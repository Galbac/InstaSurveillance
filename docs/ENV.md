# ENV-контракт

Все рабочие значения задаются окружением, без чтения `.env` приложением напрямую. Compose получает приватный env файл и передаёт сервисам явный перечень переменных. Базовые defaults ниже относятся к development; production validators требуют HTTPS, secure cookies, ключи, private storage и реквизиты оператора. Примеры — `.env.dev.example` и `.env.prod.example`.

Secrets не передаются frontend. API не получает owner/worker URL и session encryption key; worker получает свой DB URL и session key. SMTP password получает maintenance, owner connection — migrate/operator/backup. Настройки compose берутся из одного приватного файла на host, но не весь файл доставляется каждому runtime.

| Переменная | Тип | Default / обязательность |
| --- | --- | --- |
| `APP_ENV` | `str` | `development` |
| `APP_BASE_URL` | `str` | `http://localhost:3100` |
| `DATABASE_URL` | `str` | `обязательно` |
| `REDIS_URL` | `str` | `redis://redis:6379/0` |
| `AUTH_VAULT_URL` | `str` | `redis://auth-vault:6379/0` |
| `SESSION_COOKIE_NAME` | `str` | `insta_session` |
| `SESSION_COOKIE_SECURE` | `bool` | `False` |
| `SESSION_TTL_SECONDS` | `int` | `604800` |
| `CSRF_SECRET` | `SecretStr` | `обязательно` |
| `INSTAGRAM_PENDING_ENCRYPTION_KEY` | `SecretStr` | `обязательно` |
| `INSTAGRAM_SESSION_ENCRYPTION_KEY` | `SecretStr | None` | `секрет / см. правила доставки` |
| `INSTAGRAM_PRIVATE_ENABLED` | `bool` | `True` |
| `INSTAGRAM_SYNC_INTERVAL_HOURS` | `int` | `24` |
| `INSTAGRAM_MANUAL_MIN_INTERVAL_HOURS` | `int` | `6` |
| `INSTAGRAM_MAX_RUNS_PER_24H` | `int` | `2` |
| `INSTAGRAM_REQUEST_BUDGET` | `int` | `100` |
| `INSTAGRAM_REQUEST_SPACING_SECONDS` | `float` | `2` |
| `INSTAGRAM_PLATFORM_COOLDOWN_HOURS` | `int` | `24` |
| `INSTAGRAM_CREDENTIAL_TTL_SECONDS` | `int` | `600` |
| `MAX_PROFILES_PER_USER` | `int` | `1` |
| `MAX_UPLOAD_BYTES` | `int` | `104857600` |
| `MAX_UNPACKED_BYTES` | `int` | `524288000` |
| `MAX_ARCHIVE_ENTRIES` | `int` | `5000` |
| `MAX_SNAPSHOT_MEMBERS` | `int` | `100000` |
| `SMTP_HOST` | `str` | `mail` |
| `SMTP_PORT` | `int` | `1025` |
| `SMTP_USERNAME` | `str` | `` |
| `SMTP_PASSWORD` | `SecretStr` | `секрет / см. правила доставки` |
| `SMTP_TLS_MODE` | `Literal['none', 'starttls', 'ssl']` | `none` |
| `MAIL_FROM` | `str` | `InstaSurveillance <hello@localhost>` |
| `STORAGE_BACKEND` | `str` | `s3` |
| `STORAGE_DIRECTORY` | `str` | `/uploads` |
| `S3_ENDPOINT` | `str` | `http://storage:9000` |
| `S3_REGION` | `str` | `us-east-1` |
| `S3_BUCKET` | `str` | `insta-private` |
| `S3_ACCESS_KEY_ID` | `str` | `insta-dev` |
| `S3_SECRET_ACCESS_KEY` | `SecretStr` | `обязательно` |
| `CORS_ALLOWED_ORIGINS` | `str` | `` |
| `TRUSTED_HOSTS` | `str` | `localhost,127.0.0.1,backend,testserver` |
| `LOG_LEVEL` | `str` | `INFO` |
| `APP_NAME` | `str` | `InstaSurveillance` |
| `RELEASE_VERSION` | `str` | `local` |
| `DB_POOL_SIZE` | `int` | `10` |
| `DB_MAX_OVERFLOW` | `int` | `10` |
| `SESSION_ABSOLUTE_TTL_SECONDS` | `int` | `2592000` |
| `INSTAGRAM_LOGIN_MAX_ATTEMPTS` | `int` | `3` |
| `INSTAGRAM_SESSION_KEY_VERSION` | `str` | `1` |
| `INSTAGRAM_SESSION_PREVIOUS_KEYS` | `SecretStr` | `секрет / см. правила доставки` |
| `ENCRYPTION_KEY` | `SecretStr | None` | `секрет / см. правила доставки` |
| `ENCRYPTION_KEY_VERSION` | `str` | `1` |
| `ENCRYPTION_PREVIOUS_KEYS` | `SecretStr` | `секрет / см. правила доставки` |
| `TERMS_VERSION` | `str` | `2026-10-07` |
| `PRIVACY_VERSION` | `str` | `2026-10-07` |
| `CONNECTION_TERMS_VERSION` | `str` | `2026-10-07` |
| `USER_STORAGE_QUOTA_BYTES` | `int` | `1073741824` |
| `MAX_ACTIVE_HEAVY_JOBS_PER_USER` | `int` | `2` |
| `MAX_ACTIVE_IMPORTS_PER_PROFILE` | `int` | `1` |
| `IMPORTS_PER_HOUR` | `int` | `10` |
| `RAW_FILE_TTL_HOURS` | `int` | `24` |
| `EXPORT_TTL_HOURS` | `int` | `24` |
| `IMPORT_CONFIRM_TTL_HOURS` | `int` | `24` |
| `JOB_SOFT_TIMEOUT` | `int` | `300` |
| `JOB_HARD_TIMEOUT` | `int` | `600` |
| `INSTAGRAM_SYNC_SOFT_TIMEOUT` | `int` | `1200` |
| `INSTAGRAM_SYNC_HARD_TIMEOUT` | `int` | `1800` |
| `JOB_STALE_SECONDS` | `int` | `120` |
| `JOB_METADATA_RETENTION_DAYS` | `int` | `30` |
| `NOTIFICATION_RETENTION_DAYS` | `int` | `180` |
| `AUDIT_RETENTION_DAYS` | `int` | `90` |
| `LOG_RETENTION_DAYS` | `int` | `30` |
| `BACKUP_RETENTION_DAYS` | `int` | `30` |
| `INSTAGRAM_LARGE_CHANGE_FRACTION` | `float` | `0.5` |
| `INSTAGRAM_LARGE_CHANGE_MIN_MEMBERS` | `int` | `100` |
| `ENABLE_EMAIL_NOTIFICATIONS` | `bool` | `True` |
| `ENABLE_PWA` | `bool` | `True` |
| `ENABLE_OFFICIAL_INSTAGRAM` | `bool` | `False` |
| `METRICS_ENABLED` | `bool` | `True` |
| `METRICS_TOKEN` | `SecretStr` | `секрет / см. правила доставки` |
| `SUPPORT_EMAIL` | `str` | `` |
| `OPERATOR_NAME` | `str` | `` |
| `OPERATOR_ADDRESS` | `str` | `` |
| `OPERATOR_JURISDICTION` | `str` | `` |
| `LEDGER_DIRECTORY` | `str` | `/ledger` |
| `LEDGER_S3_BUCKET` | `str` | `` |
| `LEDGER_S3_ENDPOINT` | `str` | `` |
| `LEDGER_S3_ACCESS_KEY_ID` | `str` | `` |
| `LEDGER_S3_SECRET_ACCESS_KEY` | `SecretStr` | `секрет / см. правила доставки` |
| `TRUSTED_PROXY_CIDRS` | `str` | `127.0.0.1/32` |
| `ERROR_TRACKING_DSN` | `str` | `` |
| `WORKER_CONCURRENCY` | `int` | `2` |
| `CELERY_BROKER_URL` | `str` | `` |
| `S3_USE_TLS` | `bool` | `True` |
| `S3_SERVER_SIDE_ENCRYPTION` | `Literal['', 'AES256', 'aws:kms']` | `AES256` |
| `S3_KMS_KEY_ID` | `str` | `` |
| `STORAGE_WRITE_TIMEOUT_SECONDS` | `int` | `300` |

