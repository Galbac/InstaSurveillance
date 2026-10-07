# Закрытие доработок по повторной сверке ТЗ

Обновлено: 8 октября 2026. Исходное ревью сохранено в [TZ-AUDIT-initial.md](TZ-AUDIT-initial.md). Этот отчёт описывает внесённые изменения и пределы проверки; исходное ТЗ не переписано задним числом.

## Реализация G-01…G-14

| Пункт | Сделано | Подтверждение |
| --- | --- | --- |
| G-01 | Local disconnect фиксируется до обращения к auth-vault; bounded cleanup. Одноразовый best-effort logout через auth worker, без повторного входа/challenge/retry. API не читает session ciphertext | PostgreSQL outage/one-shot tests; реальные grants проверены. Platform logout проверен с подставным транспортом |
| G-02 | CSV учитывает relation/type/search и выбранный sort людей | Содержимое реально сформированных CSV проверено integration tests |
| G-03 | Уведомление о waiting SW, явное обновление, запрет перезагрузки при выбранных файлах/загрузке, cleanup listeners | Семь frontend unit checks включают upload activity, SW и cancellation. Проверка на устройствах остаётся |
| G-04 | График фактического изменения между снимками и сравнение двух диапазонов. При недостатке наблюдений — прочерки и объяснение | Strict analytics contract, typecheck/build; браузерная приёмка не выполнена |
| G-05 | Changes/Analytics сохраняют фильтры и диапазоны в URL; invalid date values игнорируются; native history обновляет Next search params | Клиент компилируется; reload/back/forward предстоит проверить в браузере |
| G-06 | Admin/support видят текущие лимиты; только admin с MFA меняет ограничения, с причиной/audit. Env задаёт предел безопасной политики. Квоты используют bigint | Integration tests запрещают ослабление и изменения ролью support; миграции 0010/0012 |
| G-07 | Очистка всей истории отдельной командой с паролем/подтверждением, квитанцией и статусом. Подключение/заметки сохраняются. Отменяются задания и экспорты, очищаются preview samples/counts. Restore учитывает cutoff | Integration tests: idempotency, ledger outage, сохранение профиля/сессии, отмена export, future snapshot после cutoff. Реальный backup drill проверяет replay |
| G-08 | Mobile bottom sheet для фильтров, skeleton, aria/focus/native dialog и reduced-motion | Lint/typecheck/build; 320px, клавиатура, contrast/text zoom требуют browser QA |
| G-09 | Обзор показывает последний import, дату и состояние, со ссылкой на job | SummaryDTO и компонент; синтетический HTTP workflow |
| G-10 | Owner-scoped технический статус email, UI в настройках, bounded retry jitter | Integration test изоляции/редактирования полей. Принятие SMTP не называется прочтением письма |
| G-11 | Generated OpenAPI DTO вместо ручных основных feature/admin типов, строгие response models, binary download contract, TanStack AbortSignal передаётся в fetch | Генерация, backend/frontend typecheck; unit проверяет cancellation. Общий Page helper остаётся структурным контейнером |
| G-12 | Composite FK запрещают пару разных профилей; nullable source_timestamp сохраняется отдельно от observed_at и включён в JSON | Constraints/parser tests; миграция 0009 |
| G-13 | Parsing duration, DB/storage up, volume exporter для DB/scratch/backup staging, bucket usage/quota. Опциональные отдельные exporters private/backup object-store capacity; новые alerts | Реальные API и Garage probes, nonroot volume probe, promtool rule tests. Доставка внешнего webhook/cloud monitoring ещё не проверена |
| G-14 | Location для 2FA/disconnect/cancel/retry и повторов idempotent async commands; status endpoints владельца/оператора | Integration tests и OpenAPI. Нейтральные auth 202 остаются без раскрытия чувствительного ресурса |

## Дополнительные исправления

- Ручное сравнение сразу ставит уже существующую автоматическую пару в очередь, не ждёт очередного запуска scheduler.
- Pending deletion idempotency резервируется до ledger I/O: параллельный повтор не создаёт второй history cutoff. При отказе ledger резерв освобождается, данные остаются доступны; при прерывании резерв истекает через минуту.
- После ужесточения минимального sync interval scheduler учитывает новый минимум и последний сбор; изменение лимита не запускает Instagram запросы.
- Session logout capability действует 120 секунд, потребляется перед единственной попыткой I/O, очищается maintenance и исключена из backup.

## Что проверено

66 backend tests PASS, отдельный load test PASS; 7 frontend unit tests PASS. Ruff/Pyright/Poetry lock, ESLint/TypeScript/Next build прошли. Проверены clean start с пустыми volumes и новым env, полный HTTP/Mailpit/Redis/Celery workflow, private S3 multipart/read/delete/anonymous denial, encrypted restore с deletion replay. Отчёты: [reports](reports/).

Локальная нагрузка на Python 3.14.8/Alpine: 1000 зарегистрированных synthetic users, 100 одновременных пользователей, 500 запросов, 100k members; p95 0,631 с, ошибок 0. Это ASGI TestClient с отдельной test DB/pool, без TLS/proxy/network, а не производственная cloud приёмка.

## Технологические отличия от первоначального ТЗ

Функциональные доработки выше реализованы. По новому указанию заказчика HTTP переведён на async SQLAlchemy/psycopg; детали и границы — [ASYNC.md](ASYNC.md). UI-стек приведён к Tailwind/Radix и RHF/Zod для auth/settings; предметные CSS и специальные формы сохраняются, см. [UI.md](UI.md). SDK транспорта вместо общего HTTPX сохраняют существующую архитектуру. Garage используется вместо архивированного MinIO. Причины и последствия — [ADR-001](adr/001-v1-decisions.md). Это запись факта реализации, а не подтверждение согласования замен заказчиком.

Новый dev env использует S3/Garage v2.4.1. Community MinIO архивирован; выбор поддерживаемого локального S3 оформлен в ADR. Существующий filesystem env сохраняется до явной миграции данных; `make s3-drill` проверяет S3 независимо. Production требует отдельный private S3 с TLS/SSE и внешние ledger/backup buckets; single-node Garage dev не используется как production хранилище.

## Оставшаяся приёмка

1. Browser/device QA: 320px и остальные размеры, a11y/zoom, URL navigation, мобильная установка и PWA update. Runtime Browser не предоставил доступных браузеров.
2. Реальные Instagram login/2FA/session restore/logout — ранее отложены пользователем.
3. Публичный cloud стенд: домен/TLS, SMTP, private S3/SSE/lifecycle, off-host backup, webhook delivery, Web Vitals, нагрузка на согласованном сервере и RPO/RTO. Доступы и реквизиты оператора не предоставлены.

Эти пункты не отмечены PASS. Завершение кода не означает завершения публичной приёмки A-01…A-35.
