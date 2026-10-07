"""Explicit boundary for blocking SDK/file/CPU operations inside async ORM bridges.

A Session is never passed to another thread. SQLAlchemy database calls remain
on the request's event loop and use psycopg.AsyncConnection.
"""

from collections.abc import Callable

from anyio import to_thread
from sqlalchemy.util.concurrency import await_only, in_greenlet


def blocking_call[**P, T](function: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    if in_greenlet():

        def isolated():
            from app.core.router import request_session

            marker = request_session.set(None)
            try:
                return function(*args, **kwargs)
            finally:
                request_session.reset(marker)

        return await_only(to_thread.run_sync(isolated))
    return function(*args, **kwargs)
