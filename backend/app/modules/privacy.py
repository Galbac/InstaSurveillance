from datetime import timedelta
from uuid import uuid4

from fastapi import Header, Request, Response
from sqlalchemy import delete, select

from app.core.async_io import blocking_call
from app.core.commands import audit, begin_command, finish_command
from app.core.config import get_settings
from app.core.dependencies import DB, UserDep, Verified
from app.core.errors import AppError
from app.core.router import APIRouter
from app.core.security import digest, now, token, verify_password
from app.integrations import ledger
from app.models import (
    AuthSession,
    DeletionRequest,
    ExportJob,
    FileObject,
    Job,
    Profile,
    SessionSecret,
    Snapshot,
    User,
)
from app.modules.contracts import DeletionDTO, DeletionStatusDTO
from app.modules.data import DeleteInput, profile_owned

router = APIRouter(prefix="/api/v1", tags=["privacy"])


def accept_deletion(db, user, request, target_type: str, target_id: str, payload: dict) -> dict:
    record, cached = begin_command(db, user, request, payload)
    if cached:
        return cached
    identity, raw = str(uuid4()), token()
    cutoff = now()
    # Reserve the idempotency key before external I/O. Concurrent retries cannot write a
    # second history cutoff to the ledger. An interrupted reservation expires in a minute.
    reserved_id = record.id if record else None
    if record:
        record.expires_at = now() + timedelta(minutes=1)
        db.commit()
        db.expire_all()
    else:
        db.rollback()
    try:
        blocking_call(
            ledger.record,
            identity,
            target_type,
            target_id,
            **({"cutoff": cutoff.isoformat()} if target_type == "history" else {}),
        )
    except Exception as error:
        from app.models import IdempotencyRecord

        if reserved_id:
            db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.id == reserved_id))
            db.commit()
        raise AppError("ledger_unavailable", "Журнал удаления недоступен. Повторите запрос", 503) from error
    if reserved_id:
        from app.models import IdempotencyRecord

        record = db.scalar(
            select(IdempotencyRecord).where(IdempotencyRecord.id == reserved_id).with_for_update()
        )
        if not record:
            raise AppError("command_pending", "Повторите запрос удаления", 409)
        record.expires_at = now() + timedelta(hours=24)
    else:
        record = None
    owner = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if not owner or owner.status != "active":
        raise AppError("account_unavailable", "Аккаунт недоступен", 409)
    if target_type == "history":
        profile = profile_owned(db, user, target_id, True)
        profiles = []
        exports = list(db.scalars(select(ExportJob).where(ExportJob.user_id == user.id)))
        export_jobs = [x.job_id for x in exports if x.job_id]
        jobs = list(
            db.scalars(
                select(Job).where(
                    ((Job.profile_id == profile.id) & (Job.kind != "connect")) | Job.id.in_(export_jobs)
                )
            )
        )
        files = list(db.scalars(select(FileObject).where(FileObject.job_id.in_([x.id for x in jobs]))))
        db.execute(delete(Snapshot).where(Snapshot.profile_id == profile.id, Snapshot.created_at <= cutoff))
        for export in db.scalars(select(ExportJob).where(ExportJob.user_id == user.id)):
            export.status = "expired"
        if profile.status == "syncing":
            profile.status = "active"
    elif target_type == "profile":
        profile = profile_owned(db, user, target_id, True)
        profiles = [profile]
        jobs = list(db.scalars(select(Job).where(Job.profile_id == profile.id)))
        files = list(db.scalars(select(FileObject).where(FileObject.job_id.in_([x.id for x in jobs]))))
    elif target_type == "snapshot":
        snapshot = db.get(Snapshot, target_id)
        if not snapshot:
            raise AppError("not_found", "Снимок не найден", 404)
        profile_owned(db, user, snapshot.profile_id, True)
        profiles = []
        exports = list(db.scalars(select(ExportJob).where(ExportJob.user_id == user.id)))
        jobs = list(db.scalars(select(Job).where(Job.id.in_([x.job_id for x in exports if x.job_id]))))
        files = list(db.scalars(select(FileObject).where(FileObject.job_id.in_([x.id for x in jobs]))))
        for export in exports:
            export.status = "expired"
        # Remove immediately: queries/comparisons never serve logically deleted snapshots.
        affected_profile, affected_time = snapshot.profile_id, snapshot.observed_at
        db.delete(snapshot)
        db.flush()
        from app.jobs.snapshots import enqueue_neighbors

        successor = db.scalar(
            select(Snapshot)
            .where(Snapshot.profile_id == affected_profile, Snapshot.observed_at > affected_time)
            .order_by(Snapshot.observed_at)
            .limit(1)
        )
        if successor:
            enqueue_neighbors(db, successor)
    else:
        profiles = list(db.scalars(select(Profile).where(Profile.user_id == user.id).with_for_update()))
        jobs = list(db.scalars(select(Job).where(Job.user_id == user.id)))
        files = list(db.scalars(select(FileObject).where(FileObject.owner == user.id)))
        owner.status = "deleting"
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    for profile in profiles:
        profile.paused = True
        profile.status = "deleting"
        profile.generation += 1
        db.execute(
            delete(SessionSecret)
            .where(SessionSecret.profile_id == profile.id)
            .execution_options(synchronize_session=False)
        )
    cancelled = []
    for job in jobs:
        if target_type == "history":
            job.details = {"warnings": ["history_cleared"]}
        if job.status not in ("completed", "failed", "expired", "cancelled", "partial"):
            job.status = "cancelled"
        cancelled.append(job.id)
    deletion = DeletionRequest(
        id=identity,
        owner=user.id,
        target_type=target_type,
        target_id=target_id,
        receipt_hash=digest(raw),
        receipt_expires_at=now() + timedelta(hours=24),
        files=[x.key for x in files],
        ledger_written=True,
    )
    db.add(deletion)
    audit(db, user.id, "privacy.delete_" + target_type, target_id, request.state.request_id)
    result = {
        "id": identity,
        "status": "queued",
        "receipt_token": raw,
        "expires_at": deletion.receipt_expires_at,
        "cleanup_deadline": now() + timedelta(hours=24),
        "backup_retention_days": get_settings().backup_retention_days,
    }
    finish_command(record, result)
    db.commit()
    from app.integrations.vault import clear_attempts

    clear_attempts(cancelled)
    return result


