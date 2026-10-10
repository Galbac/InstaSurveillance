import time
from datetime import timedelta

from app.core.commands import data_cipher
from app.core.mfa import new_seed, totp
from app.core.security import now
from app.models import (
    AdminMFA,
    FileObject,
    Job,
    Profile,
    Snapshot,
    SupportTicket,
    User,
)
from tests.test_v1_postgres import mutate

pytest_plugins = ("tests.test_v1_postgres",)


def setup_operator(context, role: str = "admin") -> tuple[str, str]:
    c, f, uid, pid = context
    seed = new_seed()
    with f() as db:
        user = db.get(User, uid)
        user.role = role
        db.add(
            AdminMFA(
                user_id=uid,
                encrypted_seed=data_cipher().encrypt(seed.encode()).decode(),
                recovery_hashes=[],
                last_counter=-1,
            )
        )
        db.commit()
    return uid, seed


def unlock_mfa(c, seed: str) -> None:
    counter = int(time.time() // 30)
    response = mutate(c, "POST", "/admin/auth/mfa/challenge", json={"code": totp(seed, counter)})
    assert response.status_code == 200


def test_admin_auth_status_and_lifecycle(context):
    c, f, uid, pid = context
    # Regular user: 403 forbidden
    assert c.get("/api/v1/admin/auth/status").status_code == 403

    # Enroll admin
    uid, seed = setup_operator(context, "admin")

    # Before challenge: not privileged, but endpoint returns 200 (not 403 mfa_required)
    status_resp = c.get("/api/v1/admin/auth/status")
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["role"] == "admin"
    assert data["privileged"] is False
    assert data["privileged_until"] is None
    assert data["mfa_enrolled"] is True

    # Protected endpoint requires MFA
    assert c.get("/api/v1/admin/overview").json()["error"]["code"] == "mfa_required"

    # Unlock MFA
    unlock_mfa(c, seed)

    # After challenge: privileged is True with expiry
    status_after = c.get("/api/v1/admin/auth/status").json()
    assert status_after["privileged"] is True
    assert status_after["privileged_until"] is not None
    assert c.get("/api/v1/admin/overview").status_code == 200


def test_admin_overview_and_system_health(context):
    c, f, uid, pid = context
    uid, seed = setup_operator(context, "admin")
    unlock_mfa(c, seed)

    # Overview returns expanded KPI breakdowns
    overview = c.get("/api/v1/admin/overview").json()
    assert "users_active" in overview
    assert "users_suspended" in overview
    assert "profiles_active" in overview
    assert "profiles_cooldown" in overview
    assert "jobs_failed_24h" in overview
    assert "partial_snapshots_7d" in overview
    assert "tickets_open" in overview

    # System health returns DB, storage, and outbox metrics
    system = c.get("/api/v1/admin/system").json()
    assert system["db_healthy"] is True
    assert isinstance(system["db_latency_ms"], int | float)
    assert system["storage_kind"] in ("s3", "filesystem")
    assert "storage_accessible" in system
    assert "outbox_pending_count" in system


def test_admin_users_and_detail(context):
    c, f, uid, pid = context
    uid, seed = setup_operator(context, "admin")
    unlock_mfa(c, seed)

    with f() as db:
        db.add(FileObject(owner=uid, key="diag/test.csv", size=2048, expires_at=now() + timedelta(days=1)))
        db.add(SupportTicket(user_id=uid, body="Test ticket for user detail", status="open"))
        db.commit()

    # List with search filter
    users_resp = c.get("/api/v1/admin/users?role=admin").json()
    assert len(users_resp["items"]) >= 1
    assert any(u["id"] == uid for u in users_resp["items"])

    # User detail
    detail = c.get(f"/api/v1/admin/users/{uid}").json()
    assert detail["id"] == uid
    assert detail["role"] == "admin"
    assert detail["storage"]["total_bytes"] >= 2048
    assert detail["storage"]["file_count"] >= 1
    assert detail["tickets_count"] >= 1
    assert len(detail["recent_tickets"]) >= 1
    assert len(detail["audit_history"]) >= 1


def test_admin_profiles_diagnostics_and_pause_resume(context):
    c, f, uid, pid = context
    uid, seed = setup_operator(context, "admin")
    unlock_mfa(c, seed)

    with f() as db:
        # Add snapshot with partial diagnostics
        db.add(
            Snapshot(
                profile_id=pid,
                source="instagram",
                observed_at=now(),
                completeness="partial",
                checksum="abc12345",
                counts={"followers": 100, "following": 50, "mutual": 20},
                provenance={"expected_followers": 110, "expected_following": 50},
            )
        )
        db.commit()

    # Profiles list
    profiles_resp = c.get("/api/v1/admin/profiles").json()
    assert len(profiles_resp["items"]) >= 1
    item = next(p for p in profiles_resp["items"] if p["id"] == pid)
    assert item["owner_email"] is not None

    # Profile detail & snapshot diagnostics
    detail = c.get(f"/api/v1/admin/profiles/{pid}").json()
    assert detail["id"] == pid
    assert detail["latest_snapshot"] is not None
    assert detail["latest_snapshot"]["followers"] == 100
    assert detail["latest_snapshot"]["expected_followers"] == 110
    assert detail["latest_snapshot"]["is_comparable"] is False

    # Pause profile
    assert (
        mutate(c, "POST", f"/admin/profiles/{pid}/pause", json={"reason": "Suspicious activity"}).status_code
        == 204
    )
    with f() as db:
        p = db.get(Profile, pid)
        assert p.paused is True
        gen_after_pause = p.generation

    # Resume profile
    assert (
        mutate(c, "POST", f"/admin/profiles/{pid}/resume", json={"reason": "Verified legitimate"}).status_code
        == 204
    )
    with f() as db:
        p = db.get(Profile, pid)
        assert p.paused is False
        assert p.generation > gen_after_pause


def test_admin_job_retry_policy(context):
    c, f, uid, pid = context
    uid, seed = setup_operator(context, "admin")
    unlock_mfa(c, seed)

    with f() as db:
        # Eligible failed import job
        job_retryable = Job(
            user_id=uid,
            profile_id=pid,
            kind="import",
            status="failed",
            error_code="storage_unavailable",
            attempts=1,
            stage="storing",
            details={"error": "timeout"},
        )
        # Non-retryable connect job
        job_forbidden = Job(
            user_id=uid,
            profile_id=pid,
            kind="connection",
            status="failed",
            error_code="temporary_unavailable",
            attempts=1,
            stage="auth",
            details={},
        )
        db.add_all([job_retryable, job_forbidden])
        db.commit()
        rid = job_retryable.id
        fid = job_forbidden.id

    # Check retryable detail
    r_detail = c.get(f"/api/v1/admin/jobs/{rid}").json()
    assert r_detail["can_retry"] is True
    assert r_detail["retry_forbidden_reason"] is None

    # Check forbidden detail
    f_detail = c.get(f"/api/v1/admin/jobs/{fid}").json()
    assert f_detail["can_retry"] is False
    assert f_detail["retry_forbidden_reason"] is not None

    # Retry forbidden returns 409
    assert mutate(c, "POST", f"/admin/jobs/{fid}/retry").status_code == 409

    # Retry eligible returns 202
    assert mutate(c, "POST", f"/admin/jobs/{rid}/retry").status_code == 202


def test_admin_support_ticket_flow(context):
    c, f, uid, pid = context
    uid, seed = setup_operator(context, "support")
    unlock_mfa(c, seed)

    with f() as db:
        t = SupportTicket(user_id=uid, body="Need assistance with login", category="access", status="open")
        db.add(t)
        db.commit()
        tid = t.id

    ticket = c.get(f"/api/v1/admin/support/tickets/{tid}").json()
    assert ticket["status"] == "open"
    assert ticket["owner_email"] is not None

    # Reply to ticket
    rep_resp = mutate(
        c,
        "PATCH",
        f"/admin/support/tickets/{tid}",
        json={"status": "resolved", "reply": "Everything has been verified."},
    )
    assert rep_resp.status_code == 200

    updated = c.get(f"/api/v1/admin/support/tickets/{tid}").json()
    assert updated["status"] == "resolved"
    assert updated["reply"] == "Everything has been verified."
