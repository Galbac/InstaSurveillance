"use client";
import type { components } from "@/lib/generated-api";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Profile, Job, date } from "@/lib/api";
import {
  PublicConfig,
  polling,
  useVisible,
  terminalStates,
} from "@/lib/workflows";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { ErrorNotice, JobProgress, Loader } from "./common";
type Connection = components["schemas"]["ConnectionDTO"];

function InstagramIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}
export default function ConnectionPanel({
  profile,
  demo = false,
  onDone,
}: {
  profile?: Profile;
  demo?: boolean;
  onDone: () => void;
}) {
  const qc = useQueryClient(),
    visible = useVisible();
  const [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [connectionMode, setConnectionMode] = useState<"password" | "session">("session");
  const flags = useQuery({
    queryKey: ["public-config"],
    queryFn: () => api<PublicConfig>("/config/public"),
    staleTime: 60000,
  });
  const connection = useQuery({
    queryKey: ["connection", profile?.id],
    queryFn: ({ signal }) =>
      api<Connection>(`/profiles/${profile!.id}/connection`, { signal }),
    enabled: !!profile && !demo,
    refetchInterval: visible ? 10000 : false,
  });
  const jobId = job?.id || connection.data?.job?.id;
  const q = useQuery({
    queryKey: ["connection-job", jobId],
    queryFn: ({ signal }) =>
      api<Job>(
        `/${(job || connection.data?.job)?.kind === "sync" ? "syncs" : "instagram/connection-attempts"}/${jobId}`,
        { signal },
      ),
    enabled: !!jobId && !demo,
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.created_at, visible),
  });
  const current = q.data || job || connection.data?.job;
  const pending = !!current && !terminalStates.includes(current.status);
  const enabled = flags.data?.instagram_enabled === true && !demo;
  const [connectErrors, setConnectErrors] = useState<{
    username?: string;
    password?: string;
    consent?: string;
    code?: string;
  }>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    const username = String(data.get("username") || "").trim(),
      password = String(data.get("password") || ""),
      accepted = !!data.get("consent");

    const errs: { username?: string; password?: string; consent?: string } = {};
    if (!username) {
      errs.username = "Укажи username Instagram";
    }
    const sessionText = String(data.get("session_text") || "").trim();
    const sessionFile = data.get("session_file");
    let sessionPayload = "";
    if (connectionMode === "password" && !password) {
      errs.password = "Укажи пароль Instagram";
    }
    if (connectionMode === "session") {
      if (sessionText) {
        sessionPayload = sessionText;
      } else if (sessionFile instanceof File && sessionFile.size > 0) {
        if (sessionFile.size > 65536) {
          errs.password = "Файл session.json должен быть до 64 КБ";
        } else {
          sessionPayload = await sessionFile.text();
        }
      } else {
        errs.password = "Вставьте sessionid / Cookie или прикрепите файл session.json";
      }
    }
    if (!accepted) {
      errs.consent = "Необходимо подтвердить условия подключения";
    }

    if (Object.keys(errs).length > 0) {
      setConnectErrors(errs);
      return;
    }

    setConnectErrors({});
    setBusy(true);
    setError(null);
    try {
      if (!enabled)
        throw new Error("Подключение сейчас отключено. Используйте архив.");
      setJob(
        await post<Job>(
          profile
            ? `/profiles/${profile.id}/connection/reconnect`
            : "/instagram/connections",
          {
            username,
            ...(connectionMode === "session"
              ? { session_json: sessionPayload }
              : { password }),
            accepted_connection_risks: accepted,
            connection_terms_version: flags.data!.connection_terms_version,
          },
        ),
      );
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      code = String(new FormData(form).get("code") || "").trim();

    if (!code || !/^[0-9]{6,8}$/.test(code)) {
      setConnectErrors({ code: "Введи 6-8 цифр кода подтверждения" });
      return;
    }

    setConnectErrors({});
    setBusy(true);
    setError(null);
    try {
      setJob(
        await post<Job>(
          `/instagram/connection-attempts/${current!.id}/verify`,
          { verification_code: code },
        ),
      );
      q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 40px", width: "100%" }}>
      <section
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#ffffff",
          borderRadius: 20,
          border: "1px solid #e2e8f0",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05)",
          padding: "36px 32px 30px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxSizing: "border-box",
        }}
      >
        {/* Instagram Header Brand / Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              boxShadow: "0 4px 12px rgba(220, 39, 67, 0.25)",
            }}
          >
            <InstagramIcon size={26} />
          </div>
          <span
            style={{
              fontFamily: "var(--font-heading, inherit)",
              fontWeight: 700,
              fontSize: 22,
              letterSpacing: "-0.5px",
              color: "#1e293b",
            }}
          >
            Instagram
          </span>
        </div>

        <p
          style={{
            fontSize: 13,
            color: "#64748b",
            textAlign: "center",
            lineHeight: 1.5,
            margin: "0 0 24px",
          }}
        >
          {profile
            ? `Переподключение аккаунта @${profile.username}`
            : "Подключи аккаунт для отслеживания взаимности и изменений"}
        </p>

        {!enabled && (
          <div className="notice" style={{ width: "100%", marginBottom: 18 }}>
            Автоматическое подключение{" "}
            {demo
              ? "недоступно в демо"
              : "отключено оператором или настройки загружаются"}
            . <Link href="/app/imports/new">Загрузить архив</Link>
          </div>
        )}

        {connection.data && (
          <div
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              fontSize: 12,
              color: "#475569",
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            Состояние:{" "}
            <strong>
              {{
                active: "Подключён",
                disconnected: "Не подключён",
                connecting: "Подключение…",
                syncing: "Идёт сбор данных",
                cooldown: "Ожидание после ограничения",
                challenge_required: "Требуется проверка в Instagram",
                reconnect_required: "Требуется переподключение",
                provider_unavailable: "Instagram временно недоступен",
                paused_by_user: "Приостановлено",
                disabled: "Отключено",
              }[connection.data.display_status] || connection.data.display_status}
            </strong>
            {connection.data.next_allowed_at && (
              <> • Следующее обновление доступно после {date(connection.data.next_allowed_at)}</>
            )}
          </div>
        )}

        {current && (pending || current.error_code) && (
          <JobProgress job={current} />
        )}
        <ErrorNotice error={error || q.error || connection.error} />

        {current?.status === "awaiting_2fa" ? (
          <form noValidate onSubmit={verify} style={{ width: "100%" }}>
            <p style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 16 }}>
              Введите код из{" "}
              {current.details.method === "totp"
                ? "приложения аутентификации (Google Authenticator)"
                : "SMS или почты"}
            </p>
            <label style={{ width: "100%" }}>
              Код безопасности
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,8}"
                required
                maxLength={8}
                placeholder="6-значный код"
                aria-invalid={!!connectErrors.code}
                onChange={() => {
                  if (connectErrors.code) {
                    setConnectErrors((prev) => ({ ...prev, code: undefined }));
                  }
                }}
              />
              {connectErrors.code && (
                <span className="field-error" role="alert">
                  {connectErrors.code}
                </span>
              )}
            </label>
            <button className="button full" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? "Проверяем…" : "Подтвердить код"}
            </button>
          </form>
        ) : pending ? (
          <Loader />
        ) : connection.data?.display_status === "active" || connection.data?.display_status === "paused_by_user" ? (
          <p role="status">
            Аккаунт подключён. Повторный вход не требуется.
            {connection.data.next_sync && !connection.data.last_sync && (
              <> Первый сбор запланирован на {date(connection.data.next_sync)}.</>
            )}
          </p>
        ) : (
          <form noValidate onSubmit={submit} style={{ width: "100%" }}>
            <label style={{ width: "100%" }}>
              Имя пользователя
              <input
                name="username"
                required
                maxLength={30}
                defaultValue={profile?.username}
                autoComplete="username"
                readOnly={!!profile}
                placeholder="username"
                aria-invalid={!!connectErrors.username}
                onChange={() => {
                  if (connectErrors.username) {
                    setConnectErrors((prev) => ({
                      ...prev,
                      username: undefined,
                    }));
                  }
                }}
              />
              {connectErrors.username && (
                <span className="field-error" role="alert">
                  {connectErrors.username}
                </span>
              )}
            </label>

            <label style={{ width: "100%", marginTop: 12 }}>
              Способ подключения
              <select
                value={connectionMode}
                onChange={(e) => {
                  setConnectionMode(e.target.value as "password" | "session");
                  setConnectErrors({});
                  setError(null);
                }}
              >
                <option value="session">Через Session ID / Cookie (Рекомендуется)</option>
                <option value="password">Логин и пароль</option>
              </select>
            </label>
            {connectionMode === "session" ? (
              <div style={{ width: "100%", marginTop: 12 }}>
                <label style={{ width: "100%", display: "block" }}>
                  Session ID или строка Cookie
                  <textarea
                    name="session_text"
                    rows={3}
                    placeholder="Вставьте sessionid (например, 5827361823%3AQwErTy...) или строку Cookie из браузера"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      fontFamily: "monospace",
                      fontSize: 12,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: connectErrors.password ? "1px solid #ef4444" : "1px solid #cbd5e1",
                      resize: "vertical",
                      marginTop: 4,
                    }}
                    aria-invalid={!!connectErrors.password}
                    onChange={() => {
                      if (connectErrors.password) {
                        setConnectErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                  />
                </label>

                <div
                  style={{
                    margin: "8px 0 12px",
                    padding: "10px 12px",
                    background: "#f8fafc",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    fontSize: 12,
                    color: "#475569",
                    lineHeight: 1.5,
                  }}
                >
                  <strong style={{ color: "#1e293b" }}>💡 Как скопировать sessionid из браузера за 10 секунд:</strong>
                  <ol style={{ margin: "6px 0 0", paddingLeft: 18, color: "#64748b" }}>
                    <li>Откройте instagram.com в Chrome/Safari/Firefox (где выполнен вход в аккаунт)</li>
                    <li>Нажмите <kbd style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4 }}>F12</kbd> (или ПКМ → «Просмотреть код») → вкладка <strong>Application</strong> (или «Хранилище»)</li>
                    <li>Слева выберите <strong>Cookies</strong> → <code>https://www.instagram.com</code></li>
                    <li>Дважды кликните и скопируйте значение <strong>sessionid</strong></li>
                  </ol>
                </div>

                <details style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                  <summary style={{ cursor: "pointer", color: "#3b82f6" }}>Или загрузить файл session.json</summary>
                  <input
                    name="session_file"
                    type="file"
                    accept=".json,application/json"
                    style={{ width: "100%", minWidth: 0, marginTop: 8 }}
                  />
                </details>
                {connectErrors.password && (
                  <span className="field-error" role="alert" style={{ marginTop: 6, display: "block" }}>
                    {connectErrors.password}
                  </span>
                )}
              </div>
            ) : (
            <label style={{ width: "100%", marginTop: 12 }}>
              Пароль
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  maxLength={256}
                  required
                  placeholder="Пароль"
                  style={{ paddingRight: 40 }}
                  aria-invalid={!!connectErrors.password}
                  onChange={() => {
                    if (connectErrors.password) {
                      setConnectErrors((prev) => ({
                        ...prev,
                        password: undefined,
                      }));
                    }
                  }}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
              {connectErrors.password && (
                <span className="field-error" role="alert">
                  {connectErrors.password}
                </span>
              )}
            </label>

            )}

            <div style={{ margin: "16px 0 20px" }}>
              <label className="check" style={{ margin: 0, alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  name="consent"
                  required
                  defaultChecked
                  aria-invalid={!!connectErrors.consent}
                  onChange={() => {
                    if (connectErrors.consent) {
                      setConnectErrors((prev) => ({
                        ...prev,
                        consent: undefined,
                      }));
                    }
                  }}
                />
                <span style={{ fontSize: 12, lineHeight: 1.4, color: "#64748b" }}>
                  Принимаю условия прямого подключения Instagram.
                </span>
              </label>
              {connectErrors.consent && (
                <span className="field-error" role="alert">
                  {connectErrors.consent}
                </span>
              )}
            </div>

            <button
              className="button full"
              disabled={busy || !enabled}
              style={{
                background: "linear-gradient(135deg, #0095f6 0%, #0077e6 100%)",
                border: "none",
                fontWeight: 600,
                boxShadow: "0 2px 8px rgba(0, 149, 246, 0.25)",
              }}
            >
              {busy
                ? "Подключение…"
                : "Войти"}
            </button>
          </form>
        )}

        {pending && current?.kind === "connect" && (
          <button
            className="button secondary full"
            disabled={busy}
            style={{ marginTop: 12 }}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/instagram/connection-attempts/${current.id}`, {
                  method: "DELETE",
                });
                await q.refetch();
                qc.invalidateQueries();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Отменить попытку
          </button>
        )}

        {(current?.status === "completed" || connection.data?.display_status === "active") && (
          <button
            className="button full"
            style={{ marginTop: 12 }}
            onClick={onDone}
          >
            Открыть обзор
          </button>
        )}

        {profile && ["active", "syncing", "paused_by_user"].includes(connection.data?.display_status || "") && (
          <button
            className="button danger full"
            style={{ marginTop: 14 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/profiles/${profile.id}/connection`, { method: "DELETE" });
                setJob(null);
                await connection.refetch();
                qc.invalidateQueries();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Отключить Instagram
          </button>
        )}

        <div
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #f1f5f9",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          <ShieldCheck size={16} color="#10b981" />
          <span>Сквозное шифрование и конфиденциальность</span>
        </div>
      </section>
    </div>
  );
}
export function SyncPanel({ id }: { id: string }) {
  const visible = useVisible(),
    qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const q = useQuery({
    queryKey: ["sync", id],
    queryFn: ({ signal }) => api<Job>(`/syncs/${id}`, { signal }),
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.created_at, visible),
  });
  return (
    <section className="panel">
      <h2>Сбор списков Instagram</h2>
      <ErrorNotice error={error || q.error} />
      {q.isPending ? (
        <Loader />
      ) : q.data ? (
        <>
          <JobProgress job={q.data} />
          <div className="sync-actions-row">
            {!terminalStates.includes(q.data.status) && (
              <button
                className="button secondary danger-outline"
                onClick={async () => {
                  try {
                    await post(`/syncs/${id}/cancel`, {});
                    await q.refetch();
                    qc.invalidateQueries({ queryKey: ["profiles"] });
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                Отменить сбор
              </button>
            )}
            {q.data.status === "completed" && (
              <Link className="button" href="/app">
                Открыть обзор
              </Link>
            )}
            <Link className="button secondary" href="/app">
              Вернуться в кабинет
            </Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
