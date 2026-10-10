"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api";

import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminUserDetail } from "@/features/admin/types";
import {
  CopyableId,
  RoleBadge,
  UserStatusBadge,
  ProfileStatusBadge,
  TicketStatusBadge,
  JobStatusBadge,
  formatBytes,
  formatDateTime,
  InstagramIcon,
} from "@/features/admin/components/badges";
import { ErrorNotice, Modal } from "@/features/common";
import {
  ArrowLeft,
  UserCheck,
  UserX,
  HardDrive,
  LifeBuoy,
  Loader2,
  ExternalLink,
} from "lucide-react";

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params?.id as string;
  const qc = useQueryClient();
  const { isPrivileged, isAdmin, status: authStatus } = useAdminAuth();

  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendSubmitting, setSuspendSubmitting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = useQuery<AdminUserDetail>({
    queryKey: ["admin", "users", userId],
    queryFn: ({ signal }) => api<AdminUserDetail>(`/admin/users/${userId}`, { signal }),
    enabled: isPrivileged && Boolean(userId),
  });

  const isSelf = authStatus?.user_id === userId;
  const isSuspended = user?.status === "suspended";

  const handleSuspendRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (suspendReason.trim().length < 5) return;
    setSuspendSubmitting(true);
    setActionError(null);
    try {
      const endpoint = isSuspended ? "restore" : "suspend";
      await post(`/admin/users/${userId}/${endpoint}`, { reason: suspendReason.trim() });
      setSuspendModalOpen(false);
      setSuspendReason("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    } catch (err) {
      setActionError(err);
    } finally {
      setSuspendSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-slate-200 rounded-md w-48 animate-pulse" />
        <div className="h-64 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-xs text-purple-700 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> К списку пользователей
        </Link>
        <ErrorNotice error={error || new Error("Пользователь не найден")} />
      </div>
    );
  }

  const storageUsedPercent = Math.min(
    100,
    Math.round((user.storage.total_bytes / (user.storage.quota_bytes || 1)) * 100)
  );

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/users"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-all"
            title="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{user.email}</h1>
              <UserStatusBadge status={user.status} />
              <RoleBadge role={user.role} />
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
              <span>ID:</span>
              <CopyableId id={user.id} />
              <span>· Зарегистрирован: {formatDateTime(user.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Action button */}
        {isAdmin && !isSelf && user.status !== "deleting" && (
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setSuspendReason("");
              setSuspendModalOpen(true);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-all shadow-sm ${
              isSuspended
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
            }`}
          >
            {isSuspended ? (
              <>
                <UserCheck className="w-4 h-4" />
                Вернуть доступ (Restore)
              </>
            ) : (
              <>
                <UserX className="w-4 h-4" />
                Приостановить доступ (Suspend)
              </>
            )}
          </button>
        )}
      </div>

      {/* Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Storage card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Использование диска
            </span>
            <HardDrive className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">
              {formatBytes(user.storage.total_bytes)}
              <span className="text-xs font-normal text-slate-500 ml-1.5">
                из {formatBytes(user.storage.quota_bytes)}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Файлов в архивах: {user.storage.file_count}</p>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                storageUsedPercent > 90
                  ? "bg-rose-500"
                  : storageUsedPercent > 70
                  ? "bg-amber-500"
                  : "bg-purple-600"
              }`}
              style={{ width: `${storageUsedPercent}%` }}
            />
          </div>
        </div>

        {/* Profiles count card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Instagram-профили
            </span>
            <InstagramIcon className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">{user.profiles_count}</div>
            <p className="text-xs text-slate-500 mt-0.5">Подключено аккаунтов на мониторинг</p>
          </div>
          <Link
            href={`/admin/profiles?user_id=${user.id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:underline pt-1"
          >
            Все профили пользователя →
          </Link>
        </div>

        {/* Support tickets card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Обращения в поддержку
            </span>
            <LifeBuoy className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900">{user.tickets_count}</div>
            <p className="text-xs text-slate-500 mt-0.5">Всего тикетов от пользователя</p>
          </div>
          <Link
            href={`/admin/support?user_id=${user.id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:underline pt-1"
          >
            Все тикеты пользователя →
          </Link>
        </div>
      </div>

      {/* Profiles & Jobs Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Profiles */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Профили пользователя</h2>
            <span className="text-xs text-slate-400">Всего: {user.profiles_count}</span>
          </div>

          {user.recent_profiles.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Профилей нет</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {user.recent_profiles.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/admin/profiles/${p.id}`}
                      className="text-sm font-semibold text-slate-900 hover:text-purple-700 transition-colors"
                    >
                      @{p.username}
                    </Link>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Синхронизация: {formatDateTime(p.last_sync)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ProfileStatusBadge status={p.status} paused={p.paused} />
                    <Link
                      href={`/admin/profiles/${p.id}`}
                      className="p-1 text-slate-400 hover:text-purple-600"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Jobs by Status */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Задания пользователя</h2>
            <Link
              href={`/admin/jobs?user_id=${user.id}`}
              className="text-xs font-semibold text-purple-700 hover:underline"
            >
              Все в таблице →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            {Object.entries(user.jobs_by_status).length === 0 ? (
              <p className="text-xs text-slate-400 col-span-2 py-6 text-center">Заданий нет</p>
            ) : (
              Object.entries(user.jobs_by_status).map(([st, cnt]) => (
                <div key={st} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="mb-1">
                    <JobStatusBadge status={st} />
                  </div>
                  <span className="text-lg font-bold text-slate-900">{cnt}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Support & Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Tickets */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Недавние обращения</h2>
            <Link
              href={`/admin/support?user_id=${user.id}`}
              className="text-xs font-semibold text-purple-700 hover:underline"
            >
              Все обращения →
            </Link>
          </div>

          {user.recent_tickets.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Обращений нет</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {user.recent_tickets.map((t) => (
                <div key={t.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/admin/support/${t.id}`}
                      className="text-xs font-semibold text-slate-800 hover:text-purple-700"
                    >
                      Категория: {t.category}
                    </Link>
                    <TicketStatusBadge status={t.status} />
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{t.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Audit History (Admin only) */}
        {isAdmin && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Журнал действий</h2>
              <Link
                href={`/admin/audit?target=${user.id}`}
                className="text-xs font-semibold text-purple-700 hover:underline"
              >
                Все записи →
              </Link>
            </div>

            {user.audit_history.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Действий не зафиксировано</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {user.audit_history.map((item) => {
                  const a = item as { id: string; action: string; created_at: string };
                  return (
                    <div key={a.id} className="py-2.5 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-800">{a.action}</span>
                        <p className="text-slate-400 mt-0.5">{formatDateTime(a.created_at)}</p>
                      </div>
                      <CopyableId id={a.id} length={4} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suspend / Restore Modal */}
      {suspendModalOpen && (
        <Modal
          title={isSuspended ? "Восстановить доступ пользователя?" : "Приостановить доступ пользователя?"}
          onClose={() => setSuspendModalOpen(false)}
        >
          <form onSubmit={handleSuspendRestore} className="space-y-4 pt-2">
            <p className="text-xs text-slate-600 leading-relaxed">
              {isSuspended
                ? "Пользователь снова сможет входить в систему. Обратите внимание: связанные Instagram-профили останутся на паузе, чтобы избежать неконтролируемых запросов к Instagram."
                : "Все активные сессии пользователя будут немедленно аннулированы. Все профили Instagram будут переведены на паузу с изменением поколения (generation), отменяя фоновые задачи."}
            </p>

            <ErrorNotice error={actionError} />

            <div>
              <label htmlFor="suspend-reason" className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Обязательная причина (от 5 до 500 символов)
              </label>
              <textarea
                id="suspend-reason"
                rows={3}
                required
                minLength={5}
                maxLength={500}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Укажите причину действия для записи в журнал аудита…"
                className="w-full p-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSuspendModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={suspendSubmitting || suspendReason.trim().length < 5}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-all shadow-sm ${
                  isSuspended
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {suspendSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {isSuspended ? "Подтвердить возврат доступа" : "Подтвердить блокировку"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
