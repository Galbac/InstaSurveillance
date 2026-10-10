"""Isolated PostgreSQL integration tests. No real Instagram/network login is performed."""

import importlib
import json
import os
from datetime import timedelta
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.db import get_db
from app.core.security import digest, hasher, now
from app.main import app
from app.models import (
    AdminMFA,
    AuthToken,
    Base,
    Comparison,
    Job,
    Member,
    Profile,
    Snapshot,
    User,
)

pytestmark = pytest.mark.skipif(
    os.getenv("TEST_POSTGRES_ENABLED") != "1",
    reason="Run through migration container with TEST_POSTGRES_ENABLED=1",
)


@pytest.fixture
def context(monkeypatch, tmp_path):
    original = get_settings()
    url = make_url(original.database_url)
    name = "insta_test_" + uuid4().hex[:16]
    admin = psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname=url.database,
        autocommit=True,
    )
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    target = url.set(database=name)
    engine = create_engine(target, pool_size=20, max_overflow=30)
    Base.metadata.create_all(engine)
    from sqlalchemy import text

    from app.integrations.revocation import CREATE_FUNCTION

    with engine.begin() as connection:
        connection.execute(text(CREATE_FUNCTION))
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setenv("DATABASE_URL", target.render_as_string(hide_password=False))
    monkeypatch.setenv("LEDGER_DIRECTORY", str(tmp_path / "ledger"))
    monkeypatch.setenv("STORAGE_BACKEND", "filesystem")
    monkeypatch.setenv("INSTAGRAM_UNLIMITED_TEST_RUNS", "false")
    monkeypatch.setenv("STORAGE_DIRECTORY", str(tmp_path / "files"))
    (tmp_path / "files").mkdir()
    get_settings.cache_clear()
    for name_module in (
        "app.core.db",
        "app.jobs.tasks",
        "app.jobs.runtime",
        "app.jobs.snapshots",
        "app.jobs.comparisons",
        "app.jobs.exporter",
        "app.jobs.maintenance",
    ):
        module = importlib.import_module(name_module)
        monkeypatch.setattr(module, "SessionLocal", factory)
    from app import main

    monkeypatch.setattr(main, "settings", get_settings())
    monkeypatch.setattr(main, "engine", engine)

    async_test_engine = create_async_engine(target, pool_size=20, max_overflow=30)
    async_factory = async_sessionmaker(async_test_engine, expire_on_commit=False)
    monkeypatch.setattr(importlib.import_module("app.core.db"), "AsyncSessionLocal", async_factory)

    async def database():
        async with async_factory() as session:
            yield session

    app.dependency_overrides[get_db] = database
    from app.core import dependencies
    from app.modules import auth

    monkeypatch.setattr(auth, "rate_limit", lambda *args: None)
    monkeypatch.setattr(dependencies, "rate_limit", lambda *args: None)
    with factory() as db:
        user = User(email="owner@example.com", password_hash=hasher.hash("test-password-long"), verified=True)
        db.add(user)
        db.flush()
        profile = Profile(user_id=user.id, username="owner")
        db.add(profile)
        db.commit()
        uid, pid = user.id, profile.id
    with TestClient(app) as client:
        csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
        assert (
            client.post(
                "/api/v1/auth/login",
                json={"email": "owner@example.com", "password": "test-password-long"},
                headers={"X-CSRF-Token": csrf},
            ).status_code
            == 200
        )
        yield client, factory, uid, pid
        client.portal.call(async_test_engine.dispose)
    app.dependency_overrides.clear()
    engine.dispose()
    get_settings.cache_clear()
    admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
    admin.close()


def mutate(client, method, path, **kwargs):
    csrf = client.get("/api/v1/auth/csrf").json()["csrf_token"]
    return client.request(
        method, "/api/v1" + path, headers={"X-CSRF-Token": csrf, **kwargs.pop("headers", {})}, **kwargs
    )


def test_failed_login_device_persists_without_credentials_and_rejects_stale_generation(context, monkeypatch):
    from types import SimpleNamespace

    from cryptography.fernet import Fernet

    from app.integrations.instagram import ProviderError
    from app.jobs import tasks
    from app.models import SessionSecret

    _, factory, uid, pid = context
    synthetic_cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(tasks, "session_cipher", lambda version=None: synthetic_cipher)
    with factory() as db:
        job = Job(user_id=uid, profile_id=pid, kind="connect", status="connecting", details={"generation": 0})
        db.add(job)
        db.commit()
        identity = job.id
    guard = SimpleNamespace(job_id=identity)
    client = SimpleNamespace(
        get_settings=lambda: {
            "uuids": {"uuid": "stable-device"},
            "usdid": {"private_key": "synthetic-attestation-key"},
            "password": "never-persist",
            "verification_code": "never-persist",
            "authorization_data": {"sessionid": "unverified-session"},
            "cookies": {"sessionid": "unverified-session"},
        }
    )
    tasks.persist_login_device(guard, client)
    with factory() as db:
        secret = db.get(SessionSecret, pid)
        assert secret
        stored = json.loads(
            tasks.session_cipher(secret.key_version).decrypt(secret.encrypted_settings.encode())
        )
        assert stored == {
            "uuids": {"uuid": "stable-device"},
            "usdid": {"private_key": "synthetic-attestation-key"},
        }
        profile = db.get(Profile, pid)
        profile.generation += 1
        db.commit()
    with pytest.raises(ProviderError, match="cancelled"):
        tasks.persist_login_device(guard, client)


def snapshot(factory, pid, followers, following, day=0):
    from app.domain.analytics import Relationships

    with factory() as db:
        data = Relationships({n: n for n in followers}, {n: n for n in following})
        row = Snapshot(
            profile_id=pid,
            source="archive",
            identity_mode="username",
            completeness="user_confirmed",
            checksum=uuid4().hex,
            observed_at=now() + timedelta(days=day),
            counts=data.summary(),
            provenance={"parser_version": "1"},
            storage_bytes=100,
        )
        db.add(row)
        db.flush()
        for relation, rows in [("followers", data.followers), ("following", data.following)]:
            for key, username in rows.items():
                db.add(Member(snapshot_id=row.id, relation=relation, identity_key=key, username=username))
        db.commit()
        return row.id


