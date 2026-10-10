"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api";

import { useAdminAuth } from "@/features/admin/auth-context";
import type { AdminProfileDetail } from "@/features/admin/types";
import { SnapshotQualityDiagnosticsCard } from "@/features/admin/components/quality-indicator";
import {
  CopyableId,
  ProfileStatusBadge,
  JobStatusBadge,
  JobKindBadge,
  formatDateTime,
  InstagramIcon,
} from "@/features/admin/components/badges";
import { ErrorNotice, Modal } from "@/features/common";
import {
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  KeyRound,
  Loader2,
} from "lucide-react";

export default function AdminProfileDetailPage() {
  const params = useParams();
  const profileId = params?.id as string;
  const qc = useQueryClient();
  const { isPrivileged, isAdmin } = useAdminAuth();

  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionReason, setActionReason] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useQuery<AdminProfileDetail>({
    queryKey: ["admin", "profiles", profileId],
    queryFn: ({ signal }) => api<AdminProfileDetail>(`/admin/profiles/${profileId}`, { signal }),
    enabled: isPrivileged && Boolean(profileId),
  });

  const handlePauseResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (actionReason.trim().length < 5 || !profile) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      const endpoint = profile.paused ? "resume" : "pause";
      await post(`/admin/profiles/${profileId}/${endpoint}`, { reason: actionReason.trim() });
      setActionModalOpen(false);
      setActionReason("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["admin", "profiles"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    } catch (err) {
      setActionError(err);
    } finally {
      setActionSubmitting(false);
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

  if (error || !profile) {
    return (
      <div className="space-y-4">
        <Link href="/admin/profiles" className="inline-flex items-center gap-1.5 text-xs text-purple-700 hover:underline">
          <ArrowLeft className="w-3.5 h-3.5" /> К списку профилей
        </Link>
        <ErrorNotice error={error || new Error("Профиль не найден")} />
      </div>
    );
  }

  const hasCooldown = Boolean(
    profile.cooldown_until && new Date(profile.cooldown_until) > new Date()
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/profiles"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-200 transition-all"
            title="Назад"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <InstagramIcon className="w-5 h-5 text-purple-600 shrink-0" />
              <h1 className="text-2xl font-bold text-slate-900">@{profile.username}</h1>
              <ProfileStatusBadge
                status={profile.status}
                paused={profile.paused}
                hasCooldown={hasCooldown}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
              <span>ID:</span>
              <CopyableId id={profile.id} />
              {profile.owner_email && (
                <>
                  <span>· Владелец:</span>
                  <Link
                    href={`/admin/users/${profile.user_id}`}
                    className="text-purple-700 hover:underline font-semibold"
                  >
                    {profile.owner_email}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Admin Pause / Resume */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setActionReason("");
              setActionModalOpen(true);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border transition-all shadow-sm ${
              profile.paused
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
            }`}
          >
            {profile.paused ? (
              <>
                <PlayCircle className="w-4 h-4" />
                Возобновить сбор (Resume)
              </>
            ) : (
              <>
                <PauseCircle className="w-4 h-4" />
                Приостановить сбор (Pause)
              </>
            )}
          </button>
        )}
      </div>

      {/* Snapshot Diagnostics Component */}
      <SnapshotQualityDiagnosticsCard snapshot={profile.latest_snapshot} />

      {/* Profile Parameters Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Подключение (Сессия)</span>
          <div className="flex items-center gap-2 pt-1">
            <KeyRound className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-bold text-slate-900">
              {profile.has_connection ? "Секрет сохранён" : "Не подключено"}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {profile.key_version ? `Версия ключа: v${profile.key_version}` : "Ключ отсутствует"}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Поколение (Generation)</span>
          <div className="text-xl font-bold text-slate-900 pt-0.5">{profile.generation}</div>
          <p className="text-xs text-slate-500">Увеличивается при смене состояния для отмены воркеров</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Интервал опроса</span>
          <div className="text-xl font-bold text-slate-900 pt-0.5">{profile.interval_hours} ч</div>
          <p className="text-xs text-slate-500">Следующий сбор: {formatDateTime(profile.next_sync)}</p>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Защитная пауза (Cooldown)</span>
          <div className="text-sm font-bold text-slate-900 pt-1">
            {hasCooldown ? formatDateTime(profile.cooldown_until) : "Не активна"}
          </div>
          <p className="text-xs text-slate-500">
            {hasCooldown ? "Снижение риска санкций Instagram" : "Запросы разрешены по расписанию"}
          </p>
        </div>
      </div>

      {/* Recent Jobs Table */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">История заданий профиля</h2>
          <Link
            href={`/admin/jobs?profile_id=${profile.id}`}
            className="text-xs font-semibold text-purple-700 hover:underline"
          >
            Все задания профиля →
          </Link>
        </div>

        {profile.recent_jobs.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">Заданий нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Тип</th>
                  <th className="py-2.5 px-3">Статус</th>
                  <th className="py-2.5 px-3">Этап</th>
                  <th className="py-2.5 px-3">Ошибка</th>
                  <th className="py-2.5 px-3">Создано</th>
                  <th className="py-2.5 px-3 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {profile.recent_jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3">
                      <JobKindBadge kind={j.kind} />
                    </td>
                    <td className="py-2.5 px-3">
                      <JobStatusBadge status={j.status} />
                    </td>
                    <td className="py-2.5 px-3 font-mono">{j.stage}</td>
                    <td className="py-2.5 px-3 text-rose-600 font-mono">{j.error_code || "—"}</td>
                    <td className="py-2.5 px-3 text-slate-500">{formatDateTime(j.created_at)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Link
                        href={`/admin/jobs/${j.id}`}
                        className="inline-flex items-center gap-1 font-semibold text-purple-700 hover:underline"
                      >
                        Детали →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pause / Resume Modal */}
      {actionModalOpen && (
        <Modal
          title={profile.paused ? "Возобновить сбор данных?" : "Приостановить сбор данных?"}
          onClose={() => setActionModalOpen(false)}
        >
          <form onSubmit={handlePauseResume} className="space-y-4 pt-2">
            <p className="text-xs text-slate-600 leading-relaxed">
              {profile.paused
                ? "Профиль будет возвращён в очередь планировщика. Возобновление НЕ сбрасывает Instagram cooldown и НЕ запускает сбор мгновенно."
                : "Профиль будет приостановлен. Поколение (generation) будет увеличено, что отменит все незавершённые фоновые сборы."}
            </p>

            <ErrorNotice error={actionError} />

            <div>
              <label htmlFor="action-reason" className="block text-xs font-semibold text-slate-700 uppercase mb-1">
                Обязательная причина (от 5 до 500 символов)
              </label>
              <textarea
                id="action-reason"
                rows={3}
                required
                minLength={5}
                maxLength={500}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Укажите причину для записи в журнал аудита…"
                className="w-full p-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setActionModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={actionSubmitting || actionReason.trim().length < 5}
                className={`inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl transition-all shadow-sm ${
                  profile.paused
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-amber-600 hover:bg-amber-700"
                }`}
              >
                {actionSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {profile.paused ? "Возобновить" : "Приостановить"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
