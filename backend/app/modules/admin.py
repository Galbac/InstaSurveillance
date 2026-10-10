import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.commands import audit, data_cipher
from app.core.config import get_settings
from app.core.dependencies import DB, AsyncDB, UserDep, rate_limit
from app.core.errors import AppError, required
from app.core.limits import NAMES, runtime_settings
from app.core.mfa import matching_counter
from app.core.pagination import cursor_decode, cursor_encode
from app.core.router import APIRouter
from app.core.security import digest, now
from app.integrations import storage
from app.jobs.notifications import notify
from app.models import (
    AdminMFA,
    AuditEvent,
    AuthSession,
    Comparison,
    DeletionRequest,
    ExportJob,
    FileObject,
    Job,
    Outbox,
    Profile,
    RuntimeLimit,
    SessionSecret,
    Snapshot,
    SupportTicket,
    User,
)
from app.modules.contracts import (
    AdminAuthStatusDTO,
    AdminJobDetailDTO,
    AdminJobDTO,
    AdminOverviewDTO,
    AdminProfileDetailDTO,
    AdminProfileDTO,
    AdminSystemHealthDTO,
    AdminTicketDTO,
    AdminUserDetailDTO,
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


class LimitInput(BaseModel):
    instagram_sync_interval_hours: int = Field(ge=1, le=8760)
    instagram_request_budget: int = Field(ge=1, le=10000)
    user_storage_quota_bytes: int = Field(ge=1024, le=1125899906842624)
    reason: str = Field(min_length=5, max_length=500)


def evaluate_job_retry(job: Job, db: Session) -> tuple[bool, str | None]:
    if job.kind not in ("import", "comparison", "export"):
        return False, "Повтор разрешён только для import, comparison и export"
    if job.status != "failed":
        return False, "Повторять можно только завершившиеся с ошибкой задания"
    if job.error_code not in ("storage_unavailable", "temporary_unavailable", "timeout"):
        return False, f"Ошибка '{job.error_code}' не подлежит автоматическому перезапуску"
    if job.attempts >= 3:
        return False, "Превышен лимит попыток (максимум 3)"
    owner = db.get(User, job.user_id)
    if not owner or owner.status != "active":
        return False, "Владелец задания не найден или заблокирован"
    return True, None


def sanitize_job_details(details: dict[str, Any] | None) -> dict[str, Any]:
    if not details or not isinstance(details, dict):
        return {}
    sensitive_keys = {
        "cookie",
        "cookies",
        "password",
        "token",
        "secret",
        "session_id",
        "auth",
        "authorization",
        "signature",
        "credential",
        "credentials",
        "proxy",
    }
    return {k: v for k, v in details.items() if not any(s in k.lower() for s in sensitive_keys)}


def page(db, query, model, scope, cursor, limit, serialize):
    keys = cursor_decode(cursor, scope)
    if keys:
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


@router.get("/auth/status", response_model=AdminAuthStatusDTO)
def auth_status(user: UserDep, request: Request, db: DB):
    if user.role not in ("admin", "support"):
        raise AppError("forbidden", "Доступ запрещён", 403)
    session = db.get(AuthSession, request.state.session_id)
    is_privileged = bool(session and session.privileged_until and session.privileged_until > now())
    mfa_record = db.scalar(select(AdminMFA.user_id).where(AdminMFA.user_id == user.id))
    return {
        "role": user.role,
        "email": user.email,
        "user_id": user.id,
        "server_time": now(),
        "privileged": is_privileged,
        "privileged_until": session.privileged_until if (session and is_privileged) else None,
        "mfa_enrolled": bool(mfa_record),
    }


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


@router.get("/overview", response_model=AdminOverviewDTO)
def overview(user: Operator, db: DB):
    settings = runtime_settings()
    now_dt = now()
    day_ago = now_dt - timedelta(days=1)
    week_ago = now_dt - timedelta(days=7)

    users_total = db.scalar(select(func.count()).select_from(User)) or 0
    users_active = db.scalar(select(func.count()).where(User.status == "active")) or 0
    users_suspended = db.scalar(select(func.count()).where(User.status == "suspended")) or 0
    users_unverified = db.scalar(select(func.count()).where(User.verified.is_(False))) or 0

    profiles_total = db.scalar(select(func.count()).select_from(Profile)) or 0
    profiles_active = (
        db.scalar(select(func.count()).where(Profile.status == "active", Profile.paused.is_(False))) or 0
    )
    profiles_paused = db.scalar(select(func.count()).where(Profile.paused.is_(True))) or 0
    profiles_cooldown = db.scalar(select(func.count()).where(Profile.cooldown_until > now_dt)) or 0

    jobs_counts = dict(db.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    jobs_failed_24h = (
        db.scalar(select(func.count()).where(Job.status == "failed", Job.created_at >= day_ago)) or 0
    )

    tickets_open = db.scalar(select(func.count()).where(SupportTicket.status == "open")) or 0
    tickets_in_progress = db.scalar(select(func.count()).where(SupportTicket.status == "in_progress")) or 0

    partial_snapshots_7d = (
        db.scalar(
            select(func.count()).where(
                Snapshot.completeness.notin_(["complete", "collection_validated", "user_confirmed"]),
                Snapshot.created_at >= week_ago,
            )
        )
        or 0
    )

    return {
        "users": users_total,
        "users_active": users_active,
        "users_suspended": users_suspended,
        "users_unverified": users_unverified,
        "profiles": profiles_total,
        "profiles_active": profiles_active,
        "profiles_paused": profiles_paused,
        "profiles_cooldown": profiles_cooldown,
        "jobs": jobs_counts,
        "jobs_failed_24h": jobs_failed_24h,
        "tickets_open": tickets_open,
        "tickets_in_progress": tickets_in_progress,
        "partial_snapshots_7d": partial_snapshots_7d,
        "limits": {
            "sync_hours": settings.instagram_sync_interval_hours,
            "request_budget": settings.instagram_request_budget,
            "storage_quota_bytes": settings.user_storage_quota_bytes,
        },
        "release": settings.release_version,
    }


@router.get("/users", response_model=Page[AdminUserDTO])
def users(
    user: Operator,
    db: DB,
    search: str | None = Query(None, max_length=120),
    role: str | None = Query(None, max_length=20),
    status: str | None = Query(None, max_length=20),
    verified: bool | None = Query(None),
    created_from: datetime | None = Query(None),
    created_to: datetime | None = Query(None),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    query = select(User)
    if search:
        s = search.strip()
        query = query.where(or_(User.email.ilike(f"%{s}%"), User.id == s))
    if role:
        query = query.where(User.role == role)
    if status:
        query = query.where(User.status == status)
    if verified is not None:
        query = query.where(User.verified == verified)
    if created_from:
        query = query.where(User.created_at >= created_from)
    if created_to:
        query = query.where(User.created_at <= created_to)

    scope = {
        "owner": user.id,
        "kind": "admin-users",
        "search": search,
        "role": role,
        "status": status,
        "verified": verified,
        "created_from": created_from.isoformat() if created_from else None,
        "created_to": created_to.isoformat() if created_to else None,
    }
    return page(
        db,
        query,
        User,
        scope,
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


@router.get("/users/{user_id}", response_model=AdminUserDetailDTO)
def user_detail(user_id: str, user: Operator, db: DB):
    target = db.get(User, user_id)
    if not target:
        raise AppError("not_found", "Пользователь не найден", 404)

    profiles_count = db.scalar(select(func.count()).where(Profile.user_id == user_id)) or 0
    jobs_by_status = dict(
        db.execute(select(Job.status, func.count()).where(Job.user_id == user_id).group_by(Job.status)).all()
    )

    storage_bytes = (
        db.scalar(select(func.coalesce(func.sum(FileObject.size), 0)).where(FileObject.owner == user_id)) or 0
    )
    storage_files = db.scalar(select(func.count()).where(FileObject.owner == user_id)) or 0
    quota_bytes = runtime_settings().user_storage_quota_bytes

    tickets_count = db.scalar(select(func.count()).where(SupportTicket.user_id == user_id)) or 0
    recent_tickets_rows = db.scalars(
        select(SupportTicket)
        .where(SupportTicket.user_id == user_id)
        .order_by(SupportTicket.created_at.desc())
        .limit(5)
    ).all()
    recent_tickets = [
        {
            "id": t.id,
            "category": t.category,
            "body": t.body,
            "status": t.status,
            "reply": t.reply,
            "created_at": t.created_at,
        }
        for t in recent_tickets_rows
    ]

    recent_profiles_rows = db.scalars(
        select(Profile).where(Profile.user_id == user_id).order_by(Profile.created_at.desc()).limit(10)
    ).all()
    p_ids = [p.id for p in recent_profiles_rows]
    connected_ids = (
        set(db.scalars(select(SessionSecret.profile_id).where(SessionSecret.profile_id.in_(p_ids))).all())
        if p_ids
        else set()
    )
    recent_profiles = [
        {
            "id": p.id,
            "username": p.username,
            "status": p.status,
            "paused": p.paused,
            "has_connection": p.id in connected_ids,
            "last_sync": p.last_sync,
        }
        for p in recent_profiles_rows
    ]

    audit_history: list[dict[str, Any]] = []
    if user.role == "admin":
        audit_rows = db.scalars(
            select(AuditEvent)
            .where(or_(AuditEvent.actor_id == user_id, AuditEvent.target == user_id))
            .order_by(AuditEvent.created_at.desc())
            .limit(10)
        ).all()
        audit_history = [
            {
                "id": a.id,
                "actor_id": a.actor_id,
                "action": a.action,
                "target": a.target,
                "request_id": a.request_id,
                "metadata": a.metadata_json,
                "created_at": a.created_at,
            }
            for a in audit_rows
        ]

    return {
        "id": target.id,
        "email": target.email,
        "verified": target.verified,
        "role": target.role,
        "status": target.status,
        "timezone": target.timezone,
        "theme": target.theme,
        "email_notifications": target.email_notifications,
        "created_at": target.created_at,
        "profiles_count": profiles_count,
        "jobs_by_status": jobs_by_status,
        "storage": {
            "total_bytes": storage_bytes,
            "file_count": storage_files,
            "quota_bytes": quota_bytes,
        },
        "tickets_count": tickets_count,
        "recent_tickets": recent_tickets,
        "recent_profiles": recent_profiles,
        "audit_history": audit_history,
    }


@router.post("/users/{user_id}/suspend", status_code=204)
def suspend(user_id: str, body: Reason, user: Operator, request: Request, db: DB):
    administrator(user)
    if user_id == user.id:
        raise AppError("self_suspend", "Нельзя заблокировать собственный аккаунт", 409)
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target or target.status == "deleting":
        raise AppError("not_found", "Пользователь не найден", 404)
    target.status = "suspended"
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


@router.get("/profiles", response_model=Page[AdminProfileDTO])
def profiles(
    user: Operator,
    db: DB,
    search: str | None = Query(None, max_length=120),
    status: str | None = Query(None, max_length=40),
    paused: bool | None = Query(None),
    has_cooldown: bool | None = Query(None),
    user_id: str | None = Query(None, max_length=36),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    query = select(Profile)
    if search:
        s = search.strip()
        query = query.where(or_(Profile.username.ilike(f"%{s}%"), Profile.id == s))
    if status:
        query = query.where(Profile.status == status)
    if paused is not None:
        query = query.where(Profile.paused == paused)
    if has_cooldown is True:
        query = query.where(Profile.cooldown_until > now())
    elif has_cooldown is False:
        query = query.where(or_(Profile.cooldown_until.is_(None), Profile.cooldown_until <= now()))
    if user_id:
        query = query.where(Profile.user_id == user_id)

    scope = {
        "owner": user.id,
        "kind": "admin-profiles",
        "search": search,
        "status": status,
        "paused": paused,
        "has_cooldown": has_cooldown,
        "user_id": user_id,
    }

    keys = cursor_decode(cursor, scope)
    if keys:
        created, identity = keys
        timestamp = datetime.fromisoformat(created)
        query = query.where(
            or_(
                Profile.created_at < timestamp,
                and_(Profile.created_at == timestamp, Profile.id < identity),
            )
        )
    rows = list(db.scalars(query.order_by(Profile.created_at.desc(), Profile.id.desc()).limit(limit + 1)))
    page_rows = rows[:limit]

    p_ids = [p.id for p in page_rows]
    u_ids = list({p.user_id for p in page_rows})

    users_map = (
        {u.id: u.email for u in db.scalars(select(User).where(User.id.in_(u_ids))).all()} if u_ids else {}
    )
    connected_ids = (
        set(db.scalars(select(SessionSecret.profile_id).where(SessionSecret.profile_id.in_(p_ids))).all())
        if p_ids
        else set()
    )

    last_jobs_map: dict[str, dict[str, Any]] = {}
    if p_ids:
        jobs_rows = db.scalars(
            select(Job).where(Job.profile_id.in_(p_ids)).order_by(Job.profile_id, Job.created_at.desc())
        ).all()
        for j in jobs_rows:
            if j.profile_id and j.profile_id not in last_jobs_map:
                last_jobs_map[j.profile_id] = {
                    "id": j.id,
                    "kind": j.kind,
                    "status": j.status,
                    "stage": j.stage,
                    "error_code": j.error_code,
                    "created_at": j.created_at,
                    "finished_at": j.finished_at,
                }

    items = [
        {
            "id": p.id,
            "user_id": p.user_id,
            "username": p.username,
            "status": p.status,
            "paused": p.paused,
            "interval_hours": p.interval_hours,
            "last_sync": p.last_sync,
            "next_sync": p.next_sync,
            "cooldown_until": p.cooldown_until,
            "has_connection": p.id in connected_ids,
            "owner_email": users_map.get(p.user_id),
            "created_at": p.created_at,
            "last_job": last_jobs_map.get(p.id),
        }
        for p in page_rows
    ]

    return {
        "items": items,
        "next_cursor": cursor_encode([page_rows[-1].created_at, page_rows[-1].id], scope)
        if len(rows) > limit
        else None,
    }


@router.get("/profiles/{profile_id}", response_model=AdminProfileDetailDTO)
def profile_detail(profile_id: str, user: Operator, db: DB):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise AppError("not_found", "Профиль не найден", 404)
    owner = db.get(User, profile.user_id)
    secret = db.get(SessionSecret, profile.id)
    snapshot = db.scalar(
        select(Snapshot)
        .where(Snapshot.profile_id == profile.id)
        .order_by(Snapshot.observed_at.desc(), Snapshot.id.desc())
        .limit(1)
    )

    latest_snapshot = None
    if snapshot:
        counts = snapshot.counts or {}
        prov = snapshot.provenance or {}
        fol = counts.get("followers", 0)
        exp_fol = prov.get("expected_followers")
        latest_snapshot = {
            "id": snapshot.id,
            "observed_at": snapshot.observed_at,
            "completeness": snapshot.completeness,
            "source": snapshot.source,
            "checksum": snapshot.checksum,
            "followers": fol,
            "expected_followers": exp_fol,
            "following": counts.get("following", 0),
            "expected_following": prov.get("expected_following"),
            "mutual": counts.get("mutual", 0),
            "is_comparable": bool(
                snapshot.completeness in ("complete", "collection_validated", "user_confirmed")
                or (fol is not None and exp_fol is not None and fol == exp_fol)
            ),
        }

    recent_jobs_rows = db.scalars(
        select(Job).where(Job.profile_id == profile.id).order_by(Job.created_at.desc()).limit(10)
    ).all()
    recent_jobs = [
        {
            "id": j.id,
            "kind": j.kind,
            "status": j.status,
            "stage": j.stage,
            "error_code": j.error_code,
            "created_at": j.created_at,
            "finished_at": j.finished_at,
        }
        for j in recent_jobs_rows
    ]

    return {
        "id": profile.id,
        "user_id": profile.user_id,
        "owner_email": owner.email if owner else None,
        "owner_status": owner.status if owner else None,
        "username": profile.username,
        "status": profile.status,
        "paused": profile.paused,
        "interval_hours": profile.interval_hours,
        "generation": profile.generation,
        "last_sync": profile.last_sync,
        "next_sync": profile.next_sync,
        "cooldown_until": profile.cooldown_until,
        "has_connection": secret is not None,
        "key_version": secret.key_version if secret else None,
        "created_at": profile.created_at,
        "latest_snapshot": latest_snapshot,
        "recent_jobs": recent_jobs,
    }


@router.post("/profiles/{profile_id}/pause", status_code=204)
def pause_profile(profile_id: str, body: Reason, user: Operator, request: Request, db: DB):
    administrator(user)
    profile = db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
    if not profile:
        raise AppError("not_found", "Профиль не найден", 404)
    profile.paused = True
    profile.generation += 1
    audit(db, user.id, "profile.pause", profile.id, request.state.request_id, reason=body.reason)
    db.commit()


@router.post("/profiles/{profile_id}/resume", status_code=204)
def resume_profile(profile_id: str, body: Reason, user: Operator, request: Request, db: DB):
    administrator(user)
    profile = db.scalar(select(Profile).where(Profile.id == profile_id).with_for_update())
    if not profile:
        raise AppError("not_found", "Профиль не найден", 404)
    owner = db.get(User, profile.user_id)
    if not owner or owner.status != "active":
        raise AppError("unsafe_action", "Нельзя возобновить профиль заблокированного пользователя", 409)
    profile.paused = False
    profile.generation += 1
    audit(db, user.id, "profile.resume", profile.id, request.state.request_id, reason=body.reason)
    db.commit()


@router.get("/jobs", response_model=Page[AdminJobDTO])
def jobs(
    user: Operator,
    db: DB,
    status: str | None = Query(None, max_length=40),
    kind: str | None = Query(None, max_length=30),
    error_code: str | None = Query(None, max_length=80),
    user_id: str | None = Query(None, max_length=36),
    profile_id: str | None = Query(None, max_length=36),
    created_from: datetime | None = Query(None),
    created_to: datetime | None = Query(None),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    query = select(Job)
    if status:
        query = query.where(Job.status == status)
    if kind:
        query = query.where(Job.kind == kind)
    if error_code:
        query = query.where(Job.error_code == error_code)
    if user_id:
        query = query.where(Job.user_id == user_id)
    if profile_id:
        query = query.where(Job.profile_id == profile_id)
    if created_from:
        query = query.where(Job.created_at >= created_from)
    if created_to:
        query = query.where(Job.created_at <= created_to)

    scope = {
        "owner": user.id,
        "kind": "admin-jobs",
        "status": status,
        "job_kind": kind,
        "error_code": error_code,
        "user_id": user_id,
        "profile_id": profile_id,
        "created_from": created_from.isoformat() if created_from else None,
        "created_to": created_to.isoformat() if created_to else None,
    }
    return page(
        db,
        query,
        Job,
        scope,
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


@router.get("/jobs/{job_id}", response_model=AdminJobDetailDTO)
def job_status(job_id: str, user: Operator, db: DB):
    job = db.get(Job, job_id)
    if not job:
        raise AppError("not_found", "Задание не найдено", 404)
    owner = db.get(User, job.user_id)
    profile = db.get(Profile, job.profile_id) if job.profile_id else None
    can_retry, reason = evaluate_job_retry(job, db)

    snapshot_id = None
    comparison_id = None
    export_id = None
    if job.kind in ("import", "sync", "connection"):
        snapshot_id = db.scalar(select(Snapshot.id).where(Snapshot.job_id == job.id))
    elif job.kind == "comparison":
        comparison_id = db.scalar(select(Comparison.id).where(Comparison.job_id == job.id))
    elif job.kind == "export":
        export_id = db.scalar(select(ExportJob.id).where(ExportJob.job_id == job.id))

    details = sanitize_job_details(job.details)
    if not snapshot_id and details.get("snapshot_id"):
        snapshot_id = str(details["snapshot_id"])
    if not comparison_id and details.get("comparison_id"):
        comparison_id = str(details["comparison_id"])
    if not export_id and details.get("export_id"):
        export_id = str(details["export_id"])

    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "stage": job.stage,
        "error_code": job.error_code,
        "attempts": job.attempts,
        "user_id": job.user_id,
        "profile_id": job.profile_id,
        "owner_email": owner.email if owner else None,
        "profile_username": profile.username if profile else None,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "heartbeat_at": job.heartbeat_at,
        "can_retry": can_retry,
        "retry_forbidden_reason": reason,
        "details": details,
        "snapshot_id": snapshot_id,
        "comparison_id": comparison_id,
        "export_id": export_id,
    }


@router.post("/jobs/{job_id}/retry", status_code=202, response_model=CommandDTO)
def retry(job_id: str, user: Operator, request: Request, db: DB, response: Response):
    job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job:
        raise AppError("not_found", "Задание не найдено", 404)
    can_retry, reason = evaluate_job_retry(job, db)
    if not can_retry:
        raise AppError("unsafe_retry", reason or "Это задание нельзя безопасно повторить", 409)
    job.status, job.error_code = "queued", None
    db.add(Outbox(kind="job", reference=job.id))
    audit(db, user.id, "job.retry", job.id, request.state.request_id)
    db.commit()
    response.headers["Location"] = "/api/v1/admin/jobs/" + job.id
    return {"id": job.id, "status": job.status}


@router.get("/support/tickets", response_model=Page[AdminTicketDTO])
def tickets(
    user: Operator,
    db: DB,
    status: str | None = Query(None, max_length=20),
    category: str | None = Query(None, max_length=30),
    user_id: str | None = Query(None, max_length=36),
    search: str | None = Query(None, max_length=120),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    query = select(SupportTicket)
    if status:
        query = query.where(SupportTicket.status == status)
    if category:
        query = query.where(SupportTicket.category == category)
    if user_id:
        query = query.where(SupportTicket.user_id == user_id)
    if search:
        s = search.strip()
        query = query.where(or_(SupportTicket.body.ilike(f"%{s}%"), SupportTicket.request_id == s))

    scope = {
        "owner": user.id,
        "kind": "admin-support",
        "status": status,
        "category": category,
        "user_id": user_id,
        "search": search,
    }

    keys = cursor_decode(cursor, scope)
    if keys:
        created, identity = keys
        timestamp = datetime.fromisoformat(created)
        query = query.where(
            or_(
                SupportTicket.created_at < timestamp,
                and_(SupportTicket.created_at == timestamp, SupportTicket.id < identity),
            )
        )
    rows = list(
        db.scalars(query.order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc()).limit(limit + 1))
    )
    page_rows = rows[:limit]

    u_ids = list({t.user_id for t in page_rows})
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(u_ids))).all()} if u_ids else {}

    items = [
        {
            "id": x.id,
            "category": x.category,
            "body": x.body,
            "request_id": x.request_id,
            "status": x.status,
            "reply": x.reply,
            "created_at": x.created_at,
            "owner_email": users_map[x.user_id].email if x.user_id in users_map else None,
            "owner_status": users_map[x.user_id].status if x.user_id in users_map else None,
        }
        for x in page_rows
    ]

    return {
        "items": items,
        "next_cursor": cursor_encode([page_rows[-1].created_at, page_rows[-1].id], scope)
        if len(rows) > limit
        else None,
    }


@router.get("/support/tickets/{ticket_id}", response_model=AdminTicketDTO)
def ticket_detail(ticket_id: str, user: Operator, db: DB):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise AppError("not_found", "Обращение не найдено", 404)
    owner = db.get(User, ticket.user_id)
    return {
        "id": ticket.id,
        "category": ticket.category,
        "body": ticket.body,
        "request_id": ticket.request_id,
        "status": ticket.status,
        "reply": ticket.reply,
        "created_at": ticket.created_at,
        "owner_email": owner.email if owner else None,
        "owner_status": owner.status if owner else None,
    }


@router.patch("/support/tickets/{ticket_id}", response_model=CommandDTO)
def reply(ticket_id: str, body: TicketReply, user: Operator, request: Request, db: DB):
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket:
        raise AppError("not_found", "Обращение не найдено", 404)
    ticket.status, ticket.reply = body.status, body.reply
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
def events(
    user: Operator,
    db: DB,
    actor_id: str | None = Query(None, max_length=36),
    action: str | None = Query(None, max_length=80),
    target: str | None = Query(None, max_length=80),
    request_id: str | None = Query(None, max_length=40),
    created_from: datetime | None = Query(None),
    created_to: datetime | None = Query(None),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    administrator(user)
    query = select(AuditEvent)
    if actor_id:
        query = query.where(AuditEvent.actor_id == actor_id)
    if action:
        query = query.where(AuditEvent.action == action)
    if target:
        query = query.where(AuditEvent.target == target)
    if request_id:
        query = query.where(AuditEvent.request_id == request_id)
    if created_from:
        query = query.where(AuditEvent.created_at >= created_from)
    if created_to:
        query = query.where(AuditEvent.created_at <= created_to)

    scope = {
        "owner": user.id,
        "kind": "audit",
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "request_id": request_id,
        "created_from": created_from.isoformat() if created_from else None,
        "created_to": created_to.isoformat() if created_to else None,
    }
    return page(
        db,
        query,
        AuditEvent,
        scope,
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


@router.get("/limits", response_model=dict[str, int])
def limits(user: Operator, db: DB):
    settings = runtime_settings()
    return {name: getattr(settings, name) for name in NAMES}


@router.patch("/limits", response_model=dict[str, int])
def update_limits(body: LimitInput, user: Operator, db: DB, request: Request):
    administrator(user)
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


@router.get("/system", response_model=AdminSystemHealthDTO)
def system_health(user: Operator, db: DB):
    administrator(user)
    settings = get_settings()

    t0 = time.perf_counter()
    try:
        db.execute(select(1)).scalar()
        db_healthy = True
        db_latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    except Exception:
        db_healthy = False
        db_latency_ms = 0.0

    storage_kind = settings.storage_backend
    storage_accessible = False
    try:
        if storage_kind == "filesystem":
            storage_accessible = Path(settings.storage_directory).is_dir()
        else:
            c = storage.client(probe=True)
            c.head_bucket(Bucket=settings.s3_bucket)
            storage_accessible = True
    except Exception:
        storage_accessible = False

    total_files = db.scalar(select(func.count()).select_from(FileObject)) or 0
    total_bytes = db.scalar(select(func.coalesce(func.sum(FileObject.size), 0))) or 0
    pending_deletions = db.scalar(select(func.count()).where(DeletionRequest.status == "queued")) or 0
    outbox_pending = db.scalar(select(func.count()).where(Outbox.delivered.is_(False))) or 0

    oldest_outbox = db.scalar(
        select(Outbox.created_at)
        .where(Outbox.delivered.is_(False))
        .order_by(Outbox.created_at.asc())
        .limit(1)
    )
    outbox_oldest_age = round((now() - oldest_outbox).total_seconds(), 1) if oldest_outbox else None

    return {
        "db_healthy": db_healthy,
        "db_latency_ms": db_latency_ms,
        "storage_kind": storage_kind,
        "storage_accessible": storage_accessible,
        "total_file_objects": total_files,
        "total_storage_bytes": total_bytes,
        "pending_deletions_count": pending_deletions,
        "outbox_pending_count": outbox_pending,
        "outbox_oldest_age_seconds": outbox_oldest_age,
        "checked_at": now(),
    }
