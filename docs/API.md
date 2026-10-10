# HTTP API V1

Авторитетный машинный контракт: [OpenAPI](api/openapi.json). TypeScript contract: `frontend/src/lib/generated-api.ts`. Перегенерация: `make schema`.

Сессия — HttpOnly cookie. Изменяющие запросы требуют CSRF token и допустимый Origin. `Idempotency-Key` — UUID команды; повторять тот же ключ только с тем же payload. Частные ответы `Cache-Control: no-store`. Ошибка: код, безопасный текст и request ID. Неверный чужой ресурс возвращает 404. Асинхронные операции возвращают Job/ресурс и опрашиваются до конечного статуса.

| Метод | Путь | Операция |
| --- | --- | --- |
| GET | `/api/v1/admin/audit` | Audit Events (admin only) |
| GET | `/api/v1/admin/auth/status` | Admin MFA & Privilege Status |
| POST | `/api/v1/admin/auth/mfa/challenge` | MFA Challenge (TOTP/recovery code) |
| GET | `/api/v1/admin/jobs` | Operator Jobs List |
| GET | `/api/v1/admin/jobs/{job_id}` | Operator Job Technical Details |
| POST | `/api/v1/admin/jobs/{job_id}/retry` | Retry Job (admin only) |
| GET | `/api/v1/admin/limits` | Global Runtime Limits |
| PATCH | `/api/v1/admin/limits` | Tighten Runtime Limits (admin only) |
| GET | `/api/v1/admin/overview` | Admin Dashboard KPI Overview |
| GET | `/api/v1/admin/profiles` | Instagram Profiles Directory |
| GET | `/api/v1/admin/profiles/{profile_id}` | Instagram Profile Diagnostics |
| POST | `/api/v1/admin/profiles/{profile_id}/pause` | Pause Profile Sync (admin only) |
| POST | `/api/v1/admin/profiles/{profile_id}/resume` | Resume Profile Sync (admin only) |
| GET | `/api/v1/admin/support/tickets` | Support Tickets Directory |
| GET | `/api/v1/admin/support/tickets/{ticket_id}` | Support Ticket Details & Thread |
| PATCH | `/api/v1/admin/support/tickets/{ticket_id}` | Support Ticket Reply & Status |
| GET | `/api/v1/admin/system` | System Infrastructure & Storage Health (admin only) |
| GET | `/api/v1/admin/users` | Users Directory |
| GET | `/api/v1/admin/users/{user_id}` | User Details & Storage Quota |
| POST | `/api/v1/admin/users/{user_id}/restore` | Restore Suspended User (admin only) |
| POST | `/api/v1/admin/users/{user_id}/suspend` | Suspend User (admin only) |
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
| GET | `/api/v1/me/email-deliveries` | Owner-scoped email delivery metadata, keyset pagination |
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
| POST | `/api/v1/profiles/{profile_id}/history/delete` | Очистка истории снимков/сравнений |
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
| GET | `/api/v1/jobs/{job_id}` | Статус задания своего пользователя |
| GET | `/api/v1/syncs/{job_id}` | Get Job |
| POST | `/api/v1/syncs/{job_id}/cancel` | Cancel Sync |

Списки используют `items`, `next_cursor`. Размер страницы по умолчанию 50, максимум 100. Курсор нельзя использовать с другими фильтрами или владельцем. История, люди, события, уведомления, support и операторские списки имеют собственные фильтры. Подробные input/output схемы и HTTP статусы находятся в OpenAPI (всего 88 операций).

В V1 нет публичного endpoint назначения ролей, массовых действий Instagram, отправки credentials в Celery payload или чтения session settings оператором. Смена роли и восстановление MFA выполняются protected CLI.

## Административный API и матрица прав (RBAC)

Все административные маршруты защищены серверной проверкой ролей (`admin`, `support`), CSRF-защитой и 15-минутным привилегированным окном MFA (`privileged_until`).

### Жизненный цикл сессии оператора
1. **Bootstrap / Проверка сессии**: `GET /api/v1/admin/auth/status` доступен операторам с ролями `admin` и `support` без требования активного привилегированного окна. Позволяет веб-интерфейсу проверить наличие сессии и статус MFA (`privileged_until`).
2. **MFA Challenge**: `POST /api/v1/admin/auth/mfa/challenge` принимает 6-значный TOTP-код или 32-значный резервный код (`recovery_code`). При успехе продлевает `privileged_until` в текущей сессии на 15 минут.
3. **Истечение привилегий**: По истечении 15 минут все защищённые эндпоинты возвращают `403 Forbidden` (`code: mfa_required`). Клиент автоматически блокирует интерфейс, очищает кэш запросов TanStack Query и отображает диалог повторного ввода MFA.

