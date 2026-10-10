"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminProfile } from "@/features/admin/types";
import { AdminTable } from "@/features/admin/components/tables";
import { AdminFilterBar } from "@/features/admin/components/filters";
import {
  ProfileStatusBadge,
  JobStatusBadge,
  formatDateTime,
  InstagramIcon,
} from "@/features/admin/components/badges";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";

export default function AdminProfilesPage() {
  const { isPrivileged } = useAdminAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paused, setPaused] = useState("");
  const [hasCooldown, setHasCooldown] = useState("");

  const queryKey = ["admin", "profiles", { search, status, paused, hasCooldown }];

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery<Page<AdminProfile>>({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (paused) params.set("paused", paused);
      if (hasCooldown) params.set("has_cooldown", hasCooldown);
      if (pageParam) params.set("cursor", String(pageParam));

      return api<Page<AdminProfile>>(`/admin/profiles?${params.toString()}`, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    enabled: isPrivileged,
  });

  const allItems = data?.pages.flatMap((p) => p.items) || [];

  const columns = [
    {
      header: "Профиль",
      accessor: (p: AdminProfile) => (
        <div className="flex items-center gap-2">
          <InstagramIcon className="w-4 h-4 text-purple-600 shrink-0" />
          <Link
            href={`/admin/profiles/${p.id}`}
            className="font-bold text-slate-900 hover:text-purple-700 transition-colors"
          >
            @{p.username}
          </Link>
        </div>
      ),
    },
    {
      header: "Владелец",
      accessor: (p: AdminProfile) =>
        p.owner_email ? (
          <Link
            href={`/admin/users/${p.user_id}`}
            className="text-xs text-slate-700 hover:text-purple-700 font-medium"
          >
            {p.owner_email}
          </Link>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      header: "Статус",
      accessor: (p: AdminProfile) => (
        <ProfileStatusBadge
          status={p.status}
          paused={p.paused}
          hasCooldown={Boolean(p.cooldown_until && new Date(p.cooldown_until) > new Date())}
        />
      ),
    },
    {
      header: "Подключение",
      accessor: (p: AdminProfile) =>
        p.has_connection ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Активно
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium">
            <XCircle className="w-3.5 h-3.5" /> Нет
          </span>
        ),
    },
    {
      header: "Последний сбор",
      accessor: (p: AdminProfile) => (
        <span className="text-xs text-slate-500">{formatDateTime(p.last_sync)}</span>
      ),
    },
    {
      header: "Последнее задание",
      accessor: (p: AdminProfile) =>
        p.last_job ? (
          <Link
            href={`/admin/jobs/${p.last_job.id}`}
            className="inline-flex items-center gap-1.5 hover:opacity-80"
          >
            <JobStatusBadge status={p.last_job.status} />
            <span className="text-xs text-slate-500">{p.last_job.kind}</span>
          </Link>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      header: "",
      className: "text-right",
      accessor: (p: AdminProfile) => (
        <Link
          href={`/admin/profiles/${p.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900"
        >
          <span>Диагностика</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Instagram-профили</h1>
          <p className="text-xs text-slate-500 mt-1">
            Мониторинг подключений, состояния сборов и ограничений Meta
          </p>
        </div>
      </div>

      <AdminFilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по username или ID профиля…",
        }}
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "", label: "Все статусы" },
              { value: "active", label: "Активные" },
              { value: "reconnect_required", label: "Требуется вход" },
              { value: "disconnected", label: "Не подключён" },
            ],
          },
          {
            id: "paused",
            value: paused,
            onChange: setPaused,
            options: [
              { value: "", label: "Пауза: все" },
              { value: "true", label: "На паузе" },
              { value: "false", label: "Активен (не на паузе)" },
            ],
          },
          {
            id: "has_cooldown",
            value: hasCooldown,
            onChange: setHasCooldown,
            options: [
              { value: "", label: "Cooldown: все" },
              { value: "true", label: "В режиме cooldown" },
              { value: "false", label: "Без cooldown" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(search || status || paused || hasCooldown)}
        onReset={() => {
          setSearch("");
          setStatus("");
          setPaused("");
          setHasCooldown("");
        }}
      />

      <AdminTable
        columns={columns}
        data={allItems}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Профили не найдены"
        emptySubtext="Попробуйте изменить параметры поиска или фильтров"
        keyExtractor={(p) => p.id}
      />

      {hasNextPage && (
        <div className="text-center pt-4">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl shadow-sm transition-all"
          >
            {isFetchingNextPage ? "Загрузка…" : "Загрузить ещё 50"}
          </button>
        </div>
      )}
    </div>
  );
}
