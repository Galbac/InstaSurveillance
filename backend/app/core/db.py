from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

settings = get_settings()
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_timeout=settings.db_connect_timeout_seconds,
    connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


# HTTP and Celery pools have separate lifecycles. The psycopg dialect chooses
# AsyncConnection when constructed by create_async_engine.
async_engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_timeout=settings.db_connect_timeout_seconds,
    connect_args={"connect_timeout": settings.db_connect_timeout_seconds},
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession]:
    async with AsyncSessionLocal() as session:
        yield session
