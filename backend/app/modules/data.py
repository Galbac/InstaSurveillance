import json
from datetime import datetime, timedelta

from fastapi import Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.core.dependencies import DB, Verified, rate_limit
from app.core.errors import AppError
from app.core.limits import runtime_settings as get_settings
from app.core.redis_io import redis_command
from app.core.router import APIRouter
from app.core.security import cipher, now
from app.domain.analytics import Relationships
from app.integrations.archive import normalize_username
from app.models import (
    Annotation,
    Job,
    Member,
    Outbox,
    Profile,
    SessionSecret,
    Snapshot,
    User,
)
from app.modules.contracts import AnnotationDTO, JobDTO, ProfileDTO, PublicConfigDTO, StatusDTO

router = APIRouter(prefix="/api/v1")


class ProfileInput(BaseModel):
    username: str = Field(min_length=1, max_length=31)
    label: str = Field(default="", max_length=80)


class ConnectInput(ProfileInput):
    password: str = Field(min_length=1, max_length=256)
    accepted_connection_risks: bool
    connection_terms_version: str = "2026-10-07"


class VerifyInput(BaseModel):
    verification_code: str = Field(min_length=4, max_length=20, pattern="^[a-zA-Z0-9-]+$")


class NoteInput(BaseModel):
    favorite: bool = False
    note: str = Field(default="", max_length=1000)


class ConfirmInput(BaseModel):
    observed_at: datetime
    full_period: bool
    followers_complete: bool
    following_complete: bool
    owns_data: bool


class PauseInput(BaseModel):
    paused: bool
    interval_hours: int | None = Field(default=None, ge=1, le=8760)


class DeleteInput(BaseModel):
    password: str
    confirmation: str


class TicketInput(BaseModel):
    body: str = Field(min_length=10, max_length=5000)


def profile_owned(db, user, profile_id: str, lock: bool = False) -> Profile:
    if lock:
        owner = db.scalar(
            select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True)
        )
        if not owner or owner.status != "active":
            raise AppError("account_unavailable", "Аккаунт недоступен", 403)
    q = select(Profile).where(
        Profile.id == profile_id, Profile.user_id == user.id, Profile.status != "deleting"
    )
    profile = db.scalar(q.with_for_update() if lock else q)
    if not profile:
        raise AppError("not_found", "Профиль не найден", 404)
    return profile


def job_owned(db, user, job_id: str) -> Job:
    job = db.get(Job, job_id)
    if not job or job.user_id != user.id:
        raise AppError("not_found", "Задание не найдено", 404)
    return job


def profile_dict(x: Profile) -> dict:
    return {
        "id": x.id,
        "username": x.username,
        "label": x.label,
        "interval_hours": x.interval_hours,
        "status": x.status,
        "paused": x.paused,
        "last_sync": x.last_sync,
        "next_sync": x.next_sync,
        "cooldown_until": x.cooldown_until,
    }


def job_dict(x: Job) -> dict:
    return {
        "id": x.id,
        "kind": x.kind,
        "status": x.status,
        "stage": x.stage,
        "details": {
            k: v
            for k, v in x.details.items()
            if k
            in (
                "counts",
                "stage_count",
                "snapshot_id",
                "comparison_id",
                "export_id",
                "requests",
                "pages",
                "filename",
                "warnings",
                "samples",
                "used_bytes",
                "expected_bytes",
                "provider_version",
                "method",
                "destination_mask",
                "expires_at",
            )
        },
        "updated_at": x.updated_at,
        "allowed_actions": ["verify", "cancel"]
        if x.status == "awaiting_2fa"
        else ["confirm", "cancel"]
        if x.status == "awaiting_confirmation"
        else ["cancel"]
        if x.status in ("queued", "connecting", "syncing", "parsing", "running")
        else [],
        "error_code": x.error_code,
        "created_at": x.created_at,
    }


def relationship(db, snapshot_id: str) -> Relationships:
    f, g = {}, {}
    for member in db.scalars(select(Member).where(Member.snapshot_id == snapshot_id)):
        (f if member.relation == "followers" else g)[member.identity_key] = member.username
    return Relationships(f, g)


def snapshots(db, profile_id: str) -> list[Snapshot]:
    return list(
        db.scalars(
            select(Snapshot)
            .where(Snapshot.profile_id == profile_id)
            .order_by(Snapshot.observed_at.desc(), Snapshot.id.desc())
        )
    )


