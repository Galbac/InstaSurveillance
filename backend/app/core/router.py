"""Async HTTP execution with SQLAlchemy's supported synchronous ORM bridge.

Domain helpers retain one implementation for Celery and API transactions.
Database I/O is native async; blocking external I/O must use blocking_call.
Decorators return the domain function so direct helper calls stay synchronous.
"""

from contextvars import ContextVar
from functools import wraps
from inspect import iscoroutinefunction

from fastapi import APIRouter as BaseRouter
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

request_session: ContextVar[Session | None] = ContextVar("request_session", default=None)


class APIRouter(BaseRouter):
    def add_api_route(self, path, endpoint, **kwargs):
        if not iscoroutinefunction(endpoint):
            original = endpoint

            @wraps(original)
            async def wrapped_endpoint(**values):
                db = values.get("db")
                if not isinstance(db, AsyncSession):
                    # Routes without a database can perform configuration/file I/O.
                    from functools import partial

                    from anyio import to_thread

                    return await to_thread.run_sync(partial(original, **values))

                def execute(session):
                    marker = request_session.set(session)
                    try:
                        return original(**{**values, "db": session})
                    finally:
                        request_session.reset(marker)

                return await db.run_sync(execute)

            endpoint = wrapped_endpoint

        return super().add_api_route(path, endpoint, **kwargs)
