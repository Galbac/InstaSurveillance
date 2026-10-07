"""Atomic command receipts. Credential-bearing commands never fingerprint their body."""

import json
import re
from datetime import timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.encryption import VersionedCipher
from app.core.errors import AppError
from app.core.security import digest, now
from app.models import AuditEvent, IdempotencyRecord, Job, User


def data_cipher():
    settings = get_settings()
    key = settings.encryption_key or settings.instagram_pending_encryption_key
    return VersionedCipher(
        settings.encryption_key_version,
        key.get_secret_value(),
        json.loads(settings.encryption_previous_keys.get_secret_value()),
    )


def begin_command(db: Session, user: User, request: Request, payload=None, *, credentials=False):
    key = request.headers.get("Idempotency-Key")
    if not key:
        return None, None
    if not re.fullmatch(r"[a-zA-Z0-9._:-]{8,128}", key):
        raise AppError("invalid_idempotency_key", "Некорректный ключ запроса")
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    scope = request.method + " " + request.url.path
    fingerprint = (
        None
        if credentials
        else digest(json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")))
    )
    record = db.scalar(
        select(IdempotencyRecord)
        .where(
            IdempotencyRecord.owner == user.id,
            IdempotencyRecord.scope == scope,
            IdempotencyRecord.key_hash == digest(key),
        )
        .with_for_update()
    )
    if record and record.expires_at <= now():
        db.delete(record)
        db.flush()
        record = None
    if record:
        if record.request_hash != fingerprint:
            raise AppError("idempotency_conflict", "Ключ уже использован для другого запроса", 409)
        if record.encrypted_response:
            return record, json.loads(data_cipher().decrypt(record.encrypted_response.encode()))
        raise AppError("command_pending", "Предыдущий запрос ещё выполняется", 409)
    record = IdempotencyRecord(
        owner=user.id,
        scope=scope,
        key_hash=digest(key),
        request_hash=fingerprint,
        expires_at=now() + timedelta(hours=24),
    )
    db.add(record)
    db.flush()
    return record, None


def finish_command(record, response: dict) -> dict:
    if record:
        record.encrypted_response = data_cipher().encrypt(json.dumps(response, default=str).encode()).decode()
    return response


def audit(
    db: Session, actor: str | None, action: str, target: str, request_id: str | None = None, **metadata
) -> None:
    # Callers provide technical IDs/enums only. No request bodies or provider exceptions.
    db.add(
        AuditEvent(
            actor_id=actor, action=action, target=target, request_id=request_id, metadata_json=metadata
        )
    )


def heavy_limit(db: Session, user_id: str) -> None:
    from sqlalchemy import func

    count = db.scalar(
        select(func.count())
        .select_from(Job)
        .where(
            Job.user_id == user_id,
            Job.status.in_(["uploading", "queued", "connecting", "syncing", "parsing", "running"]),
        )
    )
    if (count or 0) >= get_settings().max_active_heavy_jobs_per_user:
        raise AppError("heavy_job_limit", "Слишком много активных заданий. Дождитесь завершения", 429)
