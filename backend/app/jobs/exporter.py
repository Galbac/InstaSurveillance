"""Sequential export rendering into temporary files; lists never become one giant JSON object."""

import csv
import io
import json
import tempfile
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from app.core.db import SessionLocal
from app.core.errors import AppError, required
from app.core.limits import runtime_settings as get_settings
from app.core.security import now
from app.integrations import storage
from app.models import (
    Annotation,
    ChangeEvent,
    Comparison,
    Consent,
    ExportJob,
    FileObject,
    Member,
    Notification,
    Profile,
    Snapshot,
    SupportTicket,
    User,
)
from app.modules.query_service import people_query, snapshot_counts


def safe_csv(value: str) -> str:
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value


def encode(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        default=lambda obj: obj.isoformat() if isinstance(obj, datetime) else str(obj),
    )


def array(file, rows, serialize, check):
    file.write(b"[")
    for index, row in enumerate(rows):
        if index % 500 == 0:
            check()
        if index:
            file.write(b",")
        file.write(encode(serialize(row)).encode())
    file.write(b"]")


def snapshot_data(file, db, snapshot, check):
    metadata = {
        "id": snapshot.id,
        "source": snapshot.source,
        "observed_at": snapshot.observed_at,
        "created_at": snapshot.created_at,
        "completeness": snapshot.completeness,
        "identity_mode": snapshot.identity_mode,
        "checksum": snapshot.checksum,
        "counts": snapshot_counts(db, snapshot),
        "provenance": snapshot.provenance,
    }
    file.write((encode(metadata)[:-1] + ',"members":').encode())
    array(
        file,
        db.scalars(
            select(Member)
            .where(Member.snapshot_id == snapshot.id)
            .order_by(Member.relation, Member.identity_key)
            .execution_options(yield_per=1000)
        ),
        lambda x: {
            "relation": x.relation,
            "identity_key": x.identity_key,
            "username": x.username,
            "source_timestamp": x.source_timestamp,
        },
        check,
    )
    file.write(b"}")


