# Статус V1 и отчёт проверки

Дата: 7 октября 2026. Реализованы основные сценарии V1: backend, frontend, обработка данных и эксплуатационные инструменты. 14 групп доработок повторного ревью реализованы — см. [TZ-AUDIT](TZ-AUDIT.md). **Публичная приёмка ещё не завершена.** Реальное подключение Instagram, 2FA и восстановление сессии пользователь отложил для собственной проверки.

## Реализовано

| Область | Возможности |
| --- | --- |
| Проект | Python/Next.js монорепозиторий, отдельные Dockerfile, dev/prod Compose, приватный env generator, lock-файлы, CI workflow |
| Вход сервиса | Регистрация, версии согласий, verification/reset, cookie/CSRF/Origin, Argon2, смена email/пароля, список и отзыв сессий |
| Instagram | instagrapi adapter, отдельный auth worker, временные encrypted credentials, 2FA, собственный ID, encrypted session, guard/spacing/budget/cooldown, pause/disconnect/reconnect |
| Очереди | Durable outbox, ограниченный retry/dead letters, heartbeat, stale recovery, idempotency, generation/run-token guard, лимиты тяжёлых jobs |
| Импорт | ZIP либо несколько JSON, многотомные followers, проверки путей/структуры/лимитов, streaming upload, preview, подтверждения полноты/даты, dedup, очистка файлов |
| Аналитика | SQL списки/агрегаты/cursor pagination, категории взаимности, поиск/сортировка/избранное/заметки/bulk, снимки и детали provenance, периоды и асинхронные сравнения, пересчёт соседства, графики/таблица |
| Экспорт | Фоновые CSV/JSON, фильтры, полный экспорт данных, защита формул, private download с проверкой владельца и сроком 24ч |
| Управление | Theme/timezone, расписание, пять notification preferences, in-app/email notifications, support tickets/replies, удаление snapshot/profile/account и receipt |
| Операторы | Admin/support RBAC, TOTP/recovery с replay protection, protected owner CLI, метаданные, audit, блокировка/восстановление пользователя, разрешённые технические retry |
| Privacy | Immediate access stop, independent encrypted deletion ledger, повторяемая очистка DB/storage, fence для uploads, безопасный restore, раздельные DB roles и key rotation |
| Интерфейс | Лендинг/demo/auth/onboarding, полный кабинет, connect/2FA/job pages, импорт/help, admin/support, legal pages с runtime реквизитами, responsive CSS от 320px |
| PWA | Manifest/icons, install CTA/iOS инструкция, public offline fallback, запрет persistent caching личных API/кабинета |
| Эксплуатация | Nonroot/read-only prod, TLS ingress, readiness/metrics, Prometheus/Alertmanager configs, sanitized error tracking, encrypted daily backup, restore drill, deploy/rollback инструкции |

Официальная Meta интеграция и HTML импорт входят в V1.1, биллинг и командные аккаунты — V2. Они не включены в поставку V1.

## Закрытые доработки

Добавлены безопасный disconnect и best-effort logout, выбранные фильтры/сортировка CSV, PWA update flow, расширенная аналитика и URL state, admin limits с audit, очистка истории с сохранением подключения и статусом, mobile sheet/skeleton, карточка import, email delivery/jitter, generated DTO/cancellation, composite DB constraints/source timestamps, дополнительные метрики/alerts и Location. Подробная сверка и ограничения: [TZ-AUDIT](TZ-AUDIT.md).

Новый dev использует приватный локальный S3/Garage, проверены multipart/read/delete и запрет anonymous access. Старый env с filesystem автоматически не переключается: это потребовало бы миграции существующих файлов.

## Проверки и границы результатов

- Frontend: 7 unit tests PASS (PWA assets/update, upload activity, AbortSignal, API errors), ESLint/TypeScript/Next build PASS. Unit среда не является браузерной приёмкой.
- Backend повторён на Python 3.14.8/Alpine/musl; 66 passed, 1 skipped (нагрузка запущена отдельно и прошла). Новый warning Starlette/httpx — deprecation test adapter, не ошибка runtime.
- Nonroot/read-only restore проверяет account/history deletion replay и отсутствие session/logout capability в backup; [restore-drill.json](reports/restore-drill.json).
- Real local S3 drill: [s3-drill.json](reports/s3-drill.json).

