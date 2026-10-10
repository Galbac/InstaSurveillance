"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminTicket } from "@/features/admin/types";
import {
  CopyableId,
  TicketStatusBadge,
  formatDateTime,
} from "@/features/admin/components/badges";
import { ErrorNotice } from "@/features/common";
import {
  ArrowLeft,
  Send,
  MessageSquare,
  CheckCircle2,
  Loader2,
} from "lucide-react";

export default function AdminTicketDetailPage() {
  const params = useParams();
  const ticketId = params?.id as string;
  const qc = useQueryClient();
  const { isPrivileged } = useAdminAuth();

  const [replyText, setReplyText] = useState("");
  const [replyStatus, setReplyStatus] = useState<"open" | "in_progress" | "resolved">("resolved");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [successNotice, setSuccessNotice] = useState(false);

  const {
    data: ticket,
    isLoading,
    error,
    refetch,
  } = useQuery<AdminTicket>({
    queryKey: ["admin", "support", ticketId],
    queryFn: async ({ signal }) => {
      const data = await api<AdminTicket>(`/admin/support/tickets/${ticketId}`, { signal });
      setReplyText(data.reply || "");
      setReplyStatus((data.status as "open" | "in_progress" | "resolved") || "resolved");
      return data;
    },
    enabled: isPrivileged && Boolean(ticketId),
  });

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    setSuccessNotice(false);
    try {
      await api(`/admin/support/tickets/${ticketId}`, {
        method: "PATCH",
        body: JSON.stringify({
          reply: replyText.trim(),
          status: replyStatus,
        }),
      });
      setSuccessNotice(true);
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "support"] });
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

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Link href="/admin/support" className="inline-flex items-center gap-1.5 text-xs text-purple-700 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> К списку обращений
        </Link>
        <ErrorNotice error={error || new Error("Обращение не найдено")} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/support"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-all"
            title="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-slate-900">Обращение: {ticket.category}</span>
              <TicketStatusBadge status={ticket.status} />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
              <span>ID:</span>
              <CopyableId id={ticket.id} length={6} />
              {ticket.owner_email && (
                <>
                  <span>· От:</span>
                  <Link
                    href={`/admin/users/${ticket.id}`}
                    className="text-purple-700 hover:underline font-semibold"
                  >
                    {ticket.owner_email}
                  </Link>
                </>
              )}
              <span>· Создано: {formatDateTime(ticket.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ticket Details & Request ID */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Сообщение клиента
          </span>
          {ticket.request_id && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Номер запроса:</span>
              <CopyableId id={ticket.request_id} length={8} />
              <Link
                href={`/admin/audit?request_id=${ticket.request_id}`}
                className="text-xs font-semibold text-purple-700 hover:underline ml-1"
              >
                Аудит запроса →
              </Link>
            </div>
          )}
        </div>

        <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
      </div>

      {/* Reply Form */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-purple-600" />
          <h2 className="text-base font-bold text-slate-900">Ответ службы поддержки</h2>
        </div>
        <p className="text-xs text-slate-500">
          Ответ будет мгновенно отображён пользователю в разделе «Помощь», а также отправлено уведомление.
        </p>

        {successNotice && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            Ответ успешно сохранён, уведомление отправлено пользователю.
          </div>
        )}

        <ErrorNotice error={actionError} />

        <form onSubmit={handleSubmitReply} className="space-y-4">
          <div>
            <label htmlFor="ticket-reply-text" className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">
              Текст ответа (до 5000 знаков)
            </label>
            <textarea
              id="ticket-reply-text"
              rows={6}
              maxLength={5000}
              required
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Напишите развёрнутый ответ пользователю…"
              className="w-full p-3.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-all leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-3">
              <label htmlFor="ticket-status-select" className="text-xs font-semibold text-slate-700">
                Новый статус:
              </label>
              <select
                id="ticket-status-select"
                value={replyStatus}
                onChange={(e) =>
                  setReplyStatus(e.target.value as "open" | "in_progress" | "resolved")
                }
                className="py-2 px-3 text-sm bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-800 cursor-pointer"
              >
                <option value="open">Открыто (open)</option>
                <option value="in_progress">В работе (in_progress)</option>
                <option value="resolved">Решено (resolved)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting || replyText.trim().length === 0}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple-600 hover:bg-purple-700 active:scale-[0.98] text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-all"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>Отправить ответ</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