def snapshot_dict(x: Snapshot) -> dict:
    return {
        "id": x.id,
        "source": x.source,
        "observed_at": x.observed_at,
        "created_at": x.created_at,
        "completeness": x.completeness,
        "identity_mode": x.identity_mode,
    }


def enqueue(db, job: Job) -> None:
    db.add(job)
    db.flush()
    db.add(Outbox(kind="job", reference=job.id))


def create_profile(db, user, username: str) -> Profile:
    s = get_settings()
    # Lock the user to make concurrent profile-limit checks atomic.
    from app.models import User

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    name = normalize_username(username)
    existing = db.scalar(select(Profile).where(Profile.user_id == user.id, Profile.username == name))
    if existing:
        return existing
    if (
        db.scalar(select(func.count()).select_from(Profile).where(Profile.user_id == user.id))
        >= s.max_profiles_per_user
    ):
        raise AppError("profile_limit", "Лимит подключенных профилей достигнут", 409)
    profile = Profile(user_id=user.id, username=name, interval_hours=s.instagram_sync_interval_hours)
    db.add(profile)
    db.flush()
    return profile


@router.get("/profiles", response_model=list[ProfileDTO])
def profiles(user: Verified, db: DB):
    return [
        profile_dict(x)
        for x in db.scalars(select(Profile).where(Profile.user_id == user.id, Profile.status != "deleting"))
    ]


@router.post("/profiles", status_code=201, response_model=ProfileDTO)
def add_profile(body: ProfileInput, user: Verified, db: DB):
    profile = create_profile(db, user, body.username)
    profile.label = body.label
    db.commit()
    return profile_dict(profile)


@router.post("/instagram/connections", status_code=202, response_model=JobDTO)
def connect(body: ConnectInput, user: Verified, db: DB, request: Request, response: Response):
    from app.core.commands import audit, begin_command, finish_command, heavy_limit
    from app.models import Consent

    record, cached = begin_command(db, user, request, credentials=True)
    if cached:
        previous = db.get(Job, cached["id"])
        if not previous or previous.status == "expired":
            raise AppError("attempt_expired", "Создайте новую попытку входа", 410)
        response.headers["Location"] = "/api/v1/instagram/connection-attempts/" + cached["id"]
        return cached
    s = get_settings()
    if body.connection_terms_version != s.connection_terms_version:
        raise AppError("consent_version_changed", "Условия подключения обновились. Обновите страницу")
    if not s.instagram_private_enabled:
        raise AppError("provider_disabled", "Подключение временно недоступно", 503)
    if not body.accepted_connection_risks:
        raise AppError("consent_required", "Подтвердите условия подключения")
    rate_limit("iglogin:" + user.id, s.instagram_login_max_attempts, 3600)
    from app.core.security import digest

    rate_limit(
        "iglogin-account:" + digest(normalize_username(body.username)), s.instagram_login_max_attempts, 3600
    )
    rate_limit(
        "iglogin-ip:" + (request.client.host if request.client else "unknown"),
        s.instagram_login_max_attempts,
        3600,
    )
    heavy_limit(db, user.id)
    profile = create_profile(db, user, body.username)
    db.refresh(profile, with_for_update=True)
    if profile.cooldown_until and profile.cooldown_until > now():
        raise AppError("cooldown", "Дождитесь окончания ограничения", 429)
    pending = db.scalar(
        select(Job).where(
            Job.profile_id == profile.id,
            Job.kind.in_(["connect", "sync"]),
            Job.status.in_(["queued", "connecting", "syncing", "awaiting_2fa"]),
        )
    )
    if pending:
        raise AppError("connection_in_progress", "Подключение уже выполняется", 409)
    profile.generation += 1
    profile.status = "connecting"
    job = Job(
        user_id=user.id, profile_id=profile.id, kind="connect", details={"generation": profile.generation}
    )
    enqueue(db, job)
    redis_command(
        s.auth_vault_url,
        "setex",
        "login:" + job.id,
        s.instagram_credential_ttl_seconds,
        cipher(s.instagram_pending_encryption_key.get_secret_value()).encrypt(
            json.dumps({"username": profile.username, "password": body.password}).encode()
        ),
    )
    db.add(Consent(user_id=user.id, purpose="instagram-connection", version=body.connection_terms_version))
    audit(db, user.id, "instagram.connect_requested", profile.id, request.state.request_id)
    result = finish_command(record, job_dict(job))
    db.commit()
    response.headers["Location"] = "/api/v1/instagram/connection-attempts/" + job.id
    return result


