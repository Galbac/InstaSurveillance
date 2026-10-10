"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminUser } from "@/features/admin/types";
import { AdminTable } from "@/features/admin/components/tables";
import { AdminFilterBar } from "@/features/admin/components/filters";
import {
  CopyableId,
  RoleBadge,
  UserStatusBadge,
  formatDateTime,
} from "@/features/admin/components/badges";
import { CheckCircle2, XCircle, ArrowRight } from "lucide-react";

export default function AdminUsersPage() {
  const { isPrivileged } = useAdminAuth();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [verified, setVerified] = useState("");

  const queryKey = ["admin", "users", { search, role, status, verified }];

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
    refetch,
  } = useInfiniteQuery<Page<AdminUser>>({
    queryKey,
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      if (search.trim()) params.set("search", search.trim());
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      if (verified) params.set("verified", verified);
      if (pageParam) params.set("cursor", String(pageParam));

      return api<Page<AdminUser>>(`/admin/users?${params.toString()}`, { signal });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor || undefined,
    enabled: isPrivileged,
  });

  const allItems = data?.pages.flatMap((p) => p.items) || [];

  const columns = [
    {
      header: "Email",
      accessor: (u: AdminUser) => (
        <Link
          href={`/admin/users/${u.id}`}
          className="font-medium text-slate-900 hover:text-purple-700 transition-colors"
        >
          {u.email}
        </Link>
      ),
    },
    {
      header: "ID",
      accessor: (u: AdminUser) => <CopyableId id={u.id} length={6} />,
    },
    {
      header: "Роль",
      accessor: (u: AdminUser) => <RoleBadge role={u.role} />,
    },
    {
      header: "Статус",
      accessor: (u: AdminUser) => <UserStatusBadge status={u.status} />,
    },
    {
      header: "Подтверждён",
      accessor: (u: AdminUser) =>
        u.verified ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Да
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium">
            <XCircle className="w-3.5 h-3.5" /> Нет
          </span>
        ),
    },
    {
      header: "Дата регистрации",
      accessor: (u: AdminUser) => (
        <span className="text-xs text-slate-500">{formatDateTime(u.created_at)}</span>
      ),
    },
    {
      header: "",
      className: "text-right",
      accessor: (u: AdminUser) => (
        <Link
          href={`/admin/users/${u.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900"
        >
          <span>Карточка</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Пользователи</h1>
          <p className="text-xs text-slate-500 mt-1">
            Управление учетными записями, блокировка и аудит действий
          </p>
        </div>
      </div>

      <AdminFilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Поиск по email или ID…",
        }}
        filters={[
          {
            id: "role",
            value: role,
            onChange: setRole,
            options: [
              { value: "", label: "Все роли" },
              { value: "user", label: "Пользователь" },
              { value: "support", label: "Поддержка" },
              { value: "admin", label: "Администратор" },
            ],
          },
          {
            id: "status",
            value: status,
            onChange: setStatus,
            options: [
              { value: "", label: "Все статусы" },
              { value: "active", label: "Активные" },
              { value: "suspended", label: "Заблокированные" },
              { value: "deleting", label: "Удаляемые" },
            ],
          },
          {
            id: "verified",
            value: verified,
            onChange: setVerified,
            options: [
              { value: "", label: "Email: любой" },
              { value: "true", label: "Подтверждён" },
              { value: "false", label: "Не подтверждён" },
            ],
          },
        ]}
        hasActiveFilters={Boolean(search || role || status || verified)}
        onReset={() => {
          setSearch("");
          setRole("");
          setStatus("");
          setVerified("");
        }}
      />

      <AdminTable
        columns={columns}
        data={allItems}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Пользователи не найдены"
        emptySubtext="Попробуйте изменить поисковый запрос или параметры фильтров"
        keyExtractor={(u) => u.id}
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
