"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { errorText } from "@/lib/workflows";
import type { AdminAuthStatus, Privilege } from "./types";
import { ShieldAlert, KeyRound, Loader2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

interface AdminAuthContextType {
  status: AdminAuthStatus | null;
  isLoading: boolean;
  isPrivileged: boolean;
  secondsRemaining: number | null;
  role: string | null;
  isAdmin: boolean;
  isSupport: boolean;
  openMfaModal: () => void;
  refetchStatus: () => Promise<unknown>;
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [mfaModalOpen, setMfaModalOpen] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery<AdminAuthStatus>({
    queryKey: ["admin-auth-status"],
    queryFn: ({ signal }) => api<AdminAuthStatus>("/admin/auth/status", { signal }),
    staleTime: 10_000,
    retry: 1,
  });

  const isPrivileged = Boolean(status?.privileged && secondsRemaining !== null && secondsRemaining > 0);
  const role = status?.role ?? null;
  const isAdmin = role === "admin";
  const isSupport = role === "support" || role === "admin";

  // Calculate timer
  useEffect(() => {
    if (!status?.privileged || !status?.privileged_until) {
      setSecondsRemaining(null);
      return;
    }

    const expiryMs = new Date(status.privileged_until).getTime();

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        // Privilege expired
        qc.removeQueries({ queryKey: ["admin"] });
        refetch();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [status?.privileged, status?.privileged_until, qc, refetch]);

  // Open MFA modal automatically when user is admin/support but not privileged
  useEffect(() => {
    if (!isLoading && status && !isPrivileged) {
      setMfaModalOpen(true);
    }
  }, [isLoading, status, isPrivileged]);

  const handleMfaSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const code = mfaCode.trim();
      if (code.length < 6) {
        setMfaError("Код должен содержать не менее 6 знаков");
        return;
      }
      setMfaSubmitting(true);
      setMfaError(null);
      try {
        await post<Privilege>("/admin/auth/mfa/challenge", { code });
        setMfaCode("");
        setMfaModalOpen(false);
        await refetch();
        qc.invalidateQueries({ queryKey: ["admin"] });
      } catch (err) {
        setMfaError(errorText(err) || "Код неверен или уже использован");
      } finally {
        setMfaSubmitting(false);
      }
    },
    [mfaCode, qc, refetch]
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <p className="text-sm font-medium">Проверка прав администратора…</p>
        </div>
      </div>
    );
  }

  if (isError || (!isAdmin && !isSupport)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Доступ ограничен</h1>
          <p className="text-slate-600 text-sm mb-6">
            Раздел предназначен только для администраторов и специалистов службы поддержки.
          </p>
          <a
            href="/app"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-purple-700 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
          >
            Вернуться в личный кабинет
          </a>
        </div>
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider
      value={{
        status: status ?? null,
        isLoading,
        isPrivileged,
        secondsRemaining,
        role,
        isAdmin,
        isSupport,
        openMfaModal: () => setMfaModalOpen(true),
        refetchStatus: refetch,
      }}
    >
      {children}

      <Dialog.Root open={mfaModalOpen} onOpenChange={(open) => !isPrivileged ? null : setMfaModalOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 z-50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-bold text-slate-900">
                  Подтверждение входа (MFA)
                </Dialog.Title>
                <Dialog.Description className="text-xs text-slate-500">
                  Привилегированная сессия действует 15 минут
                </Dialog.Description>
              </div>
            </div>

            <p className="text-sm text-slate-600 mb-5 leading-relaxed">
              Введите 6-значный одноразовый код из вашего приложения-аутентификатора (TOTP) или резервный ключ.
            </p>

            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div>
                <label htmlFor="mfa-code-input" className="block text-xs font-semibold uppercase text-slate-500 mb-1.5">
                  Одноразовый код
                </label>
                <input
                  id="mfa-code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => {
                    setMfaCode(e.target.value);
                    if (mfaError) setMfaError(null);
                  }}
                  disabled={mfaSubmitting}
                  autoFocus
                  className="w-full text-center tracking-[0.3em] font-mono text-xl py-3 px-4 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-all"
                />
                {mfaError && (
                  <p className="text-xs text-red-600 mt-2 font-medium" role="alert">
                    {mfaError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                {isPrivileged ? (
                  <button
                    type="button"
                    onClick={() => setMfaModalOpen(false)}
                    className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium"
                  >
                    Отмена
                  </button>
                ) : (
                  <a href="/app" className="text-xs text-purple-700 hover:underline">
                    В кабинет
                  </a>
                )}
                <button
                  type="submit"
                  disabled={mfaSubmitting || mfaCode.trim().length < 6}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white font-medium text-sm rounded-xl hover:bg-purple-700 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm"
                >
                  {mfaSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Подтвердить
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return context;
}
