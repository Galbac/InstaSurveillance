"""Queue entry points. PostgreSQL owns job state; broker redelivery is harmless."""

import json
from datetime import datetime, timedelta
from importlib.metadata import version
from secrets import randbelow

from redis import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.commands import data_cipher
from app.core.db import SessionLocal
from app.core.errors import AppError, required
from app.core.limits import runtime_settings as get_settings
from app.core.security import cipher, now
from app.integrations import storage
from app.integrations.archive import parse_archive
from app.integrations.instagram import (
    ProviderError,
    classify,
    client_runtime,
    collect,
    new_client,
    safe_settings,
)
from app.integrations.mail import send_email
from app.jobs.celery_app import celery
from app.jobs.notifications import notify
from app.jobs.runtime import TERMINAL, claim, finish, heartbeat
from app.jobs.snapshots import normalized_size, publish, storage_usage
from app.models import Comparison, ExportJob, FileObject, Job, Outbox, Profile, SessionSecret, User


def pending_cipher():
    return cipher(get_settings().instagram_pending_encryption_key.get_secret_value())


def session_cipher(version: str | None = None):
    settings = get_settings()
    if version and version != settings.instagram_session_key_version:
        previous = json.loads(settings.instagram_session_previous_keys.get_secret_value())
        key = previous.get(version)
    else:
        key = (
            settings.instagram_session_encryption_key.get_secret_value()
            if settings.instagram_session_encryption_key
            else None
        )
    if not key:
        raise ProviderError("reconnect_required")
    return cipher(key)


def clear_file(key: str) -> None:
    storage.remove(key)
    with SessionLocal() as db:
        obj = db.scalar(select(FileObject).where(FileObject.key == key))
        if obj:
            db.delete(obj)
        if obj and obj.job_id:
            job = db.get(Job, obj.job_id)
            if job and job.details.get("object_key") == key:
                job.details = {k: v for k, v in job.details.items() if k != "object_key"}
        db.commit()


def persist_login_device(guard, client) -> None:
    """Keep device identity across failed logins without persisting credentials."""
    device = {
        key: value
        for key, value in safe_settings(client).items()
        if key not in ("cookies", "authorization_data", "last_login")
    }
    settings = get_settings()
    with SessionLocal() as db:
        current = required(db.get(Job, guard.job_id))
        owner = db.scalar(select(User).where(User.id == current.user_id).with_for_update())
        profile = db.scalar(select(Profile).where(Profile.id == current.profile_id).with_for_update())
        if (
            not owner
            or owner.status != "active"
            or not profile
            or profile.generation != current.details.get("generation")
            or current.status in TERMINAL
        ):
            raise ProviderError("cancelled")
        secret = db.get(SessionSecret, profile.id)
        if secret is None:
            secret = SessionSecret(profile_id=profile.id)
            db.add(secret)
        else:
            # Updating device metadata must retain any previously saved session.
            previous = json.loads(
                session_cipher(secret.key_version).decrypt(secret.encrypted_settings.encode())
            )
            device = {**previous, **device}
        secret.encrypted_settings = session_cipher().encrypt(json.dumps(device).encode()).decode()
        secret.key_version = settings.instagram_session_key_version
        db.commit()


