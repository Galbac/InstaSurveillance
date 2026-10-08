# HTTP API V1

Авторитетный машинный контракт: [OpenAPI](api/openapi.json). TypeScript contract: `frontend/src/lib/generated-api.ts`. Перегенерация: `make schema`.

Сессия — HttpOnly cookie. Изменяющие запросы требуют CSRF token и допустимый Origin. `Idempotency-Key` — UUID команды; повторять тот же ключ только с тем же payload. Частные ответы `Cache-Control: no-store`. Ошибка: код, безопасный текст и request ID. Неверный чужой ресурс возвращает 404. Асинхронные операции возвращают Job/ресурс и опрашиваются до конечного статуса.

| Метод | Путь | Операция |
| --- | --- | --- |
| GET | `/api/v1/admin/audit` | Events |
| POST | `/api/v1/admin/auth/mfa/challenge` | Challenge |
| GET | `/api/v1/admin/jobs` | Jobs |
| POST | `/api/v1/admin/jobs/{job_id}/retry` | Retry |
| GET | `/api/v1/admin/overview` | Overview |
| GET | `/api/v1/admin/support/tickets` | Tickets |
| PATCH | `/api/v1/admin/support/tickets/{ticket_id}` | Reply |
| GET | `/api/v1/admin/users` | Users |
| POST | `/api/v1/admin/users/{user_id}/restore` | Restore |
| POST | `/api/v1/admin/users/{user_id}/suspend` | Suspend |
| GET | `/api/v1/auth/csrf` | Get Csrf |
| POST | `/api/v1/auth/forgot-password` | Forgot |
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/logout` | Logout |
| POST | `/api/v1/auth/register` | Register (202; 409 if email is already registered) |
| POST | `/api/v1/auth/resend-verification` | Resend |
| POST | `/api/v1/auth/reset-password` | Reset |
| POST | `/api/v1/auth/verify-email` | Verify Email |
| GET | `/api/v1/comparisons/{comparison_id}` | Comparison Status |
| GET | `/api/v1/comparisons/{comparison_id}/events` | Comparison Events |
| GET | `/api/v1/config/public` | Public Config |
| POST | `/api/v1/exports` | Create Export |
| GET | `/api/v1/exports/{export_id}` | Export Status |
| GET | `/api/v1/exports/{export_id}/download` | Download |
| GET | `/api/v1/health/live` | Live |
| GET | `/api/v1/health/ready` | Ready |
| GET | `/api/v1/imports/{job_id}` | Get Job |
| POST | `/api/v1/imports/{job_id}/cancel` | Cancel Import |
| POST | `/api/v1/imports/{job_id}/confirm` | Confirm |
| DELETE | `/api/v1/instagram/connection-attempts/{job_id}` | Cancel Connection |
| GET | `/api/v1/instagram/connection-attempts/{job_id}` | Get Job |
| POST | `/api/v1/instagram/connection-attempts/{job_id}/verify` | Verify Connection |
| POST | `/api/v1/instagram/connections` | Connect |
| GET | `/api/v1/me` | Me |
| PATCH | `/api/v1/me` | Preferences |
| POST | `/api/v1/me/change-password` | Change |
| POST | `/api/v1/me/email-change` | Change Email |
| POST | `/api/v1/me/email-change/confirm` | Confirm Email Change |
| GET | `/api/v1/me/notification-settings` | Notification Settings |
| PATCH | `/api/v1/me/notification-settings` | Set Notification Settings |
| GET | `/api/v1/me/sessions` | Sessions |
| POST | `/api/v1/me/sessions/revoke-others` | Revoke Others |
| DELETE | `/api/v1/me/sessions/{session_id}` | Revoke |
| GET | `/api/v1/notifications` | Notifications |
| POST | `/api/v1/notifications/read` | Read Notifications |
| POST | `/api/v1/privacy/delete-account` | Delete Account |
| GET | `/api/v1/privacy/requests/{request_id}` | Deletion Status |
| GET | `/api/v1/profiles` | Profiles |
| POST | `/api/v1/profiles` | Add Profile |
| DELETE | `/api/v1/profiles/{profile_id}` | Delete Profile |
| PATCH | `/api/v1/profiles/{profile_id}` | Metadata |
| GET | `/api/v1/profiles/{profile_id}/analytics` | Analytics |
| POST | `/api/v1/profiles/{profile_id}/annotations/bulk` | Bulk Favorites |
| DELETE | `/api/v1/profiles/{profile_id}/annotations/{identity_key}` | Delete Annotation |
| PUT | `/api/v1/profiles/{profile_id}/annotations/{identity_key}` | Annotate |
| POST | `/api/v1/profiles/{profile_id}/comparisons` | Compare Snapshots |
| DELETE | `/api/v1/profiles/{profile_id}/connection` | Disconnect |
| GET | `/api/v1/profiles/{profile_id}/connection` | Connection Status |
| PATCH | `/api/v1/profiles/{profile_id}/connection` | Pause |
| POST | `/api/v1/profiles/{profile_id}/connection/reconnect` | Reconnect |
| POST | `/api/v1/profiles/{profile_id}/imports` | Upload |
| GET | `/api/v1/profiles/{profile_id}/people` | People |
| GET | `/api/v1/profiles/{profile_id}/period-snapshots` | Period Snapshots |
| GET | `/api/v1/profiles/{profile_id}/snapshots` | History |
| GET | `/api/v1/profiles/{profile_id}/summary` | Summary |
| GET | `/api/v1/profiles/{profile_id}/syncs` | Sync History |
| POST | `/api/v1/profiles/{profile_id}/syncs` | Sync |
| DELETE | `/api/v1/snapshots/{snapshot_id}` | Delete Snapshot |
| GET | `/api/v1/snapshots/{snapshot_id}` | Snapshot Detail |
| GET | `/api/v1/support/tickets` | Own Tickets |
| POST | `/api/v1/support/tickets` | Create Ticket |
| GET | `/api/v1/syncs/{job_id}` | Get Job |
| POST | `/api/v1/syncs/{job_id}/cancel` | Cancel Sync |

Списки используют `items`, `next_cursor`. Размер страницы по умолчанию 50, максимум 100. Курсор нельзя использовать с другими фильтрами или владельцем. История, люди, события, уведомления, support и операторские списки имеют собственные фильтры. Подробные input/output схемы и HTTP статусы находятся в OpenAPI.

В V1 нет публичного endpoint назначения ролей, массовых действий Instagram, отправки credentials в Celery payload или чтения session settings оператором. Смена роли и восстановление MFA выполняются protected CLI.


## Новые ресурсы повторного ревью

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | `/api/v1/admin/limits` | Текущие эффективные глобальные ограничения, admin/support с MFA |
| PATCH | `/api/v1/admin/limits` | Ужесточение ограничений, только admin, причина и audit обязательны |
| GET | `/api/v1/admin/jobs/{job_id}` | Безопасный технический статус задания для оператора |
| GET | `/api/v1/jobs/{job_id}` | Статус задания своего пользователя |
| POST | `/api/v1/profiles/{profile_id}/history/delete` | Очистка снимков/сравнений/preview, отмена jobs/exports, сохранение подключения/заметок; password + `УДАЛИТЬ` |
| GET | `/api/v1/me/email-deliveries` | Owner-scoped email delivery metadata, keyset pagination |

Очистка истории возвращает `DeletionDTO` и Location квитанции. File download описан как binary CSV/JSON, не как произвольный JSON DTO. Полный список — 79 операций в OpenAPI; основные клиентские типы генерируются из него.
