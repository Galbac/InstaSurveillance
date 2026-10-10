# Эксплуатация V1

## Локальная разработка

```sh
make dev
make logs
make test
make check
make frontend-check
make schema
make performance
make backup-drill
make down
```

Сайт http://localhost:3100; Mailpit http://localhost:8026; API http://localhost:8100/api/docs. `.env.dev` генерируется один раз с правами 0600. Регистрация → письмо Mailpit → подтверждение → импорт/подключение. Импорт: ZIP JSON или несколько JSON-файлов из выгрузки Instagram за всё время. После preview подтвердить полноту и дату; второго снимка достаточно для истории изменений.

`down` сохраняет volumes. Не использовать `down -v` для устранения сбоя: это удаляет данные. node_modules/.next, PostgreSQL, Redis, файлы и scratch находятся в Docker volumes. Python bytecode и pytest cache отключены, Ruff/Poetry/npm tool caches вне checkout. Проверка: `python3 deploy/scripts/check-workspace.py`.

## Подготовка production

1. Создать приватный `.env.prod` **вне checkout**, права 0600, по `.env.prod.example`. Сгенерировать независимые ключи и DB passwords; не использовать dev значения. Owner URL — только migrate/operator/backup, runtime API и worker используют разные роли.
2. Предоставить домен и DNS, HTTPS, SMTP с TLS, приватный S3 для imports/exports, независимые buckets/credentials для encrypted backup и deletion ledger. Настроить оператора, адрес, юрисдикцию и support email. Production validation отклоняет обязательные незаполненные поля.
3. S3 права: Get/Put/DeleteObject по своим prefixes, ListBucket для проверки, ListBucketMultipartUploads и AbortMultipartUpload для очистки. Запретить публичные ACL и anonymous access; включить SSE AES256 либо KMS. Lifecycle для временных imports/exports и abandoned multipart — резервная защита. Ledger не удалять раньше backup retention + 1 день. Backup key отличается от data/session keys; ключи хранить отдельно от copies.
4. Firewall: наружу только 80/443; PostgreSQL/Redis/auth-vault не имеют host ports. Prometheus/Alertmanager доступны только loopback через SSH tunnel. Настроить фактические облачные обработчики и юридические документы, проверить STATUS.
5. Выбрать release tag, сохранить предыдущий image tag и backup reference. Выполнить:

```sh
./deploy/scripts/deploy.sh /secure/insta/.env.prod v1-release
```

Скрипт собирает образы, проверяет settings, останавливает runtime перед backup/migration, создаёт шифрованную внешнюю копию, применяет миграции, запускает сервисы и проверяет внутренние health endpoints. При ошибке после остановки сервис остаётся остановлен: оператор устраняет причину. Для первичного пустого развёртывания предварительная копия содержит пустую БД. Это не проверка публичного TLS и не автоматическое разрешение production запуска.

После запуска проверить публичный `/api/v1/health/ready`, HTTPS/security headers, регистрацию и SMTP, приватность S3 и фактическое удаление объекта, admin MFA, email notifications и 100k нагрузку на согласованном сервере. Настроить внешний uptime monitor. Не использовать реальные Instagram credentials в автоматических deploy checks.

## Администратор и MFA

Публичный API не назначает роли и не меняет статус оператора. Назначение прав и первоначальный выпуск MFA производятся исключительно через защищённый CLI на сервере:

```sh
docker compose --env-file /secure/insta/.env.prod -f compose.prod.yml --profile operator run --rm --user "$(id -u):$(id -g)" -v /secure/insta/enrollment:/enrollment operator python -m app.cli bootstrap-admin --email operator@example.org --role admin --output /enrollment/admin.txt
```

### Команды защищённого CLI
- **`bootstrap-admin`**:
  - Параметры: `--email <EMAIL>`, `--role <admin|support>` (по умолчанию `admin`), `--output <ABSOLUTE_PATH>`.
  - Требования безопасности: Запускается от владельца схемы PostgreSQL (schema-owner) или суперпользователя. Путь `--output` обязан быть абсолютным и находиться строго вне каталога checkout репозитория; файл создаётся с маской `0600`.
  - Интерактивный ввод пароля: Длина не менее 12 символов с обязательным подтверждением.
  - Механизм работы: Создаёт пользователя со статусом `verified=True` или обновляет существующего, назначает роль (`admin` или `support`), генерирует криптографический TOTP-ключ (Base32) и 10 одноразовых 32-значных кодов восстановления (`recovery_codes`). Seed шифруется текущим ключом шифрования данных `data_cipher`, хэши кодов восстановления сохраняются в таблице `admin_mfa`. Все существующие сессии пользователя завершаются, события фиксируются в аудите (`admin.bootstrap`, `admin.mfa_enroll`).
  - Действия оператора: Импортировать TOTP в приложение аутентификации (Google Authenticator, Bitwarden и т.д.), сохранить резервные коды в безопасном менеджере паролей, удалить enrollment-файл: `shred -u /enrollment/admin.txt`.
