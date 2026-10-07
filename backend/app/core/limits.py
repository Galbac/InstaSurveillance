"""Audited operator restrictions; the environment remains the maximum allowed policy."""

from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.models import RuntimeLimit

NAMES = ("instagram_sync_interval_hours", "instagram_request_budget", "user_storage_quota_bytes")


def runtime_settings() -> Settings:
    from app.core.db import SessionLocal

    baseline = get_settings()
    from app.core.router import request_session

    current = request_session.get()
    if current is not None:
        values = {row.name: row.value for row in current.scalars(select(RuntimeLimit)) if row.name in NAMES}
    else:
        with SessionLocal() as db:
            values = {row.name: row.value for row in db.scalars(select(RuntimeLimit)) if row.name in NAMES}
    # Env changes can tighten policy further; a stale DB override never relaxes it.
    for name in values:
        values[name] = (max if name == "instagram_sync_interval_hours" else min)(
            values[name], getattr(baseline, name)
        )
    return baseline.model_copy(update=values)
