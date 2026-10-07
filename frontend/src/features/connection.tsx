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
import { ErrorNotice, JobProgress, Loader } from "./common";
type Connection = components["schemas"]["ConnectionDTO"];
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
    [busy, setBusy] = useState(false);
  const flags = useQuery({
    queryKey: ["public-config"],
    queryFn: ({ signal }) => api<PublicConfig>("/config/public", { signal }),
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
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    const username = String(data.get("username")),
      password = String(data.get("password")),
      accepted = !!data.get("consent");
    form.reset();
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
            password,
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
      code = String(new FormData(form).get("code"));
    form.reset();
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
    <div className="form-panel-grid">
      <section className="panel">
        <h2>Подключение собственного аккаунта</h2>
        <p className="muted">
          Неофициальный доступ может привести к проверке входа или ограничениям
          Instagram. Гарантировать отсутствие блокировок невозможно. Можно
          загрузить официальный архив без входа через сервис.
        </p>
        {!enabled && (
          <div className="notice">
            Автоматическое подключение{" "}
            {demo
              ? "недоступно в демо"
              : "отключено оператором или настройки загружаются"}
            . <Link href="/app/imports/new">Загрузить архив</Link>
          </div>
        )}
        {connection.data && (
          <p>
            Состояние: {connection.data.display_status}. Следующий разрешённый
            сбор: {date(connection.data.next_allowed_at)}.
          </p>
        )}
        {current && <JobProgress job={current} />}
        <ErrorNotice error={error || q.error || connection.error} />
        {current?.status === "awaiting_2fa" ? (
          <form onSubmit={verify}>
            <p>
              Введите код из{" "}
              {current.details.method === "totp"
                ? "приложения аутентификации"
                : "канала, указанного Instagram"}
              . Код действует в рамках этой попытки входа, максимум 10 минут.
            </p>
            <label>
              Код
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,8}"
                required
                maxLength={8}
              />
            </label>
            <button className="button" disabled={busy}>
              Подтвердить код
            </button>
          </form>
        ) : pending ? (
          <Loader />
        ) : (
          <form onSubmit={submit}>
            <label>
              Username Instagram
              <input
                name="username"
                required
                maxLength={30}
                defaultValue={profile?.username}
                autoComplete="username"
                readOnly={!!profile}
              />
            </label>
            <label>
              Пароль Instagram
              <input
                type="password"
                name="password"
                autoComplete="off"
                maxLength={256}
                required
              />
            </label>
            <label className="check">
              <input type="checkbox" name="consent" required />
              <span>
                Подключаю свой аккаунт и принимаю риски неофициального доступа,
                версия {flags.data?.connection_terms_version}.
              </span>
            </label>
            <button className="button" disabled={busy || !enabled}>
              {profile ? "Переподключить" : "Подключить"}
            </button>
          </form>
        )}
        {pending && current?.kind === "connect" && (
          <button
            className="button secondary"
            disabled={busy}
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
        {current?.status === "completed" && (
          <button className="button secondary" onClick={onDone}>
            Открыть обзор
          </button>
        )}
      </section>
      <aside className="panel">
        <h3>Как обновляется история</h3>
        <ol>
          <li>Вход и явное подтверждение 2FA, если требуется.</li>
          <li>Первый полный снимок показывает текущую взаимность.</li>
          <li>Следующие полные снимки позволяют сравнить изменения.</li>
        </ol>
        <p>
          Обычное расписание — раз в {flags.data?.sync_interval_hours || 24}{" "}
          часа. Ручное обновление — не чаще чем раз в{" "}
          {flags.data?.manual_min_interval_hours || 6} часов, максимум два
          запуска за сутки.
        </p>
        <p>
          При проверке безопасности, неполном ответе или ограничении сбор
          останавливается. Завершите проверку в официальном приложении; новое
          подключение запускается вашим действием.
        </p>
        <Link href="/help/import">Как получить архив Instagram</Link>
      </aside>
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
      <h2>Сбор списков</h2>
      <ErrorNotice error={error || q.error} />
      {q.isPending ? (
        <Loader />
      ) : q.data ? (
        <>
          <JobProgress job={q.data} />
          {!terminalStates.includes(q.data.status) && (
            <button
              className="button secondary"
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
          <Link className="button secondary" href="/app">
            Вернуться в кабинет
          </Link>
        </>
      ) : null}
    </section>
  );
}