- **`recover-admin-mfa`**:
  - Параметры: `--email <EMAIL>`, `--output <ABSOLUTE_PATH>`.
  - Назначение: Сброс и повторный выпуск второго фактора для действующего оператора при утере устройства или компрометации.
  - Механизм работы: Отзывает все активные сессии пользователя, генерирует новый TOTP seed и 10 новых recovery кодов в файл `0600`, логирует аудит `admin.mfa_enroll`.

### Жизненный цикл сессии и 15-минутное окно
1. **Базовый вход**: Оператор входит через стандартную форму логина (`POST /api/v1/auth/login`) и получает HttpOnly cookie сессии.
2. **Проверка статуса**: При переходе в `/admin` веб-приложение запрашивает `GET /api/v1/admin/auth/status`. Эндпоинт доступен операторам без подтверждения MFA и сообщает текущее состояние: роль, статус и значение `privileged_until`.
3. **MFA Challenge**: Если `privileged_until` отсутствует или истёк, интерфейс блокирует доступ к чувствительным данным и открывает диалог ввода TOTP / recovery code (`POST /api/v1/admin/auth/mfa/challenge`). TOTP-валидация защищена от replay-атак через отслеживание монотонного счётчика времени `last_counter`; использование recovery code безвозвратно удаляет его хэш. Успешная проверка устанавливает `privileged_until = now + 15 минут`.
4. **Истечение привилегий**: В интерфейсе отображается визуальный таймер обратного отсчёта. При наступлении дедлайна клиент автоматически очищает кэш запросов TanStack Query (`queryClient.clear()`) и выводит диалог повторной авторизации. Сервер при любых попытках запросов возвращает `403 Forbidden` (`mfa_required`).
5. **Разграничение ролей**: Для роли `support` доступ к блокировке пользователей, паузе/возобновлению профилей, перезапуску заданий, изменению лимитов, просмотру системной диагностики и журналу аудита запрещён на уровне сервера (403 Forbidden).

### Системная диагностика (System Health)
Endpoint `GET /api/v1/admin/system` (доступен только роли `admin` с активным MFA) предоставляет актуальное состояние ключевых подсистем без раскрытия конфиденциальных данных:
- **База данных**: Задержка выполнения тестового запроса (`latency_ms`) к PostgreSQL и статус соединения.
- **Хранилище объектов**: Режим работы (`local` или `s3`), результат проверки доступности (`head_bucket` для S3, проверка доступности каталога для local storage).
- **Объём данных**: Суммарный объём нормализованных файлов (`FileObject.size_bytes`).
- **Очередь удаления**: Число ожидающих обработки запросов на удаление данных (`DeletionRequest` без `receipt_token`).
- **PostgreSQL Outbox**: Число необработанных транзакционных сообщений (`processed_at IS NULL`) и возраст старейшего сообщения в очереди в секундах (`oldest_age_seconds`).
- **Безопасность**: Эндпоинт исключает DSN, пароли, ключи шифрования, переменные окружения и сырые трассировки стека.


## Остановка провайдера

Для конкретного профиля — пауза либо отключение в настройках. Disconnect удаляет secret, отменяет jobs, меняет generation; история сохраняется. Для всего сервиса: остановить worker/auth-worker/scheduler, установить `INSTAGRAM_PRIVATE_ENABLED=false`, пересоздать API/worker/auth-worker/maintenance/scheduler. Старые процессы не получают новый `.env` автоматически. Импорт продолжает работать. После challenge требуется действие пользователя в официальном Instagram и явное переподключение.

## Очереди и инциденты

PostgreSQL outbox — источник истины; Redis не является единственным местом job. Maintenance возвращает потерянные queued сообщения, восстанавливает stale heartbeat и завершает исчерпанные попытки. До трёх технических попыток для import/comparison/export; реальные login/sync не повторяются автоматически при provider errors. Администратор может повторить только допустимый технический сбой. Не менять Job вручную и не воспроизводить credentials из vault.

API ошибки содержат request ID. Логи структурированные, без body/cookies/secrets/member lists. В production application JSON logs собраны в private volume `prod_logs` и очищаются maintenance по LOG_RETENTION_DAYS (30 дней). Python runtime отключает Docker log persistence, чтобы сторонние traceback не попадали в постоянные логи; безопасные application events хранятся в /logs. При необходимости подключить облачный log shipper к этому volume read-only. Локально metadata видны через make logs. Sentry DSN опционален; отправляется только тип исключения и технические теги, без stack, user и request body. При недоступности dependency readiness возвращает неготовность; `/health/live` подтверждает процесс.

## Метрики и алерты

```sh
docker compose --env-file /secure/insta/.env.prod -f compose.prod.yml -f compose.observability.yml --profile observability up -d
```