@router.post("/privacy/delete-account", status_code=202, response_model=DeletionDTO)
def delete_account(body: DeleteInput, user: UserDep, db: DB, request: Request, response: Response):
    if body.confirmation != "УДАЛИТЬ" or not verify_password(body.password, user.password_hash):
        raise AppError("confirmation_required", "Проверьте пароль и подтверждение", 403)
    result = accept_deletion(db, user, request, "account", user.id, {"confirmation": body.confirmation})
    from app.core.config import get_settings

    response.delete_cookie(get_settings().session_cookie_name, path="/")
    response.headers["Location"] = "/api/v1/privacy/requests/" + result["id"]
    return result


@router.delete("/profiles/{profile_id}", status_code=202, response_model=DeletionDTO)
def delete_profile(profile_id: str, user: Verified, db: DB, request: Request, response: Response):
    profile_owned(db, user, profile_id)
    result = accept_deletion(db, user, request, "profile", profile_id, {"profile_id": profile_id})
    response.headers["Location"] = "/api/v1/privacy/requests/" + result["id"]
    return result


@router.delete("/snapshots/{snapshot_id}", status_code=202, response_model=DeletionDTO)
def delete_snapshot(snapshot_id: str, user: Verified, db: DB, request: Request, response: Response):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise AppError("not_found", "Снимок не найден", 404)
    profile_owned(db, user, snapshot.profile_id)
    result = accept_deletion(db, user, request, "snapshot", snapshot_id, {"snapshot_id": snapshot_id})
    response.headers["Location"] = "/api/v1/privacy/requests/" + result["id"]
    return result


@router.get("/privacy/requests/{request_id}", response_model=DeletionStatusDTO)
def deletion_status(request_id: str, db: DB, request: Request, authorization: str = Header(default="")):
    deletion = db.get(DeletionRequest, request_id)
    authorized = False
    if (
        authorization.startswith("Receipt ")
        and deletion
        and deletion.receipt_expires_at
        and deletion.receipt_expires_at > now()
    ):
        import hmac

        authorized = hmac.compare_digest(
            digest(authorization.removeprefix("Receipt ")), deletion.receipt_hash or ""
        )
    if not authorized:
        from app.core.dependencies import authenticate

        user = authenticate(request, db)
        authorized = deletion is not None and deletion.owner == user.id
    if not authorized or not deletion:
        raise AppError("not_found", "Запрос не найден", 404)
    result = {
        "id": deletion.id,
        "status": deletion.status,
        "completed_at": deletion.completed_at,
        "cleanup_deadline": deletion.created_at + timedelta(hours=24),
    }
    if deletion.status == "completed" and authorization.startswith("Receipt "):
        deletion.receipt_hash = None
        db.commit()
    return result


class ClearHistoryInput(DeleteInput):
    pass


@router.post("/profiles/{profile_id}/history/delete", status_code=202, response_model=DeletionDTO)
def delete_history(
    profile_id: str, body: ClearHistoryInput, user: Verified, db: DB, request: Request, response: Response
):
    profile_owned(db, user, profile_id, True)
    if not verify_password(body.password, user.password_hash) or body.confirmation != "УДАЛИТЬ":
        raise AppError("confirmation_required", "Проверьте пароль и подтверждение", 403)
    result = accept_deletion(db, user, request, "history", profile_id, {"history": profile_id})
    response.headers["Location"] = "/api/v1/privacy/requests/" + result["id"]
    return result