def render(export_id: str, check) -> None:
    with SessionLocal() as db:
        export = db.get(ExportJob, export_id)
        if not export or export.expires_at <= now():
            raise AppError("export_expired", "Экспорт истёк", 410)
        filters = export.filters
        with tempfile.TemporaryFile() as output:
            if export.scope == "account":
                owner = required(db.get(User, export.user_id))
                output.write(
                    (
                        encode(
                            {
                                "schema_version": 1,
                                "generated_at": now(),
                                "account": {
                                    "email": owner.email,
                                    "timezone": owner.timezone,
                                    "notification_settings": owner.notification_settings,
                                    "theme": owner.theme,
                                },
                            }
                        )[:-1]
                        + ',"profiles":['
                    ).encode()
                )
                for index, profile in enumerate(
                    db.scalars(
                        select(Profile)
                        .where(Profile.user_id == owner.id, Profile.status != "deleting")
                        .order_by(Profile.id)
                    )
                ):
                    check()
                    if index:
                        output.write(b",")
                    output.write(
                        (
                            encode({"id": profile.id, "username": profile.username, "label": profile.label})[
                                :-1
                            ]
                            + ',"snapshots":['
                        ).encode()
                    )
                    for offset, snapshot in enumerate(
                        db.scalars(
                            select(Snapshot)
                            .where(Snapshot.profile_id == profile.id)
                            .order_by(Snapshot.observed_at)
                            .execution_options(yield_per=50)
                        )
                    ):
                        if offset:
                            output.write(b",")
                        snapshot_data(output, db, snapshot, check)
                    output.write(b'],"annotations":')
                    array(
                        output,
                        db.scalars(
                            select(Annotation)
                            .where(Annotation.profile_id == profile.id)
                            .execution_options(yield_per=1000)
                        ),
                        lambda x: {"identity_key": x.identity_key, "favorite": x.favorite, "note": x.note},
                        check,
                    )
                    output.write(b',"comparisons":[')
                    for offset, comparison in enumerate(
                        db.scalars(
                            select(Comparison)
                            .where(Comparison.profile_id == profile.id, Comparison.status == "completed")
                            .execution_options(yield_per=50)
                        )
                    ):
                        if offset:
                            output.write(b",")
                        output.write(
                            (
                                encode(
                                    {
                                        "id": comparison.id,
                                        "before_snapshot_id": comparison.before_id,
                                        "after_snapshot_id": comparison.after_id,
                                        "algorithm_version": comparison.algorithm_version,
                                        "counts": comparison.counts,
                                    }
                                )[:-1]
                                + ',"events":'
                            ).encode()
                        )
                        array(
                            output,
                            db.scalars(
                                select(ChangeEvent)
                                .where(ChangeEvent.comparison_id == comparison.id)
                                .execution_options(yield_per=1000)
                            ),
                            lambda x: {
                                "identity_key": x.identity_key,
                                "username": x.username,
                                "relation": x.relation,
                                "type": x.type,
                            },
                            check,
                        )
                        output.write(b"}")
                    output.write(b"]}")
                output.write(b'],"consents":')
                array(
                    output,
                    db.scalars(select(Consent).where(Consent.user_id == owner.id)),
                    lambda x: {
                        "purpose": x.purpose,
                        "version": x.version,
                        "accepted_at": x.created_at,
                        "revoked_at": x.revoked_at,
                    },
                    check,
                )
                output.write(b',"notifications":')
                array(
                    output,
                    db.scalars(
                        select(Notification)
                        .where(Notification.user_id == owner.id)
                        .execution_options(yield_per=1000)
                    ),
                    lambda x: {
                        "kind": x.kind,
                        "title": x.title,
                        "body": x.body,
                        "read": x.read,
                        "created_at": x.created_at,
                    },
                    check,
                )
                output.write(b',"support_tickets":')
                array(
                    output,
                    db.scalars(select(SupportTicket).where(SupportTicket.user_id == owner.id)),
                    lambda x: {
                        "category": x.category,
                        "body": x.body,
                        "status": x.status,
                        "reply": x.reply,
                        "created_at": x.created_at,
                    },
                    check,
                )
                output.write(b"}")
            else:
                if export.scope == "list":
                    query = people_query(
                        filters["snapshot_id"],
                        required(export.profile_id),
                        filters["category"],
                        filters.get("search", ""),
                        filters.get("favorite", False),
                        filters.get("has_note", False),
                    )
                    if filters.get("sort") == "first_observed":
                        historical = aliased(Member)
                        order = (
                            select(func.min(Snapshot.observed_at))
                            .select_from(historical)
                            .join(Snapshot, Snapshot.id == historical.snapshot_id)
                            .where(
                                Snapshot.profile_id == export.profile_id,
                                historical.identity_key == Member.identity_key,
                                historical.relation == Member.relation,
                                Snapshot.identity_mode
                                == required(db.get(Snapshot, filters["snapshot_id"])).identity_mode,
                            )
                            .correlate(Member)
                            .scalar_subquery()
                        )
                    else:
                        order = func.lower(Member.username)
                    query = query.order_by(
                        order.desc() if filters.get("sort") == "username_desc" else order, Member.identity_key
                    )
                    rows = db.execute(query.execution_options(yield_per=1000))

                    def serialize(row):
                        return {
                            "username": row[0].username,
                            "identity_key": row[0].identity_key,
                            "category": filters["category"],
                            "note": row[1].note if row[1] else "",
                            "favorite": bool(row[1] and row[1].favorite),
                        }

                    fields = ["username", "identity_key", "category", "note", "favorite"]
                else:
                    query = (
                        select(ChangeEvent)
                        .where(ChangeEvent.comparison_id == filters["comparison_id"])
                        .order_by(ChangeEvent.username, ChangeEvent.id)
                    )
                    for field in ("relation", "type"):
                        if filters.get(field):
                            query = query.where(getattr(ChangeEvent, field) == filters[field])
                    if filters.get("search"):
                        query = query.where(
                            ChangeEvent.username.contains(filters["search"].lower(), autoescape=True)
                        )
                    rows = db.scalars(query.execution_options(yield_per=1000))

                    def serialize(row):
                        return {
                            "username": row.username,
                            "identity_key": row.identity_key,
                            "relation": row.relation,
                            "type": row.type,
                        }

                    fields = ["username", "identity_key", "relation", "type"]
                if export.format == "json":
                    output.write(
                        (
                            encode(
                                {
                                    "schema_version": 1,
                                    "generated_at": now(),
                                    "scope": export.scope,
                                    "filters": filters,
                                }
                            )[:-1]
                            + ',"items":'
                        ).encode()
                    )
                    array(output, rows, serialize, check)
                    output.write(b"}")
                else:
                    output.write(b"\xef\xbb\xbf")
                    line = io.StringIO()
                    writer = csv.DictWriter(line, fieldnames=fields + ["generated_at"])
                    writer.writeheader()
                    output.write(line.getvalue().encode())
                    line.seek(0)
                    line.truncate(0)
                    generated = now().isoformat()
                    for index, row in enumerate(rows):
                        if index % 500 == 0:
                            check()
                        value = {key: safe_csv(str(item)) for key, item in serialize(row).items()}
                        value["generated_at"] = generated
                        writer.writerow(value)
                        output.write(line.getvalue().encode())
                        line.seek(0)
                        line.truncate(0)
            size = output.tell()
            check()
            key = "exports/" + export.id + "." + export.format
            with SessionLocal() as reservation:
                existing = reservation.scalar(select(FileObject).where(FileObject.key == key))
                if not existing:
                    reservation.add(
                        FileObject(
                            owner=export.user_id,
                            job_id=export.job_id,
                            key=key,
                            size=size,
                            writing_until=now()
                            + timedelta(seconds=get_settings().storage_write_timeout_seconds + 120),
                            expires_at=export.expires_at,
                        )
                    )
                reservation.commit()
            db.rollback()  # No open read transaction during external S3 I/O.
            try:
                storage.put_stream(key, output, size, check)
            finally:
                storage.write_finished(key)
            try:
                check()
            except Exception:
                storage.remove(key)
                raise
            export = db.scalar(select(ExportJob).where(ExportJob.id == export_id).with_for_update())
            if not export or export.status == "expired":
                storage.remove(key)
                raise AppError("cancelled", "Экспорт отменён", 409)
            export.object_key, export.status = key, "completed"
            db.commit()
