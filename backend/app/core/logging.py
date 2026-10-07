"""Allowlisted JSON application logs, shared private volume, time-based retention."""

import json
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import structlog

from app.core.config import get_settings

FIELDS = {
    "event",
    "timestamp",
    "request_id",
    "route",
    "status",
    "duration_ms",
    "release",
    "job_id",
    "error_type",
}


def prune_logs() -> None:
    directory = os.environ.get("LOG_DIRECTORY", "")
    if not directory:
        return
    cutoff = datetime.now(UTC).date() - timedelta(days=get_settings().log_retention_days - 1)
    for path in Path(directory).glob("application-*.jsonl"):
        try:
            date = datetime.strptime(path.stem.removeprefix("application-"), "%Y-%m-%d").date()
            if date < cutoff:
                path.unlink(missing_ok=True)
        except ValueError:
            continue


def whitelist_and_store(logger, method, event):
    event = {key: value for key, value in event.items() if key in FIELDS}
    directory = os.environ.get("LOG_DIRECTORY", "")
    if directory:
        try:
            root = Path(directory)
            root.mkdir(parents=True, exist_ok=True)
            path = root / ("application-" + datetime.now(UTC).date().isoformat() + ".jsonl")
            descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            try:
                os.write(
                    descriptor, (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
                )
            finally:
                os.close(descriptor)
        except OSError:
            pass  # Logging failure cannot make a privacy mutation fail.
    return event


def configure() -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, get_settings().log_level.upper(), logging.INFO)
        ),
        processors=[
            structlog.processors.TimeStamper(fmt="iso"),
            whitelist_and_store,
            structlog.processors.JSONRenderer(),
        ],
    )
