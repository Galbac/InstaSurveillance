from datetime import timedelta

from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.core.limits import runtime_settings as get_settings
from app.core.security import now
from app.integrations import storage
from app.models import (
    AuditEvent,
    AuthSession,
    AuthToken,
    Comparison,
    DeletionRequest,
    ExportJob,
    FileObject,
    IdempotencyRecord,
    Job,
    Notification,
    Outbox,
    PlatformRun,
    Profile,
    Snapshot,
    User,
)


def cleanup_deletions() -> None:
    with SessionLocal() as db:
        identities = list(
            db.scalars(
                select(DeletionRequest.id)
                .where(DeletionRequest.status != "completed")
                .order_by(DeletionRequest.created_at)
                .limit(100)
            )
        )
    for identity in identities:
        with SessionLocal() as db:
            request = db.scalar(
                select(DeletionRequest)
                .where(DeletionRequest.id == identity)
                .with_for_update(skip_locked=True)
            )
            if not request or not request.ledger_written:
                continue
            request.attempts += 1
            request.status = "cleaning"
            files = request.files.copy()
            kind, target, owner = request.target_type, request.target_id, request.owner
            if kind == "account":
                user = db.get(User, target)
                if user:
                    db.delete(user)
                db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.owner == owner))
                db.execute(delete(Outbox).where(Outbox.reference == owner))
            elif kind == "profile":
                profile = db.get(Profile, target)
                if profile:
                    db.delete(profile)
            elif kind == "history":
                pass
            elif kind == "snapshot":
                snapshot = db.get(Snapshot, target)
                if snapshot:
                    db.delete(snapshot)
            db.commit()
        failed = []
        for key in files:
            try:
                with SessionLocal() as guard:
                    obj = guard.scalar(select(FileObject).where(FileObject.key == key))
                    if obj and obj.writing_until and obj.writing_until > now():
                        failed.append(key)
                        continue
                storage.remove(key)
                with SessionLocal() as db:
                    db.execute(delete(FileObject).where(FileObject.key == key))
                    db.commit()
            except Exception:
                failed.append(key)
        with SessionLocal() as db:
            request = db.get(DeletionRequest, identity)
            if request:
                request.files = failed
                request.status = "queued" if failed else "completed"
                request.completed_at = None if failed else now()
                db.commit()


