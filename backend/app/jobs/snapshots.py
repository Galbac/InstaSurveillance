import hashlib
import json
from uuid import uuid4

from sqlalchemy import func, insert, select

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.limits import runtime_settings as get_settings
from app.core.security import now
from app.domain.analytics import Relationships
from app.jobs.notifications import notify
from app.models import Annotation, Job, Member, Profile, Snapshot, User


def normalized_size(data: Relationships, provenance: dict) -> int:
    return len(
        json.dumps(
            {
                "followers": data.followers,
                "following": data.following,
                "metadata": provenance,
                "avatars": data.avatars,
                "source_timestamps": {key: value.isoformat() for key, value in data.timestamps.items()},
                "counts": data.summary(),
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    )


def storage_usage(db, user_id: str) -> int:
    snapshots = db.scalar(
        select(func.coalesce(func.sum(Snapshot.storage_bytes), 0))
        .join(Profile)
        .where(Profile.user_id == user_id)
    )
    notes = db.scalar(
        select(func.coalesce(func.sum(Annotation.storage_bytes), 0))
        .join(Profile)
        .where(Profile.user_id == user_id)
    )
    return int(snapshots + notes)


def publish(
    guard, data: Relationships, observed_at, source: str, complete: str, identity_mode: str, provenance: dict
) -> str:
    guard()
    checksum = hashlib.sha256(
        json.dumps(
            {
                "f": {k: v.lower() for k, v in data.followers.items()},
                "g": {k: v.lower() for k, v in data.following.items()},
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    size = normalized_size(data, provenance)
    settings = get_settings()
    with SessionLocal() as db:
        running = db.get(Job, guard.job_id)
        if not running:
            raise AppError("cancelled", "Задание удалено", 409)
        owner = db.scalar(select(User).where(User.id == running.user_id).with_for_update())
        profile = db.scalar(select(Profile).where(Profile.id == running.profile_id).with_for_update())
        job = db.scalar(select(Job).where(Job.id == running.id).with_for_update())
        if (
            not job
            or not owner
            or owner.status != "active"
            or not profile
            or profile.status == "deleting"
            or job.status == "cancelled"
            or job.details.get("run_token") != guard.run_token
        ):
            raise AppError("cancelled", "Публикация отменена", 409)
        if source in {"instagrapi", "aiograpi"} and (
            profile.paused or profile.generation != job.details["generation"]
        ):
            raise AppError("cancelled", "Подключение изменилось", 409)
        existing = db.scalar(select(Snapshot).where(Snapshot.job_id == job.id))
        duplicate = existing or db.scalar(
            select(Snapshot).where(
                Snapshot.profile_id == profile.id,
                Snapshot.checksum == checksum,
                Snapshot.observed_at == observed_at,
                Snapshot.source == source,
                Snapshot.identity_mode == identity_mode,
            )
        )
        if duplicate:
            job.status, job.stage = (
                ("partial" if duplicate.completeness == "partial" else "completed"),
                "duplicate",
            )
            job.finished_at = now()
            job.details = {**job.details, "snapshot_id": duplicate.id, "warnings": ["duplicate_snapshot"]}
            db.commit()
            return duplicate.id
        if storage_usage(db, owner.id) + size > settings.user_storage_quota_bytes:
            raise AppError(
                "storage_quota", "Квота истории исчерпана. Удалите снимки или обратитесь в поддержку", 409
            )
        if source in {"instagrapi", "aiograpi"}:
            previous = db.scalar(
                select(Snapshot)
                .where(Snapshot.profile_id == profile.id)
                .order_by(Snapshot.observed_at.desc())
                .limit(1)
            )
            if previous and previous.identity_mode == identity_mode and previous.counts:
                old = previous.counts.get("followers", 0)
                if (
                    old >= settings.instagram_large_change_min_members
                    and abs(len(data.followers) - old) / old >= settings.instagram_large_change_fraction
                ):
                    raise AppError(
                        "needs_review",
                        "Большое изменение списка требует проверки. Предыдущий снимок сохранён",
                        409,
                    )
        snapshot = Snapshot(
            profile_id=profile.id,
            source=source,
            observed_at=observed_at,
            completeness=complete,
            identity_mode=identity_mode,
            checksum=checksum,
            job_id=job.id,
            counts=data.summary(),
            provenance=provenance,
            storage_bytes=size,
        )
        db.add(snapshot)
        db.flush()
        timestamp = now()
        batch = []
        for relation, rows in (("followers", data.followers), ("following", data.following)):
            for key, username in rows.items():
                batch.append(
                    {
                        "id": str(uuid4()),
                        "created_at": timestamp,
                        "snapshot_id": snapshot.id,
                        "relation": relation,
                        "identity_key": key,
                        "username": username,
                        "source_timestamp": data.timestamps.get(relation + ":" + key),
                        "avatar_url": data.avatars.get(key),
                    }
                )
                if len(batch) >= 1000:
                    db.execute(insert(Member), batch)
                    batch = []
        if batch:
            db.execute(insert(Member), batch)
        job.status, job.stage = (
            ("partial", "completed") if complete == "partial" else ("completed", "completed")
        )
        job.finished_at = now()
        job.details = {**job.details, "snapshot_id": snapshot.id, "counts": data.summary()}
        if source in {"instagrapi", "aiograpi"}:
            profile.last_sync = now()
            profile.status = "active"
        notify(
            db,
            owner.id,
            "results",
            "Данные обновлены",
            "Сохранён неполный список. Доступные аккаунты можно просматривать; выводы об отписках отключены."
            if complete == "partial"
            else "Новый снимок готов. Посмотрите изменения и взаимность подписок.",
            "/app",
            "snapshot:" + snapshot.id,
        )
        enqueue_neighbors(db, snapshot)
        db.commit()
        return snapshot.id


def enqueue_neighbors(db, snapshot):

    from app.models import Comparison

    before = db.scalar(
        select(Snapshot)
        .where(Snapshot.profile_id == snapshot.profile_id, Snapshot.observed_at < snapshot.observed_at)
        .order_by(Snapshot.observed_at.desc())
        .limit(1)
    )
    after = db.scalar(
        select(Snapshot)
        .where(Snapshot.profile_id == snapshot.profile_id, Snapshot.observed_at > snapshot.observed_at)
        .order_by(Snapshot.observed_at.asc())
        .limit(1)
    )
    for left, right in ((before, snapshot), (snapshot, after)):
        if (
            left
            and right
            and left.identity_mode == right.identity_mode
            and left.completeness in {"user_confirmed", "collection_validated"}
            and right.completeness in {"user_confirmed", "collection_validated"}
        ):
            existing = db.scalar(
                select(Comparison).where(
                    Comparison.before_id == left.id,
                    Comparison.after_id == right.id,
                    Comparison.algorithm_version == "1",
                )
            )
            if not existing:
                db.add(Comparison(profile_id=snapshot.profile_id, before_id=left.id, after_id=right.id))
