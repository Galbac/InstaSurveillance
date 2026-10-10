"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminSystemHealth } from "@/features/admin/types";
import { formatBytes, formatDateTime } from "@/features/admin/components/badges";
import { ErrorNotice } from "@/features/common";
import {
  Database,
  HardDrive,
  Mail,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  ShieldAlert,
} from "lucide-react";

export default function AdminSystemPage() {
  const { isPrivileged, isAdmin } = useAdminAuth();

  const {
    data: health,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery<AdminSystemHealth>({
    queryKey: ["admin", "system"],
    queryFn: ({ signal }) => api<AdminSystemHealth>("/admin/system", { signal }),
    enabled: isPrivileged && isAdmin,
    staleTime: 10_000,
  });

  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Доступ ограничен</h2>
        <p className="text-sm text-slate-500 mt-1">
          Диагностика инфраструктуры доступна исключительно администраторам платформы.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-slate-200 rounded-md w-48 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Состояние инфраструктуры</h1>
        <ErrorNotice error={error} />
        <button
          type="button"
          onClick={() => refetch()}
          className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700"
        >
          Повторить опрос
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Состояние инфраструктуры</h1>
          <p className="text-xs text-slate-500 mt-1">
            Наблюдаемый статус PostgreSQL, хранилища объектов и очереди доставки событий (Outbox)
          </p>
        </div>

        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl shadow-sm transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          <span>{isFetching ? "Проверка…" : "Обновить статус"}</span>
        </button>
      </div>

      {/* Grid of Diagnostics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Database Health */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              База данных (PostgreSQL)
            </span>
            <Database className="w-5 h-5 text-purple-600" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            {health.db_healthy ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" /> Доступна
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                <XCircle className="w-3.5 h-3.5" /> Сбой подключения
              </span>
            )}
          </div>

          <div>
            <span className="text-2xl font-bold text-slate-900">{health.db_latency_ms} мс</span>
            <p className="text-xs text-slate-500 mt-0.5">Время отклика тестового запроса (RTT)</p>
          </div>
        </div>

        {/* Object Storage Health */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              Объектное хранилище
            </span>
            <HardDrive className="w-5 h-5 text-purple-600" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {health.storage_kind}
            </span>
            {health.storage_accessible ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" /> Готово
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                <XCircle className="w-3.5 h-3.5" /> Недоступно
              </span>
            )}
          </div>

          <div>
            <span className="text-2xl font-bold text-slate-900">
              {formatBytes(health.total_storage_bytes)}
            </span>
            <p className="text-xs text-slate-500 mt-0.5">
              Всего файлов: {health.total_file_objects.toLocaleString("ru-RU")}
            </p>
          </div>
        </div>

        {/* Outbox Events Queue */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              Очередь событий (Outbox)
            </span>
            <Mail className="w-5 h-5 text-purple-600" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            {health.outbox_pending_count > 50 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                <AlertTriangle className="w-3.5 h-3.5" /> Задержка очереди
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" /> В норме
              </span>
            )}
          </div>

          <div>
            <span className="text-2xl font-bold text-slate-900">
              {health.outbox_pending_count} событий
            </span>
            <p className="text-xs text-slate-500 mt-0.5">
              {health.outbox_oldest_age_seconds != null
                ? `Возраст старейшего: ${health.outbox_oldest_age_seconds} сек`
                : "Очередь полностью обработана"}
            </p>
          </div>
        </div>

        {/* Pending Deletions */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              Очередь безопасного удаления
            </span>
            <Trash2 className="w-5 h-5 text-purple-600" />
          </div>

          <div className="pt-1">
            <span className="text-2xl font-bold text-slate-900">
              {health.pending_deletions_count}
            </span>
            <p className="text-xs text-slate-500 mt-0.5">
              Запросов на удаление данных в ожидании фоновой очистки
            </p>
          </div>
        </div>

        {/* Timestamp */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500 tracking-wider">
              Время последней проверки
            </span>
            <Clock className="w-5 h-5 text-purple-600" />
          </div>

          <div className="pt-1">
            <span className="text-sm font-bold text-slate-900">
              {formatDateTime(health.checked_at)}
            </span>
            <p className="text-xs text-slate-500 mt-0.5">Данные с сервера получены в реальном времени</p>
          </div>
        </div>
      </div>
    </div>
  );
}
