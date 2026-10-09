# Staging на отдельном сервере

Использует production-образы и отдельное Compose-переопределение
`compose.staging.yml`. Версия instagrapi остаётся 3.0.20.

Это среда для проверки подключения и интерфейса: файлы и журнал удаления
хранятся в локальных Docker volumes, письма перехватывает Mailpit.
Внешние SMTP, S3 и независимые резервные копии здесь не настроены.
Фиксированный локальный код 1234 не действует: подтверждение идёт по письму.

## Расположение

- Код: `/opt/instasurveillance`, ветка `dev`.
- Секреты: `/etc/instasurveillance/staging.env`, права 0600.
- Приложение публикуется только через Caddy на 80/443 с HTTPS.
- PostgreSQL, Redis и auth-vault не имеют опубликованных портов.
- Mailpit публикует интерфейс только на `127.0.0.1:8025`.

Для просмотра тестовых писем:

```sh
ssh -L 8025:127.0.0.1:8025 root@46.8.233.246
```

Затем открыть `http://localhost:8025` на своём компьютере. Mailpit содержит
ссылки подтверждения и восстановления; не публиковать его в интернете.

## Запуск и обновление

```sh
cd /opt/instasurveillance
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml config --quiet
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml build backend frontend
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml up -d db redis auth-vault mail
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml run --rm migrate
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml run --rm --no-deps --user 0 \
  --cap-add CHOWN --cap-add FOWNER backend \
  sh -c 'mkdir -p /uploads /ledger && chown 10001:10001 /uploads /ledger && chmod 700 /uploads /ledger'
docker compose --env-file /etc/instasurveillance/staging.env \
  -f compose.prod.yml -f compose.staging.yml up -d --wait --wait-timeout 180
```

Окружение создаётся из `.env.prod.example` с новыми случайными ключами.
Для staging установить `STORAGE_BACKEND=filesystem`, `SMTP_HOST=mail`,
`SMTP_PORT=1025`, `SMTP_TLS_MODE=none`, пустые SMTP_USERNAME/SMTP_PASSWORD.
Настроить настоящий HTTPS APP_BASE_URL, APP_DOMAIN, TRUSTED_HOSTS и secure
cookie. Поля резервного S3 требуются для разбора базового Compose, но сервис
backup отключён профилем `production-only`: не считать эти поля настроенной
системой резервного копирования.

Перед обновлением сделать независимую копию базы и локальных volumes.
Не выполнять `down -v`: эта команда удаляет данные.

## Переход в production

Подготовить собственный домен, SMTP с TLS, приватный S3 с серверным
шифрованием, независимые хранилища журнала удаления и резервных копий,
данные оператора и мониторинг. Затем использовать только `compose.prod.yml`
и production-процедуру из `docs/OPERATIONS.md`. Docker volumes staging и
production имеют разные префиксы: данные не перенесутся автоматически.
Перенос требует резервной копии, восстановления и проверки ключей шифрования.

Сервер с 1 ГБ RAM подходит для ограниченной проверки. Swap помогает сборке,
но не заменяет память для публичной нагрузки. Ограничить WORKER_CONCURRENCY,
DB_POOL_SIZE и DB_MAX_OVERFLOW через окружение.
