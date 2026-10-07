ARG RUNTIME_PYTHON_IMAGE=python:3.14.8-alpine3.24
FROM python:3.14-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 POETRY_VIRTUALENVS_CREATE=false POETRY_CACHE_DIR=/tmp/poetry
WORKDIR /app
RUN mkdir -p /work
RUN pip install --no-cache-dir poetry==2.5.1
COPY pyproject.toml poetry.lock ./
FROM base AS dev
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
RUN poetry install --no-interaction && pyright --version
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
FROM ${RUNTIME_PYTHON_IMAGE} AS prod-dependencies
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 POETRY_VIRTUALENVS_CREATE=false POETRY_CACHE_DIR=/tmp/poetry
WORKDIR /app
RUN pip install --no-cache-dir poetry==2.5.1
COPY pyproject.toml poetry.lock ./
RUN python -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv PATH="/opt/venv/bin:$PATH"
RUN poetry install --only main --no-interaction
FROM ${RUNTIME_PYTHON_IMAGE} AS prod
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
WORKDIR /app
RUN apk add --no-cache 'zlib>=1.3.2-r1'
RUN adduser -D -u 10001 appuser && mkdir -p /work /logs && chown appuser:appuser /work /logs && chmod 0700 /work /logs
COPY --from=prod-dependencies /opt/venv /opt/venv
# Package installers are build tools; runtime executes only the locked environment.
RUN python -c "import pathlib, shutil; roots=[pathlib.Path('/opt/venv/lib/python3.14/site-packages'),pathlib.Path('/usr/local/lib/python3.14/site-packages')]; [shutil.rmtree(p) for root in roots for pattern in ('pip','pip-*.dist-info') for p in root.glob(pattern)]"
COPY . .
USER appuser
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log --proxy-headers --forwarded-allow-ips \"${TRUSTED_PROXY_CIDRS:-127.0.0.1}\""]
FROM prod AS backup
USER root
# Match the PostgreSQL 18 server; no package installer is used at runtime.
RUN apk add --no-cache postgresql18-client
RUN mkdir -p /backup-status && chown appuser:appuser /backup-status && chmod 0755 /backup-status
USER appuser
CMD ["python", "-m", "app.backups", "schedule"]

# Isolated checks on the same Python/Alpine runtime and locked native dependencies as production.
FROM prod-dependencies AS verification
RUN poetry install --no-interaction
COPY . .
CMD ["pytest", "-q"]