def test_categories_cursor_and_tenant_isolation(context):
    c, f, uid, pid = context
    snapshot(f, pid, ["a", "b", "c"], ["a", "z"])
    page = c.get(f"/api/v1/profiles/{pid}/people?category=followers&limit=2").json()
    assert [r["username"] for r in page["items"]] == ["a", "b"]
    assert page["total"] == 3
    next_page = c.get(
        f"/api/v1/profiles/{pid}/people",
        params={"category": "followers", "limit": 2, "cursor": page["next_cursor"]},
    ).json()
    assert [r["username"] for r in next_page["items"]] == ["c"]
    assert (
        c.get(
            f"/api/v1/profiles/{pid}/people", params={"category": "fans", "cursor": page["next_cursor"]}
        ).status_code
        == 400
    )
    assert c.get(f"/api/v1/profiles/{pid}/people?limit=101").status_code == 422
    with f() as db:
        other = User(email="other@example.com", password_hash="unused", verified=True)
        db.add(other)
        db.flush()
        p = Profile(user_id=other.id, username="other")
        db.add(p)
        db.commit()
        foreign = p.id
    assert c.get(f"/api/v1/profiles/{foreign}/snapshots").status_code == 404


def test_async_comparison_export_and_duplicate_request(context):
    c, f, uid, pid = context
    left = snapshot(f, pid, ["a", "gone"], ["a"], -1)
    right = snapshot(f, pid, ["a", "new"], ["a"])
    payload = {"before_snapshot_id": left, "after_snapshot_id": right}
    headers = {"Idempotency-Key": uuid4().hex}
    first = mutate(c, "POST", f"/profiles/{pid}/comparisons", json=payload, headers=headers)
    assert first.status_code == 202
    second = mutate(c, "POST", f"/profiles/{pid}/comparisons", json=payload, headers=headers)
    assert second.json()["id"] == first.json()["id"]
    from app.jobs.tasks import process

    with f() as db:
        job = db.get(Comparison, first.json()["id"]).job_id
    process.run(job)
    detail = c.get("/api/v1/comparisons/" + first.json()["id"]).json()
    assert detail["status"] == "completed", detail
    events = c.get("/api/v1/comparisons/" + first.json()["id"] + "/events").json()["items"]
    assert {(x["username"], x["type"]) for x in events} == {("gone", "removed"), ("new", "added")}
    result = mutate(
        c,
        "POST",
        "/exports",
        json={"scope": "list", "format": "csv", "profile_id": pid, "category": "followers"},
    )
    assert result.status_code == 202, result.text
    status = c.get("/api/v1/exports/" + result.json()["id"]).json()
    process.run(status["job"]["id"])
    download = c.get("/api/v1/exports/" + result.json()["id"] + "/download")
    assert download.status_code == 200 and "new" in download.text
    assert download.headers["cache-control"] == "no-store"
    from app.models import ExportJob

    with f() as db:
        row = db.get(ExportJob, result.json()["id"])
        row.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert c.get("/api/v1/exports/" + result.json()["id"] + "/download").status_code == 410


def test_hard_killed_process_recovers_without_duplicate_publication(context, tmp_path):
    import subprocess
    import sys
    import time

    from app.core.errors import AppError
    from app.jobs.maintenance import recover_jobs
    from app.jobs.runtime import JobGuard, finish
    from app.jobs.tasks import process
    from app.models import ChangeEvent, Outbox

    c, factory, _uid, pid = context
    before = snapshot(factory, pid, ["gone"], [], -1)
    after = snapshot(factory, pid, ["new"], [])
    response = mutate(
        c,
        "POST",
        f"/profiles/{pid}/comparisons",
        json={
            "before_snapshot_id": before,
            "after_snapshot_id": after,
        },
    )
    assert response.status_code == 202
    comparison_id = response.json()["id"]
    with factory() as db:
        job_id = db.get(Comparison, comparison_id).job_id
    marker = tmp_path / "claimed.json"
    # Real OS process with its own DB connection; SIGKILL prevents orderly cleanup.
    script = """
import json,sys,time
from pathlib import Path
from app.jobs.runtime import claim
guard=claim(sys.argv[1])
assert guard is not None
Path(sys.argv[2]).write_text(json.dumps({'token':guard.run_token}))
time.sleep(60)
"""
    child = subprocess.Popen([sys.executable, "-c", script, job_id, str(marker)])
    try:
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline and child.poll() is None:
            time.sleep(0.05)
        assert marker.exists(), "Child did not claim the job"
        old_token = json.loads(marker.read_text())["token"]
        child.kill()
        assert child.wait(timeout=5) < 0
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
    with factory() as db:
        job = db.get(Job, job_id)
        assert job.status == "running" and job.attempts == 1
        job.heartbeat_at = now() - timedelta(minutes=5)
        db.commit()
    recover_jobs()
    recover_jobs()
    with pytest.raises(AppError):
        JobGuard(job_id, old_token)()
    finish(JobGuard(job_id, old_token))
    with factory() as db:
        assert db.get(Job, job_id).status == "queued"
        assert len(list(db.scalars(select(Outbox).where(Outbox.reference == job_id)))) == 2
    process.run(job_id)
    with pytest.raises(AppError):
        JobGuard(job_id, old_token)()
    process.run(job_id)  # Re-delivery must not publish another result.
    with factory() as db:
        assert db.get(Job, job_id).status == "completed"
        assert db.get(Job, job_id).attempts == 2
        events = list(db.scalars(select(ChangeEvent).where(ChangeEvent.comparison_id == comparison_id)))
        assert {(event.username, event.type) for event in events} == {("gone", "removed"), ("new", "added")}
        assert len(events) == 2


