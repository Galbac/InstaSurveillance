from datetime import datetime, timedelta
from typing import Literal

from fastapi import Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.core.commands import begin_command, finish_command, heavy_limit
from app.core.dependencies import DB, AsyncDB, Verified
from app.core.errors import AppError, required
from app.core.router import APIRouter
from app.core.security import now
from app.integrations import storage
from app.models import (
    Annotation,
    Comparison,
    ExportJob,
    Job,
    Member,
    Notification,
    Snapshot,
    SupportTicket,
    User,
)
from app.modules.admin import page
from app.modules.contracts import (
    AnalyticsPoint,
    Category,
    CommandDTO,
    ComparisonDTO,
    ComparisonInput,
    DeliveryDTO,
    EventDTO,
    ExportDTO,
    ExportInput,
    JobDTO,
    NotificationDTO,
    Page,
    PeoplePage,
    PeriodSnapshotsDTO,
    SnapshotDTO,
    Sort,
    SummaryDTO,
    TicketDTO,
)
from app.modules.data import enqueue, job_dict, profile_dict, profile_owned, snapshot_dict
from app.modules.query_service import (
    comparable_relations,
    event_query,
    latest_snapshot,
    people_page,
    snapshot_counts,
)

router = APIRouter(prefix="/api/v1", tags=["analytics"])


@router.get("/profiles/{profile_id}/snapshots/{snapshot_id}/people/{identity}/avatar")
async def member_avatar(profile_id: str, snapshot_id: str, identity: str, user: Verified, db: AsyncDB):
    def resolve(session):
        profile_owned(session, user, profile_id)
        return required(
            session.scalar(
                select(Member.avatar_url)
                .join(Snapshot, Snapshot.id == Member.snapshot_id)
                .where(
                    Snapshot.profile_id == profile_id,
                    Snapshot.id == snapshot_id,
                    Member.identity_key == identity,
                    Member.avatar_url.is_not(None),
                )
                .limit(1)
            ),
            "not_found",
        )

    url = await db.run_sync(resolve)
    from app.integrations.avatars import fetch_avatar

    body, media = await fetch_avatar(url)
    return Response(
        body,
        media_type=media,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


def snapshot_dto(db, snapshot):
    return {
        **snapshot_dict(snapshot),
        "checksum": snapshot.checksum,
        "counts": snapshot_counts(db, snapshot),
        "provenance": snapshot.provenance,
        "storage_bytes": snapshot.storage_bytes,
    }


@router.get("/profiles/{profile_id}/people", response_model=PeoplePage)
def people(
    profile_id: str,
    user: Verified,
    db: DB,
    category: Category = "followers",
    search: str = Query("", max_length=100),
    favorite: bool = False,
    has_note: bool = False,
    sort: Sort = "username",
    snapshot_id: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    profile_owned(db, user, profile_id)
    snapshot = latest_snapshot(db, profile_id, snapshot_id)
    if not snapshot:
        return {"items": [], "next_cursor": None, "total": 0, "category_total": 0, "snapshot_id": None}
    return people_page(
        db, user.id, profile_id, snapshot, category, search, favorite, has_note, sort, cursor, limit
    )


@router.get("/profiles/{profile_id}/snapshots", response_model=Page[SnapshotDTO])
def history(
    profile_id: str, user: Verified, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)
):
    profile_owned(db, user, profile_id)
    # Timeline keyset uses observed time; imported order is never treated as observation order.
    from sqlalchemy import and_, or_

    from app.core.pagination import cursor_decode, cursor_encode

    scope = {"user": user.id, "profile": profile_id, "kind": "snapshots"}
    query = select(Snapshot).where(Snapshot.profile_id == profile_id)
    keys = cursor_decode(cursor, scope)
    if keys:
        timestamp = datetime.fromisoformat(keys[0])
        query = query.where(
            or_(
                Snapshot.observed_at < timestamp,
                and_(Snapshot.observed_at == timestamp, Snapshot.id < keys[1]),
            )
        )
    rows = list(db.scalars(query.order_by(Snapshot.observed_at.desc(), Snapshot.id.desc()).limit(limit + 1)))
    return {
        "items": [snapshot_dto(db, x) for x in rows[:limit]],
        "next_cursor": cursor_encode([rows[limit - 1].observed_at, rows[limit - 1].id], scope)
        if len(rows) > limit
        else None,
    }


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDTO)
def snapshot_detail(snapshot_id: str, user: Verified, db: DB):
    snapshot = db.get(Snapshot, snapshot_id)
    if not snapshot:
        raise AppError("not_found", "Снимок не найден", 404)
    profile_owned(db, user, snapshot.profile_id)
    return snapshot_dto(db, snapshot)


