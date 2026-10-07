"""Minimal Sentry envelope transport. Only allowlisted technical fields leave the service."""

import json
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

from app.core.config import get_settings
from app.core.security import now


def envelope(route: str, error_type: str, request_id: str) -> dict:
    return {
        "event_id": uuid4().hex,
        "timestamp": now().isoformat(),
        "platform": "python",
        "level": "error",
        "release": get_settings().release_version,
        "exception": {
            "values": [
                {
                    "type": error_type if re.fullmatch(r"[A-Za-z0-9_]{1,100}", error_type) else "ServerError",
                    "value": "Redacted server error",
                }
            ]
        },
        "tags": {"route": route[:200], "request_id": request_id[:40]},
    }


def send(payload: dict) -> None:
    parsed = urlparse(get_settings().error_tracking_dsn)
    project = parsed.path.rstrip("/").split("/")[-1]
    if parsed.scheme != "https" or not parsed.hostname or not parsed.username or not project.isdigit():
        raise ValueError("Invalid HTTPS Sentry DSN")
    base = parsed.path.rstrip("/").rsplit("/", 1)[0]
    host = parsed.hostname + (":" + str(parsed.port) if parsed.port else "")
    endpoint = f"https://{host}{base}/api/{project}/envelope/"
    item = json.dumps(payload, separators=(",", ":")).encode()
    header = json.dumps(
        {"event_id": payload["event_id"], "sent_at": now().isoformat()}, separators=(",", ":")
    ).encode()
    body = header + b"\n" + json.dumps({"type": "event", "length": len(item)}).encode() + b"\n" + item + b"\n"
    request = Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": f"Sentry sentry_version=7,sentry_key={parsed.username}",
        },
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        if response.status >= 300:
            raise RuntimeError("Error reporting unavailable")


def queue(route: str, error_type: str, request_id: str) -> None:
    if not get_settings().error_tracking_dsn:
        return
    from app.core.db import SessionLocal
    from app.models import Outbox

    try:
        with SessionLocal() as db:
            db.add(
                Outbox(
                    kind="error",
                    reference=request_id,
                    event_key="error:" + request_id,
                    payload=envelope(route, error_type, request_id),
                )
            )
            db.commit()
    except Exception:
        # HTTP response and job recovery never depend on reporting availability.
        pass