def test_real_broker_connection_failure_reaches_bounded_dead_letter(context, monkeypatch):
    import socket
    import time
    from types import SimpleNamespace

    from celery import Celery

    from app.jobs import tasks
    from app.jobs.maintenance import recover_jobs
    from app.models import Outbox

    c, factory, _uid, pid = context
    before = snapshot(factory, pid, ["gone"], [], -1)
    after = snapshot(factory, pid, ["new"], [])
    response = mutate(
        c,
        "POST",
        f"/profiles/{pid}/comparisons",
        json={
            "before_snapshot_id": before,
            "after_snapshot_id": after,
        },
    )
    assert response.status_code == 202
    comparison_id = response.json()["id"]
    with factory() as db:
        job_id = db.get(Comparison, comparison_id).job_id
    # Reserve a local port without listening: real TCP refusal, no shared broker disruption.
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        refused_url = f"redis://127.0.0.1:{reserved.getsockname()[1]}/0"
        monkeypatch.setenv("CELERY_BROKER_URL", refused_url)
        isolated = Celery("broker_failure_drill", broker=refused_url, set_as_current=False)
        assert isolated.conf.broker_url == refused_url
        isolated.conf.update(
            task_publish_retry=False,
            broker_connection_retry=False,
            broker_transport_options={"socket_connect_timeout": 1, "socket_timeout": 1},
        )

        def never_executed(job_id):
            raise AssertionError("The unavailable broker cannot execute a task")

        publication = isolated.task(name="drill.never_executed")(never_executed)
        monkeypatch.setattr(tasks, "celery", isolated)
        monkeypatch.setattr(tasks, "process", SimpleNamespace(apply_async=publication.apply_async))
        started = time.monotonic()
        try:
            for attempt in range(1, 4):
                with factory() as db:
                    event = db.scalar(select(Outbox).where(Outbox.reference == job_id))
                    event.next_attempt_at = now() - timedelta(seconds=1)
                    db.commit()
                tasks._dispatch()
                with factory() as db:
                    event = db.scalar(select(Outbox).where(Outbox.reference == job_id))
                    assert event.attempts == attempt and not event.delivered
                    assert event.last_error == "delivery_unavailable"
            assert time.monotonic() - started < 15
            tasks._dispatch()
            with factory() as db:
                event = db.scalar(select(Outbox).where(Outbox.reference == job_id))
                assert event.attempts == 3 and event.delivery_state == "failed"
                job = db.get(Job, job_id)
                job.updated_at = now() - timedelta(minutes=2)
                db.commit()
            recover_jobs()
            with factory() as db:
                assert db.get(Job, job_id).error_code == "queue_unavailable"
                assert db.get(Comparison, comparison_id).status == "failed"
            assert c.get(f"/api/v1/profiles/{pid}/summary").status_code == 200
        finally:
            isolated.close()


def test_multiple_json_import_confirm_and_semantic_duplicate(context):
    c, f, uid, pid = context
    files = [
        (
            "files[]",
            (
                "followers_1.json",
                json.dumps([{"string_list_data": [{"value": "Friend"}]}]),
                "application/json",
            ),
        ),
        ("files[]", ("following.json", json.dumps({"relationships_following": []}), "application/json")),
    ]
    from app.jobs.tasks import process

    timestamp = now().isoformat()
    for _ in range(2):
        response = mutate(c, "POST", f"/profiles/{pid}/imports", files=files)
        assert response.status_code == 202, response.text
        jid = response.json()["id"]
        process.run(jid)
        assert c.get("/api/v1/imports/" + jid).json()["status"] == "awaiting_confirmation"
        confirmed = mutate(
            c,
            "POST",
            f"/imports/{jid}/confirm",
            json={
                "observed_at": timestamp,
                "full_period": True,
                "followers_complete": True,
                "following_complete": True,
                "owns_data": True,
            },
        )
        assert confirmed.status_code == 202, confirmed.text
        process.run(jid)
        assert c.get("/api/v1/imports/" + jid).json()["status"] == "completed"
    with f() as db:
        assert len(list(db.scalars(select(Snapshot)))) == 1
        assert len(list(db.scalars(select(Member)))) == 1


def test_email_change_revokes_sessions_and_is_single_use(context):
    c, f, uid, pid = context
    raw = "a" * 40
    with f() as db:
        db.add(
            AuthToken(
                user_id=uid,
                purpose="email-change",
                target_email="new@example.com",
                token_hash=digest(raw),
                expires_at=now() + timedelta(minutes=5),
            )
        )
        db.commit()
    assert mutate(c, "POST", "/me/email-change/confirm", json={"token": raw}).status_code == 204
    assert c.get("/api/v1/me").status_code == 401
    assert mutate(c, "POST", "/me/email-change/confirm", json={"token": raw}).status_code == 400


