from datetime import timedelta
from typing import Annotated, Literal

from fastapi import Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.commands import audit, data_cipher
from app.core.dependencies import DB, AsyncDB, UserDep, rate_limit
from app.core.errors import AppError, required
from app.core.mfa import matching_counter
from app.core.pagination import cursor_decode, cursor_encode
from app.core.router import APIRouter
from app.core.security import digest, now
from app.models import AdminMFA, AuditEvent, AuthSession, Job, Outbox, Profile, SupportTicket, User
from app.modules.contracts import (
    AdminJobDTO,
    AdminOverviewDTO,
    AdminTicketDTO,
    AdminUserDTO,
    AuditDTO,
    CommandDTO,
    Page,
    PrivilegeDTO,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


async def privileged_user(request: Request, user: UserDep, db: AsyncDB) -> User:
    if user.role not in ("admin", "support"):
        raise AppError("forbidden", "Доступ запрещён", 403)
    session = required(await db.get(AuthSession, request.state.session_id))
    if not session.privileged_until or session.privileged_until <= now():
        raise AppError("mfa_required", "Подтвердите вход одноразовым кодом", 403)
    return user


Operator = Annotated[User, Depends(privileged_user)]


def administrator(user: User) -> None:
    if user.role != "admin":
        raise AppError("forbidden", "Нужны права администратора", 403)


class MFAInput(BaseModel):
    code: str = Field(min_length=6, max_length=100)


class Reason(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class TicketReply(BaseModel):
    status: Literal["open", "in_progress", "resolved"]
    reply: str = Field(default="", max_length=5000)


@router.post("/auth/mfa/challenge", response_model=PrivilegeDTO)
def challenge(body: MFAInput, user: UserDep, request: Request, db: DB):
    if user.role not in ("admin", "support"):
        raise AppError("forbidden", "Доступ запрещён", 403)
    rate_limit("mfa:" + user.id, 5, 900)
    record = db.scalar(select(AdminMFA).where(AdminMFA.user_id == user.id).with_for_update())
    if not record:
        raise AppError("mfa_not_enrolled", "MFA настраивается защищённой командой на сервере", 403)
    seed = data_cipher().decrypt(record.encrypted_seed.encode()).decode()
    counter = matching_counter(seed, body.code, record.last_counter)
    recovery_hash = digest(body.code)
    if counter is None and recovery_hash not in record.recovery_hashes:
        audit(db, user.id, "admin.mfa_failed", user.id, request.state.request_id)
        db.commit()
        raise AppError("invalid_mfa", "Код неверен или уже использован", 403)
    if counter is not None:
        record.last_counter = counter
    else:
        record.recovery_hashes = [x for x in record.recovery_hashes if x != recovery_hash]
    session = required(db.get(AuthSession, request.state.session_id))
    session.privileged_until = min(now() + timedelta(minutes=15), session.expires_at)
    audit(db, user.id, "admin.mfa_confirmed", user.id, request.state.request_id)
    db.commit()
    return {"expires_at": session.privileged_until}


def page(db, query, model, scope, cursor, limit, serialize):
    keys = cursor_decode(cursor, scope)
    if keys:
        from datetime import datetime

        from sqlalchemy import and_, or_

        created, identity = keys
        timestamp = datetime.fromisoformat(created)
        query = query.where(
            or_(model.created_at < timestamp, and_(model.created_at == timestamp, model.id < identity))
        )
    rows = list(db.scalars(query.order_by(model.created_at.desc(), model.id.desc()).limit(limit + 1)))
    return {
        "items": [serialize(row) for row in rows[:limit]],
        "next_cursor": cursor_encode([rows[limit - 1].created_at, rows[limit - 1].id], scope)
        if len(rows) > limit
        else None,
    }


@router.get("/users", response_model=Page[AdminUserDTO])
def users(user: Operator, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    return page(
        db,
        select(User),
        User,
        {"owner": user.id, "kind": "admin-users"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "email": x.email,
            "verified": x.verified,
            "role": x.role,
            "status": x.status,
            "created_at": x.created_at,
        },
    )


@router.post("/users/{user_id}/suspend", status_code=204)
def suspend(user_id: str, body: Reason, user: Operator, request: Request, db: DB):
    administrator(user)
    if user_id == user.id:
        raise AppError("self_suspend", "Нельзя заблокировать собственный аккаунт", 409)
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target or target.status == "deleting":
        raise AppError("not_found", "Пользователь не найден", 404)
    target.status = "suspended"
    from sqlalchemy import delete

    db.execute(delete(AuthSession).where(AuthSession.user_id == target.id))
    for profile in db.scalars(select(Profile).where(Profile.user_id == target.id)):
        profile.paused = True
        profile.generation += 1
    audit(db, user.id, "user.suspend", target.id, request.state.request_id, reason=body.reason)
    db.commit()


@router.post("/users/{user_id}/restore", status_code=204)
def restore(user_id: str, body: Reason, user: Operator, request: Request, db: DB):
    administrator(user)
    target = db.get(User, user_id)
    if not target or target.status != "suspended":
        raise AppError("not_found", "Заблокированный пользователь не найден", 404)
    target.status = "active"
    # Profiles stay paused; restoring access never silently resumes Instagram requests.
    audit(db, user.id, "user.restore", target.id, request.state.request_id, reason=body.reason)
    db.commit()


@router.get("/jobs", response_model=Page[AdminJobDTO])
def jobs(
    user: Operator,
    db: DB,
    status: str | None = Query(None, max_length=40),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    query = select(Job)
    if status:
        query = query.where(Job.status == status)
    return page(
        db,
        query,
        Job,
        {"owner": user.id, "kind": "admin-jobs", "status": status},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "kind": x.kind,
            "status": x.status,
            "stage": x.stage,
            "error_code": x.error_code,
            "attempts": x.attempts,
            "created_at": x.created_at,
            "heartbeat_at": x.heartbeat_at,
        },
    )


@router.post("/jobs/{job_id}/retry", status_code=202, response_model=CommandDTO)
def retry(job_id: str, user: Operator, request: Request, db: DB, response: Response):
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job:
        raise AppError("not_found", "Задание не найдено", 404)
    if (
        job.kind not in ("import", "comparison", "export")
        or job.status != "failed"
        or job.error_code not in ("storage_unavailable", "temporary_unavailable", "timeout")
        or job.attempts >= 3
    ):
        raise AppError("unsafe_retry", "Это задание нельзя безопасно повторить", 409)
    owner = db.get(User, job.user_id)
    if not owner or owner.status != "active":
        raise AppError("unsafe_retry", "Владелец недоступен", 409)
    job.status, job.error_code = "queued", None
    db.add(Outbox(kind="job", reference=job.id))
    audit(db, user.id, "job.retry", job.id, request.state.request_id)
    db.commit()
    response.headers["Location"] = "/api/v1/admin/jobs/" + job.id
    return {"id": job.id, "status": job.status}


@router.get("/support/tickets", response_model=Page[AdminTicketDTO])
def tickets(user: Operator, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    return page(
        db,
        select(SupportTicket),
        SupportTicket,
        {"owner": user.id, "kind": "admin-support"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "category": x.category,
            "body": x.body,
            "request_id": x.request_id,
            "status": x.status,
            "reply": x.reply,
            "created_at": x.created_at,
        },
    )


@router.patch("/support/tickets/{ticket_id}", response_model=CommandDTO)
def reply(ticket_id: str, body: TicketReply, user: Operator, request: Request, db: DB):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise AppError("not_found", "Обращение не найдено", 404)
    ticket.status, ticket.reply = body.status, body.reply
    from app.jobs.notifications import notify

    notify(
        db,
        ticket.user_id,
        "support",
        "Ответ поддержки",
        "Откройте обращение в кабинете",
        "/app/help",
        "support:" + ticket.id + ":" + digest(body.reply),
    )
    audit(db, user.id, "support.reply", ticket.id, request.state.request_id)
    db.commit()
    return {"id": ticket.id, "status": ticket.status}


@router.get("/audit", response_model=Page[AuditDTO])
def events(user: Operator, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    administrator(user)
    return page(
        db,
        select(AuditEvent),
        AuditEvent,
        {"owner": user.id, "kind": "audit"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "actor_id": x.actor_id,
            "action": x.action,
            "target": x.target,
            "request_id": x.request_id,
            "metadata": x.metadata_json,
            "created_at": x.created_at,
        },
    )


@router.get("/overview", response_model=AdminOverviewDTO)
def overview(user: Operator, db: DB):
    from app.core.limits import runtime_settings as get_settings

    settings = get_settings()
    return {
        "users": db.scalar(select(func.count()).select_from(User)),
        "jobs": dict(db.execute(select(Job.status, func.count()).group_by(Job.status)).all()),
        "limits": {
            "sync_hours": settings.instagram_sync_interval_hours,
            "request_budget": settings.instagram_request_budget,
            "storage_quota_bytes": settings.user_storage_quota_bytes,
        },
        "release": settings.release_version,
    }


class LimitInput(BaseModel):
    instagram_sync_interval_hours: int = Field(ge=1, le=8760)
    instagram_request_budget: int = Field(ge=1, le=10000)
    user_storage_quota_bytes: int = Field(ge=1024, le=1125899906842624)
    reason: str = Field(min_length=5, max_length=500)


@router.get("/limits", response_model=dict[str, int])
def limits(user: Operator, db: DB):
    from app.core.limits import NAMES, runtime_settings

    settings = runtime_settings()
    return {name: getattr(settings, name) for name in NAMES}


@router.patch("/limits", response_model=dict[str, int])
def update_limits(body: LimitInput, user: Operator, db: DB, request: Request):
    administrator(user)
    from sqlalchemy.dialects.postgresql import insert

    from app.core.config import get_settings
    from app.core.limits import NAMES
    from app.models import RuntimeLimit

    baseline = get_settings()
    values = body.model_dump(exclude={"reason"})
    if (
        body.instagram_sync_interval_hours < baseline.instagram_sync_interval_hours
        or body.instagram_request_budget > baseline.instagram_request_budget
        or body.user_storage_quota_bytes > baseline.user_storage_quota_bytes
    ):
        raise AppError("unsafe_limit", "Лимиты могут только ужесточать политику env", 409)
    for name in NAMES:
        db.execute(
            insert(RuntimeLimit)
            .values(name=name, value=values[name])
            .on_conflict_do_update(index_elements=[RuntimeLimit.name], set_={"value": values[name]})
        )
    audit(db, user.id, "limits.update", "global", request.state.request_id, values=values, reason=body.reason)
    db.commit()
    return values


@router.get("/jobs/{job_id}", response_model=AdminJobDTO)
def job_status(job_id: str, user: Operator, db: DB):
    job = db.get(Job, job_id)
    if not job:
        raise AppError("not_found", "Задание не найдено", 404)
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "stage": job.stage,
        "error_code": job.error_code,
        "attempts": job.attempts,
        "created_at": job.created_at,
        "heartbeat_at": job.heartbeat_at,
    }
