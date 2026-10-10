"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminJob } from "@/features/admin/types";
import { AdminTable } from "@/features/admin/components/tables";
import { AdminFilterBar } from "@/features/admin/components/filters";
import {
  CopyableId,
  JobStatusBadge,
  JobKindBadge,
  formatStage,
  formatErrorCode,
  formatDateTime,
} from "@/features/admin/components/badges";
import { ArrowRight } from "lucide-react";

export default function AdminJobsPage() {
  const { isPrivileged } = useAdminAuth();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [errorCode, setErrorCode] = useState("");

  const queryKey = ["admin", "jobs", { status, kind, errorCode }];

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery<Page<AdminJob>>({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (status) params.set("status", status);
      if (kind) params.set("kind", kind);
      if (errorCode.trim()) params.set("error_code", errorCode.trim());
      if (pageParam) params.set("cursor", String(pageParam));

      return api<Page<AdminJob>>(`/admin/jobs?${params.toString()}`, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    enabled: isPrivileged,
  });

  const allItems = data?.pages.flatMap((p) => p.items) || [];

  const columns = [
    {
      header: "ID задания",
      accessor: (j: AdminJob) => <CopyableId id={j.id} length={6} />,
    },
    {
      header: "Тип",
      accessor: (j: AdminJob) => <JobKindBadge kind={j.kind} />,
    },
    {
      header: "Статус",
      accessor: (j: AdminJob) => <JobStatusBadge status={j.status} />,
    },
    {
      header: "Этап",
      accessor: (j: AdminJob) => <span className="text-xs font-medium text-slate-700">{formatStage(j.stage)}</span>,
    },
    {
      header: "Код ошибки",
      accessor: (j: AdminJob) =>
        j.error_code ? (
          <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-100">
            {formatErrorCode(j.error_code)}
          </span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      header: "Попытки",
      accessor: (j: AdminJob) => (
        <span className="text-xs text-slate-600 font-medium">{j.attempts}/3</span>
      ),
    },
    {
      header: "Создано",
      accessor: (j: AdminJob) => (
        <span className="text-xs text-slate-500">{formatDateTime(j.created_at)}</span>
      ),
    },
    {
      header: "",
      className: "text-right",
      accessor: (j: AdminJob) => (
        <Link
          href={`/admin/jobs/${j.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900"
        >
          <span>Детали</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Задания и очереди</h1>
          <p className="text-xs text-slate-500 mt-1">
            Мониторинг очередей воркеров, обработка сбоев и безопасный повтор
          </p>
        </div>
      </div>

      <AdminFilterBar
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "", label: "Все статусы" },
              { value: "queued", label: "В очереди" },
              { value: "running", label: "Выполняется" },
              { value: "completed", label: "Завершено" },
              { value: "failed", label: "Сбой" },
            ],
          },
          {
            id: "kind",
            value: kind,
            onChange: setKind,
            options: [
              { value: "", label: "Все типы" },
              { value: "import", label: "Импорт архива" },
              { value: "comparison", label: "Сравнение" },
              { value: "export", label: "Экспорт" },
              { value: "connection", label: "Подключение" },
              { value: "sync", label: "Сбор данных" },
            ],
          },
          {
            id: "error",
            value: errorCode,
            onChange: setErrorCode,
            options: [
              { value: "", label: "Все ошибки" },
              { value: "storage_unavailable", label: "Хранилище недоступно" },
              { value: "temporary_unavailable", label: "Временно недоступно" },
              { value: "timeout", label: "Таймаут" },
              { value: "cooldown", label: "Защитная пауза" },
              { value: "challenge_required", label: "Требуется проверка 2FA" },
              { value: "reconnect_required", label: "Требуется переподключение" },
              { value: "identity_mismatch", label: "Несоответствие аккаунта" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(status || kind || errorCode)}
        onReset={() => {
          setStatus("");
          setKind("");
          setErrorCode("");
        }}
      />

      <AdminTable
        columns={columns}
        data={allItems}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Задания не найдены"
        emptySubtext="Попробуйте сбросить фильтры статуса или типа задания"
        keyExtractor={(j) => j.id}
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
