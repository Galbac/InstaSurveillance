# InstaSurveillance

Адаптивный сайт и PWA для анализа собственных подписок Instagram. Монорепозиторий: Python API + фоновые задачи + Next.js. **Основные сценарии V1 реализованы; детали реализации и приёмка ещё не завершены.** Полные требования: [ТЗ.md](ТЗ.md). Выполненное и оставшееся: [docs/STATUS.md](docs/STATUS.md).

## Локальный запуск

Нужны Docker Engine / Docker Desktop с Compose v2 и Python 3 для генератора конфигурации.

```sh
make dev
```

Генератор создаёт `.env.dev` с отдельными случайными ключами, правами `0600`; существующий файл сохраняется. Затем запускаются PostgreSQL, Redis, временное хранилище авторизации, API, четыре процесса Celery, Next.js, Caddy и Mailpit. Миграции выполняются до старта API.

- Сайт: http://localhost:3100
- Демо без аккаунта: http://localhost:3100/demo
- Локальная почта: http://localhost:8026
- API и OpenAPI: http://localhost:8100/api/docs

Создайте аккаунт, откройте письмо в Mailpit, подтвердите адрес. Далее подключите свой Instagram либо загрузите ZIP с JSON-разделами `followers_*.json` и `following.json` из официальной выгрузки за всё время. Первый снимок показывает взаимность; второй позволяет увидеть изменения. Импорт требует подтверждения полноты и даты наблюдения.

```sh
make logs
make test
make check
make frontend-check
make performance
make backup-drill
make down
```

`down` сохраняет данные в Docker volumes. Кэш Python отключён, кэш Next.js и node_modules вынесены в Docker volumes; временные инструменты используют `/tmp`. Не запускайте npm/Poetry на хосте без переноса их кэша за пределы проекта.

## Возможности первой версии

Регистрация и подтверждение email, вход, сброс пароля, управление сессиями в кабинете; подключение Instagram и 2FA; ручной и плановый сбор; импорт и предварительный просмотр; взаимные и невзаимные подписки; история и сравнение; поиск, избранное, заметки; график; CSV/JSON; уведомления; пауза, отключение, удаление аккаунта; светлая/тёмная тема; PWA с безопасной офлайн-заглушкой.

Автоматический сбор использует неофициальный `instagrapi`. Гарантировать отсутствие блокировок невозможно. Программа прекращает запросы при challenge, 429, неполных списках и исчерпании бюджета. Не выполняет подписок, отписок, лайков или рассылок. Настройки запросов — в `.env`; безопасные значения по умолчанию: 24 часа, минимум 6 часов между ручными попытками, максимум 2 запуска/сутки, бюджет 100 запросов с интервалом 2 секунды. Пароль Instagram находится только во временном зашифрованном Redis, максимум 10 минут, не попадает в аргументы очереди или постоянную БД. Ключ сохранённых сессий отсутствует в процессе API.

## Структура

```text
backend/       FastAPI, SQLAlchemy, Alembic, Celery, адаптеры, тесты, Poetry lock
frontend/      Next.js App Router, TypeScript, стили, PWA, npm lock
compose.dev.yml  отдельное окружение разработки
compose.prod.yml отдельная схема production
.env.*.example   документированные настройки без рабочих секретов
deploy/        Caddy, создание роли PostgreSQL, генератор dev env
docs/          решения, статус и эксплуатация
ТЗ.md          согласованные требования
```

## Production

Порядок настройки описан в [docs/OPERATIONS.md](docs/OPERATIONS.md). Production использует приватный внешний S3 и SMTP с TLS, HTTPS и Secure cookies. `.env.prod.example` — шаблон, а не готовая конфигурация. До публичного запуска необходимо закрыть пункты из STATUS, заполнить сведения оператора, подключить внешние backup/S3/SMTP и пройти проверку на целевом сервере.

Версии зафиксированы в lock-файлах. Изменять зависимости следует через Poetry / npm с проверкой совместимости и advisory; [архитектурные решения](docs/ARCHITECTURE.md) объясняют выбор стека. Не передавайте `.env`, Instagram-пароли, cookie/session dumps или пользовательские архивы в git и логи.

`INSTAGRAM_PROXY_URL` задаёт постоянный HTTP(S)/SOCKS5 маршрут Instagram в `.env`.
Он передаётся только worker-процессам и применяется к подключению, сбору и отзыву
сессии. Пустое значение оставляет прямое соединение. Сохраняйте маршрут аккаунта
при восстановлении сессии; смена адреса или наличие прокси не гарантируют вход.

## Дополнительные функции V1

Асинхронные сравнения и экспорты, bulk избранное, фильтры и периоды, timezone, смена email и пароля, устройство/отзыв сессии, support replies, admin/support с MFA, журнал согласий и аудита, независимый deletion ledger, шифрованные backups и безопасный restore, метрики/алерты и CI. Контракт [73 API операций](docs/API.md), отчёты [проверок](docs/STATUS.md). Реальный Instagram login/2FA/session restore пользователь проверит отдельно.


## Завершение повторного ревью

Сверка 14 групп доработок и границы приёмки: [docs/TZ-AUDIT.md](docs/TZ-AUDIT.md).

- `make frontend-check` — unit tests, lint, types, production build.
- `make performance` — изолированная нагрузка на Python/Alpine runtime production, отчёт `performance-alpine.json`.
- `make s3-drill` — настоящий локальный S3: multipart, чтение, удаление, anonymous denial.
- Новый `make setup` создаёт S3/Garage dev env. Старый filesystem env сохраняет режим до миграции файлов.
- PWA update запрашивает явную перезагрузку и ждёт окончания загрузки/отмены выбранных файлов. Очистка истории доступна в настройках с сохранением подключения.

Browser/device, live Instagram и публичная cloud приёмка перечислены отдельно; локальные PASS их не заменяют.

### Асинхронная работа backend

HTTP использует native async psycopg и SQLAlchemy AsyncSession; Redis — asyncio, SDK/файлы/Argon2 работают вне event loop. Общие ORM helpers сохранены через штатный run_sync, Celery выполняет sync транзакции. [Устройство и правила расширения](docs/ASYNC.md).

Read-only публичная проверка: `python3 deploy/scripts/verify-public.py --url https://YOUR_DOMAIN --report /secure/insta/public-http.json`.

UI использует Tailwind, Radix Dialog, React Hook Form/Zod в auth/settings. [Стек и browser/device приёмка](docs/UI.md).