def recover_jobs() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        identities = list(
            db.scalars(
                select(Job.id)
                .where(
                    Job.status.in_(
                        [
                            "queued",
                            "uploading",
                            "connecting",
                            "syncing",
                            "parsing",
                            "running",
                            "awaiting_2fa",
                            "awaiting_confirmation",
                        ]
                    )
                )
                .order_by(Job.created_at)
                .limit(1000)
            )
        )
    for identity in identities:
        with SessionLocal() as db:
            initial = db.get(Job, identity)
            if not initial:
                continue
            owner = db.scalar(select(User).where(User.id == initial.user_id).with_for_update())
            if not owner:
                continue
            if initial.profile_id:
                db.scalar(select(Profile).where(Profile.id == initial.profile_id).with_for_update())
            job = db.scalar(select(Job).where(Job.id == identity).with_for_update(skip_locked=True))
            if not job or job.status not in {
                "queued",
                "uploading",
                "connecting",
                "syncing",
                "parsing",
                "running",
                "awaiting_2fa",
                "awaiting_confirmation",
            }:
                continue
            if (
                job.kind == "connect"
                and job.created_at + timedelta(seconds=settings.instagram_credential_ttl_seconds) <= now()
            ):
                job.status, job.error_code = "expired", "expired"
            elif (
                job.status == "awaiting_confirmation"
                and job.created_at + timedelta(hours=settings.import_confirm_ttl_hours) <= now()
            ):
                job.status, job.error_code = "expired", "preview_expired"
            elif job.status == "uploading" and job.updated_at < now() - timedelta(minutes=15):
                job.status, job.error_code = "failed", "upload_interrupted"
            elif job.status == "queued" and job.updated_at < now() - timedelta(seconds=60):
                pending = db.scalar(
                    select(Outbox.id).where(
                        Outbox.reference == job.id, Outbox.delivered.is_(False), Outbox.attempts < 3
                    )
                )
                if not pending:
                    exhausted = db.scalar(
                        select(Outbox.id).where(
                            Outbox.reference == job.id, Outbox.delivered.is_(False), Outbox.attempts >= 3
                        )
                    )
                    if exhausted:
                        job.status, job.error_code = "failed", "queue_unavailable"
                        job.finished_at = now()
                    else:
                        job.updated_at = now()
                        db.add(Outbox(kind="job", reference=job.id))
            elif job.status in ("connecting", "syncing", "parsing", "running") and (
                job.heartbeat_at or job.updated_at
            ) < now() - timedelta(seconds=settings.job_stale_seconds):
                if job.kind in ("import", "export", "comparison") and job.attempts < 3:
                    job.status = "queued"
                    # Fence a paused old process immediately, before another worker claims the retry.
                    job.details = {key: value for key, value in job.details.items() if key != "run_token"}
                    job.updated_at = now()
                    db.add(
                        Outbox(kind="job", reference=job.id, next_attempt_at=now() + timedelta(seconds=30))
                    )
                else:
                    job.status = "partial" if job.kind == "sync" else "failed"
                    job.error_code = "worker_lost"
                    job.finished_at = now()
            if job.status in ("expired", "failed", "partial"):
                for model in (Comparison, ExportJob):
                    child = db.scalar(select(model).where(model.job_id == job.id))
                    if child:
                        child.status = "failed"
            if job.status in ("expired", "failed", "partial") and job.kind in ("sync", "connect"):
                profile = db.get(Profile, job.profile_id)
                if profile and profile.generation == job.details.get("generation"):
                    profile.status = "active" if job.kind == "sync" else "reconnect_required"
            db.commit()


def cleanup_files() -> None:
    with SessionLocal() as db:
        rows = list(db.scalars(select(FileObject).order_by(FileObject.expires_at).limit(1000)))
        keys = []
        for obj in rows:
            if obj.writing_until and obj.writing_until > now():
                continue
            job = db.get(Job, obj.job_id) if obj.job_id else None
            finished_raw = obj.key.startswith("imports/") and (
                not job or job.status in ("failed", "completed", "expired", "cancelled")
            )
            if obj.expires_at <= now() or finished_raw:
                keys.append(obj.key)
    for key in keys:
        try:
            storage.remove(key)
            with SessionLocal() as db:
                obj = db.scalar(select(FileObject).where(FileObject.key == key))
                if obj:
                    job = db.get(Job, obj.job_id)
                    if job and job.details.get("object_key") == key:
                        job.details = {k: v for k, v in job.details.items() if k != "object_key"}
                    db.delete(obj)
                export = db.scalar(select(ExportJob).where(ExportJob.object_key == key))
                if export:
                    export.status = "expired"
                    export.object_key = None
                db.commit()
        except Exception:
            continue


def retain() -> None:
    from app.models import SessionRevocation

    with SessionLocal() as db:
        db.execute(delete(SessionRevocation).where(SessionRevocation.expires_at <= now()))
        db.commit()
    settings = get_settings()
    with SessionLocal() as db:
        db.execute(delete(AuthToken).where(AuthToken.expires_at < now()))
        db.execute(delete(AuthSession).where(AuthSession.expires_at < now()))
        db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < now()))
        db.execute(delete(PlatformRun).where(PlatformRun.created_at < now() - timedelta(hours=48)))
        db.execute(
            delete(Notification).where(
                Notification.created_at < now() - timedelta(days=settings.notification_retention_days)
            )
        )
        db.execute(
            delete(AuditEvent).where(
                AuditEvent.created_at < now() - timedelta(days=settings.audit_retention_days)
            )
        )
        db.execute(
            delete(Job).where(Job.finished_at < now() - timedelta(days=settings.job_metadata_retention_days))
        )
        db.execute(
            delete(Outbox).where(
                Outbox.delivered.is_(True),
                Outbox.created_at < now() - timedelta(days=settings.job_metadata_retention_days),
            )
        )
        for request in db.scalars(
            select(DeletionRequest).where(
                DeletionRequest.receipt_expires_at < now(), DeletionRequest.receipt_hash.is_not(None)
            )
        ):
            request.receipt_hash = None
        db.execute(
            delete(DeletionRequest).where(
                DeletionRequest.status == "completed",
                DeletionRequest.created_at < now() - timedelta(days=settings.backup_retention_days + 1),
            )
        )
        db.commit()