def test_admin_mfa_role_gate_and_replay(context):
    c, f, uid, pid = context
    assert c.get("/api/v1/admin/users").status_code == 403
    import time

    from app.core.commands import data_cipher
    from app.core.mfa import new_seed, totp

    seed = new_seed()
    counter = int(time.time() // 30)
    with f() as db:
        db.get(User, uid).role = "admin"
        db.add(
            AdminMFA(
                user_id=uid,
                encrypted_seed=data_cipher().encrypt(seed.encode()).decode(),
                recovery_hashes=[],
                last_counter=-1,
            )
        )
        db.commit()
    assert c.get("/api/v1/admin/users").json()["error"]["code"] == "mfa_required"
    assert (
        mutate(c, "POST", "/admin/auth/mfa/challenge", json={"code": totp(seed, counter)}).status_code == 200
    )
    assert c.get("/api/v1/admin/users").status_code == 200
    assert (
        mutate(c, "POST", "/admin/auth/mfa/challenge", json={"code": totp(seed, counter)}).status_code == 403
    )


def test_connection_does_not_invent_a_deadline_after_rejected_login(context):
    client, factory, _uid, pid = context
    with factory() as db:
        profile = db.get(Profile, pid)
        profile.status = "reconnect_required"
        profile.cooldown_until = None
        db.commit()
    response = client.get(f"/api/v1/profiles/{pid}/connection")
    assert response.status_code == 200
    assert response.json()["next_allowed_at"] is None
    assert response.json()["can_sync"] is False


def test_connection_preserves_real_cooldown_and_clears_expired_deadline(context):
    client, factory, _uid, pid = context
    deadline = now() + timedelta(minutes=5)
    with factory() as db:
        profile = db.get(Profile, pid)
        profile.status = "cooldown"
        profile.cooldown_until = deadline
        db.commit()
    response = client.get(f"/api/v1/profiles/{pid}/connection")
    assert response.status_code == 200
    assert response.json()["next_allowed_at"] == deadline.isoformat().replace("+00:00", "Z")
    assert response.json()["can_sync"] is False
    with factory() as db:
        profile = db.get(Profile, pid)
        profile.status = "active"
        profile.cooldown_until = now() - timedelta(minutes=1)
        db.commit()
    response = client.get(f"/api/v1/profiles/{pid}/connection")
    assert response.status_code == 200
    assert response.json()["next_allowed_at"] is None
    assert response.json()["can_sync"] is True


def test_local_instagram_cooldown_blocks_credentials_before_vault_write(context, monkeypatch):
    from app.modules import data

    client, factory, _uid, pid = context
    calls = []
    monkeypatch.setattr(data, "redis_command", lambda *args: calls.append(args))
    with factory() as db:
        profile = db.get(Profile, pid)
        profile.status = "cooldown"
        profile.cooldown_until = now() + timedelta(hours=24)
        db.commit()
    response = mutate(
        client,
        "POST",
        "/instagram/connections",
        json={"username": "owner", "password": "synthetic-only", "accepted_connection_risks": True},
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "cooldown"
    assert calls == []
    with factory() as db:
        assert not db.scalar(select(Job).where(Job.profile_id == pid, Job.kind == "connect"))


def test_credentials_idempotency_never_hashes_password(context):
    c, f, uid, pid = context
    from starlette.requests import Request

    from app.core.commands import begin_command, finish_command

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/instagram/connections",
            "headers": [(b"idempotency-key", uuid4().hex.encode())],
        }
    )
    with f() as db:
        user = db.get(User, uid)
        record, cached = begin_command(db, user, request, {"password": "secret"}, credentials=True)
        finish_command(record, {"id": "safe"})
        db.commit()
        assert record.request_hash is None and "secret" not in record.encrypted_response


def test_privacy_immediate_access_stop_cleanup_and_ledger(context):
    c, f, uid, pid = context
    snapshot(f, pid, ["a"], [])
    result = mutate(
        c,
        "POST",
        "/privacy/delete-account",
        json={"password": "test-password-long", "confirmation": "УДАЛИТЬ"},
    )
    assert result.status_code == 202, result.text
    assert c.get("/api/v1/me").status_code == 401
    from app.integrations.ledger import records

    assert any(x["target_id"] == uid for x in records())
    from app.jobs.maintenance import cleanup_deletions

    cleanup_deletions()
    receipt = result.json()
    headers = {"Authorization": "Receipt " + receipt["receipt_token"]}
    status = c.get("/api/v1/privacy/requests/" + receipt["id"], headers=headers)
    assert status.json()["status"] == "completed", status.text
    assert c.get("/api/v1/privacy/requests/" + receipt["id"], headers=headers).status_code in (401, 404)
    with f() as db:
        assert db.get(User, uid) is None and not list(db.scalars(select(Snapshot)))


def test_run_budget_survives_disconnect_and_stale_job_recovery(context):
    c, f, uid, pid = context
    from app.jobs.maintenance import recover_jobs
    from app.models import SessionSecret

    with f() as db:
        profile = db.get(Profile, pid)
        profile.external_id = "synthetic-external-123"
        profile.status = "active"
        profile.paused = False
        db.add(SessionSecret(profile_id=pid, encrypted_settings="synthetic-no-network", key_version="1"))
        db.commit()
    response = mutate(c, "POST", f"/profiles/{pid}/syncs", json={})
    assert response.status_code == 202, response.text
    jid = response.json()["id"]
    with f() as db:
        job = db.get(Job, jid)
        job.status = "syncing"
        job.heartbeat_at = now() - timedelta(minutes=5)
        job.details = {**job.details, "run_token": "stale"}
        db.commit()
    recover_jobs()
    with f() as db:
        assert db.get(Job, jid).status == "partial"
        assert db.get(Profile, pid).status == "active"
    limited = mutate(c, "POST", f"/profiles/{pid}/syncs", json={})
    assert limited.status_code == 429 and "retry-after" in limited.headers
    mutate(c, "DELETE", f"/profiles/{pid}/connection")
    with f() as db:
        profile = db.get(Profile, pid)
        profile.external_id = "synthetic-external-123"
        profile.status = "active"
        profile.paused = False
        db.commit()
    assert mutate(c, "POST", f"/profiles/{pid}/syncs", json={}).status_code == 429


def test_old_snapshot_insertion_and_middle_deletion_rebuild_adjacency(context):
    c, f, uid, pid = context
    first = snapshot(f, pid, ["a"], [], -3)
    middle = snapshot(f, pid, ["a", "b"], [], -2)
    latest = snapshot(f, pid, ["a", "c"], [], -1)
    from app.jobs.snapshots import enqueue_neighbors

    with f() as db:
        enqueue_neighbors(db, db.get(Snapshot, middle))
        db.commit()
        assert {(x.before_id, x.after_id) for x in db.scalars(select(Comparison))} == {
            (first, middle),
            (middle, latest),
        }
    response = mutate(c, "DELETE", "/snapshots/" + middle)
    assert response.status_code == 202, response.text
    with f() as db:
        assert db.get(Snapshot, middle) is None
        assert {(x.before_id, x.after_id) for x in db.scalars(select(Comparison))} == {(first, latest)}
    summary = c.get(f"/api/v1/profiles/{pid}/summary").json()
    assert summary["snapshot"]["id"] == latest and summary["previous_snapshot"]["id"] == first


@pytest.mark.parametrize("source", ["instagrapi", "aiograpi"])
def test_cancel_generation_prevents_publication_and_preserves_history(context, source):
    c, f, uid, pid = context
    from app.core.errors import AppError
    from app.domain.analytics import Relationships
    from app.jobs.runtime import claim
    from app.jobs.snapshots import publish

    with f() as db:
        profile = db.get(Profile, pid)
        profile.status = "active"
        profile.external_id = "synthetic-123"
        profile.paused = False
        job = Job(user_id=uid, profile_id=pid, kind="sync", details={"generation": profile.generation})
        db.add(job)
        db.commit()
        jid = job.id
    guard = claim(jid)
    assert guard is not None
    mutate(c, "DELETE", f"/profiles/{pid}/connection")
    with pytest.raises(AppError):
        publish(guard, Relationships({"1": "a"}, {}), now(), source, "collection_validated", "stable_id", {})
    with f() as db:
        assert not list(db.scalars(select(Snapshot)))


