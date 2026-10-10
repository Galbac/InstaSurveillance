import hmac
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from starlette.background import BackgroundTask
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import get_settings
from app.core.db import async_engine, engine
from app.core.errors import AppError
from app.core.logging import configure
from app.core.security import csrf
from app.modules import admin, auth, connections, data, extended, imports, privacy
from app.modules.contracts import StatusDTO

settings = get_settings()

configure()
logging.getLogger("aiograpi").disabled = True


@asynccontextmanager
async def lifespan(application: FastAPI):
    try:
        yield
    finally:
        await async_engine.dispose()
        from anyio import to_thread

        await to_thread.run_sync(engine.dispose)


app = FastAPI(
    lifespan=lifespan,
    title="InstaSurveillance API",
    version="0.1.0",
    docs_url="/api/docs" if settings.app_env != "production" else None,
    openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts.split(","))
approved_origins = {
    settings.app_base_url,
    *[origin.strip() for origin in settings.cors_allowed_origins.split(",") if origin.strip()],
}
if settings.cors_allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(approved_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key", "Authorization"],
    )
app.include_router(auth.router)
app.include_router(data.router)
app.include_router(extended.router)
app.include_router(imports.router)
app.include_router(connections.router)
app.include_router(privacy.router)
app.include_router(admin.router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    request.state.request_id = uuid4().hex[:12]
    started = time.perf_counter()
    if request.method in ("POST", "PATCH", "PUT", "DELETE"):
        seed = request.cookies.get(settings.session_cookie_name) or request.cookies.get("insta_csrf_seed", "")
        provided = request.headers.get("X-CSRF-Token", "")
        if (
            not seed
            or not hmac.compare_digest(provided, csrf(seed))
            or request.headers.get("origin", settings.app_base_url) not in approved_origins
        ):
            return JSONResponse(
                {
                    "error": {
                        "code": "csrf_failed",
                        "message": "Обновите страницу и повторите действие",
                        "request_id": request.state.request_id,
                    }
                },
                status_code=403,
            )
    try:
        response = await call_next(request)
    except Exception as error:
        # Handle inside the middleware: Starlette's outer 500 handler otherwise re-raises
        # to Uvicorn, which would log SQL parameters and exception text.
        response = await unexpected(request, error)
    route = getattr(request.scope.get("route"), "path", "unmatched")
    duration = time.perf_counter() - started
    from app.core.metrics import record

    record(route, response.status_code, duration)
    await structlog.get_logger().ainfo(
        "http_request",
        request_id=request.state.request_id,
        route=route,
        status=response.status_code,
        duration_ms=round(duration * 1000, 2),
        release=settings.release_version,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(AppError)
async def expected_error(request: Request, error: AppError):
    headers = {"Retry-After": str(error.details.get("retry_after", 60))} if error.status == 429 else {}
    return JSONResponse(
        {
            "error": {
                "code": error.code,
                "message": error.message,
                "details": error.details,
                "request_id": request.state.request_id,
            }
        },
        status_code=error.status,
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def invalid_input(request: Request, error: RequestValidationError):
    # Never echo pydantic input values (credentials/verification codes).
    errors = error.errors()
    first_msg = "Проверьте заполненные поля"
    details: dict[str, str] = {}
    for err in errors:
        loc = err.get("loc", ())
        field = str(loc[-1]) if loc else "general"
        msg = err.get("msg", "")
        if msg.startswith("Value error, "):
            msg = msg[len("Value error, "):]
        elif "pattern" in err.get("type", "") or "string_pattern_mismatch" in err.get("type", ""):
            if field == "username":
                msg = "Instagram username может содержать только латинские буквы, цифры, точки и подчёркивания (до 30 символов)"
        details[field] = msg
        if first_msg == "Проверьте заполненные поля" and msg:
            first_msg = msg

    return JSONResponse(
        {
            "error": {
                "code": "invalid_input",
                "message": first_msg,
                "details": details,
                "request_id": getattr(request.state, "request_id", None),
            }
        },
        status_code=422,
    )


@app.exception_handler(Exception)
async def unexpected(request: Request, error: Exception):
    from app.integrations.telemetry import queue

    await structlog.get_logger().aerror(
        "request_failed", request_id=request.state.request_id, error_type=type(error).__name__
    )
    return JSONResponse(
        {
            "error": {
                "code": "internal_error",
                "message": "Сервис временно недоступен. Повторите позже",
                "request_id": request.state.request_id,
            }
        },
        status_code=503,
        headers={"Cache-Control": "no-store", "X-Request-ID": request.state.request_id},
        background=BackgroundTask(
            queue,
            getattr(request.scope.get("route"), "path", "unmatched"),
            type(error).__name__,
            request.state.request_id,
        ),
    )


@app.get("/api/v1/health/live", response_model=StatusDTO)
async def live():
    return {"status": "ok"}


@app.get("/api/v1/health/ready", response_model=StatusDTO)
async def ready():
    from anyio import to_thread
    from redis.asyncio import Redis

    from app.integrations import storage

    try:
        async with async_engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        for url in (settings.redis_url, settings.auth_vault_url):
            async with Redis.from_url(url, socket_connect_timeout=3, socket_timeout=3) as redis:
                await redis.ping()
        if settings.storage_backend == "s3":
            await to_thread.run_sync(
                lambda: storage.client(probe=True).head_bucket(Bucket=settings.s3_bucket)
            )
            if settings.app_env == "production":
                from app.integrations.ledger import ledger_client

                await to_thread.run_sync(
                    lambda: ledger_client().head_bucket(Bucket=settings.ledger_s3_bucket)
                )
        else:
            from pathlib import Path

            if not await to_thread.run_sync(lambda: Path(settings.storage_directory).is_dir()):
                raise RuntimeError("missing storage")
    except Exception as error:
        raise AppError("dependencies_unavailable", "Компонент сервиса недоступен", 503) from error
    return {"status": "ready"}


@app.get("/api/v1/metrics", include_in_schema=False)
async def metrics(request: Request):
    from anyio import to_thread

    if (
        not settings.metrics_enabled
        or not settings.metrics_token.get_secret_value()
        or not hmac.compare_digest(
            request.headers.get("Authorization", ""), "Bearer " + settings.metrics_token.get_secret_value()
        )
    ):
        raise AppError("not_found", "Не найдено", 404)
    from datetime import timedelta
    from pathlib import Path

    from sqlalchemy import func, select

    from app.core.db import AsyncSessionLocal
    from app.core.metrics import render
    from app.core.security import now
    from app.integrations import storage
    from app.models import DeletionRequest, FileObject, Job, Outbox

    content = render()
    try:
        async with AsyncSessionLocal() as db:
            for status, count in await db.execute(select(Job.status, func.count()).group_by(Job.status)):
                content += f'insta_jobs{{status="{status}"}} {count}\n'
            count = await db.scalar(
                select(func.count()).select_from(FileObject).where(FileObject.expires_at < now())
            )
            content += f"insta_cleanup_backlog {count}\n"
            count = await db.scalar(
                select(func.count())
                .select_from(DeletionRequest)
                .where(
                    DeletionRequest.status != "completed",
                    DeletionRequest.created_at < now() - timedelta(hours=23),
                )
            )
            content += f"insta_deletion_deadline_backlog {count}\n"
            count = await db.scalar(
                select(func.count()).select_from(Outbox).where(Outbox.delivery_state == "failed")
            )
            content += f"insta_outbox_failed {count}\n"
            oldest = await db.scalar(select(func.min(Job.created_at)).where(Job.status == "queued"))
            age = max(0, (now() - oldest).total_seconds()) if oldest else 0
            content += f"insta_queue_oldest_seconds {age}\n"
        content += "insta_db_up 1\n"
    except Exception:
        content += "insta_db_up 0\n"
    from redis.asyncio import Redis

    worker_store = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
    try:
        for kind in ("default", "auth", "maintenance"):
            try:
                alive = int(bool(await worker_store.get("worker:alive:" + kind)))
            except Exception:
                alive = 0
            content += f'insta_worker_up{{queue="{kind}"}} {alive}\n'
        import os

        for kind in ("connect", "sync", "import", "comparison", "export", "parsing"):
            try:
                values = await worker_store.hgetall("metrics:job:" + kind)
                count = int(values.get(b"count", b"0"))
                seconds = int(values.get(b"microseconds", b"0")) / 1000000
            except Exception:
                count, seconds = 0, 0
            content += f'insta_job_attempt_duration_seconds_count{{kind="{kind}"}} {count}\ninsta_job_attempt_duration_seconds_sum{{kind="{kind}"}} {seconds}\n'
        try:
            if settings.storage_backend == "s3":
                await to_thread.run_sync(
                    lambda: storage.client(probe=True).head_bucket(Bucket=settings.s3_bucket)
                )
            elif not await to_thread.run_sync(lambda: Path(settings.storage_directory).is_dir()):
                raise OSError("Storage missing")
            content += "insta_storage_up 1\n"
        except Exception:
            content += "insta_storage_up 0\n"
        import json

        try:
            usage = json.loads(await worker_store.get("metrics:storage:usage") or b"null")
            if usage:
                content += f"insta_storage_used_bytes {usage['bytes']}\ninsta_storage_usage_timestamp {usage['timestamp']}\n"
        except Exception:
            pass
        content += f"insta_storage_quota_bytes {settings.s3_storage_quota_bytes}\n"
        import shutil
        from pathlib import Path

        work = await to_thread.run_sync(lambda: shutil.disk_usage(os.environ.get("TMPDIR", "/tmp")))
        content += f"insta_scratch_available_bytes {work.free}\ninsta_scratch_capacity_bytes {work.total}\n"

        try:
            last = float(
                await to_thread.run_sync(
                    lambda: (
                        Path(os.environ.get("BACKUP_STATUS_DIRECTORY", "/backup-status")) / "latest"
                    ).read_text()
                )
            )
        except OSError, ValueError:
            last = 0.0
        content += f"insta_backup_last_success_timestamp {last}\n"
        return PlainTextResponse(content, media_type="text/plain; version=0.0.4")
    finally:
        await worker_store.aclose()
