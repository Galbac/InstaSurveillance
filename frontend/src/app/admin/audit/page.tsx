"use client";

import React, { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AuditEventDTO } from "@/features/admin/types";
import { AdminTable } from "@/features/admin/components/tables";
import { AdminFilterBar } from "@/features/admin/components/filters";
import { CopyableId, formatDateTime } from "@/features/admin/components/badges";
import { Modal } from "@/features/common";
import { Eye, ShieldAlert } from "lucide-react";

export default function AdminAuditPage() {
  const { isPrivileged, isAdmin } = useAdminAuth();
  const [action, setAction] = useState("");
  const [target, setTarget] = useState("");
  const [requestId, setRequestId] = useState("");
  const [selectedMeta, setSelectedMeta] = useState<Record<string, unknown> | null>(null);

  const queryKey = ["admin", "audit", { action, target, requestId }];

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery<Page<AuditEventDTO>>({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (action) params.set("action", action);
      if (target.trim()) params.set("target", target.trim());
      if (requestId.trim()) params.set("request_id", requestId.trim());
      if (pageParam) params.set("cursor", String(pageParam));

      return api<Page<AuditEventDTO>>(`/admin/audit?${params.toString()}`, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    enabled: isPrivileged && isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
        <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Доступ ограничен</h2>
        <p className="text-sm text-slate-500 mt-1">
          Журнал аудита доступен исключительно администраторам платформы.
        </p>
      </div>
    );
  }

  const allItems = data?.pages.flatMap((p) => p.items) || [];

  const columns = [
    {
      header: "Действие",
      accessor: (a: AuditEventDTO) => (
        <span className="font-semibold text-xs text-purple-900 bg-purple-50 px-2.5 py-1 rounded-md border border-purple-100">
          {a.action}
        </span>
      ),
    },
    {
      header: "Инициатор (Actor)",
      accessor: (a: AuditEventDTO) =>
        a.actor_id ? <CopyableId id={a.actor_id} length={6} /> : <span className="text-xs text-slate-400">система</span>,
    },
    {
      header: "Цель (Target)",
      accessor: (a: AuditEventDTO) => <CopyableId id={a.target} length={6} />,
    },
    {
      header: "Request ID",
      accessor: (a: AuditEventDTO) =>
        a.request_id ? <CopyableId id={a.request_id} length={6} /> : <span className="text-xs text-slate-400">—</span>,
    },
    {
      header: "Метаданные",
      accessor: (a: AuditEventDTO) => (
        <button
          type="button"
          onClick={() => setSelectedMeta(a.metadata as Record<string, unknown>)}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-purple-700 font-medium"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Просмотр</span>
        </button>
      ),
    },
    {
      header: "Время (UTC)",
      accessor: (a: AuditEventDTO) => (
        <span className="text-xs text-slate-500">{formatDateTime(a.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Журнал аудита</h1>
          <p className="text-xs text-slate-500 mt-1">
            Неизменяемый реестр административных действий, изменений лимитов и авторизаций
          </p>
        </div>
      </div>

      <AdminFilterBar
        search={{
          value: requestId,
          onChange: setRequestId,
          placeholder: "Поиск по Request ID или ID цели…",
        }}
        filters={[
          {
            id: "action",
            value: action,
            onChange: setAction,
            options: [
              { value: "", label: "Все действия" },
              { value: "admin.mfa_confirmed", label: "admin.mfa_confirmed" },
              { value: "admin.mfa_failed", label: "admin.mfa_failed" },
              { value: "user.suspend", label: "user.suspend" },
              { value: "user.restore", label: "user.restore" },
              { value: "profile.pause", label: "profile.pause" },
              { value: "profile.resume", label: "profile.resume" },
              { value: "job.retry", label: "job.retry" },
              { value: "support.reply", label: "support.reply" },
              { value: "limits.update", label: "limits.update" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(action || target || requestId)}
        onReset={() => {
          setAction("");
          setTarget("");
          setRequestId("");
        }}
      />

      <AdminTable
        columns={columns}
        data={allItems}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Записи аудита не найдены"
        emptySubtext="Попробуйте сбросить фильтры поиска"
        keyExtractor={(a) => a.id}
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

      {selectedMeta && (
        <Modal title="Метаданные события" onClose={() => setSelectedMeta(null)}>
          <div className="space-y-4 pt-2">
            <pre className="p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-xl overflow-x-auto max-h-96">
              {JSON.stringify(selectedMeta, null, 2)}
            </pre>
            <div className="text-right">
              <button
                type="button"
                onClick={() => setSelectedMeta(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl"
              >
                Закрыть
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
