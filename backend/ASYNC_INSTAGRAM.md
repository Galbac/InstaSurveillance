# Переход Instagram-интеграции на aiograpi

Дата: 9 октября 2026.

## Изученные границы проекта

HTTP обслуживает FastAPI с AsyncSession/psycopg и синхронными предметными
функциями через SQLAlchemy run_sync. PostgreSQL хранит задания и durable outbox;
Celery разделяет авторизацию, сбор и maintenance. Instagram вызывается только
в workers: process_instagram и одноразовый platform_logout. HTTP валидирует
импортируемую сессию и записывает зашифрованные credentials во временный vault.

Перед изменением проверены структура backend, модели и миграции, HTTP router,
конфигурация и runtime limits, подключение/2FA/отключение, guard и heartbeat,
публикация снимков, recovery и отзыв сессии, тесты и Docker/Compose. Проверены
потребители source во frontend: контракт допускает строку, история различает
архив и автоматический сбор, поэтому новый source не требует изменения API.

## Библиотека и совместимость

Используется стабильная [aiograpi 2.0.15](https://pypi.org/project/aiograpi/2.0.15/),
проверенная через PyPI JSON и опубликованный wheel. Поддерживается Python >=3.10;
проект ограничен Python >=3.14,<3.15. Исходники wheel указывают upstream
instagrapi 3.0.16; прежняя библиотека проекта была 3.0.20. Полная эквивалентность
версий не предполагается. Проверены используемые методы Client, auth, account,
user, password, Bloks/CAA, private/public/GraphQL HTTP-сессии и curl-транспорт.

Зависимость instagrapi удалена из lock; добавлены aiograpi 2.0.15,
orjson 3.13.0, zstandard 0.25.0 и socksio 1.0.0. HTTPX 0.28.1 теперь нужен
в runtime с extra socks для ранее поддерживаемых SOCKS5/SOCKS5H-прокси.
[socksio](https://pypi.org/project/socksio/1.0.0/) поддерживает Python >=3.6;
extra рекомендован [официальной документацией HTTPX](https://www.python-httpx.org/advanced/proxies/#socks).
Версии остальных существующих пакетов сохранены. Extras video/curl не включены:
приватный нативный async curl уже входит в базовую установку; публичный транспорт
использует HTTPX. Poetry lock сформирован штатной Poetry 2.5.1 из Docker.

## Изменения исполнения

- login, account_info, logout и чтение страниц ожидаются как корутины.
- Один asyncio.Runner принадлежит одному заданию Celery и обслуживает все его
  сетевые операции. Соединения не переносятся между event loops.
- Транзакции workers и операции Redis выполняются в существующем синхронном
  orchestration-коде вне event loop. Guard/progress с DB I/O внутри сетевой
  корутины выполняются через asyncio.to_thread, со своей Session на вызов.
- Интервал между запросами использует asyncio.sleep и допускает отмену.
- Все три HTTP-сессии и retired clients закрываются до закрытия event loop,
  включая ошибку и выход в ожидание 2FA.

Это перевод Instagram I/O на асинхронную библиотеку. Prefork Celery по-прежнему
занимает один процесс заданием; миграция не увеличивает автоматически число
одновременных заданий и не снимает ограничения Instagram.

## Сохранённые ограничения и особенности aiograpi

Бюджет, проверка задания перед отправкой, интервалы, proxy, TLS, ограниченные
таймауты и allowlist действуют на private, public и graphql transport.
Sync допускает только чтение собственных списков/сведений, revoke — только
один POST logout. Challenge и 429 останавливают работу без скрытого повтора.

В aiograpi public_request с retries_count=0 не делает запрос. Адаптер вызывает
_send_public_request ровно один раз, также при явном override retries_count.
Приватный _send_private_request умеет повторять HTTP 500, отбрасывая курсор;
адаптер прекращает такой ответ до повторной отправки. Redirect блокируется и
параметром запроса, и default HTTPX: публичная Session удаляет falsy kwargs,
включая follow_redirects=False. Проверены реальные Session + MockTransport.

Сохранённые mobile settings принимают android_device_id и старый device_id;
при создании клиента старый ключ переносится в android_device_id. UUID,
настройки устройства и USDID остаются в зашифрованной сессии. Пароль, код,
proxy, настройки TLS и transport не импортируются в конфигурацию клиента.
Raw sessionid превращается в settings без создания HTTP-сессий на HTTP-валидации.

Новые снимки записывают source=aiograpi и фактическую версию провайдера.
Старый source=instagrapi сохраняет проверку generation/паузы, контроль крупных
изменений и обновление last_sync. Схема БД и ключи шифрования не меняются.

## Проверки

В изолированном штатном dev-контейнере: 90 тестов прошли, отдельный
performance-тест пропущен. Poetry check --lock, Ruff lint/format и Pyright
прошли. На Python 3.14.8/Alpine 3.24 также прошли 90 тестов, один пропущен.
Аудит pip-audit завершился: No known vulnerabilities found.

Локальный dev-образ пересобран; backend, worker, auth-worker, maintenance и
scheduler обновлены. Перед обновлением выполняющихся заданий не было.
Readiness API вернул HTTP 200/ready, три Celery worker ответили на ping,
в backend проверена установленная aiograpi 2.0.15.

Синтетические проверки охватывают бюджет, запрещённые операции, proxy, CAA payload, 429/диагностику,
неполные списки, отсутствие повтора при HTTP 500, redirect, отмену async sleep,
закрытие сессий и перенос UUID. PostgreSQL-тесты проверяют импорт сессии,
сохранение устройства, отзыв и запрет публикации после отмены для обоих source.

Живой вход в Instagram не выполняется в ходе миграции; переход сам по себе
не доказывает устранение ранее наблюдавшегося HTTP 429 при CAA login.
# Локальное тестирование ручных сборов

В compose.dev.yml включён INSTAGRAM_UNLIMITED_TEST_RUNS=true: ручные сборы
не ограничиваются шестичасовым интервалом и суточным числом запусков.
Настройка действует только при APP_ENV=local/development; вне dev-compose
по умолчанию выключена. Для возврата ограничений задайте
INSTAGRAM_UNLIMITED_TEST_RUNS=false и пересоздайте сервисы.
Бюджет запросов, интервалы внутри сбора, провайдерский cooldown и запрет
параллельных сборов одного профиля сохраняются. Автоматическое расписание
не ускоряется: повторные тесты запускаются вручную.

