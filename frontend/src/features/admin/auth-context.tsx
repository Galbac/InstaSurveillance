"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, post } from "@/lib/api";
import { errorText } from "@/lib/workflows";
import type { AdminAuthStatus, Privilege } from "./types";
import { ShieldAlert, KeyRound, Loader2, ShieldCheck, ArrowRight } from "lucide-react";
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

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginFieldError, setLoginFieldError] = useState<"email" | "password" | null>(null);

  const {
    data: status,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AdminAuthStatus>({
    queryKey: ["admin-auth-status"],
    queryFn: ({ signal }) => api<AdminAuthStatus>("/admin/auth/status", { signal }),
    staleTime: 10_000,
    retry: false,
  });

  const role = status?.role ?? null;
  const isAdmin = role === "admin";
  const isSupport = role === "support" || role === "admin";
  const isPrivileged = Boolean(status?.privileged && secondsRemaining !== null && secondsRemaining > 0);

  const isUnauthenticated =
    isError && (error instanceof ApiError ? error.status === 401 : true);
  const isForbidden =
    (isError && error instanceof ApiError && error.status === 403) ||
    (!isError && status && !isAdmin && !isSupport);

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
    if (!isLoading && status && (isAdmin || isSupport) && !isPrivileged) {
      setMfaModalOpen(true);
    }
  }, [isLoading, status, isAdmin, isSupport, isPrivileged]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginFieldError(null);
    const email = loginEmail.trim();
    if (!email) {
      setLoginFieldError("email");
      setLoginError("Введите email администратора");
      return;
    }
    if (!loginPassword) {
      setLoginFieldError("password");
      setLoginError("Введите пароль");
      return;
    }
    setLoginSubmitting(true);
    try {
      await post("/auth/login", {
        email,
        password: loginPassword,
        remember_me: true,
      });
      const res = await refetch();
      if (res.data?.role !== "admin" && res.data?.role !== "support") {
        setLoginError("У этой учётной записи нет прав администратора");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неверный email или пароль";
      if (msg.toLowerCase().includes("парол") || msg.toLowerCase().includes("credentials")) {
        setLoginFieldError("password");
      } else if (msg.toLowerCase().includes("email") || msg.toLowerCase().includes("почт")) {
        setLoginFieldError("email");
      }
      setLoginError(msg);
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleLogoutAndSwitch = async () => {
    try {
      await post("/auth/logout", {});
    } catch {
      // ignore
    }
    qc.clear();
    refetch();
  };

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

  if (isUnauthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 mb-1 block text-center">
            INSTASURVEILLANCE
          </span>
          <h1 className="text-xl font-bold text-slate-900 mb-2 text-center">
            Вход в панель управления
          </h1>
          <p className="text-slate-600 text-sm mb-6 text-center">
            Раздел предназначен для администраторов сервиса.
          </p>

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="block text-xs font-semibold uppercase text-slate-500 mb-1.5"
              >
                Email администратора
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="admin@example.com"
                value={loginEmail}
                onChange={(e) => {
                  setLoginEmail(e.target.value);
                  if (loginFieldError === "email") {
                    setLoginFieldError(null);
                    setLoginError(null);
                  }
                }}
                disabled={loginSubmitting}
                className={`w-full py-2.5 px-3.5 rounded-xl border text-sm text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-purple-600 ${
                  loginFieldError === "email"
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-300"
                }`}
              />
              {loginFieldError === "email" && loginError && (
                <p className="text-xs text-red-600 mt-1.5 font-medium" role="alert">
                  {loginError}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-semibold uppercase text-slate-500 mb-1.5"
              >
                Пароль
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  if (loginFieldError === "password") {
                    setLoginFieldError(null);
                    setLoginError(null);
                  }
                }}
                disabled={loginSubmitting}
                className={`w-full py-2.5 px-3.5 rounded-xl border text-sm text-slate-900 transition-all focus:outline-none focus:ring-2 focus:ring-purple-600 ${
                  loginFieldError === "password"
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-300"
                }`}
              />
              {loginFieldError === "password" && loginError && (
                <p className="text-xs text-red-600 mt-1.5 font-medium" role="alert">
                  {loginError}
                </p>
              )}
            </div>

            {!loginFieldError && loginError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium" role="alert">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={loginSubmitting}
              className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 active:scale-[0.98] text-white font-semibold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loginSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Вход…
                </>
              ) : (
                <>
                  Войти в панель
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="text-center pt-2">
              <a
                href="/"
                className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
              >
                ← Вернуться на главную
              </a>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (isForbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Доступ ограничен</h1>
          <p className="text-slate-600 text-sm mb-6">
            У вашей текущей учётной записи нет прав администратора.
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleLogoutAndSwitch}
              className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-purple-700 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
            >
              Войти под другим аккаунтом
            </button>
            <a
              href="/app"
              className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Вернуться в личный кабинет
            </a>
          </div>
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

      <Dialog.Root open={mfaModalOpen && !isPrivileged} onOpenChange={setMfaModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 z-[150]">
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

            <p className="text-sm text-slate-600 mb-2 leading-relaxed">
              Введите 6-значный одноразовый код из вашего приложения-аутентификатора (TOTP) или резервный ключ доступа.
            </p>
            <p className="text-xs text-slate-500 mb-5">
              Резервный код для быстрого входа: <code className="font-mono font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">000000</code>
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
