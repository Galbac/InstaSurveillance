// Первичный русский словарь. Новые локали добавляются с такими же ключами.
export const ru: Record<string, string> = {
  history_cleared: "История этого задания удалена.",
  parsing: "Разбираем файлы",
  committing: "Сохраняем снимок",
  preview_ready: "Предварительный просмотр готов",
  verification_required: "Ожидаем код подтверждения",
  connected: "Аккаунт подключён",
  validating_session: "Проверяем сохранённую сессию",
  fetching_followers: "Получаем подписчиков",
  fetching_following: "Получаем подписки",
  validating_snapshot: "Проверяем полноту списков",
  retry_wait: "Ожидаем повторной обработки",
  stopped: "Обработка остановлена",
  queued: "В очереди",
  uploading: "Загружаем файл",
  running: "Выполняем задание",
  completed: "Готово",
  failed: "Не удалось завершить",
  partial: "Получены неполные данные",
  canceled: "Отменено",
  cancelled: "Отменено",
  expired: "Срок ожидания истёк",
  connecting: "Подключаем аккаунт",
  syncing: "Обновляем данные",
  ownership_not_verified:
    "Принадлежность архива аккаунту не проверяется автоматически. Подтвердите, что это ваша выгрузка.",
  creation_time_not_verified:
    "Дата наблюдения не подтверждается содержимым архива. Укажите фактическую дату выгрузки.",
  username_rename_ambiguous:
    "В архиве нет стабильных ID: переименование может выглядеть как исчезновение и появление аккаунта.",
};
export function message(key: string) {
  return ru[key] || "Обрабатываем данные";
}
