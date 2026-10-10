"""Bounded CDN image fetching; never forward browser or Instagram credentials."""

import asyncio
import logging
import time
from collections import OrderedDict
from urllib.parse import urlparse

import httpx

from app.core.errors import AppError

_cache: OrderedDict[str, tuple[float, bytes, str]] = OrderedDict()
_slots = asyncio.Semaphore(4)
# HTTPX info messages include signed CDN URLs.
logging.getLogger("httpx").setLevel(logging.WARNING)


async def fetch_avatar(url: str) -> tuple[bytes, str]:
    try:
        parsed = urlparse(url)
        host = parsed.hostname or ""
        port = parsed.port
    except ValueError:
        raise AppError("avatar_unavailable", "Фото недоступно", 404) from None
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or not any(
            host.endswith("." + domain) for domain in ("instagram.com", "cdninstagram.com", "fbcdn.net")
        )
    ):
        raise AppError("avatar_unavailable", "Фото недоступно", 404)
    cached = _cache.get(url)
    if cached and cached[0] > time.monotonic():
        _cache.move_to_end(url)
        return cached[1], cached[2]
    try:
        async with _slots, httpx.AsyncClient(timeout=15, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", url) as response:
                media = response.headers.get("content-type", "").split(";", 1)[0]
                if response.status_code != 200 or media not in {
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "image/gif",
                }:
                    raise AppError("avatar_unavailable", "Фото недоступно", 404)
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 524288:
                        raise AppError("avatar_unavailable", "Фото недоступно", 404)
    except httpx.HTTPError:
        raise AppError("avatar_unavailable", "Фото недоступно", 404) from None
    content = bytes(body)
    if not content:
        raise AppError("avatar_unavailable", "Фото недоступно", 404)
    _cache[url] = (time.monotonic() + 300, content, media)
    _cache.move_to_end(url)
    while len(_cache) > 128:
        _cache.popitem(last=False)
    return content, media
