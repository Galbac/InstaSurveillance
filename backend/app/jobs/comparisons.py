from uuid import uuid4

from sqlalchemy import delete, insert, select

from app.core.db import SessionLocal
from app.core.errors import AppError, required
from app.core.security import now
from app.models import ChangeEvent, Comparison, Profile, Snapshot, User
from app.modules.query_service import event_query


def calculate(comparison_id: str, check) -> None:
    with SessionLocal() as db:
        comparison = db.get(Comparison, comparison_id)
        if not comparison:
            raise AppError("cancelled", "Снимки удалены", 409)
        events = event_query(
            required(db.get(Snapshot, comparison.before_id)), required(db.get(Snapshot, comparison.after_id))
        )
        rows = db.execute(select(events).execution_options(yield_per=1000))
        batches = []
        counts = {}
        timestamp = now()
        # Stream read results, stage compact rows; max events bounded by two snapshot quotas.
        with SessionLocal() as writer:
            owner = writer.scalar(
                select(User)
                .join(Profile, Profile.user_id == User.id)
                .where(Profile.id == comparison.profile_id)
                .with_for_update()
            )
            writer.scalar(select(Profile).where(Profile.id == comparison.profile_id).with_for_update())
            current = writer.scalar(
                select(Comparison).where(Comparison.id == comparison_id).with_for_update()
            )
            if not current or not owner or owner.status != "active":
                raise AppError("cancelled", "Расчёт отменён", 409)
            writer.execute(delete(ChangeEvent).where(ChangeEvent.comparison_id == comparison_id))
            for index, row in enumerate(rows):
                if index % 1000 == 0:
                    check()
                value = dict(row._mapping)
                counter = value["relation"] + "_" + value["type"]
                counts[counter] = counts.get(counter, 0) + 1
                batches.append(
                    {"id": str(uuid4()), "comparison_id": comparison_id, "created_at": timestamp, **value}
                )
                if len(batches) >= 1000:
                    writer.execute(insert(ChangeEvent), batches)
                    batches = []
            if batches:
                writer.execute(insert(ChangeEvent), batches)
            check()
            current.status = "completed"
            current.counts = counts
            writer.commit()
