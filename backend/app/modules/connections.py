from datetime import timedelta

from fastapi import Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.commands import audit
from app.core.dependencies import DB, Verified
from app.core.errors import AppError
from app.core.limits import runtime_settings as get_settings
from app.core.router import APIRouter
from app.core.security import now
from app.models import Job, User
from app.modules.contracts import ConnectionDTO, JobDTO, ProfileDTO
from app.modules.data import ConnectInput, connect, job_dict, job_owned, profile_dict, profile_owned

router = APIRouter(prefix="/api/v1", tags=["connections"])


class ProfileMetadata(BaseModel):
    label: str = Field(max_length=80)


@router.patch("/profiles/{profile_id}", response_model=ProfileDTO)
def metadata(profile_id: str, body: ProfileMetadata, user: Verified, db: DB):
    profile = profile_owned(db, user, profile_id, True)
    profile.label = body.label
    db.commit()
    return profile_dict(profile)


@router.get("/profiles/{profile_id}/connection", response_model=ConnectionDTO)
def connection_status(profile_id: str, user: Verified, db: DB):
    profile = profile_owned(db, user, profile_id)
    latest = db.scalar(
        select(Job)
        .where(Job.profile_id == profile_id, Job.kind.in_(["connect", "sync"]))
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    from app.core.security import csrf
    from app.models import PlatformRun

    settings = get_settings()
    runs = list(
        db.scalars(
            select(PlatformRun)
            .where(
                PlatformRun.external_hash == csrf("platform:" + (profile.external_id or profile.id)),
                PlatformRun.created_at > now() - timedelta(hours=24),
            )
            .order_by(PlatformRun.created_at)
        )
    )
    current_time = now()
    deadlines = [
        deadline
        for deadline in (
            profile.cooldown_until,
            runs[-1].created_at + timedelta(hours=settings.instagram_manual_min_interval_hours)
            if runs
            else None,
            runs[0].created_at + timedelta(hours=24)
            if len(runs) >= settings.instagram_max_runs_per_24h
            else None,
        )
        if deadline is not None and deadline > current_time
    ]
    next_allowed = max(deadlines) if deadlines else None
    status = (
        "disabled"
        if not settings.instagram_private_enabled
        else "paused_by_user"
        if profile.paused and profile.status in ("active", "syncing")
        else profile.status
    )
    return {
        **profile_dict(profile),
        "display_status": status,
        "next_allowed_at": next_allowed,
        "job": job_dict(latest) if latest else None,
        "can_sync": settings.instagram_private_enabled
        and not profile.paused
        and profile.status == "active"
        and (next_allowed is None or next_allowed <= current_time),
        "provider_enabled": settings.instagram_private_enabled,
    }


@router.post("/profiles/{profile_id}/connection/reconnect", status_code=202, response_model=JobDTO)
def reconnect(
    profile_id: str, body: ConnectInput, user: Verified, db: DB, request: Request, response: Response
):
    profile = profile_owned(db, user, profile_id)
    from app.integrations.archive import normalize_username

    if normalize_username(body.username) != profile.username:
        raise AppError("identity_mismatch", "Username должен совпадать с выбранным профилем", 409)
    return connect(body, user, db, request, response)


def cancel_job(job_id, user, db, request):
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    job = job_owned(db, user, job_id)
    profile = profile_owned(db, user, job.profile_id, True) if job.profile_id else None
    db.refresh(job, with_for_update=True)
    if job.status in (
        "completed",
        "cancelled",
        "expired",
        "failed",
        "partial",
        "needs_review",
        "cooldown",
        "challenge_required",
        "reconnect_required",
    ):
        if job.status == "completed":
            raise AppError("already_completed", "Результат уже опубликован", 409)
        return job_dict(job)
    job.status, job.stage = "cancelled", "cancelled"
    if profile and job.kind in ("connect", "sync"):
        profile.generation += 1
        profile.status = "reconnect_required" if job.kind == "connect" else "active"
    audit(db, user.id, "job.cancel", job.id, request.state.request_id)
    db.commit()
    if job.kind == "connect":
        from app.core.redis_io import redis_command

        try:
            redis_command(
                get_settings().auth_vault_url,
                "delete",
                "login:" + job.id,
                "pending:" + job.id,
                "code:" + job.id,
            )
        except Exception:
            pass
    return job_dict(job)


@router.delete("/instagram/connection-attempts/{job_id}", status_code=204)
def cancel_connection(job_id: str, user: Verified, db: DB, request: Request):
    job = job_owned(db, user, job_id)
    if job.kind != "connect":
        raise AppError("not_found", "Попытка не найдена", 404)
    cancel_job(job_id, user, db, request)


@router.post("/syncs/{job_id}/cancel", status_code=202, response_model=JobDTO)
def cancel_sync(job_id: str, user: Verified, db: DB, request: Request, response: Response):
    job = job_owned(db, user, job_id)
    if job.kind != "sync":
        raise AppError("not_found", "Сбор не найден", 404)
    response.headers["Location"] = "/api/v1/" + ("syncs/" if job.kind == "sync" else "imports/") + job_id
    return cancel_job(job_id, user, db, request)


@router.post("/imports/{job_id}/cancel", status_code=202, response_model=JobDTO)
def cancel_import(job_id: str, user: Verified, db: DB, request: Request, response: Response):
    job = job_owned(db, user, job_id)
    if job.kind != "import":
        raise AppError("not_found", "Импорт не найден", 404)
    response.headers["Location"] = "/api/v1/" + ("syncs/" if job.kind == "sync" else "imports/") + job_id
    return cancel_job(job_id, user, db, request)