@router.get("/profiles/{profile_id}/summary", response_model=SummaryDTO)
def summary(profile_id: str, user: Verified, db: DB, snapshot_id: str | None = None):
    profile = profile_owned(db, user, profile_id)
    latest = latest_snapshot(db, profile_id, snapshot_id)
    last_import = db.scalar(
        select(Job)
        .where(Job.profile_id == profile_id, Job.kind == "import")
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    imported = job_dict(last_import) if last_import else None
    if not latest:
        return {
            "profile": profile_dict(profile),
            "snapshot": None,
            "counts": None,
            "changes": None,
            "last_import": imported,
        }
    from sqlalchemy import and_, or_

    previous = db.scalar(
        select(Snapshot)
        .where(
            Snapshot.profile_id == profile_id,
            or_(
                Snapshot.observed_at < latest.observed_at,
                and_(Snapshot.observed_at == latest.observed_at, Snapshot.id < latest.id),
            ),
        )
        .order_by(Snapshot.observed_at.desc(), Snapshot.id.desc())
        .limit(1)
    )
    events, counters = None, None
    if (
        previous
        and previous.identity_mode == latest.identity_mode
        and previous.observed_at < latest.observed_at
    ):
        comparison = db.scalar(
            select(Comparison).where(
                Comparison.before_id == previous.id,
                Comparison.after_id == latest.id,
                Comparison.algorithm_version == "1",
                Comparison.status == "completed",
            )
        )
        if comparison:
            from app.models import ChangeEvent

            events = [
                {
                    "identity_key": x.identity_key,
                    "username": x.username,
                    "relation": x.relation,
                    "type": x.type,
                }
                for x in db.scalars(
                    select(ChangeEvent)
                    .where(ChangeEvent.comparison_id == comparison.id)
                    .order_by(ChangeEvent.username, ChangeEvent.id)
                    .limit(20)
                )
            ]
            counters = comparison.counts
    return {
        "profile": profile_dict(profile),
        "snapshot": snapshot_dto(db, latest),
        "counts": snapshot_counts(db, latest),
        "changes": events,
        "change_counts": counters,
        "previous_snapshot": snapshot_dto(db, previous) if previous else None,
        "last_import": imported,
    }


@router.get("/profiles/{profile_id}/analytics", response_model=list[AnalyticsPoint])
def analytics(
    profile_id: str,
    user: Verified,
    db: DB,
    start: datetime | None = None,
    end: datetime | None = None,
    days: int | None = None,
):
    profile_owned(db, user, profile_id)
    if days and not start:
        start = now() - timedelta(days=days)
    if (start and start.tzinfo is None) or (end and end.tzinfo is None) or (start and end and start > end):
        raise AppError("invalid_date", "Выберите корректный диапазон с часовым поясом")
    query = select(Snapshot).where(Snapshot.profile_id == profile_id)
    if start:
        query = query.where(Snapshot.observed_at >= start)
    if end:
        query = query.where(Snapshot.observed_at <= end)
    rows = list(db.scalars(query.order_by(Snapshot.observed_at).limit(1001)))
    if len(rows) > 1000:
        raise AppError("range_limit", "Сократите диапазон: более 1000 наблюдений", 409)
    return [{"id": x.id, "date": x.observed_at, **snapshot_counts(db, x)} for x in rows]


@router.get("/profiles/{profile_id}/period-snapshots", response_model=PeriodSnapshotsDTO)
def period_snapshots(profile_id: str, user: Verified, db: DB, start: datetime, end: datetime):
    profile_owned(db, user, profile_id)
    if start.tzinfo is None or end.tzinfo is None or start >= end:
        raise AppError("invalid_date", "Выберите корректный диапазон с часовым поясом")
    query = select(Snapshot).where(
        Snapshot.profile_id == profile_id, Snapshot.observed_at >= start, Snapshot.observed_at <= end
    )
    count = db.scalar(select(func.count()).select_from(query.subquery()))
    first = db.scalar(query.order_by(Snapshot.observed_at, Snapshot.id).limit(1))
    last = db.scalar(query.order_by(Snapshot.observed_at.desc(), Snapshot.id.desc()).limit(1))
    return {
        "before": snapshot_dto(db, first) if first else None,
        "after": snapshot_dto(db, last) if last else None,
        "count": count,
    }


@router.post("/profiles/{profile_id}/comparisons", status_code=202, response_model=CommandDTO)
def compare_snapshots(
    profile_id: str, body: ComparisonInput, user: Verified, db: DB, request: Request, response: Response
):
    receipt, cached = begin_command(db, user, request, body.model_dump())
    if cached:
        response.headers["Location"] = "/api/v1/comparisons/" + cached["id"]
        return cached
    profile_owned(db, user, profile_id, True)
    before = required(latest_snapshot(db, profile_id, body.before_snapshot_id), "not_found")
    after = required(latest_snapshot(db, profile_id, body.after_snapshot_id), "not_found")
    event_query(before, after)
    existing = db.scalar(
        select(Comparison).where(
            Comparison.before_id == before.id,
            Comparison.after_id == after.id,
            Comparison.algorithm_version == "1",
        )
    )
    if existing and (existing.status == "failed" or (existing.status == "queued" and not existing.job_id)):
        heavy_limit(db, user.id)
        job = Job(user_id=user.id, profile_id=profile_id, kind="comparison")
        enqueue(db, job)
        existing.job_id, existing.status = job.id, "queued"
        job.details = {"comparison_id": existing.id}
    if existing:
        result = {"id": existing.id, "status": existing.status}
        finish_command(receipt, result)
        db.commit()
        response.status_code = 200 if existing.status == "completed" else 202
        response.headers["Location"] = "/api/v1/comparisons/" + existing.id
        return result
    heavy_limit(db, user.id)
    job = Job(user_id=user.id, profile_id=profile_id, kind="comparison")
    enqueue(db, job)
    comparison = Comparison(profile_id=profile_id, before_id=before.id, after_id=after.id, job_id=job.id)
    db.add(comparison)
    db.flush()
    job.details = {"comparison_id": comparison.id}
    result = finish_command(receipt, {"id": comparison.id, "status": "queued"})
    db.commit()
    response.headers["Location"] = "/api/v1/comparisons/" + comparison.id
    return result


def comparison_owned(db, user, comparison_id):
    comparison = db.get(Comparison, comparison_id)
    if not comparison:
        raise AppError("not_found", "Сравнение не найдено", 404)
    profile_owned(db, user, comparison.profile_id)
    return comparison


@router.get("/comparisons/{comparison_id}", response_model=ComparisonDTO)
def comparison_status(comparison_id: str, user: Verified, db: DB):
    comparison = comparison_owned(db, user, comparison_id)
    before, after = (
        required(db.get(Snapshot, comparison.before_id)),
        required(db.get(Snapshot, comparison.after_id)),
    )
    job = db.get(Job, comparison.job_id) if comparison.job_id else None
    return {
        "id": comparison.id,
        "status": comparison.status,
        "counts": comparison.counts,
        "identity_mode": after.identity_mode,
        "interval": {"start": before.observed_at, "end": after.observed_at},
        "compared_relations": comparable_relations(before, after),
        "job": job_dict(job) if job else None,
    }


@router.get("/comparisons/{comparison_id}/events", response_model=Page[EventDTO])
def comparison_events(
    comparison_id: str,
    user: Verified,
    db: DB,
    relation: Literal["followers", "following"] | None = None,
    type: Literal["added", "removed"] | None = None,
    search: str = Query("", max_length=100),
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    comparison = comparison_owned(db, user, comparison_id)
    if comparison.status != "completed":
        raise AppError("comparison_pending", "Расчёт ещё не завершён", 409)
    from app.models import ChangeEvent

    query = select(ChangeEvent).where(ChangeEvent.comparison_id == comparison.id)
    if relation:
        query = query.where(ChangeEvent.relation == relation)
    if type:
        query = query.where(ChangeEvent.type == type)
    if search:
        query = query.where(func.lower(ChangeEvent.username).contains(search.lower(), autoescape=True))
    return page(
        db,
        query,
        ChangeEvent,
        {"owner": user.id, "comparison": comparison_id, "relation": relation, "type": type, "search": search},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "identity_key": x.identity_key,
            "username": x.username,
            "relation": x.relation,
            "type": x.type,
        },
    )


@router.delete("/profiles/{profile_id}/annotations/{identity_key}", status_code=204)
def delete_annotation(profile_id: str, identity_key: str, user: Verified, db: DB):
    profile_owned(db, user, profile_id)
    db.execute(
        delete(Annotation).where(Annotation.profile_id == profile_id, Annotation.identity_key == identity_key)
    )
    db.commit()


class BulkFavorites(BaseModel):
    identity_keys: list[str] = Field(min_length=1, max_length=100)
    favorite: bool


@router.post("/profiles/{profile_id}/annotations/bulk", status_code=204)
def bulk_favorites(profile_id: str, body: BulkFavorites, user: Verified, db: DB):
    import json

    from app.core.limits import runtime_settings as get_settings
    from app.jobs.snapshots import storage_usage

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    profile_owned(db, user, profile_id, True)
    for key in set(body.identity_keys):
        if not 1 <= len(key) <= 80:
            raise AppError("invalid_identity", "Некорректный ключ записи")
        annotation = db.scalar(
            select(Annotation).where(Annotation.profile_id == profile_id, Annotation.identity_key == key)
        )
        if not annotation:
            annotation = Annotation(profile_id=profile_id, identity_key=key)
            db.add(annotation)
        annotation.favorite = body.favorite
        annotation.storage_bytes = len(
            json.dumps(
                {"identity_key": key, "favorite": body.favorite, "note": annotation.note or ""},
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode()
        )
    db.flush()
    if storage_usage(db, user.id) > get_settings().user_storage_quota_bytes:
        raise AppError("storage_quota", "Квота истории исчерпана", 409)
    db.commit()


@router.post("/exports", status_code=202, response_model=CommandDTO)
def create_export(body: ExportInput, user: Verified, db: DB, request: Request, response: Response):
    receipt, cached = begin_command(db, user, request, body.model_dump())
    if cached:
        response.headers["Location"] = "/api/v1/exports/" + cached["id"]
        return cached
    from app.core.dependencies import rate_limit
    from app.core.limits import runtime_settings as get_settings

    rate_limit("export:" + user.id, 5, 3600)
    heavy_limit(db, user.id)
    if body.scope == "account" and body.format != "json":
        raise AppError("invalid_format", "Полная история выгружается в JSON")
    if body.scope == "list":
        if not body.profile_id:
            raise AppError("profile_required", "Выберите профиль")
        profile_owned(db, user, body.profile_id)
        snapshot = latest_snapshot(db, body.profile_id, body.snapshot_id)
        if not snapshot:
            raise AppError("not_found", "Нет снимков для выгрузки", 404)
        body.snapshot_id = snapshot.id
    if body.scope == "comparison":
        comparison = comparison_owned(db, user, body.comparison_id)
        if comparison.status != "completed":
            raise AppError("comparison_pending", "Дождитесь расчёта", 409)
        body.profile_id = comparison.profile_id
    job = Job(user_id=user.id, profile_id=body.profile_id, kind="export")
    enqueue(db, job)
    export = ExportJob(
        user_id=user.id,
        profile_id=body.profile_id,
        job_id=job.id,
        scope=body.scope,
        format=body.format,
        filters=body.model_dump(),
        expires_at=now() + timedelta(hours=get_settings().export_ttl_hours),
    )
    db.add(export)
    db.flush()
    job.details = {"export_id": export.id}
    result = finish_command(receipt, {"id": export.id, "status": "queued"})
    db.commit()
    response.headers["Location"] = "/api/v1/exports/" + export.id
    return result


def export_owned(db, user, export_id):
    export = db.get(ExportJob, export_id)
    if not export or export.user_id != user.id:
        raise AppError("not_found", "Экспорт не найден", 404)
    if export.profile_id:
        profile_owned(db, user, export.profile_id)
    return export


@router.get("/exports/{export_id}", response_model=ExportDTO)
def export_status(export_id: str, user: Verified, db: DB):
    export = export_owned(db, user, export_id)
    return {
        "id": export.id,
        "status": "expired" if export.expires_at <= now() else export.status,
        "format": export.format,
        "expires_at": export.expires_at,
        "job": job_dict(required(db.get(Job, export.job_id))) if export.job_id else None,
    }


@router.get(
    "/exports/{export_id}/download",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Private UTF-8 CSV or JSON file; Content-Disposition attachment",
            "content": {
                "text/csv": {"schema": {"type": "string", "format": "binary"}},
                "application/json": {"schema": {"type": "string", "format": "binary"}},
            },
        }
    },
)
def download(export_id: str, user: Verified, db: DB):
    export = export_owned(db, user, export_id)
    if export.expires_at <= now() or export.status == "expired":
        raise AppError("export_expired", "Срок файла истёк. Сформируйте новый экспорт", 410)
    if export.status != "completed" or not export.object_key:
        raise AppError("export_pending", "Файл ещё не готов", 409)

    object_key, owner_id = export.object_key, user.id

    async def chunks():
        from time import monotonic

        from anyio import CancelScope, to_thread
        from starlette.concurrency import iterate_in_threadpool

        from app.core.db import AsyncSessionLocal

        checked = 0.0
        stream = storage.iter_object(object_key)
        try:
            async for chunk in iterate_in_threadpool(stream):
                if monotonic() - checked > 1:
                    async with AsyncSessionLocal() as guard:
                        owner = await guard.get(User, owner_id)
                        current = await guard.get(ExportJob, export_id)
                        if (
                            not owner
                            or owner.status != "active"
                            or not current
                            or current.status != "completed"
                        ):
                            return
                    checked = monotonic()
                yield chunk
        finally:
            with CancelScope(shield=True):
                await to_thread.run_sync(stream.close)

    return StreamingResponse(
        chunks(),
        media_type="text/csv" if export.format == "csv" else "application/json",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="instagram-export.{export.format}"',
        },
    )


