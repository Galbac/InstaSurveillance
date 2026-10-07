import threading
from contextlib import contextmanager
from datetime import timedelta
from uuid import uuid4

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.security import now
from app.models import Job, Profile, User

ACTIVE = {"queued", "uploading", "connecting", "syncing", "parsing", "running"}
TERMINAL = {
    "completed",
    "failed",
    "cancelled",
    "expired",
    "partial",
    "needs_review",
    "cooldown",
    "challenge_required",
    "reconnect_required",
}


class JobGuard:
    def __init__(self, job_id: str, run_token: str):
        self.job_id, self.run_token = job_id, run_token

    def __call__(self):
        with SessionLocal() as db:
            job = db.get(Job, self.job_id)
            if not job or job.status not in ACTIVE or job.details.get("run_token") != self.run_token:
                raise AppError("cancelled", "Задание отменено", 409)
            if job.kind == "connect":
                from app.core.config import get_settings

                if (
                    job.created_at + timedelta(seconds=get_settings().instagram_credential_ttl_seconds)
                    <= now()
                ):
                    raise AppError("expired", "Попытка входа истекла", 410)
            owner = db.get(User, job.user_id)
            if not owner or owner.status != "active":
                raise AppError("cancelled", "Аккаунт недоступен", 409)
            if job.profile_id:
                profile = db.get(Profile, job.profile_id)
                if not profile or profile.status == "deleting":
                    raise AppError("cancelled", "Профиль удалён", 409)
                if job.kind in ("sync", "connect"):
                    from app.core.config import get_settings

                    if not get_settings().instagram_private_enabled:
                        raise AppError("provider_disabled", "Источник отключён", 409)
                    if profile.generation != job.details.get("generation") or (
                        job.kind == "sync" and profile.paused
                    ):
                        raise AppError("cancelled", "Подключение изменилось", 409)
            if not job.heartbeat_at or job.heartbeat_at < now() - timedelta(seconds=15):
                job.heartbeat_at = now()
                db.commit()

    def progress(self, stage: str, **details):
        self()
        with SessionLocal() as db:
            job = db.scalar(select(Job).where(Job.id == self.job_id).with_for_update())
            if not job or job.status not in ACTIVE or job.details.get("run_token") != self.run_token:
                raise AppError("cancelled", "Задание отменено", 409)
            job.stage = stage
            job.details = {**job.details, **details}
            job.heartbeat_at = now()
            db.commit()


@contextmanager
def heartbeat(guard: JobGuard):
    stopped = threading.Event()

    def pulse():
        while not stopped.wait(15):
            try:
                guard()
            except Exception:
                return

    thread = threading.Thread(target=pulse, daemon=True)
    thread.start()
    try:
        yield guard
    finally:
        stopped.set()
        thread.join(timeout=1)


def claim(job_id: str) -> JobGuard | None:
    with SessionLocal() as db:
        job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
        if not job or job.status != "queued":
            return None
        identity = str(uuid4())
        job.attempts += 1
        job.status = {"connect": "connecting", "sync": "syncing", "import": "parsing"}.get(
            job.kind, "running"
        )
        job.started_at = now()
        job.heartbeat_at = now()
        job.error_code = None
        job.details = {**job.details, "run_token": identity}
        db.commit()
        return JobGuard(job_id, identity)


def finish(guard: JobGuard, details: dict | None = None):
    with SessionLocal() as db:
        job = db.scalar(select(Job).where(Job.id == guard.job_id).with_for_update())
        if (
            not job
            or job.details.get("run_token") != guard.run_token
            or job.status not in {"connecting", "syncing", "parsing", "running"}
        ):
            return
        job.status, job.stage = "completed", "completed"
        job.finished_at = now()
        job.heartbeat_at = now()
        if details:
            job.details = {**job.details, **details}
        db.commit()
