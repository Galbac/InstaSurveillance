"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/features/admin/auth-context";
import { ErrorNotice } from "@/features/common";
import { formatBytes } from "@/features/admin/components/badges";
import { CheckCircle2, Loader2, Info } from "lucide-react";

export default function AdminLimitsPage() {
  const qc = useQueryClient();
  const { isPrivileged, isAdmin } = useAdminAuth();

  const [syncHours, setSyncHours] = useState<number>(24);
  const [requestBudget, setRequestBudget] = useState<number>(600);
  const [quotaBytes, setQuotaBytes] = useState<number>(1073741824);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [successNotice, setSuccessNotice] = useState(false);

  const {
    isLoading,
    error,
    refetch,
  } = useQuery<Record<string, number>>({
    queryKey: ["admin", "limits"],
    queryFn: async ({ signal }) => {
      const data = await api<Record<string, number>>("/admin/limits", { signal });
      if (data.instagram_sync_interval_hours) setSyncHours(data.instagram_sync_interval_hours);
      if (data.instagram_request_budget) setRequestBudget(data.instagram_request_budget);
      if (data.user_storage_quota_bytes) setQuotaBytes(data.user_storage_quota_bytes);
      return data;
    },
    enabled: isPrivileged,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    setSubmitting(true);
    setActionError(null);
    setSuccessNotice(false);
    try {
      await api("/admin/limits", {
        method: "PATCH",
        body: JSON.stringify({
          instagram_sync_interval_hours: Number(syncHours),
          instagram_request_budget: Number(requestBudget),
          user_storage_quota_bytes: Number(quotaBytes),
          reason: reason.trim(),
        }),
      });
      setSuccessNotice(true);
      setReason("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    } catch (err) {
      setActionError(err);
    } finally {
      setSubmitting(false);
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

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Глобальные ограничения</h1>
        <p className="text-xs text-slate-500 mt-1">
          Конфигурация политики безопасности Meta и квот дискового пространства
        </p>
      </div>

      {/* Caution alert */}
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Политика ужесточения лимитов:</span>
          <p className="mt-0.5">
            Динамические лимиты могут только делать правила строже базовых настроек окружения
            (увеличивать интервал между сборами, уменьшать бюджет запросов к Meta и уменьшать квоту
            диска). Попытка смягчить правила ниже базовой конфигурации сервера будет отклонена с ошибкой.
          </p>
        </div>
      </div>

      {successNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          Лимиты успешно обновлены и записаны в журнал аудита.
        </div>
      )}

      <ErrorNotice error={actionError || error} />

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Interval */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="sync-interval-input" className="text-xs font-semibold text-slate-700 uppercase">
                Минимальный интервал Instagram (часов)
              </label>
              <span className="text-xs font-bold text-purple-700">{syncHours} ч</span>
            </div>
            <input
              id="sync-interval-input"
              type="number"
              min={1}
              max={8760}
              required
              disabled={!isAdmin || submitting}
              value={syncHours}
              onChange={(e) => setSyncHours(Number(e.target.value))}
              className="w-full p-3 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Минимальное количество часов между регулярными автоматическими сборами данных профиля.
            </p>
          </div>

          {/* Budget */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="request-budget-input" className="text-xs font-semibold text-slate-700 uppercase">
                Бюджет HTTP-запросов на один сбор
              </label>
              <span className="text-xs font-bold text-purple-700">{requestBudget} запросов</span>
            </div>
            <input
              id="request-budget-input"
              type="number"
              min={1}
              max={10000}
              required
              disabled={!isAdmin || submitting}
              value={requestBudget}
              onChange={(e) => setRequestBudget(Number(e.target.value))}
              className="w-full p-3 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Максимальный лимит пагинаций и вызовов API Instagram за один цикл сканирования.
            </p>
          </div>

          {/* Quota */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="storage-quota-input" className="text-xs font-semibold text-slate-700 uppercase">
                Пользовательская квота диска (байт)
              </label>
              <span className="text-xs font-bold text-purple-700">{formatBytes(quotaBytes)}</span>
            </div>
            <input
              id="storage-quota-input"
              type="number"
              min={1024}
              required
              disabled={!isAdmin || submitting}
              value={quotaBytes}
              onChange={(e) => setQuotaBytes(Number(e.target.value))}
              className="w-full p-3 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-purple-600"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Предельный суммарный объём экспортов и архивов файлов на одного пользователя.
            </p>
          </div>

          {/* Reason */}
          {isAdmin ? (
            <div>
              <label htmlFor="limits-reason-input" className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">
                Обязательная причина изменения (от 5 до 500 символов)
              </label>
              <textarea
                id="limits-reason-input"
                rows={3}
                required
                minLength={5}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: Ужесточение интервала для предотвращения волны блокировок Instagram…"
                className="w-full p-3.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600"
              />
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">
              Редактирование параметров лимитов доступно только администраторам платформы.
            </p>
          )}

          {isAdmin && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={submitting || reason.trim().length < 5}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 active:scale-[0.98] text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Сохранить ограничения</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
