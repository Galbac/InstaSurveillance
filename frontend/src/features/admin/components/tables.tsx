"use client";

import React from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { errorText } from "@/lib/workflows";

interface AdminTableProps<T> {
  columns: {
    header: string;
    accessor?: (item: T) => React.ReactNode;
    className?: string;
  }[];
  data: T[] | undefined;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage?: string;
  emptySubtext?: string;
  renderRow?: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T) => string;
}

export function AdminTable<T>({
  columns,
  data,
  isLoading,
  error,
  onRetry,
  emptyMessage = "Нет записей",
  emptySubtext = "По заданным фильтрам ничего не найдено",
  renderRow,
  keyExtractor,
}: AdminTableProps<T>) {
  if (error) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-rose-200">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-900 mb-1">Ошибка загрузки данных</h3>
        <p className="text-sm text-slate-600 mb-4 max-w-md mx-auto">{errorText(error)}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-xl transition-all shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Повторить запрос
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/75">
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`py-3.5 px-4 font-semibold text-slate-700 text-xs tracking-wider uppercase whitespace-nowrap ${
                    col.className || ""
                  }`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              // Shimmer skeleton rows
              Array.from({ length: 6 }).map((_, rIdx) => (
                <tr key={rIdx} className="animate-pulse">
                  {columns.map((_, cIdx) => (
                    <td key={cIdx} className="py-4 px-4">
                      <div className="h-4 bg-slate-200/70 rounded-md w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : !data || data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16 px-4 text-center">
                  <div className="max-w-xs mx-auto flex flex-col items-center">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                      <Inbox className="w-6 h-6" />
                    </div>
                    <p className="text-base font-semibold text-slate-800 mb-1">{emptyMessage}</p>
                    <p className="text-xs text-slate-500">{emptySubtext}</p>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, idx) =>
                renderRow ? (
                  renderRow(item, idx)
                ) : (
                  <tr key={keyExtractor(item)} className="hover:bg-slate-50/80 transition-colors">
                    {columns.map((col, cIdx) => (
                      <td key={cIdx} className={`py-3.5 px-4 ${col.className || ""}`}>
                        {col.accessor ? col.accessor(item) : null}
                      </td>
                    ))}
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
