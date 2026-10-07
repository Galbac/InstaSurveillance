# Зависимости V1

Версии зафиксированы в Poetry/npm lock, официальные PyPI/npm/release metadata проверялись при выборе. Runtime Python 3.14, Node 24; сборка на Linux ARM64. Проверки на другой целевой архитектуре должны выполняться в CI/на сервере.

| Набор | Решение |
| --- | --- |
| API | FastAPI 0.142.2, SQLAlchemy 2.1.3, psycopg 3.3.6, Alembic 1.20.0 |
| Tasks | Celery 5.6.3, redis client 8.1.0 |
| Instagram | instagrapi 3.0.20; pydantic 2.13.5 соответствует <2.14 |
| Frontend | Next 16.4.0, React 19.3.0; TypeScript 5.9.3 совместим с eslint/OpenAPI tools |
| Checks | Ruff 0.16.10, Pyright 1.1.414, pytest 9.1.1, pip-audit 2.10.1 |
| Infrastructure | PostgreSQL 18; Alpine client 18.6 для backup; Redis 8; Caddy 2.10.2; Prometheus 3.15.0; Alertmanager 0.34.1 |

Poetry build tooling отсутствует в финальном prod Python runtime: зависимости из /opt/venv. Node dev tooling не является работающим frontend server в prod; Next standalone использует отдельный непривилегированный пользователь.

`python-audit.json` и `npm-audit.json` — отчёты известной advisory базы на момент выполнения, не гарантии будущей безопасности. CI повторяет аудит. Base-image/OS advisory scan выполнен; результаты и release gate описаны в [IMAGE-SECURITY](IMAGE-SECURITY.md). Повторять на фактическом release и целевой архитектуре.

Лицензии инвентаризованы в `reports/python-licenses.json` и `reports/frontend-licenses.json`. psycopg/binary и libvips имеют LGPL условия, certifi — MPL; собственные модификации этих библиотек не вносились. Dulwich относится к tooling и допускает альтернативу Apache. Локальный Inter поставляется с OFL license в public/fonts. Инвентаризация metadata не заменяет проверку обязательств при распространении контейнеров и actual selected platform binaries. Redis 8 имеет отдельные лицензионные варианты; владельцу нужно выбрать и соблюдать применимый вариант для своей модели распространения/хостинга. Сервис не перепродаёт Redis как отдельный продукт.

Рутинное обновление: проверить official stable/Python support/peer dependencies → минимальное изменение → lock → tests/type/build/audit → release notes. Не обновлять несвязанные пакеты для удаления предупреждений.

Официальные источники лицензий: [Redis licenses](https://redis.io/legal/licenses/), [Psycopg source license](https://github.com/psycopg/psycopg/blob/master/LICENSE.txt).

Production backend/backup используют [официальный Python 3.14.8 Alpine 3.24](https://github.com/docker-library/official-images/blob/master/library/python); build и runtime имеют одинаковую musl ABI. Debian /opt/venv не копируется в Alpine. [postgresql18-client 18.6-r0](https://pkgs.alpinelinux.org/package/v3.24/main/aarch64/postgresql18-client) соответствует major сервера; зафиксированные Python зависимости не обновлялись. Полные tests и read-only/nonroot restore проверены на ARM64; amd64 проверяется на целевом сервере.

Security revision zlib 1.3.2-r1 проверена через официальный APK index (`apk policy zlib`); production Dockerfile требуют `zlib>=1.3.2-r1`, устраняя CVE-2026-85091. Python/npm lock при этом не менялись.


## Дополнение dev tooling

Garage v2.4.1 — отдельный официальный dev image с AGPL-3.0, версия сверена с официальным quick start; не добавляет Python/npm зависимостей и не является выбранным production object store. Prettier 3.9.9 использован разово для оформления frontend через временный Docker `/tmp` cache; registry stable/Node engine проверены, package.json/lock dependencies не менялись. Frontend unit checks используют уже закреплённый TypeScript compiler и встроенные Node test/VM, без нового test framework.

Async HTTP: включён `sqlalchemy[asyncio]` 2.1.3; единственная новая transitive dependency — greenlet 3.5.6. Стабильная версия и Python >=3.10 проверены на PyPI 7 октября 2026; CPython 3.14 musl/macOS wheels доступны. Прежние зависимости не обновлены. См. [ASYNC.md](ASYNC.md).

UI additions по ТЗ: Tailwind/@tailwindcss/postcss 4.3.3, @radix-ui/react-dialog 1.2.0, react-hook-form 7.89.0, zod 4.6.5, @hookform/resolvers 5.9.1. Stable/peers/Node compatibility проверены в official npm registry; React 19/Node24 совместимы. Lock обновлён, npm ci/audit выполнены. [UI.md](UI.md) описывает применение и browser QA. Greenlet license metadata: MIT AND PSF-2.0.