- Автоматические проверки Python: unit/security и изолированные PostgreSQL integration tests. Последний прогон: **66 passed, 1 skipped**; skipped — нагрузочный тест, который отдельно прошёл. Реальных запросов Instagram нет.
- Ruff, Pyright и согласованность Poetry lock проверяются; frontend ESLint, TypeScript и production build проходят. OpenAPI и TypeScript client генерируются из одного контракта: 79 API операций.
- pip-audit и npm audit: известных уязвимостей в проверенных зависимостях не найдено на дату прогона. JSON отчёты — [reports](reports/). Это не гарантия отсутствия неизвестных уязвимостей. Аудит ОС образов описан ниже. Перечни лицензий также сохранены; особенности описаны в [DEPENDENCIES](DEPENDENCIES.md).
- Сквозной HTTP/SMTP/Redis/Celery workflow прошёл на запущенном dev stack: регистрация, письмо/verification, два импорта, сравнение, полный export/download и удаление аккаунта. Тестовый аккаунт удалён. [dev-stack-smoke.json](reports/dev-stack-smoke.json). Это проверка API и инфраструктуры, не browser QA.
- Production image audit Trivy 0.75.0 выполнен. После удаления npm и обновления zlib в frontend runtime advisory findings не осталось. Backend/backup переведены на официальный Python 3.14.8 Alpine 3.24 с пересборкой locked dependencies под musl. Все три production-образа проходят gate: HIGH/CRITICAL нет, MEDIUM/LOW findings также нет после обновления zlib до 1.3.2-r1 из официального Alpine repository. Ранее проверенные Debian/Bookworm образы не выбраны. Подробности: [IMAGE-SECURITY](IMAGE-SECURITY.md).
- Реальное HTTP отключение через ограниченную API роль проверено с synthetic ciphertext: session secret удалён, создано непрозрачное разрешение только для worker. Реальных Instagram запросов нет; [disconnect-drill.json](reports/disconnect-drill.json).
- PostgreSQL runtime privileges проверены: API не читает session secrets и не назначает роли; worker не владелец схемы, не создаёт роли/БД и не назначает роли.
- Нагрузочный тест: 1000 синтетических пользователей, 100 одновременных сессий, 500 чтений и снимок 100000 строк. Данные и измерения — [performance-async.json](reports/performance-async.json). Транспорт ASGI TestClient, без TLS/сети; результат нельзя выдавать за приёмку согласованного облачного сервера 4 vCPU/8 GB.
- Изолированный restore drill: миграции PostgreSQL 18 → encrypted pg_dump → удаление пользователя после копии → пустая БД restore → ledger replay. Проверены отзыв сессий и reconnect_required: [restore-drill.json](reports/restore-drill.json). Рабочая БД не восстанавливалась. Production RPO/RTO и реальный off-host bucket пока не подтверждены.
- Чистый запуск из копии исходников с новыми credentials и пустыми изолированными volumes прошёл полный HTTP workflow; временный стенд удалён. [clean-start.json](reports/clean-start.json).
- Dev Compose и prod/observability синтаксис проверены; Caddy prod configuration валидна. Production проверялся с временными значениями только для разбора конфигурации, без облачного запуска.
- Проверка отсутствия cache/dependency directories в checkout проходит. Dev caches/scratch находятся в Docker volumes или вне проекта.
- Browser runtime не предоставил браузер (`agent.browsers.list()` вернул пустой список). **Визуальная проверка 320px, text zoom, keyboard/screen reader, сквозной браузерный сценарий и установка PWA на устройствах не выполнены.** CSS и accessibility code не заменяют эту приёмку.
- Для TestClient есть предупреждение Starlette о будущем переходе с httpx. Оно не ломает тесты; несвязанные зависимости ради удаления предупреждения не обновлялись.

Итог текущего прогона и source fingerprint: [completion-checks.json](reports/completion-checks.json).

## Матрица A-01…A-35

«Автотесты» означают проверенную часть сценария на синтетических данных; «реальное окружение» требует отдельной приёмки и не считается PASS.

