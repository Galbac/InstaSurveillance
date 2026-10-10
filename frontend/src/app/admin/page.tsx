"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminOverview } from "@/features/admin/types";
import { KPICard } from "@/features/admin/components/kpi-card";
import { JobStatusBadge, formatBytes, InstagramIcon } from "@/features/admin/components/badges";
import { ErrorNotice } from "@/features/common";
import {
  Users,
  UserX,
  AlertTriangle,
  LifeBuoy,
  Activity,
  Sliders,
  Clock,
  Layers,
} from "lucide-react";
import Link from "next/link";

export default function AdminOverviewPage() {
  const { isPrivileged } = useAdminAuth();

  const {
    data: overview,
    isLoading,
    error,
    refetch,
  } = useQuery<AdminOverview>({
    queryKey: ["admin", "overview"],
    queryFn: ({ signal }) => api<AdminOverview>("/admin/overview", { signal }),
    enabled: isPrivileged,
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Обзор системы</h1>
          <p className="text-sm text-slate-500">Загрузка оперативных показателей…</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200/60 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-slate-900">Обзор системы</h1>
        <ErrorNotice error={error} />
        <button
          type="button"
          onClick={() => refetch()}
          className="px-4 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="space-y-8">
      {/* Title & Release */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Обзор платформы</h1>
          <p className="text-xs text-slate-500 mt-1">
            Оперативная сводка системы · Версия релиза:{" "}
            <span className="font-mono font-medium text-slate-700">{overview.release}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/limits"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-purple-700 bg-white hover:bg-purple-50 border border-slate-200 rounded-xl transition-all shadow-sm"
          >
            <Sliders className="w-3.5 h-3.5 text-purple-600" />
            <span>Параметры лимитов</span>
          </Link>
          <Link
            href="/admin/system"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-purple-700 bg-white hover:bg-purple-50 border border-slate-200 rounded-xl transition-all shadow-sm"
          >
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
            <span>Состояние инфраструктуры</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Пользователи"
          value={overview.users}
          subtitle={`Активных: ${overview.users_active} · Неподтверждённых: ${overview.users_unverified}`}
          icon={<Users className="w-4 h-4" />}
          href="/admin/users"
        />

        <KPICard
          title="Заблокировано"
          value={overview.users_suspended}
          subtitle="Аккаунты с ограниченным доступом"
          icon={<UserX className="w-4 h-4" />}
          href="/admin/users?status=suspended"
          alert={overview.users_suspended > 0}
        />

        <KPICard
          title="Instagram-профили"
          value={overview.profiles}
          subtitle={`Активно: ${overview.profiles_active} · На паузе: ${overview.profiles_paused}`}
          icon={<InstagramIcon className="w-4 h-4" />}
          href="/admin/profiles"
        />

        <KPICard
          title="Ожидание лимитов"
          value={overview.profiles_cooldown}
          subtitle="Защитная пауза запросов Instagram"
          icon={<Clock className="w-4 h-4" />}
          href="/admin/profiles?has_cooldown=true"
          alert={overview.profiles_cooldown > 0}
        />

        <KPICard
          title="Сбои заданий (24ч)"
          value={overview.jobs_failed_24h}
          subtitle="Завершились с технической ошибкой"
          icon={<AlertTriangle className="w-4 h-4" />}
          href="/admin/jobs?status=failed"
          alert={overview.jobs_failed_24h > 0}
        />

        <KPICard
          title="Открытые обращения"
          value={overview.tickets_open}
          subtitle={`В работе: ${overview.tickets_in_progress}`}
          icon={<LifeBuoy className="w-4 h-4" />}
          href="/admin/support?status=open"
          alert={overview.tickets_open > 0}
        />

        <KPICard
          title="Частичные снимки (7д)"
          value={overview.partial_snapshots_7d}
          subtitle="Снимки с неполным списком подписчиков"
          icon={<Layers className="w-4 h-4" />}
          alert={overview.partial_snapshots_7d > 0}
        />

        <KPICard
          title="Квота хранилища"
          value={formatBytes(overview.limits.storage_quota_bytes)}
          subtitle={`Интервал: ${overview.limits.sync_hours}ч · Бюджет: ${overview.limits.request_budget}`}
          icon={<Sliders className="w-4 h-4" />}
          href="/admin/limits"
        />
      </div>

      {/* Jobs Breakdown & System Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Jobs by Status */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Задания по статусам</h2>
            <Link href="/admin/jobs" className="text-xs font-semibold text-purple-700 hover:underline">
              Все задания →
            </Link>
          </div>
          <p className="text-xs text-slate-500">Распределение очередей и фоновых воркеров</p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
            {Object.entries(overview.jobs).length === 0 ? (
              <p className="text-xs text-slate-400 col-span-full py-4 text-center">Заданий нет</p>
            ) : (
              Object.entries(overview.jobs).map(([status, count]) => (
                <Link
                  key={status}
                  href={`/admin/jobs?status=${encodeURIComponent(status)}`}
                  className="p-3.5 rounded-xl bg-slate-50 hover:bg-purple-50/60 border border-slate-100 transition-colors flex flex-col justify-between"
                >
                  <div className="mb-2">
                    <JobStatusBadge status={status} />
                  </div>
                  <span className="text-xl font-bold text-slate-900">{count}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Global Limits Summary */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Активные параметры безопасности</h2>
            <Link href="/admin/limits" className="text-xs font-semibold text-purple-700 hover:underline">
              Изменить →
            </Link>
          </div>
          <p className="text-xs text-slate-500">Глобальные ограничения защиты от блокировок Meta</p>

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs font-medium text-slate-600">Минимальный интервал сбора</span>
              <span className="text-sm font-bold text-slate-900">{overview.limits.sync_hours} ч</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs font-medium text-slate-600">Бюджет запросов на профиль</span>
              <span className="text-sm font-bold text-slate-900">{overview.limits.request_budget} запросов</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-xs font-medium text-slate-600">Пользовательская квота диска</span>
              <span className="text-sm font-bold text-slate-900">
                {formatBytes(overview.limits.storage_quota_bytes)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