Prometheus `/api/v1/metrics` читает внутри сети с отдельным METRICS_TOKEN; edge скрывает endpoint. Config/token создаются в private volume без вывода секретов. Alertmanager webhook задаётся HTTPS URL в `.env`; пустое значение не отправляет сообщения. Алерты: API down/5xx/latency, возраст очереди, dead letters, backlog/возраст удаления и устаревший backup. Проверить доставку алерта реальному оператору до запуска. Backup status volume читается API только read-only.

## Backup / restore

Плановый backup раз в сутки, retention по `.env` (30 дней по умолчанию), encrypted off-host S3. Ключ не хранить только на том же сервере. Проверка локального конвейера: `make backup-drill`, результат `docs/reports/restore-drill.json`. Она создаёт и удаляет только случайные изолированные БД `insta_drill_*` и не восстанавливает рабочую БД.

Реальное восстановление:

1. Остановить API/workers/scheduler; сохранить текущую БД для расследования отдельно.
2. Подготовить **новую пустую БД** и owner connection; скачать encrypted backup в private operator directory.
3. В отдельном recovery environment указать TARGET connection в `BACKUP_DATABASE_URL`, независимый ledger и требуемые старые data/backup keys.
4. Запустить backup image с private mount:

```sh
python -m app.backups restore --input /recovery/backup.enc --confirm-database NEW_EMPTY_DATABASE_NAME
```

5. Restore проверяет ciphertext до pg_restore, replay удалений до доступа, отзывает sessions, удаляет credentials/MFA/outbox/exports, переводит Instagram в reconnect_required. Переоформить admin MFA через protected CLI, проверить роли, данные и deletion ledger. Переключить runtime на восстановленную БД только после проверок.

Production RPO ≤24ч и RTO ≤8ч требуют измерения на фактическом сервере и внешнем bucket; локальный drill не подтверждает эти сроки.

## Rollback

Перед release обязательна `make image-audit`: HIGH/CRITICAL findings блокируют deploy, отсутствие fix не трактуется как разрешение. Перед release нужны предыдущие образы и проверенная pre-migration копия. Если схема совместима, остановить runtime, задать предыдущий RELEASE_TAG, запустить **без build и без downgrade**, проверить readiness и workflows. Не перезаписывать previous tags. Если схема несовместима: не запускать старый код поверх новой схемы; выполнить описанный restore в новую БД с ledger, переоформить MFA и переключить connection. Изменения после backup будут потеряны, кроме обязательного replay удалений. Миграции V1 явно запрещают разрушительный downgrade.

## Ротация ключей

Session key: добавить старую версию в `INSTAGRAM_SESSION_PREVIOUS_KEYS`, назначить новый key/version, остановить auth/default workers, выполнить защищённый `python -m app.cli rotate-instagram-key`, пересоздать workers и проверить. Data key: аналогично `ENCRYPTION_PREVIOUS_KEYS`, `ENCRYPTION_KEY_VERSION`, команда `rotate-data-key`; сохранить предыдущие keys для независимого ledger до истечения окна backups. Backup key хранится по версии копии вне сервиса; не терять ключи действующих copies. При утечке session key отозвать подключения и требовать reconnect, одной ротации ciphertext недостаточно.

## Политика хранения

Снимки/заметки — до удаления пользователем; auth credentials ≤10 минут; preview/raw files ≤24ч; downloads ≤24ч; Job metadata 30 дней, уведомления 180, audit 90, idempotency 24ч, backups 30 дней по умолчанию. User data quota считает нормализованные данные и заметки, не размер физических DB pages. Удаление запрещает доступ сразу, storage cleanup повторяется ≤24ч. Ledger живёт дольше backup window. Проверять backlog, место `/work`, DB и backup store.

ENV reference: [ENV.md](ENV.md). Полный локальный HTTP/SMTP/worker сценарий без Instagram: `make stack-smoke`.

## Проверка чистого запуска

`make clean-start` копирует исходники во временный каталог вне checkout, создаёт новый приватный env и случайный Compose project с пустыми volumes. Стенд проходит полный synthetic HTTP/email/import/export/delete сценарий, затем его контейнеры и volumes удаляются. Текущий dev stack не останавливается. Отчёт — `docs/reports/clean-start.json`; это локальная проверка исходников, не remote Git checkout или cloud acceptance. Docker images и build cache остаются вне проекта.

## Проверка публичного origin

После настройки DNS/TLS выполнить read-only HTTP probe:

```sh
python3 deploy/scripts/verify-public.py --url https://YOUR_DOMAIN --report /secure/insta/public-http.json
```

Проверяет TLS через системный trust store, health, security headers/HSTS, unauthenticated auth boundary, скрытый metrics endpoint и публичные PWA assets. Не создаёт аккаунт и не отправляет письма/Instagram requests. Ошибки провайдера и содержимое ответов не записываются. Для локального HTTP требуется `--allow-http`; такой результат не считается проверкой TLS. Browser/device, фактическая SMTP доставка, S3 lifecycle, off-host backup/RPO/RTO, нагрузка и alert delivery принимаются отдельно.