def process_import(guard):
    settings = get_settings()
    with SessionLocal() as db:
        job = required(db.get(Job, guard.job_id))
        details = job.details.copy()
        owner = job.user_id
    guard.progress("parsing")
    from time import monotonic

    parsing_started = monotonic()
    report = {}
    try:
        with storage.open_spooled(details["object_key"], settings.max_upload_bytes) as stream:
            data = parse_archive(
                stream,
                details["filename"],
                settings.max_unpacked_bytes,
                settings.max_archive_entries,
                settings.max_snapshot_members,
                report=report,
            )
    finally:
        from app.core.metrics import record_job

        record_job("parsing", monotonic() - parsing_started)
    guard()
    provenance = {
        **report,
        "upload_checksum": details.get("upload_checksum"),
        "parser_version": "1",
        "algorithm_version": "1",
        "observed_at_source": "user_declared",
        "imported_at": now().isoformat(),
        "followers_completeness": "user_confirmed",
        "following_completeness": "user_confirmed",
        "warnings": ["ownership_not_verified", "creation_time_not_verified", "username_rename_ambiguous"],
    }
    expected = normalized_size(data, provenance)
    with SessionLocal() as db:
        job = required(db.scalar(select(Job).where(Job.id == guard.job_id).with_for_update()))
        if not job or job.status == "cancelled":
            raise AppError("cancelled", "Импорт отменён", 409)
        used = storage_usage(db, owner)
        if used + expected > settings.user_storage_quota_bytes:
            raise AppError("storage_quota", "Квота истории исчерпана", 409)
        if not details.get("confirmed"):
            job.status, job.stage = "awaiting_confirmation", "preview_ready"
            job.details = {
                **job.details,
                "counts": data.summary(),
                "samples": {
                    "followers": list(data.followers.values())[:10],
                    "following": list(data.following.values())[:10],
                },
                "warnings": provenance["warnings"],
                "expected_bytes": expected,
                "used_bytes": used,
                "expires_at": (
                    job.created_at + timedelta(hours=settings.import_confirm_ttl_hours)
                ).isoformat(),
            }
            db.commit()
            return
    guard.progress("committing")
    publish(
        guard,
        data,
        datetime.fromisoformat(details["observed_at"]),
        "archive",
        "user_confirmed",
        "username",
        provenance,
    )
    try:
        clear_file(details["object_key"])
    except Exception:
        pass  # File registry persists; maintenance retries cleanup independently.


def process_instagram(guard):
    with client_runtime() as (runner, clients):
        _process_instagram(guard, runner, clients)


