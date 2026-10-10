"use client";

import React from "react";
import type { AdminSnapshotDiagnostics } from "../types";
import { CompletenessBadge, CopyableId, formatDateTime } from "./badges";
import { CheckCircle2, AlertTriangle, Layers, FileCheck } from "lucide-react";

export function SnapshotQualityDiagnosticsCard({
  snapshot,
}: {
  snapshot: AdminSnapshotDiagnostics | null;
}) {
  if (!snapshot) {
    return (
      <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center">
        <p className="text-sm text-slate-500">Снимки данных пока отсутствуют</p>
      </div>
    );
  }

  const followersDiff =
    snapshot.expected_followers != null ? snapshot.followers - snapshot.expected_followers : null;
  const followingDiff =
    snapshot.expected_following != null ? snapshot.following - snapshot.expected_following : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">Диагностика качества последнего снимка</h3>
            <CompletenessBadge completeness={snapshot.completeness} />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Зафиксирован: {formatDateTime(snapshot.observed_at)} · Источник: {snapshot.source}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Контрольная сумма:</span>
          <CopyableId id={snapshot.checksum} length={6} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Followers Diagnostics */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 uppercase">
            <span>Подписчики (Followers)</span>
            <Layers className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {snapshot.followers.toLocaleString("ru-RU")}
            {snapshot.expected_followers != null && (
              <span className="text-sm font-normal text-slate-500 ml-1.5">
                из {snapshot.expected_followers.toLocaleString("ru-RU")}
              </span>
            )}
          </div>
          {followersDiff !== null && followersDiff !== 0 ? (
            <p className="text-xs text-amber-700 font-medium">
              Расхождение: {followersDiff > 0 ? `+${followersDiff}` : followersDiff} аккаунтов
            </p>
          ) : (
            <p className="text-xs text-emerald-700 font-medium">Сходятся с ожидаемым счётчиком</p>
          )}
        </div>

        {/* Following Diagnostics */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 uppercase">
            <span>Подписки (Following)</span>
            <Layers className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {snapshot.following.toLocaleString("ru-RU")}
            {snapshot.expected_following != null && (
              <span className="text-sm font-normal text-slate-500 ml-1.5">
                из {snapshot.expected_following.toLocaleString("ru-RU")}
              </span>
            )}
          </div>
          {followingDiff !== null && followingDiff !== 0 ? (
            <p className="text-xs text-amber-700 font-medium">
              Расхождение: {followingDiff > 0 ? `+${followingDiff}` : followingDiff} аккаунтов
            </p>
          ) : (
            <p className="text-xs text-emerald-700 font-medium">Сходятся с ожидаемым счётчиком</p>
          )}
        </div>

        {/* Comparability Check */}
        <div
          className={`p-4 rounded-xl border space-y-2 ${
            snapshot.is_comparable
              ? "bg-emerald-50/50 border-emerald-200/80"
              : "bg-amber-50/50 border-amber-200/80"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 uppercase">
            <span>Пригодность к сравнению</span>
            <FileCheck className="w-4 h-4 text-purple-600" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            {snapshot.is_comparable ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="text-sm font-semibold text-emerald-900">Пригоден для диффов</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                <span className="text-sm font-semibold text-amber-950">Неполные данные</span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {snapshot.is_comparable
              ? "Снимок проверен и может участвовать в расчёте отписок/подписок."
              : "Отсутствие части аккаунтов не подтверждает факт отписки без полной валидации."}
          </p>
        </div>
      </div>
    </div>
  );
}
