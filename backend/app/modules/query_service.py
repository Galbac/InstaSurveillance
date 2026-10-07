"""Bounded SQL read models shared by HTTP lists and streaming exports."""

from datetime import datetime

from sqlalchemy import and_, exists, func, or_, select, union_all
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError
from app.core.pagination import cursor_decode, cursor_encode
from app.models import Annotation, Member, Snapshot

CATEGORIES = {"followers", "following", "mutual", "not_following_back", "fans"}


def snapshot_counts(db: Session, snapshot: Snapshot) -> dict:
    if snapshot.counts:
        return snapshot.counts
    f = db.scalar(
        select(func.count())
        .select_from(Member)
        .where(Member.snapshot_id == snapshot.id, Member.relation == "followers")
    )
    g = db.scalar(
        select(func.count())
        .select_from(Member)
        .where(Member.snapshot_id == snapshot.id, Member.relation == "following")
    )
    other = aliased(Member)
    mutual = db.scalar(
        select(func.count())
        .select_from(Member)
        .where(
            Member.snapshot_id == snapshot.id,
            Member.relation == "followers",
            exists(
                select(other.id).where(
                    other.snapshot_id == snapshot.id,
                    other.relation == "following",
                    other.identity_key == Member.identity_key,
                )
            ),
        )
    )
    f, g, mutual = int(f or 0), int(g or 0), int(mutual or 0)
    return {
        "followers": f,
        "following": g,
        "mutual": mutual,
        "fans": f - mutual,
        "not_following_back": g - mutual,
        "mutual_rate": round(mutual / f * 100, 1) if f else None,
    }


def latest_snapshot(db: Session, profile_id: str, snapshot_id: str | None = None) -> Snapshot | None:
    query = select(Snapshot).where(Snapshot.profile_id == profile_id)
    if snapshot_id:
        snapshot = db.scalar(query.where(Snapshot.id == snapshot_id))
        if not snapshot:
            raise AppError("not_found", "Снимок не найден", 404)
        return snapshot
    return db.scalar(query.order_by(Snapshot.observed_at.desc(), Snapshot.id.desc()).limit(1))


def people_query(
    snapshot_id: str,
    profile_id: str,
    category: str,
    search: str = "",
    favorite: bool = False,
    has_note: bool = False,
):
    if category not in CATEGORIES:
        raise AppError("invalid_category", "Неизвестная категория")
    relation = "following" if category in ("following", "not_following_back") else "followers"
    opposite = "followers" if relation == "following" else "following"
    other = aliased(Member)
    matching = exists(
        select(other.id).where(
            other.snapshot_id == snapshot_id,
            other.relation == opposite,
            other.identity_key == Member.identity_key,
        )
    )
    query = (
        select(Member, Annotation)
        .outerjoin(
            Annotation,
            and_(Annotation.profile_id == profile_id, Annotation.identity_key == Member.identity_key),
        )
        .where(Member.snapshot_id == snapshot_id, Member.relation == relation)
    )
    if category == "mutual":
        query = query.where(matching)
    elif category in ("fans", "not_following_back"):
        query = query.where(~matching)
    if search:
        query = query.where(func.lower(Member.username).contains(search.lower(), autoescape=True))
    if favorite:
        query = query.where(Annotation.favorite.is_(True))
    if has_note:
        query = query.where(func.length(func.trim(Annotation.note)) > 0)
    return query


def people_page(
    db: Session,
    user_id: str,
    profile_id: str,
    snapshot: Snapshot,
    category: str,
    search: str,
    favorite: bool,
    has_note: bool,
    sort: str,
    cursor: str | None,
    limit: int,
) -> dict:
    scope = {
        "user": user_id,
        "profile": profile_id,
        "snapshot": snapshot.id,
        "category": category,
        "search": search,
        "favorite": favorite,
        "has_note": has_note,
        "sort": sort,
    }
    query = people_query(snapshot.id, profile_id, category, search, favorite, has_note)
    counters = snapshot_counts(db, snapshot)
    category_total = counters[category]
    total = (
        db.scalar(select(func.count()).select_from(query.subquery()))
        if search or favorite or has_note
        else category_total
    )
    if sort == "first_observed":
        historical = aliased(Member)
        first = (
            select(func.min(Snapshot.observed_at))
            .select_from(historical)
            .join(Snapshot, Snapshot.id == historical.snapshot_id)
            .where(
                Snapshot.profile_id == profile_id,
                Snapshot.identity_mode == snapshot.identity_mode,
                historical.identity_key == Member.identity_key,
                historical.relation == Member.relation,
            )
            .correlate(Member)
            .scalar_subquery()
        )
        sort_value = first
        query = query.add_columns(first.label("first_observed_at"))  # pyright: ignore[reportAssignmentType]
    elif sort in ("username", "username_desc"):
        sort_value = func.lower(Member.username)
    else:
        raise AppError("invalid_sort", "Неизвестная сортировка")
    values = cursor_decode(cursor, scope)
    descending = sort == "username_desc"
    if values:
        try:
            value, identity = values
            value = datetime.fromisoformat(value) if sort == "first_observed" else value
        except (ValueError, TypeError) as error:
            raise AppError("invalid_cursor", "Некорректная страница") from error
        condition = sort_value < value if descending else sort_value > value
        query = query.where(or_(condition, and_(sort_value == value, Member.identity_key > identity)))
    query = query.order_by(
        sort_value.desc() if descending else sort_value.asc(), Member.identity_key.asc()
    ).limit(limit + 1)
    rows: list = list(db.execute(query))
    items = [
        {
            "identity_key": row[0].identity_key,
            "username": row[0].username,
            "favorite": bool(row[1] and row[1].favorite),
            "note": row[1].note if row[1] else "",
            "first_observed_at": row[2] if sort == "first_observed" else None,
        }
        for row in rows[:limit]
    ]
    next_cursor = None
    if len(rows) > limit:
        row = rows[limit - 1]
        value = row[2] if sort == "first_observed" else row[0].username.lower()
        next_cursor = cursor_encode([value, row[0].identity_key], scope)
    return {
        "items": items,
        "total": total,
        "category_total": category_total,
        "next_cursor": next_cursor,
        "snapshot_id": snapshot.id,
        "observed_at": snapshot.observed_at,
        "source": snapshot.source,
        "completeness": snapshot.completeness,
        "identity_mode": snapshot.identity_mode,
    }


def event_query(before: Snapshot, after: Snapshot):
    if (
        before.profile_id != after.profile_id
        or before.identity_mode != after.identity_mode
        or before.observed_at >= after.observed_at
    ):
        raise AppError("snapshot_not_comparable", "Выберите совместимые снимки в правильном порядке", 409)
    if before.completeness not in ("user_confirmed", "collection_validated") or after.completeness not in (
        "user_confirmed",
        "collection_validated",
    ):
        raise AppError("snapshot_not_comparable", "Полнота списков не подтверждена", 409)
    from sqlalchemy import literal

    other = aliased(Member)
    parts = []
    for old, new, kind in [(before, after, "added"), (after, before, "removed")]:
        parts.append(
            select(Member.identity_key, Member.username, Member.relation, literal(kind).label("type")).where(
                Member.snapshot_id == new.id,
                ~exists(
                    select(other.id).where(
                        other.snapshot_id == old.id,
                        other.identity_key == Member.identity_key,
                        other.relation == Member.relation,
                    )
                ),
            )
        )
    return union_all(*parts).subquery()
