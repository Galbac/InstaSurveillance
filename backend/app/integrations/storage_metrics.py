"""Periodic object usage probe; credentials and object keys never enter metrics."""

import json
from time import time

from redis import Redis

from app.core.config import get_settings
from app.integrations import storage


def refresh() -> None:
    settings = get_settings()
    store = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
    if not store.set("metrics:storage:refresh", "1", ex=300, nx=True):
        return
    try:
        if settings.storage_backend == "s3":
            size = 0
            count = 0
            client = storage.client(probe=True)
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=settings.s3_bucket):
                for obj in page.get("Contents", []):
                    size += obj["Size"]
                    count += 1
                if count > 100000:
                    raise ValueError("Usage probe limit")
        else:
            from pathlib import Path

            size = sum(
                path.stat().st_size for path in Path(settings.storage_directory).rglob("*") if path.is_file()
            )
        store.set(
            "metrics:storage:usage",
            json.dumps({"bytes": size, "timestamp": time()}),
            ex=900,
        )
    except Exception:
        store.delete("metrics:storage:usage")
