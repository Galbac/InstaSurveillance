import hashlib
import json
import tempfile
import zipfile
from datetime import timedelta
from pathlib import PurePosixPath

from fastapi import File, Request, Response, UploadFile
from sqlalchemy import func, select

from app.core.async_io import blocking_call
from app.core.commands import begin_command, finish_command, heavy_limit
from app.core.config import Settings
from app.core.dependencies import DB, Verified, rate_limit
from app.core.errors import AppError
from app.core.limits import runtime_settings as get_settings
from app.core.router import APIRouter
from app.core.security import now
from app.integrations import storage
from app.integrations.archive import ALLOWLIST
from app.models import FileObject, Job, Outbox, User
from app.modules.contracts import JobDTO
from app.modules.data import ConfirmInput, job_dict, job_owned, profile_owned

router = APIRouter(prefix="/api/v1", tags=["imports"])


def spool_upload(uploads: list[UploadFile], settings: Settings | None = None):
    settings = settings or get_settings()
    target = tempfile.SpooledTemporaryFile(max_size=1024 * 1024)
    count = 0
    hashes = []
    try:
        if len(uploads) > settings.max_archive_entries:
            raise AppError("archive_limit", "Слишком много выбранных файлов")
        names = [PurePosixPath(upload.filename or "archive.zip").name for upload in uploads]
        if len(uploads) > 1 and (
            len(set(names)) != len(names) or any(not ALLOWLIST.fullmatch(name) for name in names)
        ):
            raise AppError("mixed_archives", "Выберите один ZIP или JSON-файлы связей одного профиля")
        archive = zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) if len(uploads) > 1 else None
        try:
            for upload, name in zip(uploads, names, strict=True):
                checksum = hashlib.sha256()
                writer = archive.open(name, "w") if archive else target
                try:
                    while chunk := upload.file.read(1024 * 1024):
                        count += len(chunk)
                        if count > settings.max_upload_bytes:
                            raise AppError("upload_limit", "Файлы превышают допустимый размер", 413)
                        checksum.update(chunk)
                        writer.write(chunk)
                finally:
                    if archive:
                        writer.close()
                hashes.append((name, checksum.hexdigest()))
        finally:
            if archive:
                archive.close()
        size = target.tell()
        if size > settings.max_upload_bytes:
            raise AppError("upload_limit", "Файл превышает допустимый размер", 413)
        target.seek(0)
        fingerprint = hashlib.sha256(json.dumps(sorted(hashes)).encode()).hexdigest()
        return target, size, "archive.zip" if archive else names[0], fingerprint
    except Exception:
        target.close()
        raise


@router.post("/profiles/{profile_id}/imports", status_code=202, response_model=JobDTO)
def upload(
    profile_id: str,
    user: Verified,
    db: DB,
    request: Request,
    response: Response,
    file: UploadFile | None = File(default=None),
    files: list[UploadFile] | None = File(default=None, alias="files[]"),
):
    profile_owned(db, user, profile_id)
    db.rollback()
    selected = files or ([file] if file else [])
    if not selected:
        raise AppError("file_required", "Выберите файлы")
    with_spool = blocking_call(spool_upload, selected, get_settings())
    stream, size, filename, fingerprint = with_spool
    try:
        record, cached = begin_command(db, user, request, {"profile": profile_id, "checksum": fingerprint})
        if cached:
            response.headers["Location"] = "/api/v1/imports/" + cached["id"]
            return cached
        settings = get_settings()
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        profile_owned(db, user, profile_id, True)
        heavy_limit(db, user.id)
        rate_limit("upload:" + user.id, settings.imports_per_hour, 3600)
        count = db.scalar(
            select(func.count())
            .select_from(Job)
            .where(
                Job.profile_id == profile_id,
                Job.kind == "import",
                Job.status.in_(["uploading", "queued", "parsing", "awaiting_confirmation"]),
            )
        )
        if (count or 0) >= settings.max_active_imports_per_profile:
            raise AppError("import_in_progress", "Дождитесь текущего импорта", 409)
        job = Job(
            user_id=user.id,
            profile_id=profile_id,
            kind="import",
            status="uploading",
            stage="uploaded",
            details={"filename": filename},
        )
        db.add(job)
        db.flush()
        key = "imports/" + job.id
        job.details = {"filename": filename, "object_key": key, "upload_checksum": fingerprint}
        db.add(
            FileObject(
                owner=user.id,
                job_id=job.id,
                key=key,
                size=size,
                writing_until=now() + timedelta(seconds=settings.storage_write_timeout_seconds + 120),
                expires_at=now() + timedelta(hours=settings.raw_file_ttl_hours),
            )
        )
        finish_command(record, job_dict(job))
        db.commit()
        try:
            try:
                blocking_call(storage.put_stream, key, stream, size)
            finally:
                # This request's ORM facade uses native async psycopg. Keep the
                # durable writing deadline if the database cannot acknowledge completion.
                try:
                    record_file = db.scalar(select(FileObject).where(FileObject.key == key).with_for_update())
                    if record_file:
                        record_file.writing_until = None
                        db.commit()
                except Exception:
                    db.rollback()
        except Exception as error:
            job = db.get(Job, job.id)
            if job:
                job.status, job.error_code = "failed", "storage_unavailable"
                db.commit()
            raise AppError("storage_unavailable", "Хранилище недоступно. Повторите позже", 503) from error
        db.refresh(job)
        owner = db.get(User, user.id)
        if not owner or owner.status != "active" or job.status != "uploading":
            try:
                blocking_call(storage.remove, key)
            except Exception:
                pass
            raise AppError("cancelled", "Загрузка отменена", 409)
        job.status, job.stage = "queued", "validating"
        db.add(Outbox(kind="job", reference=job.id))
        result = finish_command(record, job_dict(job))
        db.commit()
        response.headers["Location"] = "/api/v1/imports/" + job.id
        return result
    finally:
        blocking_call(stream.close)


@router.post("/imports/{job_id}/confirm", status_code=202, response_model=JobDTO)
def confirm(job_id: str, body: ConfirmInput, user: Verified, db: DB, request: Request, response: Response):
    record, cached = begin_command(db, user, request, body.model_dump())
    if cached:
        response.headers["Location"] = "/api/v1/imports/" + cached["id"]
        return cached
    job = job_owned(db, user, job_id)
    if job.status != "awaiting_confirmation" or not all(
        (body.full_period, body.followers_complete, body.following_complete, body.owns_data)
    ):
        raise AppError("incomplete_archive", "Подтвердите полноту и право на обработку данных", 409)
    if job.created_at + timedelta(hours=get_settings().import_confirm_ttl_hours) <= now():
        raise AppError("import_expired", "Предпросмотр истёк. Загрузите архив заново", 410)
    if body.observed_at.tzinfo is None or body.observed_at > now():
        raise AppError("invalid_date", "Укажите прошедшее время с часовым поясом")
    heavy_limit(db, user.id)
    job.details = {
        **job.details,
        "observed_at": body.observed_at.isoformat(),
        "observed_at_source": "user_declared",
        "confirmed": True,
    }
    job.status = "queued"
    db.add(Outbox(kind="job", reference=job.id))
    result = finish_command(record, job_dict(job))
    db.commit()
    response.headers["Location"] = "/api/v1/imports/" + job.id
    return result