@router.get(
    "/instagram/connection-attempts/{job_id}", response_model=JobDTO, response_model_exclude_unset=True
)
@router.get("/syncs/{job_id}", response_model=JobDTO, response_model_exclude_unset=True)
@router.get("/imports/{job_id}", response_model=JobDTO, response_model_exclude_unset=True)
def get_job(job_id: str, user: Verified, db: DB):
    return job_dict(job_owned(db, user, job_id))


@router.post("/instagram/connection-attempts/{job_id}/verify", status_code=202, response_model=JobDTO)
def verify_connection(job_id: str, body: VerifyInput, user: Verified, db: DB, response: Response):
    s = get_settings()
    job = job_owned(db, user, job_id)
    if job.kind != "connect" or job.status != "awaiting_2fa":
        raise AppError("invalid_state", "Проверка кода недоступна", 409)
    rate_limit("igcode:" + job.id, 3, 600)
    ttl = redis_command(s.auth_vault_url, "ttl", "login:" + job.id)
    if ttl <= 0:
        raise AppError("expired", "Попытка входа истекла. Подключите аккаунт заново", 409)
    redis_command(
        s.auth_vault_url,
        "setex",
        "code:" + job.id,
        ttl,
        cipher(s.instagram_pending_encryption_key.get_secret_value()).encrypt(
            body.verification_code.encode()
        ),
    )
    job.status = "queued"
    enqueue_event = Outbox(kind="job", reference=job.id)
    db.add(enqueue_event)
    db.commit()
    response.headers["Location"] = "/api/v1/instagram/connection-attempts/" + job.id
    return job_dict(job)


@router.patch("/profiles/{profile_id}/connection", response_model=ProfileDTO)
def pause(profile_id: str, body: PauseInput, user: Verified, db: DB):
    p = profile_owned(db, user, profile_id, True)
    if body.interval_hours is not None:
        if body.interval_hours < get_settings().instagram_sync_interval_hours:
            raise AppError("interval_limit", "Интервал не может быть ниже минимального")
        p.interval_hours = body.interval_hours
    p.paused = body.paused
    db.commit()
    return profile_dict(p)


@router.delete("/profiles/{profile_id}/connection", status_code=202, response_model=StatusDTO)
def disconnect(profile_id: str, user: Verified, db: DB, response: Response):
    p = profile_owned(db, user, profile_id, True)
    from uuid import uuid4

    from sqlalchemy import text

    capability = str(uuid4())
    prepared = db.scalar(
        text("SELECT public.prepare_instagram_logout(:profile,:owner,:id)"),
        {"profile": p.id, "owner": user.id, "id": capability},
    )
    if prepared:
        db.add(Outbox(kind="revoke", reference=capability))
    p.generation += 1
    p.status = "disconnected"
    p.paused = True
    p.next_sync = None
    p.external_id = None
    db.execute(
        delete(SessionSecret)
        .where(SessionSecret.profile_id == p.id)
        .execution_options(synchronize_session=False)
    )
    cancelled = []
    for job in db.scalars(
        select(Job).where(
            Job.profile_id == p.id, Job.status.in_(["queued", "connecting", "awaiting_2fa", "syncing"])
        )
    ):
        job.status = "cancelled"
        cancelled.append(job.id)
    db.commit()
    # Revocation is durable before touching the disposable vault. TTL bounds any failed cleanup.
    from app.integrations.vault import clear_attempts

    clear_attempts(cancelled)
    response.headers["Location"] = f"/api/v1/profiles/{profile_id}/connection"
    return {"status": "disconnected"}