def test_partial_followers_do_not_block_complete_following_comparison(context):
    c, f, uid, pid = context
    from app.jobs.tasks import process

    before = snapshot(f, pid, ["a", "missing"], ["keep", "gone"], -1)
    after = snapshot(f, pid, ["a"], ["keep"], 0)
    with f() as db:
        for sid in (before, after):
            row = db.get(Snapshot, sid)
            row.completeness = "partial"
            row.provenance = {
                "following_completeness": "collection_validated",
                "expected_following": row.counts["following"],
            }
        db.commit()
    response = mutate(
        c,
        "POST",
        f"/profiles/{pid}/comparisons",
        json={"before_snapshot_id": before, "after_snapshot_id": after},
    )
    assert response.status_code == 202, response.text
    cid = response.json()["id"]
    process.run(c.get(f"/api/v1/comparisons/{cid}").json()["job"]["id"])
    status = c.get(f"/api/v1/comparisons/{cid}").json()
    assert status["compared_relations"] == ["following"]
    assert status["counts"] == {"following_removed": 1}
    events = c.get(f"/api/v1/comparisons/{cid}/events").json()["items"]
    assert [(x["username"], x["relation"], x["type"]) for x in events] == [("gone", "following", "removed")]


def test_unlimited_local_runs_skip_service_limits_but_keep_provider_cooldown(context, monkeypatch):
    c, f, uid, pid = context
    from app.models import SessionSecret

    monkeypatch.setenv("INSTAGRAM_UNLIMITED_TEST_RUNS", "true")
    monkeypatch.setenv("APP_ENV", "development")
    get_settings.cache_clear()
    with f() as db:
        profile = db.get(Profile, pid)
        profile.external_id = "synthetic-owner"
        profile.status = "active"
        profile.paused = False
        db.add(SessionSecret(profile_id=pid, encrypted_settings="synthetic-no-network", key_version="1"))
        db.commit()
    for _ in range(5):
        assert c.get(f"/api/v1/profiles/{pid}/connection").json()["can_sync"] is True
        response = mutate(c, "POST", f"/profiles/{pid}/syncs", json={})
        assert response.status_code == 202, response.text
        with f() as db:
            db.get(Job, response.json()["id"]).status = "completed"
            db.get(Profile, pid).status = "active"
            db.commit()
    with f() as db:
        db.get(Profile, pid).cooldown_until = now() + timedelta(hours=1)
        db.commit()
    assert c.get(f"/api/v1/profiles/{pid}/connection").json()["can_sync"] is False
    assert mutate(c, "POST", f"/profiles/{pid}/syncs", json={}).status_code == 429


def test_partial_snapshot_is_readable_but_never_generates_unfollow_events(context, monkeypatch):
    c, f, uid, pid = context
    from app.core.errors import AppError
    from app.domain.analytics import Relationships
    from app.jobs.runtime import claim
    from app.jobs.snapshots import publish
    from app.modules.query_service import event_query

    previous = snapshot(f, pid, ["a", "missing"], [], -1)
    with f() as db:
        profile = db.get(Profile, pid)
        profile.status = "active"
        profile.paused = False
        profile.external_id = "synthetic-owner"
        db.get(Snapshot, previous).identity_mode = "stable_id"
        job = Job(user_id=uid, profile_id=pid, kind="sync", details={"generation": profile.generation})
        db.add(job)
        db.commit()
        jid = job.id
    guard = claim(jid)
    assert guard is not None
    sid = publish(
        guard,
        Relationships({"a": "a"}, {}, avatars={"a": "https://cdn.example.fbcdn.net/avatar.jpg"}),
        now(),
        "aiograpi",
        "partial",
        "stable_id",
        {"expected_followers": 2},
    )
    with f() as db:
        assert db.get(Job, jid).status == "partial"
        assert db.get(Snapshot, sid).completeness == "partial"
        assert not list(db.scalars(select(Comparison)))
        with pytest.raises(AppError, match="snapshot_not_comparable"):
            event_query(db.get(Snapshot, previous), db.get(Snapshot, sid))
    summary = c.get(f"/api/v1/profiles/{pid}/summary")
    assert summary.status_code == 200
    assert summary.json()["snapshot"]["completeness"] == "partial"
    assert summary.json()["changes"] is None
    people = c.get(f"/api/v1/profiles/{pid}/people?category=followers")
    assert people.status_code == 200
    assert people.json()["completeness"] == "partial"
    assert [x["username"] for x in people.json()["items"]] == ["a"]
    assert (
        people.json()["items"][0]["avatar_url"] == f"/api/v1/profiles/{pid}/snapshots/{sid}/people/a/avatar"
    )

    from app.integrations import avatars

    async def image(url):
        assert url == "https://cdn.example.fbcdn.net/avatar.jpg"
        return b"synthetic-jpeg", "image/jpeg"

    monkeypatch.setattr(avatars, "fetch_avatar", image)
    photo = c.get(people.json()["items"][0]["avatar_url"])
    assert photo.status_code == 200 and photo.content == b"synthetic-jpeg"
    assert photo.headers["cache-control"] == "no-store"
    assert c.get(f"/api/v1/profiles/{pid}/snapshots/{uuid4()}/people/a/avatar").status_code == 404


