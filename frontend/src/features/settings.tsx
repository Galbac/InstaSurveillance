"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Globe,
  Lock,
  Mail,
  Bell,
  Monitor,
  Smartphone,
  Database,
  Trash2,
  UserX,
  ShieldAlert,
  Eye,
  EyeOff,
  ChevronDown,
  Power,
  Pause,
  Play,
  RefreshCw,
  Unlink,
  User as UserIcon,
  Clock,
  Download,
} from "lucide-react";
import { api, post, User, Profile } from "@/lib/api";
import type { components } from "@/lib/generated-api";
import { useUrlValue, useVisible } from "@/lib/workflows";
import { ErrorNotice, ExportButton, Modal } from "./common";

type Session = components["schemas"]["SessionDTO"];
type NotificationSettings = components["schemas"]["NotificationPreferences"];

function InstagramIcon({ size = 20 }: { size?: number }) {
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

const MOCK_DEMO_SESSIONS = [
  {
    id: "demo-session-1",
    device: "Chrome · macOS · Moscow, Russia",
    title: "Текущая сессия",
    isCurrent: true,
    isOnline: true,
    type: "laptop",
  },
  {
    id: "demo-session-2",
    device: "Safari · macOS · Moscow, Russia",
    title: "MacBook Pro",
    isCurrent: false,
    dateStr: "12 марта 2025, 14:32",
    type: "laptop",
  },
  {
    id: "demo-session-3",
    device: "Instagram App · iOS · Moscow, Russia",
    title: "iPhone",
    isCurrent: false,
    dateStr: "10 марта 2025, 09:15",
    type: "phone",
  },
];

export default function SettingsPanel({
  user,
  profile,
  demo = false,
  onNotice,
}: {
  user?: User;
  profile?: Profile;
  demo?: boolean;
  onNotice: (text: string) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const visible = useVisible();

  const [error, setError] = useState<unknown>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Form states
  const [timezone, setTimezone] = useState(
    user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow",
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);

  // Email form states
  const [newEmail, setNewEmail] = useState("");
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [showEmailPass, setShowEmailPass] = useState(false);

  // Profile fields state
  const [profileLabel, setProfileLabel] = useState(profile?.label || "Демо");
  const [profileInterval, setProfileInterval] = useState(
    String(profile?.interval_hours || 24),
  );
  const [isPaused, setIsPaused] = useState(profile?.paused || false);

  // Deletion modal state
  const [deleting, setDeleting] = useState<
    "account" | "profile" | "history" | null
  >(null);

  const [historyReceipt, setHistoryReceipt] = useUrlValue("history_receipt", "");
  const historyCleanup = useQuery({
    queryKey: ["history-cleanup", historyReceipt],
    queryFn: ({ signal }) =>
      api<components["schemas"]["DeletionStatusDTO"]>(
        `/privacy/requests/${historyReceipt}`,
        { signal },
      ),
    enabled: !!historyReceipt && !demo,
    refetchInterval: (query) =>
      visible && query.state.data?.status !== "completed" ? 5000 : false,
  });

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: ({ signal }) => api<Session[]>("/me/sessions", { signal }),
    enabled: !demo,
  });

  const preferences = useQuery({
    queryKey: ["notification-settings"],
    queryFn: ({ signal }) =>
      api<NotificationSettings>("/me/notification-settings", { signal }),
    enabled: !demo,
  });

  // Local notification toggles state (initialized with demo/backend defaults)
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    email_results: true,
    email_connection: false,
    email_support: false,
    in_app_results: true,
    in_app_connection: true,
  });

  useEffect(() => {
    if (preferences.data) {
      setToggles({
        email_results: preferences.data.email_results,
        email_connection: preferences.data.email_connection,
        email_support: preferences.data.email_support,
        in_app_results: preferences.data.in_app_results,
        in_app_connection: preferences.data.in_app_connection,
      });
    }
  }, [preferences.data]);

  const handleToggle = async (key: string) => {
    const updated = !toggles[key];
    setToggles((prev) => ({ ...prev, [key]: updated }));

    if (!demo) {
      try {
        const nextSettings = { ...toggles, [key]: updated };
        await api("/me/notification-settings", {
          method: "PATCH",
          body: JSON.stringify(nextSettings),
        });
        qc.invalidateQueries({ queryKey: ["notification-settings"] });
      } catch (err) {
        setError(err);
      }
    }
  };

  const guard = () => {
    if (demo) {
      onNotice("В демо-режиме настройки не изменяются. Создайте свой аккаунт.");
      throw new Error("В демо настройки не изменяются. Создайте свой аккаунт.");
    }
  };

  const handleSaveTimezone = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg("");
    try {
      guard();
      setBusy(true);
      await api("/me", {
        method: "PATCH",
        body: JSON.stringify({
          theme: "light",
          timezone,
          email_notifications: user?.email_notifications || false,
        }),
      });
      qc.invalidateQueries({ queryKey: ["me"] });
      setSuccessMsg("Часовой пояс сохранён.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // Password and Email validation error states
  const [passwordErrors, setPasswordErrors] = useState<{ current?: string; new?: string }>({});
  const [emailErrors, setEmailErrors] = useState<{ email?: string; password?: string }>({});

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg("");
    const errs: { current?: string; new?: string } = {};
    if (!currentPassword) {
      errs.current = "Введи текущий пароль";
    }
    if (!newPassword || newPassword.length < 12) {
      errs.new = "Пароль должен содержать от 12 до 256 символов";
    }
    if (Object.keys(errs).length > 0) {
      setPasswordErrors(errs);
      return;
    }
    setPasswordErrors({});
    try {
      guard();
      setBusy(true);
      await post("/me/change-password", {
        current_password: currentPassword,
        password: newPassword,
      });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      setCurrentPassword("");
      setNewPassword("");
      setSuccessMsg("Пароль успешно изменён.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg("");
    const errs: { email?: string; password?: string } = {};
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      errs.email = "Укажи корректный email";
    }
    if (!emailCurrentPassword) {
      errs.password = "Введи текущий пароль";
    }
    if (Object.keys(errs).length > 0) {
      setEmailErrors(errs);
      return;
    }
    setEmailErrors({});
    try {
      guard();
      setBusy(true);
      await post("/me/email-change", {
        email: newEmail,
        current_password: emailCurrentPassword,
      });
      setNewEmail("");
      setEmailCurrentPassword("");
      setSuccessMsg("Письмо с подтверждением отправлено на новый адрес.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfileConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      guard();
      if (!profile) return;
      await api(`/profiles/${profile.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label: profileLabel }),
      });
      await api(`/profiles/${profile.id}/connection`, {
        method: "PATCH",
        body: JSON.stringify({
          paused: isPaused,
          interval_hours: Number(profileInterval),
        }),
      });
      qc.invalidateQueries({ queryKey: ["profiles"] });
      onNotice("Настройки подключения сохранены.");
    } catch (err) {
      setError(err);
    }
  };

  const handleTogglePause = async () => {
    try {
      guard();
      if (!profile) return;
      const nextPaused = !isPaused;
      setIsPaused(nextPaused);
      await api(`/profiles/${profile.id}/connection`, {
        method: "PATCH",
        body: JSON.stringify({ paused: nextPaused }),
      });
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (err) {
      setError(err);
    }
  };

  const handleDisconnect = async () => {
    try {
      guard();
      if (!profile) return;
      await api(`/profiles/${profile.id}/connection`, {
        method: "DELETE",
      });
      qc.invalidateQueries();
      onNotice(
        "Подключение отключено. Завершите ненужные сеансы также в официальном Instagram.",
      );
    } catch (err) {
      setError(err);
    }
  };

  async function revoke(id?: string) {
    try {
      guard();
      if (id) await api(`/me/sessions/${id}`, { method: "DELETE" });
      else await post("/me/sessions/revoke-others", {});
      if (sessions.data?.find((x) => x.id === id)?.current) {
        qc.clear();
        router.replace("/login");
      } else sessions.refetch();
    } catch (err) {
      setError(err);
    }
  }

  const supportedTimezones = Array.from(
    new Set([
      "Europe/Moscow",
      "UTC",
      user?.timezone || "Europe/Moscow",
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  );

  return (
    <div className="settings-v2-container">
      <ErrorNotice error={error} />
      {successMsg && (
        <div className="notice" role="status">
          {successMsg}
        </div>
      )}

      {/* 1. TOP 2-COLUMN GRID (Часовой пояс + Пароль сервиса) */}
      <section className="settings-v2-top-grid">
        {/* Card 1: Часовой пояс */}
        <div className="settings-v2-card">
          <header className="settings-v2-card-header">
            <div className="settings-v2-header-left">
              <div className="settings-v2-icon-box" aria-hidden="true">
                <Globe size={20} />
              </div>
              <h2 className="settings-v2-card-title">Часовой пояс</h2>
            </div>
          </header>

          <form onSubmit={handleSaveTimezone} className="settings-v2-form-body">
            <div className="settings-v2-field">
              <label className="settings-v2-label">Часовой пояс</label>
              <div className="settings-v2-input-wrap">
                <Globe size={16} className="text-gray-400 shrink-0" />
                <span className="text-sm font-semibold text-gray-800 flex-1 truncate">
                  {timezone}
                </span>
                <ChevronDown size={16} className="text-gray-400 shrink-0" />
                <select
                  className="settings-v2-select-native"
                  aria-label="Выбор часового пояса"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {supportedTimezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="settings-v2-hint">
              Время в отчетах и уведомлениях будет отображаться в этом часовом поясе.
            </p>

            <button
              type="submit"
              className="settings-v2-btn-purple"
              disabled={busy}
            >
              Сохранить
            </button>
          </form>
        </div>

        {/* Card 2: Пароль сервиса */}
        <div className="settings-v2-card">
          <header className="settings-v2-card-header">
            <div className="settings-v2-header-left">
              <div className="settings-v2-icon-box" aria-hidden="true">
                <Lock size={20} />
              </div>
              <h2 className="settings-v2-card-title">Пароль сервиса</h2>
            </div>
          </header>

          <form onSubmit={handleSavePassword} className="settings-v2-form-body">
            <div className="settings-v2-field">
              <label className="settings-v2-label">Текущий пароль</label>
              <div
                className={`settings-v2-input-wrap ${
                  passwordErrors.current ? "has-error" : ""
                }`}
              >
                <Lock size={16} className="text-gray-400 shrink-0" />
                <input
                  type={showCurrentPass ? "text" : "password"}
                  className="settings-v2-input"
                  placeholder="Введите текущий пароль"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (passwordErrors.current) {
                      setPasswordErrors((p) => ({ ...p, current: undefined }));
                    }
                  }}
                  aria-invalid={!!passwordErrors.current}
                  maxLength={256}
                />
                <button
                  type="button"
                  className="settings-v2-eye-btn"
                  title={showCurrentPass ? "Скрыть пароль" : "Показать пароль"}
                  onClick={() => setShowCurrentPass(!showCurrentPass)}
                >
                  {showCurrentPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordErrors.current && (
                <span className="field-error" role="alert">
                  {passwordErrors.current}
                </span>
              )}
            </div>

            <div className="settings-v2-field">
              <label className="settings-v2-label">Новый пароль</label>
              <div
                className={`settings-v2-input-wrap ${
                  passwordErrors.new ? "has-error" : ""
                }`}
              >
                <Lock size={16} className="text-gray-400 shrink-0" />
                <input
                  type={showNewPass ? "text" : "password"}
                  className="settings-v2-input"
                  placeholder="Введите новый пароль"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (passwordErrors.new) {
                      setPasswordErrors((p) => ({ ...p, new: undefined }));
                    }
                  }}
                  aria-invalid={!!passwordErrors.new}
                  minLength={12}
                  maxLength={256}
                />
                <button
                  type="button"
                  className="settings-v2-eye-btn"
                  title={showNewPass ? "Скрыть пароль" : "Показать пароль"}
                  onClick={() => setShowNewPass(!showNewPass)}
                >
                  {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordErrors.new && (
                <span className="field-error" role="alert">
                  {passwordErrors.new}
                </span>
              )}
            </div>

            <p className="settings-v2-hint">
              После смены пароля остальные сессии будут отозваны.
            </p>

            <button
              type="submit"
              className="settings-v2-btn-purple"
              disabled={busy}
            >
              Сохранить
            </button>
          </form>
        </div>
      </section>

      {/* 2. CARD 3: Смена email */}
      <section className="settings-v2-card">
        <header className="settings-v2-card-header">
          <div className="settings-v2-header-left">
            <div className="settings-v2-icon-box" aria-hidden="true">
              <Mail size={20} />
            </div>
            <div>
              <h2 className="settings-v2-card-title">Смена email</h2>
              <p className="settings-v2-card-subtitle">
                Сейчас: {user?.email || "demo@example.com"}. Новый адрес требуется
                подтвердить. После подтверждения понадобится снова войти.
              </p>
            </div>
          </div>
        </header>

        <form onSubmit={handleSaveEmail} className="settings-v2-form-body">
          <div className="settings-v2-fields-row">
            <div className="settings-v2-field">
              <label className="settings-v2-label">Новый email</label>
              <div
                className={`settings-v2-input-wrap ${
                  emailErrors.email ? "has-error" : ""
                }`}
              >
                <Mail size={16} className="text-gray-400 shrink-0" />
                <input
                  type="email"
                  className="settings-v2-input"
                  placeholder="example@domain.com"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    if (emailErrors.email) {
                      setEmailErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  aria-invalid={!!emailErrors.email}
                  autoComplete="email"
                />
              </div>
              {emailErrors.email && (
                <span className="field-error" role="alert">
                  {emailErrors.email}
                </span>
              )}
            </div>

            <div className="settings-v2-field">
              <label className="settings-v2-label">Текущий пароль</label>
              <div
                className={`settings-v2-input-wrap ${
                  emailErrors.password ? "has-error" : ""
                }`}
              >
                <Lock size={16} className="text-gray-400 shrink-0" />
                <input
                  type={showEmailPass ? "text" : "password"}
                  className="settings-v2-input"
                  placeholder="Введите пароль"
                  value={emailCurrentPassword}
                  onChange={(e) => {
                    setEmailCurrentPassword(e.target.value);
                    if (emailErrors.password) {
                      setEmailErrors((prev) => ({
                        ...prev,
                        password: undefined,
                      }));
                    }
                  }}
                  aria-invalid={!!emailErrors.password}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="settings-v2-eye-btn"
                  title={showEmailPass ? "Скрыть пароль" : "Показать пароль"}
                  onClick={() => setShowEmailPass(!showEmailPass)}
                >
                  {showEmailPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {emailErrors.password && (
                <span className="field-error" role="alert">
                  {emailErrors.password}
                </span>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="settings-v2-btn-purple"
            disabled={busy}
          >
            Сохранить
          </button>
        </form>
      </section>

      {/* 3. CARD 4: Уведомления */}
      <section className="settings-v2-card">
        <header className="settings-v2-card-header">
          <div className="settings-v2-header-left">
            <div className="settings-v2-icon-box" aria-hidden="true">
              <Bell size={20} />
            </div>
            <div>
              <h2 className="settings-v2-card-title">Уведомления</h2>
              <p className="settings-v2-card-subtitle">
                Выберите, какие события присылать на email.
              </p>
            </div>
          </div>
        </header>

        <div className="settings-v2-toggles-list">
          {[
            {
              key: "email_results",
              title: "Email о готовом результате",
              desc: "Уведомлять, когда отчёт по профилю готов.",
            },
            {
              key: "email_connection",
              title: "Email об остановке подключения",
              desc: "Уведомлять, если подключение было остановлено.",
            },
            {
              key: "email_support",
              title: "Email об ответе поддержки",
              desc: "Уведомлять о новых сообщениях от поддержки.",
            },
            {
              key: "in_app_results",
              title: "Результаты внутри кабинета",
              desc: "Показывать готовые результаты в кабинете сервиса.",
            },
            {
              key: "in_app_connection",
              title: "Ошибка подключения внутри кабинета",
              desc: "Показывать уведомления об ошибках подключения в кабинете.",
            },
          ].map((item) => {
            const isOn = !!toggles[item.key];
            return (
              <div
                key={item.key}
                className="settings-v2-toggle-row"
                onClick={() => handleToggle(item.key)}
                role="switch"
                aria-checked={isOn}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleToggle(item.key);
                  }
                }}
              >
                <div className={`settings-v2-switch ${isOn ? "on" : ""}`}>
                  <div className="settings-v2-switch-knob" />
                </div>
                <div className="settings-v2-toggle-text">
                  <div className="settings-v2-toggle-title">{item.title}</div>
                  <div className="settings-v2-toggle-desc">{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. CARD 5: Активные сессии сервиса */}
      <section className="settings-v2-card">
        <header className="settings-v2-card-header">
          <div className="settings-v2-header-left">
            <div className="settings-v2-icon-box" aria-hidden="true">
              <Monitor size={20} />
            </div>
            <div>
              <h2 className="settings-v2-card-title">Активные сессии сервиса</h2>
              <p className="settings-v2-card-subtitle">
                Здесь отображаются все активные сессии в твоём аккаунте.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="settings-v2-btn-revoke-others"
            onClick={() => revoke()}
          >
            <Power size={14} className="text-gray-500" />
            <span>Завершить остальные</span>
          </button>
        </header>

        <div className="settings-v2-sessions-list">
          {demo || !sessions.data?.length
            ? MOCK_DEMO_SESSIONS.map((s) => (
                <div key={s.id} className="settings-v2-session-item">
                  <div className="settings-v2-session-left">
                    <span
                      className={`settings-v2-session-dot ${
                        s.isOnline ? "green" : "gray"
                      }`}
                    />
                    <div className="settings-v2-session-device-icon">
                      {s.type === "phone" ? (
                        <Smartphone size={18} />
                      ) : (
                        <Monitor size={18} />
                      )}
                    </div>
                    <div className="settings-v2-session-details">
                      <div className="settings-v2-session-title-row">
                        <span className="settings-v2-session-title">
                          {s.title}
                        </span>
                        {s.isCurrent && (
                          <span className="settings-v2-current-badge">
                            Это устройство
                          </span>
                        )}
                      </div>
                      <span className="settings-v2-session-meta">
                        {s.device}
                      </span>
                    </div>
                  </div>

                  <div className="settings-v2-session-right">
                    {s.isOnline ? (
                      <span className="settings-v2-session-online">
                        Сейчас онлайн
                      </span>
                    ) : (
                      <>
                        <span className="settings-v2-session-time">
                          {s.dateStr}
                        </span>
                        <button
                          type="button"
                          className="settings-v2-btn-revoke"
                          onClick={() =>
                            onNotice(
                              "В демо-режиме сессия не может быть завершена.",
                            )
                          }
                        >
                          Завершить
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            : sessions.data.map((s) => (
                <div key={s.id} className="settings-v2-session-item">
                  <div className="settings-v2-session-left">
                    <span
                      className={`settings-v2-session-dot ${
                        s.current ? "green" : "gray"
                      }`}
                    />
                    <div className="settings-v2-session-device-icon">
                      <Monitor size={18} />
                    </div>
                    <div className="settings-v2-session-details">
                      <div className="settings-v2-session-title-row">
                        <span className="settings-v2-session-title">
                          {s.device || "Браузер"}
                        </span>
                        {s.current && (
                          <span className="settings-v2-current-badge">
                            Это устройство
                          </span>
                        )}
                      </div>
                      <span className="settings-v2-session-meta">
                        Вход {new Date(s.created_at).toLocaleDateString("ru-RU")}
                      </span>
                    </div>
                  </div>

                  <div className="settings-v2-session-right">
                    {s.current ? (
                      <span className="settings-v2-session-online">
                        Сейчас онлайн
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="settings-v2-btn-revoke"
                        onClick={() => revoke(s.id)}
                      >
                        Завершить
                      </button>
                    )}
                  </div>
                </div>
              ))}
        </div>
      </section>

      {/* 5. CARD 6: Instagram Profile Settings */}
      <section className="settings-v2-card">
        <header className="settings-v2-card-header">
          <div className="settings-v2-header-left">
            <div className="settings-v2-icon-box instagram" aria-hidden="true">
              <InstagramIcon size={20} />
            </div>
            <div>
              <h2 className="settings-v2-card-title">
                Instagram @{profile?.username || "your.circle"}
              </h2>
              <p className="settings-v2-card-subtitle">
                Управляй подключением и настройками проверки.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {isPaused ? "На паузе" : "Активно"}
          </span>
        </header>

        <form onSubmit={handleSaveProfileConnection} className="settings-v2-form-body">
          <div className="settings-v2-fields-row">
            <div className="settings-v2-field">
              <label className="settings-v2-label">Название профиля</label>
              <div className="settings-v2-input-wrap">
                <UserIcon size={16} className="text-gray-400 shrink-0" />
                <input
                  type="text"
                  className="settings-v2-input font-semibold"
                  value={profileLabel}
                  onChange={(e) => setProfileLabel(e.target.value)}
                  maxLength={80}
                />
              </div>
            </div>

            <div className="settings-v2-field">
              <label className="settings-v2-label">
                Интервал обновления, часов
              </label>
              <div className="settings-v2-input-wrap">
                <Clock size={16} className="text-gray-400 shrink-0" />
                <span className="text-sm font-semibold text-gray-800 flex-1">
                  {profileInterval}
                </span>
                <ChevronDown size={16} className="text-gray-400 shrink-0" />
                <select
                  className="settings-v2-select-native"
                  aria-label="Интервал обновления"
                  value={profileInterval}
                  onChange={(e) => setProfileInterval(e.target.value)}
                >
                  <option value="12">12</option>
                  <option value="24">24</option>
                  <option value="48">48</option>
                  <option value="72">72</option>
                </select>
              </div>
            </div>
          </div>

          <div className="settings-v2-actions-row">
            <button
              type="button"
              className="settings-v2-btn-purple"
              onClick={handleTogglePause}
            >
              {isPaused ? (
                <>
                  <Play size={15} />
                  <span>Возобновить сбор</span>
                </>
              ) : (
                <>
                  <Pause size={15} />
                  <span>Поставить на паузу</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="settings-v2-btn-secondary"
              onClick={() => router.push("/app/instagram/connect")}
            >
              <RefreshCw size={15} />
              <span>Переподключить</span>
            </button>
            <button
              type="button"
              className="settings-v2-btn-outline"
              onClick={handleDisconnect}
            >
              <Unlink size={15} />
              <span>Отключить</span>
            </button>
          </div>

          <p className="settings-v2-hint">
            Пауза не снимает ограничений или проверку безопасности Instagram.
            История остаётся доступной.
          </p>
        </form>
      </section>

      {/* 6. CARD 7: Данные и приватность */}
      <section className="settings-v2-card">
        <header className="settings-v2-card-header">
          <div className="settings-v2-header-left">
            <div className="settings-v2-icon-box" aria-hidden="true">
              <Database size={20} />
            </div>
            <div>
              <h2 className="settings-v2-card-title">Данные и приватность</h2>
              <p className="settings-v2-card-subtitle">
                История хранится до удаления. Экспорт содержит ваши списки, снимки,
                события и пометки; учётные данные Instagram в него не входят.
              </p>
            </div>
          </div>
        </header>

        <div className="settings-v2-privacy-grid">
          {/* Tile 1: Экспорт JSON */}
          <div className="settings-v2-privacy-tile">
            <div className="settings-v2-privacy-top">
              <div className="settings-v2-privacy-icon text-gray-700">
                <Download size={22} />
              </div>
              <h3 className="settings-v2-privacy-title">Экспорт JSON</h3>
              <p className="settings-v2-privacy-desc">
                Скачать все данные в удобном формате
              </p>
            </div>
            {demo ? (
              <button
                type="button"
                className="settings-v2-tile-btn gray"
                onClick={() => onNotice("Экспорт доступен после регистрации.")}
              >
                Экспорт JSON
              </button>
            ) : (
              <ExportButton
                label="Экспорт JSON"
                request={{ scope: "account", format: "json" }}
              />
            )}
          </div>

          {/* Tile 2: Очистить историю */}
          <div className="settings-v2-privacy-tile">
            <div className="settings-v2-privacy-top">
              <div className="settings-v2-privacy-icon text-rose-500">
                <Trash2 size={22} />
              </div>
              <h3 className="settings-v2-privacy-title red">Очистить историю</h3>
              <p className="settings-v2-privacy-desc">
                Удалить все сохранённые данные о проверках.
              </p>
            </div>
            <button
              type="button"
              className="settings-v2-tile-btn soft-red"
              onClick={() => setDeleting("history")}
            >
              Очистить историю
            </button>
          </div>

          {/* Tile 3: Удалить профиль и историю */}
          <div className="settings-v2-privacy-tile">
            <div className="settings-v2-privacy-top">
              <div className="settings-v2-privacy-icon text-rose-500">
                <UserX size={22} />
              </div>
              <h3 className="settings-v2-privacy-title red">
                Удалить профиль и историю
              </h3>
              <p className="settings-v2-privacy-desc">
                Безвозвратно удалить профиль и все связанные данные.
              </p>
            </div>
            <button
              type="button"
              className="settings-v2-tile-btn soft-red"
              onClick={() => setDeleting("profile")}
            >
              Удалить профиль
            </button>
          </div>

          {/* Tile 4: Удалить аккаунт сервиса */}
          <div className="settings-v2-privacy-tile">
            <div className="settings-v2-privacy-top">
              <div className="settings-v2-privacy-icon text-rose-600">
                <ShieldAlert size={22} />
              </div>
              <h3 className="settings-v2-privacy-title red">
                Удалить аккаунт сервиса
              </h3>
              <p className="settings-v2-privacy-desc">
                Полное удаление аккаунта и всех данных.
              </p>
            </div>
            <button
              type="button"
              className="settings-v2-tile-btn solid-red"
              onClick={() => setDeleting("account")}
            >
              Удалить аккаунт
            </button>
          </div>
        </div>

        {historyReceipt && (
          <div className="notice" role="status">
            <b>
              {historyCleanup.data?.status === "completed"
                ? "Очистка файлов завершена"
                : "История скрыта, файлы очищаются"}
            </b>
            {historyCleanup.data && (
              <p>
                Срок очистки:{" "}
                {new Date(
                  historyCleanup.data.cleanup_deadline,
                ).toLocaleDateString("ru-RU")}
              </p>
            )}
            <ErrorNotice error={historyCleanup.error} />
          </div>
        )}
      </section>

      {/* Deletion confirmation modal */}
      {deleting && (
        <Modal
          title={
            deleting === "account"
              ? "Удалить аккаунт?"
              : deleting === "history"
                ? "Очистить историю?"
                : "Удалить профиль?"
          }
          onClose={() => setDeleting(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const data = new FormData(e.currentTarget);
              try {
                guard();
                const result =
                  deleting !== "profile"
                    ? await post<{ id: string; receipt_token: string }>(
                        deleting === "history"
                          ? `/profiles/${profile!.id}/history/delete`
                          : "/privacy/delete-account",
                        {
                          password: data.get("password"),
                          confirmation: data.get("confirmation"),
                        },
                      )
                    : await api<{ id: string; receipt_token: string }>(
                        `/profiles/${profile!.id}`,
                        { method: "DELETE" },
                      );
                if (deleting === "history") {
                  setHistoryReceipt(result.id);
                  qc.invalidateQueries();
                  setDeleting(null);
                  onNotice(
                    "История удалена из кабинета. Файлы очищаются в течение 24 часов; подключение сохранено.",
                  );
                } else {
                  qc.clear();
                  window.location.assign(
                    `/deleted#id=${encodeURIComponent(result.id)}&token=${encodeURIComponent(result.receipt_token)}`,
                  );
                }
              } catch (err) {
                setError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Будут удалены{" "}
              {deleting === "account"
                ? "все профили, история, заметки и настройки"
                : deleting === "history"
                  ? "снимки и сравнения этого профиля; заметки и подключение сохранятся"
                  : "этот профиль, его снимки и заметки"}
              . Отменить действие после подтверждения нельзя.
            </p>
            {deleting !== "profile" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "16px 0" }}>
                <label className="settings-v2-field">
                  <span className="settings-v2-label">Пароль сервиса</span>
                  <div className="settings-v2-input-wrap">
                    <input
                      name="password"
                      type="password"
                      className="settings-v2-input"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </label>
                <label className="settings-v2-field">
                  <span className="settings-v2-label">Напишите УДАЛИТЬ</span>
                  <div className="settings-v2-input-wrap">
                    <input
                      name="confirmation"
                      className="settings-v2-input"
                      required
                      pattern="УДАЛИТЬ"
                    />
                  </div>
                </label>
              </div>
            )}
            <ErrorNotice error={error} />
            <button className="button danger full" disabled={busy} style={{ marginTop: 16 }}>
              Подтвердить удаление
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