def _process_instagram(guard, runner, clients):
    settings = get_settings()
    proxy_url = settings.instagram_proxy_url.get_secret_value() if settings.instagram_proxy_url else None
    vault = Redis.from_url(settings.auth_vault_url)
    with SessionLocal() as db:
        job = required(db.get(Job, guard.job_id))
        profile = required(db.get(Profile, job.profile_id))
        job_kind, details, profile_id = job.kind, job.details.copy(), profile.id
        lock_key = "instagram:" + (profile.external_id or profile.username)
    lock = Redis.from_url(settings.redis_url).lock(
        lock_key, timeout=settings.instagram_sync_hard_timeout + 60, blocking_timeout=0
    )
    if not lock.acquire():
        raise ProviderError("already_running")
    try:
        guard()
        if job_kind == "connect":
            encrypted = vault.get("login:" + guard.job_id)
            if not encrypted:
                raise ProviderError("expired")
            credentials = json.loads(pending_cipher().decrypt(encrypted))
            pending = vault.get("pending:" + guard.job_id)
            stored = json.loads(pending_cipher().decrypt(pending)) if pending else None
            if stored is None:
                with SessionLocal() as db:
                    secret = db.get(SessionSecret, profile_id)
                    if secret:
                        stored = json.loads(
                            session_cipher(secret.key_version).decrypt(secret.encrypted_settings.encode())
                        )
            imported_session = credentials.get("session_settings")
            if imported_session:
                stored = imported_session
            remaining = settings.instagram_request_budget - details.get("requests", 0)
            if remaining <= 0:
                raise ProviderError("budget_exceeded")
            client = new_client(
                stored,
                min(remaining, 30),
                settings.instagram_request_spacing_seconds,
                guard,
                proxy_url=proxy_url,
            )
            clients.append(client)
            code = vault.getdel("code:" + guard.job_id)
            verification = pending_cipher().decrypt(code).decode() if code else ""
            persist_login_device(guard, client)
            try:
                if not imported_session:
                    runner.run(
                        client.login(
                            credentials["username"], credentials["password"], verification_code=verification
                        )
                    )
            except Exception as error:
                import structlog

                diagnostic = {
                    "provider_responses": client.policy_responses.copy(),
                    "provider_version": version("aiograpi"),
                    "requests": details.get("requests", 0) + client.policy_requests,
                }
                failure = error
                if not isinstance(failure, AppError):
                    status = getattr(client.last_response, "status_code", None)
                    failure = ProviderError(
                        classify(error), http_status=status if status and status >= 400 else None
                    )
                failure.details.update(diagnostic)

                structlog.get_logger().error(
                    "instagram_login_failed",
                    job_id=guard.job_id,
                    error_type=type(error).__name__,
                    error_code=classify(error),
                    provider_http_status=getattr(error, "details", {}).get("provider_http_status"),
                    provider_responses=client.policy_responses,
                )
                if classify(error) not in ("cancelled", "expired"):
                    persist_login_device(guard, client)
                if classify(error) != "awaiting_2fa":
                    raise failure from None
                ttl = vault.ttl("login:" + guard.job_id)
                if ttl <= 0:
                    raise ProviderError("expired") from None
                vault.setex(
                    "pending:" + guard.job_id,
                    ttl,
                    pending_cipher().encrypt(json.dumps(safe_settings(client)).encode()),
                )
                with SessionLocal() as db:
                    db.scalar(select(User).where(User.id == job.user_id).with_for_update())
                    profile = required(
                        db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
                    )
                    job = required(db.scalar(select(Job).where(Job.id == guard.job_id).with_for_update()))
                    if job.status == "cancelled":
                        raise ProviderError("cancelled") from None
                    job.status, job.stage = "awaiting_2fa", "verification_required"
                    job.details = {
                        **job.details,
                        **diagnostic,
                        "method": "supported_code",
                        "requests": details.get("requests", 0) + client.policy_requests,
                        "expires_at": (now() + timedelta(seconds=ttl)).isoformat(),
                    }
                    profile = required(db.get(Profile, profile_id))
                    profile.status = "awaiting_2fa"
                    db.commit()
                return
            guard()
            from app.integrations.archive import normalize_username

            try:
                identity = runner.run(client.account_info())
            except Exception as error:
                import structlog

                diagnostic = {
                    "provider_responses": client.policy_responses.copy(),
                    "provider_version": version("aiograpi"),
                    "requests": details.get("requests", 0) + client.policy_requests,
                }
                failure = error
                if not isinstance(failure, AppError):
                    status = getattr(client.last_response, "status_code", None)
                    failure = ProviderError(
                        classify(error), http_status=status if status and status >= 400 else None
                    )
                failure.details.update(diagnostic)
                structlog.get_logger().error(
                    "instagram_identity_check_failed",
                    job_id=guard.job_id,
                    error_type=type(error).__name__,
                    error_code=classify(error),
                    provider_http_status=getattr(error, "details", {}).get("provider_http_status"),
                )
                raise failure from None
            if normalize_username(identity.username) != credentials["username"] or str(identity.pk) != str(
                client.user_id
            ):
                raise ProviderError("identity_mismatch")
            from sqlalchemy import delete

            from app.modules.data import request_sync

            with SessionLocal() as db:
                owner = db.scalar(select(User).where(User.id == job.user_id).with_for_update())
                profile = required(
                    db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
                )
                current = required(db.scalar(select(Job).where(Job.id == guard.job_id).with_for_update()))
                if (
                    not owner
                    or owner.status != "active"
                    or not profile
                    or profile.generation != details["generation"]
                    or current.status == "cancelled"
                ):
                    raise ProviderError("cancelled")
                profile.external_id = str(client.user_id)
                profile.status = "active"
                profile.paused = False
                db.execute(delete(SessionSecret).where(SessionSecret.profile_id == profile_id))
                db.add(
                    SessionSecret(
                        profile_id=profile_id,
                        encrypted_settings=session_cipher()
                        .encrypt(json.dumps(safe_settings(client)).encode())
                        .decode(),
                        key_version=settings.instagram_session_key_version,
                    )
                )
                current.status, current.stage = "completed", "connected"
                current.finished_at = now()
                try:
                    request_sync(db, profile)
                except AppError as error:
                    if error.code not in ("sync_rate_limited", "heavy_job_limit"):
                        raise
                    profile.next_sync = now() + timedelta(hours=settings.instagram_manual_min_interval_hours)
                db.commit()
            vault.delete("login:" + guard.job_id, "pending:" + guard.job_id, "code:" + guard.job_id)
        else:
            started = now()
            with SessionLocal() as db:
                profile = required(db.get(Profile, profile_id))
                secret = db.get(SessionSecret, profile_id)
                if not secret:
                    raise ProviderError("reconnect_required")
                stored = json.loads(
                    session_cipher(secret.key_version).decrypt(secret.encrypted_settings.encode())
                )
                external_id = required(profile.external_id, "reconnect_required")
            guard.progress("validating_session")
            client = new_client(
                stored,
                settings.instagram_request_budget,
                settings.instagram_request_spacing_seconds,
                guard,
                mode="sync",
                proxy_url=proxy_url,
            )

            clients.append(client)

            def progress(stage, count):
                guard.progress(
                    "fetching_" + stage, stage_count=count, requests=getattr(client, "policy_requests", 0)
                )

            data = runner.run(
                collect(client, external_id, settings.max_snapshot_members, progress, allow_partial=True)
            )
            guard.progress("validating_snapshot")
            provenance = {
                "provider_version": "aiograpi-" + version("aiograpi"),
                "algorithm_version": "1",
                "collection_start": started.isoformat(),
                "collection_end": now().isoformat(),
                "expected_followers": len(data.followers),
                "expected_following": len(data.following),
                "request_count": getattr(client, "policy_requests", 0),
                "page_count": getattr(client, "policy_pages", 0),
                "pagination_reason": "exhausted",
                "followers_completeness": "collection_validated",
                "following_completeness": "collection_validated",
            }
            provenance.update(data.collection_metadata)
            publish(guard, data, now(), "aiograpi", provenance["completeness"], "stable_id", provenance)
            with SessionLocal() as db:
                profile = required(
                    db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
                )
                if profile and profile.generation == details["generation"]:
                    secret = db.get(SessionSecret, profile_id)
                    if secret:
                        secret.encrypted_settings = (
                            session_cipher().encrypt(json.dumps(safe_settings(client)).encode()).decode()
                        )
                        secret.key_version = settings.instagram_session_key_version
                        db.commit()
    finally:
        try:
            lock.release()
        except Exception:
            pass