| ID | Доказательство / что остаётся |
| --- | --- |
| A-01, A-02 | Чистая копия исходников, новый 0600 env и пустые volumes: полный dev stack и HTTP workflow прошли; [clean-start.json](reports/clean-start.json). Remote Git checkout и целевой cloud ещё не проверены |
| A-03 | Auth unit/integration tests; реальный production SMTP требует проверки |
| A-04 | Tenant isolation и чужие UUID — PostgreSQL tests |
| A-05, A-06 | Формулы, первый snapshot и counters — domain/integration tests; live источник отложен |
| A-07, A-08 | Archive parser tests: missing categories, ZIP paths, многотомность/gaps/nesting/depth, dedup |
| A-09 | Username mode и provenance реализованы; UI не утверждает доказанную причину/rename |
| A-10 | HTTP idempotency и semantic import duplicate — integration tests |
| A-11 | Реальный SIGKILL отдельного рабочего процесса, recovery, повторная доставка и отсутствие дублей проверены на изолированной локальной БД. Старый token отзывается до нового claim; реальный TCP отказ брокера, три попытки/dead letter и доступность чтения проверены; целевой cloud ещё требует drill |
| A-12, A-13 | Поздний снимок и удаление среднего — PostgreSQL adjacency tests |
| A-14 | Локальный 100k load stand; повторить timings/RAM на согласованном сервере |
| A-15, A-16 | Код адаптивности/a11y есть; browser и устройства недоступны, приёмка не выполнена |
| A-17 | Manifest/public-only SW/install flow есть; реальная установка/offline/logout QA не выполнена |
| A-18 | Async export/owner/expiry и CSV formula tests; скачивание через browser проверить |
| A-19 | Session revoke/password/email one-use tests; браузерный путь проверить |
| A-20 | Immediate access stop/ledger/cleanup/receipt tests; фактические S3 permissions и SLA cloud проверить |
| A-21 | Изолированный encrypted restore с replay удаления после backup прошёл |
| A-22 | Secrets redaction/credential idempotency/telemetry whitelist tests; image scan выполнен, gate HIGH/CRITICAL проходит. Production log sampling ещё нужен |
| A-23 | Workspace cache check проходит |
| A-24 | Импорт и private adapter независимы от Meta OAuth |
| A-25 | Реальные login/2FA отложены пользователем; механизм реализован |
| A-26 | Fake transport 429/no retry/budget; реальное поведение Instagram отложено |
| A-27 | Код reconnect без password login; реальная отозванная сессия отложена |
| A-28 | Общая блокировка и HMAC rolling budget; simultaneous scheduler/live drill ещё нужен |
| A-29 | Fake pagination/cursor/partial tests; реальные большие списки отложены |
| A-30 | API rolling quota и disconnect bypass test; live policy требует наблюдения |
| A-31 | DB role isolation проверена; реальное session restore отложено |
| A-32 | Generation cancellation до публикации проверена; in-flight live cancellation отложена |
| A-33 | Restore drill проверяет paused/reconnect и отсутствие session/credential восстановления |
| A-34 | Mismatch отклоняется до HTTP — тест; actual login identity проверка отложена |
| A-35 | Domain identity mode compatibility tests; interface caveats реализованы |

## Что зависит от внешнего окружения

1. Пользователь: реальный Instagram login, поддерживаемая 2FA, session restore, ограничения/challenge и отмена live сборов.
2. Browser/устройства: размеры 320/360/390/768/1024/1440, text zoom, клавиатура, screen reader, сквозной путь и PWA Android/iOS.
3. Владелец: облако/домен/SMTP/S3, оператор и документы, реальные alert recipients. Без этих сведений публичный запуск не выполнялся.
4. Эксплуатационная приёмка: off-host backup/lifecycle, измеренный RPO/RTO, outage/rollback drill, внешняя HTTPS нагрузка и повторный image audit на целевой архитектуре (локальный gate проходит).

Порядок работы: [OPERATIONS](OPERATIONS.md). Архитектура: [ARCHITECTURE](ARCHITECTURE.md). Контракт: [API](API.md).

## Уточнение: async psycopg

HTTP переведён на AsyncSession/psycopg.AsyncConnection, Redis asyncio; SDK/файлы/Argon2 и HTTP logging не блокируют event loop. Celery и migrations сохраняют sync engine. Подробности и правила расширения — [ASYNC.md](ASYNC.md). 66 backend tests на Alpine прошли, включая native driver/heartbeat/cancellation. Семь frontend unit tests и production build прошли. Последний load run: [performance-async.json](reports/performance-async.json); прежние отчёты сохранены как история.

Read-only probe публичного origin готов: `python3 deploy/scripts/verify-public.py --url https://YOUR_DOMAIN --report /secure/insta/public-http.json`. Локальный режим прошёл 10/10, TLS не проверялся: [public-http-local.json](reports/public-http-local.json). Он не подтверждает browser/PWA устройства, SMTP/S3/cloud нагрузку или Instagram.

UI-стек приведён к Tailwind/Radix/RHF/Zod; границы и browser/device сценарии — [UI.md](UI.md). React Hook Form/Zod применены к auth/settings; специальные формы сохраняют свои состояния. Последние frontend unit checks: 7 PASS.

Итог локальных изменений async/UI: [async-ui-checks.json](reports/async-ui-checks.json). Предыдущий completion-checks.json сохраняет исторический результат до перехода на async. Cloud/device/Instagram приёмка не отмечена PASS.
