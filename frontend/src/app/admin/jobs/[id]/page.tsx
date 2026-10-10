"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminJobDetail } from "@/features/admin/types";
import {
  CopyableId,
  JobStatusBadge,
  JobKindBadge,
  formatDateTime,
} from "@/features/admin/components/badges";
import { ErrorNotice, Modal } from "@/features/common";
import { ArrowLeft, RotateCcw, Loader2 } from "lucide-react";

export default function AdminJobDetailPage() {
  const params = useParams();
  const jobId = params?.id as string;
  const qc = useQueryClient();
  const { isPrivileged } = useAdminAuth();

  const [retryModalOpen, setRetryModalOpen] = useState(false);
  const [retrySubmitting, setRetrySubmitting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const {
    data: job,
    isLoading,
    error,
    refetch,
  } = useQuery<AdminJobDetail>({
    queryKey: ["admin", "jobs", jobId],
    queryFn: ({ signal }) => api<AdminJobDetail>(`/admin/jobs/${jobId}`, { signal }),
    enabled: isPrivileged && Boolean(jobId),
  });

  const handleRetry = async () => {
    setRetrySubmitting(true);
    setActionError(null);
    try {
      await post(`/admin/jobs/${jobId}/retry`, {});
      setRetryModalOpen(false);
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    } catch (err) {
      setActionError(err);
    } finally {
      setRetrySubmitting(false);
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

  if (error || !job) {
    return (
      <div className="space-y-4">
        <Link href="/admin/jobs" className="inline-flex items-center gap-1.5 text-xs text-purple-700 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> К списку заданий
        </Link>
        <ErrorNotice error={error || new Error("Задание не найдено")} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/jobs"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-all"
            title="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <JobKindBadge kind={job.kind} />
              <JobStatusBadge status={job.status} />
              <CopyableId id={job.id} length={8} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
              {job.owner_email && (
                <>
                  <span>Владелец:</span>
                  <Link
                    href={`/admin/users/${job.user_id}`}
                    className="text-purple-700 hover:underline font-semibold"
                  >
                    {job.owner_email}
                  </Link>
                </>
              )}
              {job.profile_username && (
                <>
                  <span>· Профиль:</span>
                  <Link
                    href={`/admin/profiles/${job.profile_id}`}
                    className="text-purple-700 hover:underline font-semibold"
                  >
                    @{job.profile_username}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Retry Button */}
        <div>
          {job.can_retry ? (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setRetryModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Повторить задание</span>
            </button>
          ) : (
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-500 text-xs font-medium rounded-lg">
                Повтор недоступен
              </span>
              {job.retry_forbidden_reason && (
                <p className="text-[11px] text-slate-400 mt-1 max-w-xs">{job.retry_forbidden_reason}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Primary Parameters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Этап исполнения</span>
          <div className="font-mono text-sm font-bold text-slate-900 pt-0.5">{job.stage}</div>
          <p className="text-xs text-slate-500">Попыток: {job.attempts} из 3</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Код ошибки</span>
          <div className="font-mono text-sm font-bold text-rose-600 pt-0.5">
            {job.error_code || "—"}
          </div>
          <p className="text-xs text-slate-500">
            {job.error_code ? "Зафиксирован сбой воркера" : "Ошибок не зафиксировано"}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Время создания</span>
          <div className="text-xs font-bold text-slate-900 pt-1">{formatDateTime(job.created_at)}</div>
          <p className="text-xs text-slate-500">Старт: {formatDateTime(job.started_at)}</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Heartbeat / Завершение</span>
          <div className="text-xs font-bold text-slate-900 pt-1">
            {formatDateTime(job.finished_at || job.heartbeat_at)}
          </div>
          <p className="text-xs text-slate-500">Обновлено: {formatDateTime(job.updated_at)}</p>
        </div>
      </div>

      {/* Linked Artifacts */}
      {(job.snapshot_id || job.comparison_id || job.export_id) && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Связанные объекты данных
          </h2>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {job.snapshot_id && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Снимок (Snapshot):</span>
                <CopyableId id={job.snapshot_id} />
              </div>
            )}
            {job.comparison_id && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Сравнение:</span>
                <CopyableId id={job.comparison_id} />
              </div>
            )}
            {job.export_id && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-slate-500">Экспорт:</span>
                <CopyableId id={job.export_id} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Details JSON */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Технические детали (Details)</h2>
        <p className="text-xs text-slate-500">
          Сведения об обработке, логах этапов и параметрах. Чувствительные токены исключены.
        </p>
        <pre className="p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl overflow-x-auto max-h-96">
          {JSON.stringify(job.details, null, 2)}
        </pre>
      </div>

      {/* Retry Confirmation Modal */}
      {retryModalOpen && (
        <Modal title="Повторить выполнение задания?" onClose={() => setRetryModalOpen(false)}>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-slate-600 leading-relaxed">
              Задание будет переведено в статус <code>queued</code> и отправлено в очередь воркеров через
              outbox-событие. Повтор разрешён только для технических сбоев (хранилище, таймаут) уже
              сохранённых данных.
            </p>

            <ErrorNotice error={actionError} />

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRetryModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleRetry}
                disabled={retrySubmitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-xl shadow-sm"
              >
                {retrySubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Подтвердить перезапуск
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