def test_deletion_waits_for_inflight_object_write(context):
    c, f, uid, _ = context
    from app.integrations.storage import write_finished
    from app.jobs.maintenance import cleanup_deletions
    from app.models import DeletionRequest, FileObject

    key = f"imports/{uid}/synthetic.zip"
    with f() as db:
        db.add(
            FileObject(
                owner=uid,
                key=key,
                size=10,
                expires_at=now() + timedelta(hours=1),
                writing_until=now() + timedelta(minutes=5),
            )
        )
        db.commit()
    response = mutate(
        c,
        "POST",
        "/privacy/delete-account",
        json={"password": "test-password-long", "confirmation": "УДАЛИТЬ"},
    )
    assert response.status_code == 202, response.text
    cleanup_deletions()
    with f() as db:
        request = db.scalar(select(DeletionRequest).where(DeletionRequest.owner == uid))
        assert request.status == "queued" and key in request.files
    write_finished(key)
    cleanup_deletions()
    with f() as db:
        request = db.scalar(select(DeletionRequest).where(DeletionRequest.owner == uid))
        assert request.status == "completed" and request.files == []
        assert db.scalar(select(FileObject).where(FileObject.key == key)) is None


def test_unverified_user_can_delete_own_service_account(context):
    c, f, uid, _ = context
    with f() as db:
        db.get(User, uid).verified = False
        db.commit()
    result = mutate(
        c,
        "POST",
        "/privacy/delete-account",
        json={"password": "test-password-long", "confirmation": "УДАЛИТЬ"},
    )
    assert result.status_code == 202
    assert c.get("/api/v1/me").status_code == 401


def test_history_clear_preserves_connection_and_cancels_exports(context):
    from app.jobs.maintenance import cleanup_deletions
    from app.models import ExportJob, SessionSecret

    c, factory, uid, pid = context
    sid = snapshot(factory, pid, ["a", "b"], ["a"])
    with factory() as db:
        profile = db.get(Profile, pid)
        profile.status, profile.external_id, profile.paused = "active", "synthetic-id", False
        db.add(
            Job(
                user_id=uid,
                profile_id=pid,
                kind="import",
                status="completed",
                details={"samples": {"followers": ["private_sample"]}, "counts": {"followers": 2}},
            )
        )
        db.add(SessionSecret(profile_id=pid, encrypted_settings="synthetic", key_version="1"))
        db.commit()
    result = mutate(c, "POST", "/exports", json={"scope": "account", "format": "json"})
    assert result.status_code == 202, result.text
    headers = {"Idempotency-Key": uuid4().hex}
    payload = {"password": "test-password-long", "confirmation": "УДАЛИТЬ"}
    cleared = mutate(c, "POST", f"/profiles/{pid}/history/delete", json=payload, headers=headers)
    assert cleared.status_code == 202, cleared.text
    assert cleared.headers["location"].endswith(cleared.json()["id"])
    repeated = mutate(c, "POST", f"/profiles/{pid}/history/delete", json=payload, headers=headers)
    assert repeated.json()["id"] == cleared.json()["id"]
    with factory() as db:
        assert db.get(Snapshot, sid) is None
        profile = db.get(Profile, pid)
        assert profile.status == "active" and not profile.paused and profile.external_id == "synthetic-id"
        assert db.get(SessionSecret, pid) is not None
        imported = db.scalar(select(Job).where(Job.profile_id == pid, Job.kind == "import"))
        assert imported.details == {"warnings": ["history_cleared"]}
        export = db.get(ExportJob, result.json()["id"])
        assert export.status == "expired" and db.get(Job, export.job_id).status == "cancelled"
    cleanup_deletions()
    receipt = c.get(cleared.headers["location"]).json()
    assert receipt["status"] == "completed"
    future = snapshot(factory, pid, ["new"], [])
    from app.backups import sanitize_restore

    sanitize_restore(get_settings().database_url)
    with factory() as db:
        assert db.get(Snapshot, future) is not None and db.get(Profile, pid) is not None


def test_disconnect_commits_before_vault_failure(context, monkeypatch):
    from app.integrations import vault
    from app.models import SessionSecret

    c, factory, uid, pid = context
    with factory() as db:
        db.add(SessionSecret(profile_id=pid, encrypted_settings="synthetic", key_version="1"))
        job = Job(user_id=uid, profile_id=pid, kind="connect", status="awaiting_2fa")
        db.add(job)
        db.commit()
        jid = job.id

    class Unavailable:
        @classmethod
        def from_url(cls, *args, **kwargs):
            with factory() as db:
                assert db.get(SessionSecret, pid) is None
                assert db.get(Job, jid).status == "cancelled"
            raise ConnectionError("synthetic outage")

    monkeypatch.setattr(vault, "redis_command", lambda *args: Unavailable.from_url())
    response = mutate(c, "DELETE", f"/profiles/{pid}/connection")
    assert response.status_code == 202 and response.headers["location"].endswith("/connection")
    assert c.get(response.headers["location"]).json()["status"] == "disconnected"


def test_comparison_composite_constraints(context):
    from sqlalchemy.exc import IntegrityError

    _, factory, uid, pid = context
    left = snapshot(factory, pid, ["a"], [])
    with factory() as db:
        other = Profile(user_id=uid, username="another")
        db.add(other)
        db.commit()
        other_id = other.id
    right = snapshot(factory, other_id, ["b"], [])
    with factory() as db:
        db.add(Comparison(profile_id=pid, before_id=left, after_id=right))
        with pytest.raises(IntegrityError):
            db.commit()


def test_email_delivery_owner_and_safe_fields(context):
    from app.models import Outbox

    c, factory, uid, _ = context
    with factory() as db:
        db.add_all(
            [
                Outbox(
                    kind="email",
                    reference=uid,
                    payload={"sealed": "do-not-expose"},
                    delivery_state="failed",
                    attempts=3,
                    last_error="smtp_unavailable",
                ),
                Outbox(kind="email", reference="foreign", payload={"sealed": "foreign"}),
            ]
        )
        db.commit()
    response = c.get("/api/v1/me/email-deliveries")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert len(items) == 1 and items[0]["attempts"] == 3
    assert "sealed" not in response.text and "foreign" not in response.text
    assert items[0]["next_attempt_at"] is None