### Матрица прав доступа

| Раздел / Ресурс | Маршрут | Метод | `admin` | `support` | Аудит и ограничения |
| --- | --- | --- | :---: | :---: | --- |
| **Auth Status** | `/api/v1/admin/auth/status` | `GET` | ✅ | ✅ | Проверка роли и таймера без требования MFA |
| **MFA Challenge** | `/api/v1/admin/auth/mfa/challenge` | `POST` | ✅ | ✅ | Продлевает привилегии на 15 минут |
| **Обзор (KPI)** | `/api/v1/admin/overview` | `GET` | ✅ | ✅ | Сводные метрики пользователей, профилей, ошибок и очередей |
| **Пользователи: список** | `/api/v1/admin/users` | `GET` | ✅ | ✅ | Фильтры по статусу/роли, поиск по email, cursor |
| **Пользователи: карточка** | `/api/v1/admin/users/{id}` | `GET` | ✅ | ✅ | Профили пользователя, занятое хранилище, ожидающие удаления |
| **Пользователи: блокировка** | `/api/v1/admin/users/{id}/suspend` | `POST` | ✅ | ❌ (403) | Причина ≥ 5 символов, отзыв всех сессий, аудит `users.suspend` |
| **Пользователи: разблокировка**| `/api/v1/admin/users/{id}/restore` | `POST` | ✅ | ❌ (403) | Причина ≥ 5 символов, аудит `users.restore` |
| **Профили: список** | `/api/v1/admin/profiles` | `GET` | ✅ | ✅ | Поиск по username, статус подключения, флаг частичного сбора |
| **Профили: карточка** | `/api/v1/admin/profiles/{id}` | `GET` | ✅ | ✅ | История последних 5 снимков, полнота followers, задачи |
| **Профили: пауза** | `/api/v1/admin/profiles/{id}/pause` | `POST` | ✅ | ❌ (403) | Причина ≥ 5 символов, инкремент `generation`, аудит `instagram_profiles.pause` |
| **Профили: возобновление** | `/api/v1/admin/profiles/{id}/resume` | `POST` | ✅ | ❌ (403) | Причина ≥ 5 символов, инкремент `generation`, аудит `instagram_profiles.resume` |
| **Задания: список** | `/api/v1/admin/jobs` | `GET` | ✅ | ✅ | Фильтры по типу/статусу, безопасные детали без секретов/токенов |
| **Задания: карточка** | `/api/v1/admin/jobs/{id}` | `GET` | ✅ | ✅ | Технические детали, статус `can_retry` и `retry_reason` |
| **Задания: повтор** | `/api/v1/admin/jobs/{id}/retry` | `POST` | ✅ | ❌ (403) | Политика `evaluate_job_retry`: только сбои с attempts < 3, аудит `jobs.retry` |
| **Поддержка: тикеты** | `/api/v1/admin/support/tickets` | `GET` | ✅ | ✅ | Фильтры по статусу (`open`, `in_progress`, `closed`), email |
| **Поддержка: карточка** | `/api/v1/admin/support/tickets/{id}`| `GET` | ✅ | ✅ | История сообщений, email пользователя |
| **Поддержка: ответ** | `/api/v1/admin/support/tickets/{id}`| `PATCH` | ✅ | ✅ | Ответ пользователю, смена статуса, отправка email-уведомления |
| **Инфраструктура** | `/api/v1/admin/system` | `GET` | ✅ | ❌ (403) | Задержка БД, статус диска/S3, объем файлов, outbox queue |
| **Журнал аудита** | `/api/v1/admin/audit` | `GET` | ✅ | ❌ (403) | Фильтры по action и target_id, cursor, просмотр metadata |
| **Лимиты: просмотр** | `/api/v1/admin/limits` | `GET` | ✅ | ✅ | Текущие глобальные лимиты (квоты, rate-limits, retention) |
| **Лимиты: ужесточение** | `/api/v1/admin/limits` | `PATCH` | ✅ | ❌ (403) | Только уменьшение значений (ужесточение), аудит `runtime_limits.tighten` |

### Безопасность и минимизация данных
- **Никаких утечек секретов**: Ни один эндпоинт не возвращает cookie-сессии Instagram, пароли, DSN базы данных, переменные окружения, seed-ключи TOTP или приватные ссылки на хранилище.
- **Маскирование деталей заданий**: Поле `details` очищается белым списком безопасных диагностических ключей (`stage`, `provider_http_status`, `error_type`, `processed_items`, `duration_seconds`).
- **Строгая валидация причин**: Все мутирующие операции администратора требуют обязательное поле `reason` длиной не менее 5 символов и фиксируются в неизменяемом журнале аудита `audit_events`.