def request_sync(db, p: Profile) -> Job:
    s = get_settings()
    if not s.instagram_private_enabled or p.status not in ("active", "syncing") or p.paused:
        raise AppError("connection_unavailable", "Подключение не активно", 409)
    if p.cooldown_until and p.cooldown_until > now():
        raise AppError("cooldown", "Instagram ограничил запросы", 429)
    if db.scalar(
        select(Job).where(Job.profile_id == p.id, Job.kind == "sync", Job.status.in_(["queued", "syncing"]))
    ):
        raise AppError("already_running", "Сбор уже выполняется", 409)
    from app.core.commands import heavy_limit
    from app.core.security import csrf
    from app.models import PlatformRun

    heavy_limit(db, p.user_id)
    external_hash = csrf("platform:" + (p.external_id or p.id))
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy import text

        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(external_hash[:15], 16)})
    cutoff = now() - timedelta(hours=24)
    runs = list(
        db.scalars(
            select(PlatformRun)
            .where(PlatformRun.external_hash == external_hash, PlatformRun.created_at > cutoff)
            .order_by(PlatformRun.created_at)
        )
    )
    next_allowed = max(
        [
            p.cooldown_until or now(),
            runs[-1].created_at + timedelta(hours=s.instagram_manual_min_interval_hours) if runs else now(),
            runs[0].created_at + timedelta(hours=24) if len(runs) >= s.instagram_max_runs_per_24h else now(),
        ]
    )
    if next_allowed > now():
        raise AppError(
            "sync_rate_limited",
            "Повторное обновление пока недоступно",
            429,
            {
                "next_allowed_at": next_allowed.isoformat(),
                "retry_after": max(1, int((next_allowed - now()).total_seconds())),
            },
        )
    job = Job(user_id=p.user_id, profile_id=p.id, kind="sync", details={"generation": p.generation})
    enqueue(db, job)
    db.add(PlatformRun(external_hash=external_hash, job_reference=job.id))
    p.next_sync = now() + timedelta(hours=max(p.interval_hours, s.instagram_sync_interval_hours))
    p.status = "syncing"
    return job


@router.post("/profiles/{profile_id}/syncs", status_code=202, response_model=JobDTO)
def sync(profile_id: str, user: Verified, db: DB, request: Request, response: Response):
    from app.core.commands import begin_command, finish_command

    record, cached = begin_command(db, user, request, {"profile_id": profile_id})
    if cached:
        response.headers["Location"] = "/api/v1/syncs/" + cached["id"]
        return cached
    p = profile_owned(db, user, profile_id, True)
    job = request_sync(db, p)
    result = finish_command(record, job_dict(job))
    db.commit()
    response.headers["Location"] = "/api/v1/syncs/" + job.id
    return result


@router.put("/profiles/{profile_id}/annotations/{identity_key}", response_model=AnnotationDTO)
def annotate(profile_id: str, identity_key: str, body: NoteInput, user: Verified, db: DB):
    from app.models import User

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    profile_owned(db, user, profile_id, True)
    if len(identity_key) > 80:
        raise AppError("invalid_identity", "Некорректный ключ")
    x = db.scalar(
        select(Annotation).where(Annotation.profile_id == profile_id, Annotation.identity_key == identity_key)
    )
    if not x:
        x = Annotation(profile_id=profile_id, identity_key=identity_key)
        db.add(x)
    from app.jobs.snapshots import storage_usage

    size = len(
        json.dumps(
            {"identity_key": identity_key, "favorite": body.favorite, "note": body.note},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    )
    if storage_usage(db, user.id) - (x.storage_bytes or 0) + size > get_settings().user_storage_quota_bytes:
        raise AppError("storage_quota", "Квота истории исчерпана", 409)
    x.favorite, x.note, x.storage_bytes = body.favorite, body.note, size
    db.commit()
    return {"favorite": x.favorite, "note": x.note}


@router.get("/config/public", response_model=PublicConfigDTO)
def public_config(db: DB):
    s = get_settings()
    return {
        "instagram_enabled": s.instagram_private_enabled,
        "max_upload_bytes": s.max_upload_bytes,
        "sync_interval_hours": s.instagram_sync_interval_hours,
        "manual_min_interval_hours": s.instagram_manual_min_interval_hours,
        "max_runs_per_24h": s.instagram_max_runs_per_24h,
        "terms_version": s.terms_version,
        "privacy_version": s.privacy_version,
        "connection_terms_version": s.connection_terms_version,
        "user_storage_quota_bytes": s.user_storage_quota_bytes,
        "enable_email_notifications": s.enable_email_notifications,
        "enable_pwa": s.enable_pwa,
        "enable_official_instagram": s.enable_official_instagram,
        "operator_name": s.operator_name,
        "operator_address": s.operator_address,
        "operator_jurisdiction": s.operator_jurisdiction,
        "support_email": s.support_email,
        "backup_retention_days": s.backup_retention_days,
    }


@router.get("/jobs/{job_id}", response_model=JobDTO)
def status_job(job_id: str, user: Verified, db: DB):
    return job_dict(job_owned(db, user, job_id))