def test_export_event_filters_and_people_sort(context):
    from app.jobs.tasks import process

    c, factory, _, pid = context
    left = snapshot(factory, pid, ["a", "gone"], ["old"], -1)
    right = snapshot(factory, pid, ["a", "new"], ["added"])
    comparison = mutate(
        c,
        "POST",
        f"/profiles/{pid}/comparisons",
        json={"before_snapshot_id": left, "after_snapshot_id": right},
    ).json()["id"]
    process.run(c.get(f"/api/v1/comparisons/{comparison}").json()["job"]["id"])
    for payload, expected in [
        (
            {"scope": "comparison", "comparison_id": comparison, "relation": "followers", "type": "removed"},
            ["gone"],
        ),
        (
            {"scope": "list", "profile_id": pid, "category": "followers", "sort": "username_desc"},
            ["new", "a"],
        ),
    ]:
        accepted = mutate(c, "POST", "/exports", json={**payload, "format": "csv"})
        assert accepted.status_code == 202, accepted.text
        eid = accepted.json()["id"]
        process.run(c.get(f"/api/v1/exports/{eid}").json()["job"]["id"])
        import csv
        import io

        download = c.get(f"/api/v1/exports/{eid}/download")
        assert download.status_code == 200, download.text
        assert [
            row["Имя пользователя"]
            for row in csv.DictReader(io.StringIO(download.text.lstrip("\ufeff")), delimiter=";")
        ] == expected


def test_operator_limits_are_audited_and_never_relax_env(context):
    from app.models import AuditEvent, AuthSession

    c, factory, uid, _ = context
    with factory() as db:
        db.get(User, uid).role = "admin"
        for session in db.scalars(select(AuthSession).where(AuthSession.user_id == uid)):
            session.privileged_until = now() + timedelta(minutes=5)
        db.commit()
    baseline = get_settings()
    values = {
        "instagram_sync_interval_hours": baseline.instagram_sync_interval_hours + 1,
        "instagram_request_budget": max(1, baseline.instagram_request_budget - 1),
        "user_storage_quota_bytes": baseline.user_storage_quota_bytes - 1024,
        "reason": "Synthetic audit check",
    }
    response = mutate(c, "PATCH", "/admin/limits", json=values)
    assert response.status_code == 200, response.text
    assert (
        c.get("/api/v1/config/public").json()["sync_interval_hours"]
        == values["instagram_sync_interval_hours"]
    )
    assert (
        c.get("/api/v1/admin/limits").json()["user_storage_quota_bytes"] == values["user_storage_quota_bytes"]
    )
    assert (
        mutate(
            c,
            "PATCH",
            "/admin/limits",
            json={**values, "instagram_request_budget": baseline.instagram_request_budget + 1},
        ).status_code
        == 409
    )
    with factory() as db:
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "limits.update")) is not None
        db.get(User, uid).role = "support"
        db.commit()
    assert mutate(c, "PATCH", "/admin/limits", json=values).status_code == 403


def test_logout_is_one_shot_and_does_not_restore_session(context, monkeypatch):
    from app.jobs import tasks
    from app.models import SessionRevocation, SessionSecret

    c, factory, _, pid = context
    from cryptography.fernet import Fernet

    synthetic_cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(tasks, "session_cipher", lambda version=None: synthetic_cipher)
    with factory() as db:
        db.add(
            SessionSecret(
                profile_id=pid,
                encrypted_settings=tasks.session_cipher().encrypt(b"{}").decode(),
                key_version=get_settings().instagram_session_key_version,
            )
        )
        db.commit()
    response = mutate(c, "DELETE", f"/profiles/{pid}/connection")
    assert response.status_code == 202, response.text
    with factory() as db:
        capability = db.scalar(select(SessionRevocation))
        assert capability and db.get(SessionSecret, pid) is None
        identity = capability.id
    calls = []

    class Client:
        async def logout(self):
            calls.append("logout")
            raise RuntimeError("synthetic blocked logout")

    async def close_fake(client):
        pass

    monkeypatch.setattr("app.integrations.instagram.close_client", close_fake)
    monkeypatch.setattr(tasks, "new_client", lambda *args, **kwargs: Client())
    tasks.platform_logout.run(identity)
    tasks.platform_logout.run(identity)
    assert calls == ["logout"]
    with factory() as db:
        assert db.get(SessionRevocation, identity) is None
        assert db.get(SessionSecret, pid) is None
        assert db.get(Profile, pid).status == "disconnected"


def test_manual_comparison_immediately_queues_existing_automatic_pair(context):
    c, factory, _, pid = context
    left = snapshot(factory, pid, ["a"], [], -1)
    right = snapshot(factory, pid, ["b"], [])
    with factory() as db:
        pair = Comparison(profile_id=pid, before_id=left, after_id=right)
        db.add(pair)
        db.commit()
        identity = pair.id
    response = mutate(
        c,
        "POST",
        f"/profiles/{pid}/comparisons",
        json={"before_snapshot_id": left, "after_snapshot_id": right},
    )
    assert response.status_code == 202 and response.json()["id"] == identity
    assert response.headers["location"].endswith(identity)
    with factory() as db:
        assert db.get(Comparison, identity).job_id is not None


def test_history_ledger_failure_releases_reservation_without_deleting_data(context, monkeypatch):
    from app.integrations import ledger

    c, factory, _, pid = context
    sid = snapshot(factory, pid, ["a"], [])
    original = ledger.record

    def unavailable(*args, **kwargs):
        raise ConnectionError("synthetic outage")

    monkeypatch.setattr(ledger, "record", unavailable)
    payload = {"password": "test-password-long", "confirmation": "УДАЛИТЬ"}
    headers = {"Idempotency-Key": uuid4().hex}
    failed = mutate(c, "POST", f"/profiles/{pid}/history/delete", json=payload, headers=headers)
    assert failed.status_code == 503 and failed.json()["error"]["code"] == "ledger_unavailable"
    with factory() as db:
        assert db.get(Snapshot, sid) is not None
    monkeypatch.setattr(ledger, "record", original)
    assert (
        mutate(c, "POST", f"/profiles/{pid}/history/delete", json=payload, headers=headers).status_code == 202
    )


