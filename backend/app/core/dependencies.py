from datetime import UTC, timedelta
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.redis_io import redis_command
from app.core.security import digest, now
from app.models import AuthSession, User

# Router supplies the sync ORM facade of the same async request session.
DB = Annotated[Session, Depends(get_db)]
AsyncDB = Annotated[AsyncSession, Depends(get_db)]


def authenticate(request: Request, db: Session) -> User:
    raw = request.cookies.get(get_settings().session_cookie_name, "")
    session = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == digest(raw), AuthSession.expires_at > now())
    )
    user = db.get(User, session.user_id) if session else None
    if (
        not session
        or not user
        or user.status != "active"
        or session.created_at.replace(tzinfo=UTC)
        + timedelta(seconds=get_settings().session_absolute_ttl_seconds)
        <= now()
    ):
        raise AppError("unauthenticated", "Войдите в аккаунт", 401)
    if not session.last_seen or session.last_seen.replace(tzinfo=UTC) < now() - timedelta(minutes=5):
        session.last_seen = now()
        db.commit()
    request.state.session_id = session.id
    request.state.actor_id = user.id
    return user


async def current_user(request: Request, db: AsyncDB) -> User:
    return await db.run_sync(lambda session: authenticate(request, session))


UserDep = Annotated[User, Depends(current_user)]


def verified_user(user: UserDep) -> User:
    if not user.verified:
        raise AppError("email_unverified", "Подтвердите email перед подключением Instagram", 403)
    return user


Verified = Annotated[User, Depends(verified_user)]


def rate_limit(key: str, limit: int, window: int) -> None:
    url = get_settings().redis_url
    count = redis_command(
        url,
        "eval",
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        1,
        "limit:" + key,
        window,
    )
    if count > limit:
        raise AppError(
            "rate_limited",
            "Слишком много попыток. Попробуйте позже",
            429,
            {"retry_after": max(1, redis_command(url, "ttl", "limit:" + key))},
        )