def fail(guard, error):
    settings = get_settings()
    code = (
        error.code
        if isinstance(error, AppError)
        else "account_in_use"
        if isinstance(error, IntegrityError)
        else "timeout"
        if type(error).__name__ == "SoftTimeLimitExceeded"
        else "temporary_unavailable"
        if type(error).__name__
        in (
            "OperationalError",
            "EndpointConnectionError",
            "ConnectTimeoutError",
            "ReadTimeoutError",
            "ClientError",
            "OSError",
        )
        else classify(error)
    )
    with SessionLocal() as db:
        initial = db.get(Job, guard.job_id)
        if not initial:
            return
        owner = db.scalar(select(User).where(User.id == initial.user_id).with_for_update())
        if not owner:
            return
        if initial.profile_id:
            db.scalar(select(Profile).where(Profile.id == initial.profile_id).with_for_update())
        job = required(db.scalar(select(Job).where(Job.id == guard.job_id).with_for_update()))
        if (
            not job
            or job.details.get("run_token") != guard.run_token
            or job.status in ("cancelled", "completed")
        ):
            return
        if (
            job.kind in ("import", "export", "comparison")
            and code in ("temporary_unavailable", "storage_unavailable", "timeout")
            and job.attempts < 3
        ):
            job.status, job.stage = "queued", "retry_wait"
            db.add(
                Outbox(
                    kind="job",
                    reference=job.id,
                    next_attempt_at=now() + timedelta(seconds=5 * 2**job.attempts + randbelow(6)),
                )
            )
        else:
            job.status = (
                "partial"
                if code
                in (
                    "request_budget_exhausted",
                    "incomplete_pagination",
                    "inconsistent_snapshot",
                    "members_limit",
                )
                else code
                if code in TERMINAL
                else "failed"
            )
            job.finished_at = now()
            job.stage = "stopped"
        job.error_code = code
        provider_http_status = getattr(error, "details", {}).get("provider_http_status")
        if provider_http_status:
            job.details = {**job.details, "provider_http_status": provider_http_status}
        diagnostic = getattr(error, "details", {})
        job.details = {
            **job.details,
            **{
                key: diagnostic[key]
                for key in ("provider_responses", "provider_version", "requests")
                if key in diagnostic
            },
        }
        if job.kind in ("connect", "sync"):
            profile = required(db.get(Profile, job.profile_id))
            if profile and profile.generation == job.details.get("generation"):
                if code in ("cooldown", "challenge_required", "reconnect_required", "provider_unavailable"):
                    profile.status = code
                    if code == "cooldown":
                        retry_after = getattr(error, "details", {}).get("retry_after", 0)
                        delay = max(settings.instagram_platform_cooldown_hours * 3600, retry_after)
                        if delay > 0:
                            cooldown_until = now() + timedelta(seconds=delay)
                            profile.cooldown_until = cooldown_until
                            job.details = {**job.details, "next_allowed_at": cooldown_until.isoformat()}
                        else:
                            profile.cooldown_until = None
                            profile.status = "reconnect_required"
                            job.details = {**job.details, "next_allowed_at": None}
                elif job.kind == "connect":
                    profile.status = "reconnect_required"
                elif profile.status == "syncing":
                    profile.status = "active"
                notify(
                    db,
                    job.user_id,
                    "connection",
                    "Обновление приостановлено",
                    "Откройте настройки подключения: требуется действие или ожидание.",
                    "/app/settings",
                    "connection:" + profile.id + ":" + code + ":" + now().strftime("%Y-%m-%d"),
                )
        if job.kind == "comparison":
            comparison = db.get(Comparison, job.details.get("comparison_id"))
            if comparison:
                comparison.status = "queued" if job.status == "queued" else "failed"
        if job.kind == "export":
            export = db.get(ExportJob, job.details.get("export_id"))
            if export:
                export.status = "queued" if job.status == "queued" else "failed"
        db.commit()
        if job.kind == "connect":
            Redis.from_url(settings.auth_vault_url).delete(
                "login:" + job.id, "pending:" + job.id, "code:" + job.id
            )
        if job.kind == "import" and job.status != "queued" and job.details.get("object_key"):
            try:
                clear_file(job.details["object_key"])
            except Exception:
                pass


