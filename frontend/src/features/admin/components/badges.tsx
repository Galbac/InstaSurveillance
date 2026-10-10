"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

export function InstagramIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function CopyableId({ id, length = 8 }: { id: string; length?: number }) {
  const [copied, setCopied] = useState(false);

  const shortId = id.length > length * 2 ? `${id.slice(0, length)}…${id.slice(-4)}` : id;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Скопировать полный ID: ${id}`}
      className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-600 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 px-2 py-0.5 rounded transition-colors group"
    >
      <span>{shortId}</span>
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-purple-600 shrink-0" />
      )}
    </button>
  );
}

export function UserStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Активен
        </span>
      );
    case "suspended":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Заблокирован
        </span>
      );
    case "deleting":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Удаляется
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          {status}
        </span>
      );
  }
}

export function RoleBadge({ role }: { role: string }) {
  switch (role) {
    case "admin":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
          Администратор
        </span>
      );
    case "support":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
          Поддержка
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          Пользователь
        </span>
      );
  }
}

export function ProfileStatusBadge({
  status,
  paused,
  hasCooldown,
}: {
  status: string;
  paused: boolean;
  hasCooldown?: boolean;
}) {
  if (paused) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        На паузе
      </span>
    );
  }
  if (hasCooldown) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
        Ожидание лимита
      </span>
    );
  }
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Активен
        </span>
      );
    case "reconnect_required":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Требуется вход
        </span>
      );
    case "disconnected":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          Не подключён
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          {status}
        </span>
      );
  }
}

export function JobStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "succeeded":
    case "completed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Завершено
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Ошибка
        </span>
      );
    case "processing":
    case "running":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
          Выполняется
        </span>
      );
    case "connecting":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
          Подключение…
        </span>
      );
    case "syncing":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 animate-pulse">
          Сбор данных…
        </span>
      );
    case "parsing":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200 animate-pulse">
          Обработка…
        </span>
      );
    case "uploading":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 animate-pulse">
          Загрузка…
        </span>
      );
    case "queued":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
          В очереди
        </span>
      );
    case "cooldown":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
          Защитная пауза
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Частичный
        </span>
      );
    case "awaiting_2fa":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Ожидает 2FA
        </span>
      );
    case "stopped":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          Остановлено
        </span>
      );
    case "cancelled":
    case "canceled":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          Отменено
        </span>
      );
    case "timeout":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Таймаут
        </span>
      );
    case "expired":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          Истекло
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          {status}
        </span>
      );
  }
}

export function JobKindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    import: "Импорт архива",
    comparison: "Сравнение снимков",
    export: "Экспорт данных",
    connect: "Подключение",
    connection: "Подключение",
    sync: "Сбор данных",
    delete: "Удаление данных",
    parsing: "Обработка архива",
  };
  return (
    <span className="text-xs font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
      {map[kind] || kind}
    </span>
  );
}

export function TicketStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "open":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Открыто
        </span>
      );
    case "in_progress":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          В работе
        </span>
      );
    case "resolved":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Решено
        </span>
      );
    case "closed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
          Закрыто
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          {status}
        </span>
      );
  }
}

export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  connection: "Подключение",
  import: "Импорт",
  analytics: "Аналитика",
  privacy: "Данные и приватность",
  other: "Другое",
};

export function TicketCategoryBadge({ category }: { category: string }) {
  const label = TICKET_CATEGORY_LABELS[category] || category;
  return (
    <span className="font-semibold text-xs text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md">
      {label}
    </span>
  );
}

export const STAGE_LABELS: Record<string, string> = {
  validating_session: "Проверка сессии",
  prepare: "Подготовка",
  fetching_followers: "Сбор подписчиков",
  fetching_following: "Сбор подписок",
  validating_snapshot: "Проверка снимка",
  committing: "Сохранение снимка",
  stopped: "Остановлено",
  cancelled: "Отменено",
  connected: "Подключено",
  verification_required: "Ожидание кода 2FA",
  comparing: "Сравнение снимков",
  exporting: "Формирование архива",
  unpacking: "Распаковка архива",
  parsing: "Парсинг файлов",
  completed: "Завершено",
};

export function formatStage(stage: string): string {
  return STAGE_LABELS[stage] || stage;
}

export const ERROR_CODE_LABELS: Record<string, string> = {
  reconnect_required: "Требуется переподключение",
  identity_mismatch: "Несоответствие сессии и аккаунта",
  cooldown: "Защитная пауза (cooldown)",
  challenge_required: "Требуется подтверждение в Instagram",
  request_budget_exhausted: "Исчерпан бюджет запросов",
  inconsistent_snapshot: "Списки изменились во время сбора",
  expired: "Время ожидания истекло",
  cancelled: "Отменено оператором",
  worker_lost: "Процесс воркера остановлен",
  storage_quota: "Превышена квота диска",
  storage_unavailable: "Хранилище недоступно",
  temporary_unavailable: "Временно недоступно",
  timeout: "Превышено время ожидания",
  rate_limit: "Превышен лимит запросов",
  invalid_credentials: "Неверные учетные данные",
  account_in_use: "Аккаунт уже подключен",
  provider_unavailable: "Instagram временно недоступен",
};

export function formatErrorCode(code?: string | null): string {
  if (!code) return "—";
  return ERROR_CODE_LABELS[code] || code;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin.mfa_confirmed": "Подтверждение MFA",
  "admin.mfa_failed": "Ошибка MFA",
  "user.suspend": "Блокировка пользователя",
  "user.restore": "Разблокировка пользователя",
  "user.role_change": "Изменение роли",
  "user.register": "Регистрация пользователя",
  "user.login": "Авторизация в системе",
  "user.delete": "Удаление пользователя",
  "user.local_password_reset": "Сброс пароля",
  "privacy.delete_account": "Запрос удаления аккаунта",
  "profile.pause": "Приостановка сбора профиля",
  "profile.resume": "Возобновление сбора профиля",
  "instagram.connect_requested": "Запрос подключения Instagram",
  "job.cancel": "Отмена задания",
  "job.retry": "Повторный запуск задания",
  "limits.update": "Изменение глобальных лимитов",
  "support.reply": "Ответ на обращение",
  "ticket.reply": "Ответ на обращение",
  "session.revoke_others": "Отзыв активных сессий",
};

export function formatAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

export function CompletenessBadge({ completeness }: { completeness: string }) {
  switch (completeness) {
    case "complete":
    case "collection_validated":
    case "user_confirmed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Полный снимок
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Частичный
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
          {completeness}
        </span>
      );
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Б";
  const k = 1024;
  const sizes = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDateTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(isoString)) + " UTC";
  } catch {
    return isoString;
  }
}