def schedule_profiles() -> None:
    settings = get_settings()
    if not settings.instagram_private_enabled:
        return
    with SessionLocal() as db:
        identities = list(
            db.scalars(
                select(Profile.id)
                .join(User)
                .where(
                    User.status == "active",
                    Profile.paused.is_(False),
                    Profile.status.in_(["active", "cooldown"]),
                    Profile.next_sync <= now(),
                )
                .limit(200)
            )
        )
    for identity in identities:
        with SessionLocal() as db:
            original = db.get(Profile, identity)
            if not original:
                continue
            # Match publication lock order: owner, then profile.
            db.scalar(select(User).where(User.id == original.user_id).with_for_update())
            profile = db.scalar(
                select(Profile).where(Profile.id == identity).with_for_update(skip_locked=True)
            )
            if not profile or profile.paused or profile.status not in ("active", "cooldown"):
                continue
            if profile.cooldown_until and profile.cooldown_until > now():
                continue
            if profile.last_sync:
                earliest = profile.last_sync + timedelta(
                    hours=max(profile.interval_hours, settings.instagram_sync_interval_hours)
                )
                if earliest > now():
                    profile.next_sync = earliest
                    db.commit()
                    continue
            if profile.status == "cooldown":
                profile.status = "active"
            from app.core.errors import AppError
            from app.modules.data import request_sync

            try:
                request_sync(db, profile)
            except AppError:
                continue
            db.commit()


def maintain() -> None:
    from app.core.logging import prune_logs

    prune_logs()
    from app.integrations.storage_metrics import refresh

    try:
        refresh()
    except Exception:
        pass  # Monitoring cannot prevent cleanup/recovery.
    cleanup_deletions()
    recover_jobs()
    schedule_comparisons()
    cleanup_files()
    retain()
    schedule_profiles()
    from redis import Redis

    from app.integrations import ledger

    if Redis.from_url(get_settings().redis_url).set("ledger:prune", "1", ex=3600, nx=True):
        ledger.prune()


def schedule_comparisons():
    from app.core.commands import heavy_limit
    from app.core.errors import AppError
    from app.models import Comparison

    with SessionLocal() as db:
        candidates = list(
            db.scalars(
                select(Comparison.id)
                .where(Comparison.status == "queued", Comparison.job_id.is_(None))
                .limit(200)
            )
        )
    for identity in candidates:
        with SessionLocal() as db:
            original = db.get(Comparison, identity)
            if not original:
                continue
            profile = db.get(Profile, original.profile_id)
            if not profile:
                continue
            user = db.scalar(select(User).where(User.id == profile.user_id).with_for_update())
            if not user or user.status != "active":
                continue
            comparison = db.scalar(
                select(Comparison).where(Comparison.id == identity).with_for_update(skip_locked=True)
            )
            if not comparison or comparison.job_id:
                continue
            try:
                heavy_limit(db, user.id)
            except AppError:
                continue
            from app.modules.data import enqueue

            job = Job(
                user_id=user.id, profile_id=profile.id, kind="comparison", details={"comparison_id": identity}
            )
            enqueue(db, job)
            comparison.job_id = job.id
            db.commit()
