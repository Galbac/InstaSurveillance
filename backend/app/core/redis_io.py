"""Native async Redis in HTTP bridges; bounded synchronous access in workers."""

from typing import Any

from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from sqlalchemy.util.concurrency import await_only, in_greenlet


async def _command(url: str, name: str, *args: Any) -> Any:
    async with AsyncRedis.from_url(url, socket_connect_timeout=2, socket_timeout=2) as client:
        return await getattr(client, name)(*args)


def redis_command(url: str, name: str, *args: Any) -> Any:
    if in_greenlet():
        return await_only(_command(url, name, *args))
    with Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2) as client:
        return getattr(client, name)(*args)
