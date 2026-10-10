"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminTicket } from "@/features/admin/types";
import { AdminTable } from "@/features/admin/components/tables";
import { AdminFilterBar } from "@/features/admin/components/filters";
import {
  CopyableId,
  TicketStatusBadge,
  TicketCategoryBadge,
  formatDateTime,
} from "@/features/admin/components/badges";
import { ArrowRight, MessageSquare } from "lucide-react";

export default function AdminSupportPage() {
  const { isPrivileged } = useAdminAuth();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const queryKey = ["admin", "support", { status, category, search }];

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery<Page<AdminTicket>>({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (status) params.set("status", status);
      if (category) params.set("category", category);
      if (search.trim()) params.set("search", search.trim());
      if (pageParam) params.set("cursor", String(pageParam));

      return api<Page<AdminTicket>>(`/admin/support/tickets?${params.toString()}`, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    enabled: isPrivileged,
  });

  const allItems = data?.pages.flatMap((p) => p.items) || [];

  const columns = [
    {
      header: "Категория",
      accessor: (t: AdminTicket) => <TicketCategoryBadge category={t.category} />,
    },
    {
      header: "Пользователь",
      accessor: (t: AdminTicket) =>
        t.owner_email ? (
          <span className="text-xs text-slate-800 font-medium">{t.owner_email}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      header: "Сообщение",
      accessor: (t: AdminTicket) => (
        <p className="text-xs text-slate-600 line-clamp-2 max-w-sm">{t.body}</p>
      ),
    },
    {
      header: "Номер запроса (Request ID)",
      accessor: (t: AdminTicket) =>
        t.request_id ? <CopyableId id={t.request_id} length={6} /> : <span className="text-xs text-slate-400">—</span>,
    },
    {
      header: "Статус",
      accessor: (t: AdminTicket) => <TicketStatusBadge status={t.status} />,
    },
    {
      header: "Ответ",
      accessor: (t: AdminTicket) =>
        t.reply ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <MessageSquare className="w-3.5 h-3.5" /> Да
          </span>
        ) : (
          <span className="text-xs text-slate-400">Нет</span>
        ),
    },
    {
      header: "Дата",
      accessor: (t: AdminTicket) => (
        <span className="text-xs text-slate-500">{formatDateTime(t.created_at)}</span>
      ),
    },
    {
      header: "",
      className: "text-right",
      accessor: (t: AdminTicket) => (
        <Link
          href={`/admin/support/${t.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900"
        >
          <span>Ответить</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Служба поддержки</h1>
          <p className="text-xs text-slate-500 mt-1">
            Обращения клиентов, диагностика сбоев по Request ID и ответы
          </p>
        </div>
      </div>

      <AdminFilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по тексту или Request ID…",
        }}
        filters={[
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "", label: "Все статусы" },
              { value: "open", label: "Открытые (Новые)" },
              { value: "in_progress", label: "В работе" },
              { value: "resolved", label: "Решённые" },
            ],
          },
          {
            id: "category",
            value: category,
            onChange: setCategory,
            options: [
              { value: "", label: "Все категории" },
              { value: "connection", label: "Подключение" },
              { value: "import", label: "Импорт" },
              { value: "analytics", label: "Аналитика" },
              { value: "privacy", label: "Данные и приватность" },
              { value: "other", label: "Другое" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(status || category || search)}
        onReset={() => {
          setStatus("");
          setCategory("");
          setSearch("");
        }}
      />

      <AdminTable
        columns={columns}
        data={allItems}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Обращения не найдены"
        emptySubtext="Все текущие вопросы решены или фильтры слишком строгие"
        keyExtractor={(t) => t.id}
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