def test_async_database_io_and_cancel_return_connections(context):
    """Real async driver, event loop responsiveness and pool release after cancellation."""
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.async_io import blocking_call
    from app.core.router import request_session

    client, factory, _, _ = context

    async def verify():
        pool = create_async_engine(factory.kw["bind"].url, pool_size=2, max_overflow=0)
        sessions = async_sessionmaker(pool)
        ticks = 0
        running = True

        async def heartbeat():
            nonlocal ticks
            while running:
                ticks += 1
                await asyncio.sleep(0.01)

        async def query():
            async with sessions() as db:
                connection = await db.connection()
                raw = await connection.get_raw_connection()
                assert isinstance(raw.driver_connection, psycopg.AsyncConnection)
                await db.execute(text("SELECT pg_sleep(0.15)"))

        timer = asyncio.create_task(heartbeat())
        try:
            await asyncio.gather(query(), query())
            assert ticks >= 5, "Database wait blocked the event loop"
            ticks = 0
            async with sessions() as db:

                def sdk_wait(session):
                    import time

                    marker = request_session.set(session)
                    try:

                        def sdk():
                            assert request_session.get() is None
                            time.sleep(0.15)

                        blocking_call(sdk)
                    finally:
                        request_session.reset(marker)

                await db.run_sync(sdk_wait)
            assert ticks >= 5, "Blocking SDK work blocked the event loop"

            async def cancellable():
                async with sessions() as db:
                    await db.execute(text("SELECT pg_sleep(10)"))

            task = asyncio.create_task(cancellable())
            await asyncio.sleep(0.1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert pool.pool.checkedout() == 0
            async with sessions() as db:
                assert await db.scalar(text("SELECT 1")) == 1
        finally:
            running = False
            await timer
            await pool.dispose()

    client.portal.call(verify)


@pytest.mark.parametrize("identity_username", ["owner", "another_account"])
def test_imported_mobile_session_checks_identity_without_password_login(
    context, monkeypatch, identity_username
):
    from types import SimpleNamespace

    from cryptography.fernet import Fernet

    from app.integrations.instagram import ProviderError
    from app.jobs import tasks
    from app.models import SessionSecret
    from app.modules import data

    _, factory, uid, pid = context
    synthetic_cipher = Fernet(Fernet.generate_key())
    monkeypatch.setattr(tasks, "pending_cipher", lambda: synthetic_cipher)
    monkeypatch.setattr(tasks, "session_cipher", lambda version=None: synthetic_cipher)
    with factory() as db:
        job = Job(user_id=uid, profile_id=pid, kind="connect", status="connecting", details={"generation": 0})
        db.add(job)
        db.commit()
        job_id = job.id
    saved = {
        "authorization_data": {"sessionid": "synthetic-session", "ds_user_id": "123"},
        "uuids": {"uuid": "u", "phone_id": "p", "device_id": "android-test"},
        "device_settings": {"app_version": "449.0.0.52.84"},
    }
    encrypted = synthetic_cipher.encrypt(
        json.dumps({"username": "owner", "password": None, "session_settings": saved}).encode()
    )
    deleted = []

    class Vault:
        def get(self, key):
            return encrypted if key == "login:" + job_id else None

        def getdel(self, key):
            return None

        def delete(self, *keys):
            deleted.extend(keys)

        def lock(self, *args, **kwargs):
            return SimpleNamespace(acquire=lambda: True, release=lambda: None)

    monkeypatch.setattr(tasks.Redis, "from_url", lambda *args, **kwargs: Vault())
    monkeypatch.setattr(data, "request_sync", lambda *args: None)

    class Client:
        user_id = "123"
        policy_requests = 1
        policy_responses = []

        def login(self, *args, **kwargs):
            pytest.fail("Imported sessions must never start password login")

        async def account_info(self):
            return SimpleNamespace(username=identity_username, pk=123)

        def get_settings(self):
            return saved

    def new_client(settings, *args, **kwargs):
        assert settings == saved
        return Client()

    async def close_fake(client):
        pass

    monkeypatch.setattr("app.integrations.instagram.close_client", close_fake)
    monkeypatch.setattr(tasks, "new_client", new_client)

    class Guard:
        def __init__(self):
            self.job_id = job_id

        def __call__(self):
            pass

    if identity_username != "owner":
        with pytest.raises(ProviderError) as error:
            tasks.process_instagram(Guard())
        assert error.value.code == "identity_mismatch"
        with factory() as db:
            assert db.get(Profile, pid).status != "active"
            secret = db.get(SessionSecret, pid)
            if secret:
                assert "authorization_data" not in json.loads(
                    synthetic_cipher.decrypt(secret.encrypted_settings.encode())
                )
    else:
        tasks.process_instagram(Guard())
        with factory() as db:
            assert db.get(Profile, pid).status == "active"
            assert db.get(Job, job_id).status == "completed"
            secret = db.get(SessionSecret, pid)
            assert secret is not None
            assert "synthetic-session" not in secret.encrypted_settings
        assert "login:" + job_id in deleted


def test_forgot_and_resend_verification_and_branded_email(context):
    from app.integrations.mail import render_email_html

    c, factory, uid, _ = context
    with factory() as db:
        user = db.get(User, uid)
        real_email = user.email

    # 1. Forgot password - non-existent email gives 404
    resp = mutate(c, "POST", "/auth/forgot-password", json={"email": "nonexistent_abc@example.com"})
    assert resp.status_code == 404
    assert "не найден" in resp.json()["error"]["message"]

    # 2. Forgot password - existing email gives 202
    resp = mutate(c, "POST", "/auth/forgot-password", json={"email": real_email})
    assert resp.status_code == 202
    assert "отправлено" in resp.json()["message"]

    # 3. Resend verification - non-existent email gives 404
    resp = mutate(c, "POST", "/auth/resend-verification", json={"email": "nonexistent_abc@example.com"})
    assert resp.status_code == 404

    # 4. Resend verification - existing user unauthenticated by email gives 202
    resp = mutate(c, "POST", "/auth/resend-verification", json={"email": real_email})
    assert resp.status_code == 202
    assert "отправлен" in resp.json()["message"]

    # 5. render_email_html produces branded HTML with code and button
    html_output = render_email_html("Подтвердите email", "Код подтверждения: 1234", action_url="http://localhost:3100/verify", code="1234")
    assert "INSTASURVEILLANCE" in html_output
    assert "1234" in html_output
    assert "http://localhost:3100/verify" in html_output