@celery.task
def process(job_id: str):
    try:
        guard = claim(job_id)
    except Exception as error:
        import structlog

        structlog.get_logger().error("job_claim_failed", job_id=job_id, error_type=type(error).__name__)
        return
    if not guard:
        return
    from time import monotonic

    started = monotonic()
    kind = "unknown"
    try:
        with heartbeat(guard):
            guard()
            with SessionLocal() as db:
                job = required(db.get(Job, job_id))
                kind = job.kind
                details = job.details.copy()
            if kind == "import":
                process_import(guard)
            elif kind in ("connect", "sync"):
                process_instagram(guard)
            elif kind == "comparison":
                from app.jobs.comparisons import calculate

                calculate(details["comparison_id"], guard)
                finish(guard)
            elif kind == "export":
                from app.jobs.exporter import render

                render(details["export_id"], guard)
                finish(guard)
    except Exception as error:
        import structlog

        structlog.get_logger().error(
            "job_execution_failed",
            job_id=job_id,
            error_type=type(error).__name__,
            error_code=classify(error),
            provider_http_status=getattr(error, "details", {}).get("provider_http_status"),
        )
        try:
            fail(guard, error)
        except Exception as persistence_error:
            import structlog

            structlog.get_logger().error(
                "job_state_persist_failed", job_id=job_id, error_type=type(persistence_error).__name__
            )

    finally:
        from app.core.metrics import record_job

        record_job(kind, monotonic() - started)


