# Асинхронный backend

Уточнение заказчика от 7 октября 2026: сохранить psycopg и выполнять I/O асинхронно везде, где это применимо.

## Что выполняется асинхронно

- HTTP использует `create_async_engine`, `async_sessionmaker` и отдельную `AsyncSession` на запрос. Драйвер — настоящий `psycopg.AsyncConnection`; БД не выполняется через thread pool.
- Авторизация, проверка MFA и readiness выполняют запросы асинхронно. Все предметные HTTP-маршруты зарегистрированы асинхронным router.
- Redis rate limits и временный auth vault используют `redis.asyncio` с ограниченными таймаутами и закрытием клиента. В Celery тот же адаптер использует синхронный клиент.
- boto3, упаковка/чтение файлов и Argon2 работают через ограниченный AnyIO thread pool. ORM session в поток не передаётся, контекст request session очищается. Чтение chunks скачивания обслуживается Starlette вне event loop; периодическая проверка owner/export выполняется нативной async session, генератор закрывается при отмене. Завершение записи FileObject в HTTP использует текущую async transaction.
- HTTP logging использует `ainfo`/`aerror`, чтобы файловый processor не блокировал event loop. Асинхронный DB pool закрывается в lifespan.

## Общий ORM-код

Существующие транзакционные функции API/Celery используют штатный `AsyncSession.run_sync`: SQLAlchemy приостанавливает их на DB I/O через greenlet, передавая работу асинхронному драйверу. Сами функции не переписаны целиком на `async def`. Это не запуск синхронного psycopg в отдельном потоке.

`DB` описывает sync ORM facade внутри предметной функции; router заменяет полученную async session её facade. `AsyncDB` используется в нативных async dependencies/обработчиках. Новые async handlers могут сразу использовать `AsyncDB` и `await db.execute(...)`.

Правила для развития:

1. Одна session принадлежит одному запросу/задаче. Нельзя запускать параллельные запросы через одну session; для независимых транзакций нужны отдельные session.
2. Внутри sync ORM facade DB операции выполняются напрямую; блокирующее внешнее I/O — только через `blocking_call`, Redis — через `redis_command`. Нельзя передавать Session/ORM lazy access в callable другого потока.
3. Не создавать отдельный sync engine для чтения runtime limits внутри HTTP-транзакции: используется текущая request session.
4. Celery, миграции, backup и operator CLI сохраняют синхронный DB engine. Их процессы выполняют отдельные задания, не блокируют HTTP event loop.
5. `/metrics` также асинхронный: DB/Redis probes используют native async, S3/filesystem probes — ограниченные SDK вызовы вне event loop. Клиент Redis закрывается в finally.

## Пулы и производительность

`DB_POOL_SIZE`, `DB_MAX_OVERFLOW` и `DB_CONNECT_TIMEOUT_SECONDS` применяются к каждому engine каждого процесса отдельно. HTTP async pool и sync pool фоновых процессов независимы. При расчёте `max_connections` PostgreSQL нужно учитывать оба, все API/Celery процессы, migrate/backup и запас для эксплуатации. Увеличение пула без измерения не гарантирует ускорения.

Проверка с настоящим PostgreSQL подтверждает тип драйвера, работу heartbeat во время `pg_sleep`, перенос блокирующего SDK вызова из event loop и возврат соединения после отмены SQL. Локальный нагрузочный отчёт — [performance-async.json](reports/performance-async.json): отдельная тестовая БД, pool 20 + overflow 30, ASGI TestClient, 100 разных сессий и 500 запросов. Он не заменяет проверку публичного сервера 4 vCPU / 8 GB и не доказывает ускорение относительно другого запуска с иной фоновой нагрузкой.

## Зависимости

Включён extra `sqlalchemy[asyncio]` у существующей SQLAlchemy 2.1.3. В lock добавлен только greenlet 3.5.6, остальные версии сохранены. По [PyPI](https://pypi.org/project/greenlet/3.5.6/) поддерживается Python >=3.10, доступны CPython 3.14 wheels для musl aarch64/x86_64 и macOS. Проверки повторены на Python 3.14.8/Alpine.

Официальные описания: [SQLAlchemy asyncio/run_sync](https://docs.sqlalchemy.org/en/21/orm/extensions/asyncio.html), [psycopg async](https://www.psycopg.org/psycopg3/docs/advanced/async.html), [structlog asyncio](https://www.structlog.org/en/stable/standard-library.html).
