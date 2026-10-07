"""Signed keyset cursors bound to the owner, resource and effective filters."""

import base64
import hashlib
import hmac
import json
from typing import Any

from app.core.config import get_settings
from app.core.errors import AppError


def cursor_encode(values: list[Any], scope: dict) -> str:
    payload = json.dumps(
        {"v": 1, "s": scope, "k": values}, default=str, sort_keys=True, separators=(",", ":")
    ).encode()
    signature = hmac.new(
        get_settings().csrf_secret.get_secret_value().encode(), payload, hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(signature + payload).decode().rstrip("=")


def cursor_decode(value: str | None, scope: dict) -> list | None:
    if not value:
        return None
    try:
        if len(value) > 4096:
            raise ValueError
        raw = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
        signature, payload = raw[:32], raw[32:]
        expected = hmac.new(
            get_settings().csrf_secret.get_secret_value().encode(), payload, hashlib.sha256
        ).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        data = json.loads(payload)
        if data["v"] != 1 or data["s"] != scope or not isinstance(data["k"], list):
            raise ValueError
        return data["k"]
    except (ValueError, KeyError, TypeError, UnicodeError) as error:
        raise AppError("invalid_cursor", "Параметры списка изменились. Начните с первой страницы") from error