def _dispatch():
    for _ in range(20):
        with SessionLocal() as db:
            event = db.scalar(
                select(Outbox)
                .where(Outbox.delivered.is_(False), Outbox.attempts < 3, Outbox.next_attempt_at <= now())
                .order_by(Outbox.created_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if not event:
                return
            identity, kind, reference, payload = event.id, event.kind, event.reference, event.payload.copy()
            event.attempts += 1
            event.delivery_state = "sending"
            event.next_attempt_at = now() + timedelta(seconds=60)
            db.commit()
        try:
            if kind == "email":
                mail = (
                    json.loads(data_cipher().decrypt(payload["sealed"].encode()))
                    if "sealed" in payload
                    else payload
                )
                send_email(mail["to"], mail["subject"], mail["body"], message_id=identity)
            elif kind == "revoke":
                settings = get_settings()
                with celery.connection_for_write(
                    transport_options={
                        "socket_connect_timeout": settings.broker_publish_timeout_seconds,
                        "socket_timeout": settings.broker_publish_timeout_seconds,
                    }
                ) as connection:
                    connection.ensure_connection(max_retries=0)
                    platform_logout.apply_async(
                        args=[reference], queue="auth", connection=connection, retry=False, expires=120
                    )
            elif kind == "error":
                from app.integrations.telemetry import send

                send(payload)
            elif kind == "job":
                with SessionLocal() as db:
                    job = db.get(Job, reference)
                    kind = job.kind if job else None
                    status = job.status if job else None
                if status == "queued":
                    settings = get_settings()
                    live = kind in ("connect", "sync")
                    with celery.connection_for_write(
                        transport_options={
                            "socket_connect_timeout": settings.broker_publish_timeout_seconds,
                            "socket_timeout": settings.broker_publish_timeout_seconds,
                        }
                    ) as connection:
                        # Connection establishment also retries by default; the outbox owns retries.
                        connection.ensure_connection(max_retries=0)
                        process.apply_async(
                            args=[reference],
                            connection=connection,
                            retry=False,
                            queue="auth" if kind == "connect" else "default",
                            soft_time_limit=settings.instagram_sync_soft_timeout
                            if live
                            else settings.job_soft_timeout,
                            time_limit=settings.instagram_sync_hard_timeout
                            if live
                            else settings.job_hard_timeout,
                        )
            with SessionLocal() as db:
                event = db.get(Outbox, identity)
                if event:
                    event.delivered = True
                    event.delivery_state = "delivered"
                    event.payload = {}
                    db.commit()
        except Exception:
            with SessionLocal() as db:
                event = db.get(Outbox, identity)
                if event:
                    event.last_error = "delivery_unavailable"
                    event.delivery_state = "failed" if event.attempts >= 3 else "pending"
                    event.next_attempt_at = now() + timedelta(seconds=5 * 2**event.attempts + randbelow(6))
                    db.commit()


@celery.task
def dispatch():
    try:
        _dispatch()
    except Exception as error:
        import structlog

        structlog.get_logger().error("outbox_processing_failed", error_type=type(error).__name__)


@celery.task
def schedule():
    from app.jobs.maintenance import maintain

    try:
        maintain()
    except Exception as error:
        import structlog

        structlog.get_logger().error("maintenance_failed", error_type=type(error).__name__)


@celery.task(time_limit=45, soft_time_limit=40, acks_late=False)
def platform_logout(identity: str) -> None:
    """Consume once before I/O. No login, retries, challenge or session restoration."""
    from app.models import SessionRevocation

    with SessionLocal() as db:
        capability = db.scalar(
            select(SessionRevocation).where(SessionRevocation.id == identity).with_for_update()
        )
        if not capability:
            return
        encrypted, version, valid = (
            capability.encrypted_settings,
            capability.key_version,
            capability.expires_at > now(),
        )
        db.delete(capability)
        db.commit()
    if not valid:
        return
    try:
        settings = json.loads(session_cipher(version).decrypt(encrypted.encode()))
        config = get_settings()
        with client_runtime() as (runner, clients):
            client = new_client(
                settings,
                1,
                0,
                lambda: None,
                mode="revoke",
                proxy_url=config.instagram_proxy_url.get_secret_value()
                if config.instagram_proxy_url
                else None,
            )
            clients.append(client)
            runner.run(client.logout())
    except Exception:
        pass  # Local revocation is durable even if Instagram rejects logout.
