"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, post, User, Profile, date } from "@/lib/api";
import type { components } from "@/lib/generated-api";
import { PublicConfig, useUrlValue, useVisible } from "@/lib/workflows";
import { ErrorNotice, ExportButton, Modal, Loader } from "./common";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { settingsSchema } from "@/lib/form-schemas";
import { FormInput, FormSelect } from "@/components/form-fields";
type Session = components["schemas"]["SessionDTO"];
type NotificationSettings = components["schemas"]["NotificationPreferences"];
function ActionForm({
  title,
  children,
  onSubmit,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: (data: FormData) => Promise<unknown>;
}) {
  const formState = useForm({ resolver: zodResolver(settingsSchema) });
  const [error, setError] = useState<unknown>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <FormProvider {...formState}>
      <form
        className="panel settings-form"
        onSubmit={formState.handleSubmit(async (_, e) => {
          const form = e?.target as HTMLFormElement,
            data = new FormData(form);
          setBusy(true);
          setError(null);
          setMessage("");
          try {
            await onSubmit(data);
            formState.reset();
            form.reset();
            setMessage(
              "Изменения сохранены. Проверьте почту, если подтверждение требуется.",
            );
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        })}
      >
        <h3>{title}</h3>
        {children}
        <ErrorNotice error={error} />
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button className="button secondary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </form>
    </FormProvider>
  );
}
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
  const router = useRouter(),
    qc = useQueryClient();
  const [error, setError] = useState<unknown>(null),
    [deleting, setDeleting] = useState<
      "account" | "profile" | "history" | null
    >(null),
    [busy, setBusy] = useState(false);
  const visible = useVisible();
  const [historyReceipt, setHistoryReceipt] = useUrlValue(
    "history_receipt",
    "",
  );
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
  const flags = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => api<PublicConfig>("/config/public", { signal }),
  });
  const deliveries = useQuery({
    queryKey: ["email-deliveries"],
    queryFn: ({ signal }) =>
      api<{
        items: components["schemas"]["DeliveryDTO"][];
        next_cursor: string | null;
      }>("/me/email-deliveries?limit=20", { signal }),
    enabled: !demo,
  });
  const guard = () => {
    if (demo)
      throw new Error("В демо настройки не изменяются. Создайте свой аккаунт.");
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
    } catch (error) {
      setError(error);
    }
  }
  return (
    <div className="feature-stack">
      <ErrorNotice error={error} />
      <div className="settings-grid">
        <ActionForm
          title="Часовой пояс"
          onSubmit={async (data) => {
            guard();
            await api("/me", {
              method: "PATCH",
              body: JSON.stringify({
                theme: "light",
                timezone: data.get("timezone"),
                email_notifications: user?.email_notifications || false,
              }),
            });
            qc.invalidateQueries({ queryKey: ["me"] });
          }}
        >
          <label>
            Часовой пояс
            <FormSelect
              name="timezone"
              defaultValue={
                user?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            >
              {Array.from(
                new Set([
                  "UTC",
                  user?.timezone || "UTC",
                  ...Intl.supportedValuesOf("timeZone"),
                ]),
              ).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </FormSelect>
          </label>
        </ActionForm>
        <ActionForm
          title="Пароль сервиса"
          onSubmit={async (data) => {
            guard();
            await post("/me/change-password", {
              current_password: data.get("current_password"),
              password: data.get("password"),
            });
            qc.invalidateQueries({ queryKey: ["sessions"] });
          }}
        >
          <label>
            Текущий пароль
            <FormInput
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          <label>
            Новый пароль
            <FormInput
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
            />
          </label>
          <p className="muted">
            После смены пароля остальные сессии будут отозваны.
          </p>
        </ActionForm>
        <ActionForm
          title="Смена email"
          onSubmit={async (data) => {
            guard();
            await post("/me/email-change", {
              email: data.get("email"),
              current_password: data.get("current_password"),
            });
          }}
        >
          <p className="muted">
            Сейчас: {user?.email || "demo@example.com"}. Новый адрес требуется
            подтвердить. После подтверждения понадобится снова войти.
          </p>
          <label>
            Новый email
            <FormInput
              name="email"
              type="email"
              required
              autoComplete="email"
            />
          </label>
          <label>
            Текущий пароль
            <FormInput
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
        </ActionForm>
        <ActionForm
          title="Уведомления"
          onSubmit={async (data) => {
            guard();
            const settings = Object.fromEntries(
              [
                "email_results",
                "email_connection",
                "email_support",
                "in_app_results",
                "in_app_connection",
              ].map((key) => [key, !!data.get(key)]),
            );
            await api("/me/notification-settings", {
              method: "PATCH",
              body: JSON.stringify(settings),
            });
            qc.invalidateQueries({ queryKey: ["me"] });
            qc.invalidateQueries({ queryKey: ["notification-settings"] });
          }}
        >
          <div key={JSON.stringify(preferences.data)}>
            {[
              ["email_results", "Email о готовом результате"],
              ["email_connection", "Email об остановке подключения"],
              ["email_support", "Email об ответе поддержки"],
              ["in_app_results", "Результаты внутри кабинета"],
              ["in_app_connection", "Ошибки подключения внутри кабинета"],
            ].map(([name, label]) => (
              <label className="checkbox-row" key={name}>
                <FormInput
                  name={name}
                  type="checkbox"
                  defaultChecked={
                    preferences.data?.[name as keyof NotificationSettings] ??
                    name.startsWith("in_app")
                  }
                  disabled={
                    name.startsWith("email") &&
                    flags.data?.enable_email_notifications === false
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </ActionForm>
      </div>
      <section className="panel">
        <header className="panel-heading">
          <h2>Активные сессии сервиса</h2>
          <button
            className="button secondary small"
            onClick={() => revoke()}
            disabled={demo}
          >
            Завершить остальные
          </button>
        </header>
        {sessions.isPending && !demo ? (
          <Loader />
        ) : (
          sessions.data?.map((session) => (
            <div className="session-row" key={session.id}>
              <div>
                <b>
                  {session.device || "Браузер"}{" "}
                  {session.current && (
                    <span className="badge success">Текущая</span>
                  )}
                </b>
                <p className="muted">
                  Вход {date(session.created_at)} · последний доступ{" "}
                  {date(session.last_seen)}
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() => revoke(session.id)}
              >
                Завершить
              </button>
            </div>
          ))
        )}
        <ErrorNotice error={sessions.error} />
      </section>
      {!demo && (
        <section className="panel">
          <h2>Доставка email</h2>
          <p className="muted">
            Статус отражает принятие письма почтовым сервером, а не его
            прочтение.
          </p>
          <ErrorNotice error={deliveries.error} />
          {deliveries.isPending ? (
            <Loader />
          ) : (
            deliveries.data?.items.map((item) => (
              <div className="session-row" key={item.id}>
                <div>
                  <b>
                    {(
                      {
                        delivered: "Принято почтовым сервером",
                        pending: "Ожидает отправки",
                        failed: "Доставка не подтверждена",
                        unknown: "Результат неизвестен",
                      } as Record<string, string>
                    )[item.status] || item.status}
                  </b>
                  <p className="muted">
                    {date(item.created_at)} · попыток: {item.attempts}
                    {item.next_attempt_at &&
                      ` · следующая попытка: ${date(item.next_attempt_at)}`}
                    {item.error_code && ` · код: ${item.error_code}`}
                  </p>
                </div>
              </div>
            ))
          )}
          {!deliveries.isPending && !deliveries.data?.items.length && (
            <p>Писем пока нет.</p>
          )}
        </section>
      )}
      {profile && (
        <section className="panel">
          <header className="panel-heading">
            <h2>Instagram @{profile.username}</h2>
            <span className="badge">{profile.status}</span>
          </header>
          <ActionForm
            title="Название и расписание"
            onSubmit={async (data) => {
              guard();
              await api(`/profiles/${profile.id}`, {
                method: "PATCH",
                body: JSON.stringify({ label: data.get("label") }),
              });
              await api(`/profiles/${profile.id}/connection`, {
                method: "PATCH",
                body: JSON.stringify({
                  paused: profile.paused,
                  interval_hours: Number(data.get("interval")),
                }),
              });
              qc.invalidateQueries({ queryKey: ["profiles"] });
            }}
          >
            <label>
              Название профиля
              <FormInput
                name="label"
                defaultValue={profile.label || ""}
                maxLength={80}
              />
            </label>
            <label>
              Интервал обновления, часов
              <FormInput
                name="interval"
                type="number"
                min={flags.data?.sync_interval_hours || 24}
                max={8760}
                defaultValue={profile.interval_hours || 24}
                required
              />
            </label>
          </ActionForm>
          <div className="button-row">
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  guard();
                  await api(`/profiles/${profile.id}/connection`, {
                    method: "PATCH",
                    body: JSON.stringify({ paused: !profile.paused }),
                  });
                  qc.invalidateQueries({ queryKey: ["profiles"] });
                } catch (error) {
                  setError(error);
                }
              }}
            >
              {profile.paused ? "Возобновить расписание" : "Поставить на паузу"}
            </button>
            <button
              className="button secondary"
              onClick={() => router.push("/app/instagram/connect")}
            >
              Переподключить
            </button>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  guard();
                  await api(`/profiles/${profile.id}/connection`, {
                    method: "DELETE",
                  });
                  qc.invalidateQueries();
                  onNotice(
                    "Подключение отключено. Завершите ненужные сеансы также в официальном Instagram.",
                  );
                } catch (error) {
                  setError(error);
                }
              }}
            >
              Отключить
            </button>
          </div>
          <p className="muted">
            Пауза не снимает ограничения или проверку безопасности Instagram.
            История остаётся доступной.
          </p>
        </section>
      )}
      <section className="panel">
        <h2>Данные и приватность</h2>
        <p className="muted">
          История хранится до удаления. Экспорт содержит ваши списки, снимки,
          события и пометки; учётные данные Instagram в него не входят.
        </p>
        {demo ? (
          <button
            className="button secondary"
            onClick={() => onNotice("Экспорт доступен после регистрации.")}
          >
            Экспорт JSON
          </button>
        ) : (
          <ExportButton
            label="Сформировать всю историю JSON"
            request={{ scope: "account", format: "json" }}
          />
        )}
        {historyReceipt && (
          <div className="notice" role="status">
            <b>
              {historyCleanup.data?.status === "completed"
                ? "Очистка файлов завершена"
                : "История скрыта, файлы очищаются"}
            </b>
            {historyCleanup.data && (
              <p>Срок очистки: {date(historyCleanup.data.cleanup_deadline)}</p>
            )}
            <ErrorNotice error={historyCleanup.error} />
          </div>
        )}
        <div className="button-row danger-actions">
          {profile && (
            <button
              className="button danger secondary"
              onClick={() => setDeleting("history")}
            >
              Очистить историю, сохранить подключение
            </button>
          )}
          {profile && (
            <button
              className="button danger secondary"
              onClick={() => setDeleting("profile")}
            >
              Удалить профиль и историю
            </button>
          )}
          <button
            className="button danger"
            onClick={() => setDeleting("account")}
          >
            Удалить аккаунт сервиса
          </button>
        </div>
        <p className="muted">
          Доступ прекращается сразу. Очистка рабочих хранилищ — в течение 24
          часов, ротационные резервные копии — до{" "}
          {flags.data?.backup_retention_days || 30} дней. Журнал удаления
          применяется при восстановлении.
        </p>
      </section>
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
              } catch (error) {
                setError(error);
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
              <>
                <label>
                  Пароль сервиса
                  <FormInput
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label>
                  Напишите УДАЛИТЬ
                  <FormInput name="confirmation" required pattern="УДАЛИТЬ" />
                </label>
              </>
            )}
            <ErrorNotice error={error} />
            <button className="button danger" disabled={busy}>
              Подтвердить удаление
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