@router.get("/notifications", response_model=Page[NotificationDTO])
def notifications(user: Verified, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    return page(
        db,
        select(Notification).where(Notification.user_id == user.id),
        Notification,
        {"owner": user.id, "kind": "notifications"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "kind": x.kind,
            "title": x.title,
            "body": x.body,
            "link": x.link,
            "read": x.read,
            "created_at": x.created_at,
        },
    )


class ReadNotifications(BaseModel):
    ids: list[str] | None = Field(default=None, max_length=100)


@router.post("/notifications/read", status_code=204)
def read_notifications(body: ReadNotifications, user: Verified, db: DB):
    query = select(Notification).where(Notification.user_id == user.id, Notification.read.is_(False))
    if body.ids is not None:
        query = query.where(Notification.id.in_(body.ids))
    for notification in db.scalars(query.limit(1000)):
        notification.read = True
    db.commit()


class TicketInput(BaseModel):
    category: Literal["connection", "import", "analytics", "privacy", "other"] = "other"
    body: str = Field(min_length=10, max_length=5000)
    request_id: str | None = Field(default=None, max_length=40, pattern="^[a-zA-Z0-9-]+$")


@router.post("/support/tickets", status_code=201, response_model=CommandDTO)
def create_ticket(body: TicketInput, user: Verified, db: DB):
    from app.core.dependencies import rate_limit

    rate_limit("ticket:" + user.id, 5, 3600)
    ticket = SupportTicket(user_id=user.id, **body.model_dump())
    db.add(ticket)
    db.commit()
    return {"id": ticket.id, "status": ticket.status}


@router.get("/support/tickets", response_model=Page[TicketDTO])
def own_tickets(user: Verified, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    return page(
        db,
        select(SupportTicket).where(SupportTicket.user_id == user.id),
        SupportTicket,
        {"owner": user.id, "kind": "support"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "category": x.category,
            "body": x.body,
            "status": x.status,
            "reply": x.reply,
            "created_at": x.created_at,
        },
    )


@router.get("/profiles/{profile_id}/syncs", response_model=Page[JobDTO])
def sync_history(
    profile_id: str, user: Verified, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)
):
    profile_owned(db, user, profile_id)
    return page(
        db,
        select(Job).where(Job.profile_id == profile_id, Job.kind == "sync"),
        Job,
        {"owner": user.id, "profile": profile_id, "kind": "sync"},
        cursor,
        limit,
        job_dict,
    )


@router.get("/me/email-deliveries", response_model=Page[DeliveryDTO])
def deliveries(user: Verified, db: DB, cursor: str | None = None, limit: int = Query(50, ge=1, le=100)):
    from app.models import Outbox

    return page(
        db,
        select(Outbox).where(Outbox.kind == "email", Outbox.reference == user.id),
        Outbox,
        {"owner": user.id, "kind": "email-deliveries"},
        cursor,
        limit,
        lambda x: {
            "id": x.id,
            "status": x.delivery_state,
            "attempts": x.attempts,
            "created_at": x.created_at,
            "next_attempt_at": x.next_attempt_at if not x.delivered and x.attempts < 3 else None,
            "error_code": x.last_error,
        },
    )
