# ADR-001: границы V1

Статус: применено в реализации; эксплуатационные условия требуют настройки владельцем.

| Решение | Причина | Следствие |
| --- | --- | --- |
| FastAPI + async SQLAlchemy/psycopg в HTTP | Уточнение заказчика: сохранить psycopg, убрать блокирующий I/O | AsyncSession/AsyncConnection; общие ORM helpers через run_sync, Celery синхронный. См. ASYNC.md |
| Общая таблица Job | Единые отмена, heartbeat, recovery | API сохраняет предметные connect/import/sync маршруты |
| SQL counters/anti-join/keyset | До 100 000 строк без полной загрузки на запрос | Пары вычисляются асинхронно, UI показывает ожидание |
| Неофициальный адаптер с транспортным guard | Выбранный пользователем вариант доступа | Риск блокировки остаётся; импорт — независимая альтернатива |
| Раздельные ключи/роли | API не нужен расшифрованный Instagram session | Owner CLI и auth worker защищаются отдельно |
| Независимый ledger | Restore не должен возвращать удалённые данные | Ledger и его ключи хранятся дольше backup window |
| Production S3; новый dev Garage v2.4.1 | Общий API/worker storage проверяется по настоящему S3 | Single-node dev не доказывает production TLS/SSE/lifecycle; старый filesystem env требует миграции |
| Next.js + Tailwind/Radix/RHF/Zod | Набор UI инструментов из ТЗ | Theme/utilities и предметные CSS; общие диалоги Radix, auth/settings RHF/Zod. См. UI.md |
| TS 5.9.3 | Peer compatibility инструментов V1 | Обновлять весь набор совместимо, а не отдельный major |
| Логическая квота | Предсказуемая стоимость пользовательских данных | Дополнительно нужны диск/DB/backup alarms |

Импорт не доказывает владельца архива и фактическую дату; пользователь подтверждает их явно. Исчезновение не устанавливает причину отписки. Смена username без ID не распознаётся как доказанное переименование.


## Уточнения после повторного ревью

- Предыдущее отличие UI-стека устранено: Tailwind/Radix подключены, auth/settings переведены на React Hook Form/Zod. Специальные upload/2FA/операторские формы сохраняют свои состояния; обязательная Pydantic validation остаётся на API. См. UI.md.
- Requests остаётся транспортом instagrapi, boto3 — S3/ledger, SMTP — email. Universal HTTPX не нужен поверх SDK; его dev-зависимость используется только test adapter.
- Локальный S3: [Community MinIO repository](https://github.com/minio/minio) архивирован. [Официальный quick start Garage](https://garagehq.deuxfleurs.fr/documentation/quick-start/) указывает v2.4.1; эта версия зафиксирована. Python зависимостей не добавлено, S3 adapter использует существующий boto3. AGPL-3.0 относится к dev Garage; для production выбран отдельный совместимый private bucket, не single-node dev.
- Admin меняет только ограничения в безопасных env границах. Interval может увеличиваться, request budget/quota — уменьшаться. Расширение предела требует изменения серверного env; это не скрытое снятие политики через браузер.
- Одноразовый logout выполняется из таблицы с ciphertext, доступной только worker. SECURITY DEFINER routine проверяет owner/profile и возвращает boolean; API не видит шифротекст. Capability не восстанавливается из backup и не возобновляет session.