## Инфраструктура и protected операции

Дополнительные переменные в примерах: `APP_DOMAIN`, `RELEASE_TAG`, `POSTGRES_*`, `API_DB_PASSWORD`, `WORKER_DB_PASSWORD`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BACKUP_DATABASE_URL` (только recovery override), `BACKUP_ENCRYPTION_KEY`, `BACKUP_S3_*`, `BACKUP_STATUS_DIRECTORY`, `ALERT_WEBHOOK_URL`, `APP_NETWORK_CIDR`, `APP_EDGE_IP`, `MAX_HTTP_BODY_BYTES` и `*_MEMORY_LIMIT`/`*_CPU_LIMIT`. Backup bucket/ключи обязательны в production; alert webhook опционален. `${VAR:?}` в compose — обязательное значение без fallback. Смена APP_EDGE_IP требует совпадающего TRUSTED_PROXY_CIDRS.

Версионированные ключи: `*_PREVIOUS_KEYS` — JSON object {version: key}; не печатать его в логах. `TRUSTED_HOSTS`/`CORS_ALLOWED_ORIGINS` — comma-separated строки; CORS wildcard запрещён. `SMTP_TLS_MODE`: none только dev, starttls/ssl в prod. Secrets должны иметь независимые случайные значения; generator делает это только для dev.

Retention для централизованного внешнего log sink и физические DB/disk limits также настраиваются оператором: один параметр приложения не изменяет политики внешнего облачного сервиса.

`LOG_DIRECTORY`: private application JSON log directory (prod /logs, dev stdout). LOG_RETENTION_DAYS применяется maintenance к этим файлам. Инфраструктурные логи внешнего облачного sink требуют отдельной настройки retention.

## Изолированные проверки и dev ports

`DEV_WEB_PORT` (3100), `DEV_API_PORT` (8100), `DEV_MAIL_PORT` (8026) управляют локальными port bindings; `APP_BASE_URL` должен соответствовать web port. `BROKER_PUBLISH_TIMEOUT_SECONDS` (3, диапазон 1–30) ограничивает TCP connection/read публикации; retry выполняет durable outbox. `SMOKE_BASE_URL` и `SMOKE_MAIL_URL` позволяют запускать сквозной сценарий на изолированном стенде.


## Дополнения повторного ревью

| Переменная | Назначение |
| --- | --- |
| `GARAGE_RPC_SECRET` | Генерируемый 32-byte hex secret только для dev storage-config; в frontend не передаётся |
| `S3_STORAGE_QUOTA_BYTES` | Логический предел всего private bucket для alert, 0 — не задан; отличается от пользовательской history quota |
| `DB_CONNECT_TIMEOUT_SECONDS` | Ограничение подключения и ожидания DB pool, 3 секунды по умолчанию |
| `VOLUME_METRICS_MEMORY_LIMIT` | Production volume exporter, по умолчанию 64m |
| `STORAGE_METRICS_TARGET` / `BACKUP_METRICS_TARGET` | Необязательный host:port отдельных private/backup capacity exporters |
| `STORAGE_METRICS_TOKEN` / `BACKUP_METRICS_TOKEN` | Отдельные bearer tokens; при пустом значении используется METRICS_TOKEN |
| `STORAGE_METRICS_SCHEME` / `BACKUP_METRICS_SCHEME` | По умолчанию https; для private dev Docker Garage — http |

Новый dev S3 endpoint — `http://storage:3900`, region `garage`; key начинается `GK`, credentials генерируются setup. SSE в этом одноузловом dev отключён явно; production validator требует SSE и TLS. Для SSE env используется default только при отсутствии переменной, пустой dev value не подменяется AES256 в Compose.

Global runtime limits хранятся в DB и могут только ужесточать соответствующие env значения. Квота сохраняется как bigint; несогласованные значения отклоняются API, секреты не раскрываются в admin overview.

Volume exporter измеряет DB/scratch/backup staging volumes. Он не выдаёт staging volume за ёмкость off-host bucket. Self-hosted Garage exporters используют `garage_local_disk_avail/total`; другие провайдеры должны выдать совместимые сигналы или иметь свои alarms. Для managed S3 физическая ёмкость управляется провайдером: дополнительно настраиваются bucket usage/cost/quota и доступность. Источник метрик Garage: [official monitoring reference](https://garagehq.deuxfleurs.fr/documentation/reference-manual/monitoring/).

### Async DB pools

HTTP async engine и sync engine Celery/operator tools имеют отдельные пулы. `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` — предел каждого engine каждого процесса, а не суммарный лимит сервиса. Учесть количество API/worker процессов и резерв PostgreSQL; не увеличивать пул без проверки нагрузки. [Подробности](ASYNC.md).
