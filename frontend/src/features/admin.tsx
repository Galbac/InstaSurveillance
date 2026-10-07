"use client";
import type { components } from "@/lib/generated-api";
import Link from "next/link";
import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, post, User } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { ErrorNotice, Loader, Modal } from "./common";
type Schemas = components["schemas"];
type RecordRow = { id: string } & Partial<
  Schemas["AdminUserDTO"] &
    Schemas["AdminJobDTO"] &
    Schemas["AdminTicketDTO"] &
    Schemas["AuditDTO"]
>;
export default function AdminPanel() {
  const qc = useQueryClient(),
    [authorized, setAuthorized] = useState(false),
    [tab, setTab] = useState("jobs"),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<{ row: RecordRow; kind: string } | null>(
      null,
    );
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api<User>("/me", { signal }),
  });
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: ({ signal }) =>
      api<Schemas["AdminOverviewDTO"]>("/admin/overview", { signal }),
    enabled: authorized,
  });
  const limits = useQuery({
    queryKey: ["admin-limits"],
    queryFn: ({ signal }) =>
      api<Record<string, number>>("/admin/limits", { signal }),
    enabled: authorized,
  });
  const q = useInfiniteQuery({
    queryKey: ["admin-list", tab],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api<Page<RecordRow>>(
        `/admin/${tab}?limit=50` +
          (pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""),
        { signal },
      ),
    getNextPageParam: (x) => x.next_cursor || undefined,
    enabled: authorized,
  });
  const operator = me.data?.role === "admin" || me.data?.role === "support";
  return (
    <main className="legal-page admin-page">
      <Link href="/app">В кабинет</Link>
      <h1>Администрирование</h1>
      <ErrorNotice error={error || me.error || q.error || overview.error} />
      {me.isPending ? (
        <Loader />
      ) : !operator ? (
        <p>Доступ только для назначенных оператором ролей.</p>
      ) : !authorized ? (
        <section className="panel">
          <h2>Подтвердите MFA</h2>
          <p>
            Привилегии действуют 15 минут. Настройка аутентификатора и
            восстановление — защищённой командой на сервере.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                code = String(new FormData(form).get("code"));
              form.reset();
              setBusy(true);
              setError(null);
              try {
                await post("/admin/auth/mfa/challenge", { code });
                setAuthorized(true);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Код аутентификатора или одноразовый резервный код
              <input
                name="code"
                required
                autoComplete="one-time-code"
                maxLength={100}
              />
            </label>
            <button className="button" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </section>
      ) : (
        <>
          <p>
            Версия {overview.data?.release} · пользователей{" "}
            {overview.data?.users}.{" "}
            {Object.entries(overview.data?.jobs || {})
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          <section className="panel">
            <h2>Глобальные лимиты</h2>
            <p className="muted">
              Можно ужесточить ограничения в пределах серверной конфигурации.
              Изменения записываются в журнал.
            </p>
            <ErrorNotice error={limits.error} />
            {limits.data && (
              <form
                key={JSON.stringify(limits.data)}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(null);
                  const data = new FormData(e.currentTarget);
                  try {
                    await api("/admin/limits", {
                      method: "PATCH",
                      body: JSON.stringify({
                        ...Object.fromEntries(
                          Object.keys(limits.data!).map((k) => [
                            k,
                            Number(data.get(k)),
                          ]),
                        ),
                        reason: data.get("reason"),
                      }),
                    });
                    await limits.refetch();
                    qc.invalidateQueries({ queryKey: ["admin-overview"] });
                    qc.invalidateQueries({ queryKey: ["config"] });
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {Object.entries(limits.data).map(([key, value]) => (
                  <label key={key}>
                    {(
                      {
                        instagram_sync_interval_hours:
                          "Минимальный интервал Instagram, часов",
                        instagram_request_budget: "Бюджет запросов на сбор",
                        user_storage_quota_bytes: "Квота пользователя, байт",
                      } as Record<string, string>
                    )[key] || key}
                    <input
                      name={key}
                      type="number"
                      required
                      min={1}
                      defaultValue={value}
                      disabled={me.data?.role !== "admin"}
                    />
                  </label>
                ))}
                {me.data?.role === "admin" && (
                  <>
                    <label>
                      Причина изменения
                      <textarea
                        name="reason"
                        required
                        minLength={5}
                        maxLength={500}
                      />
                    </label>
                    <button className="button" disabled={busy}>
                      Сохранить лимиты
                    </button>
                  </>
                )}
              </form>
            )}
          </section>
          <div className="button-row">
            {[
              ["users", "Пользователи"],
              ["jobs", "Задания"],
              ["support/tickets", "Обращения"],
              ...(me.data?.role === "admin" ? [["audit", "Журнал"]] : []),
            ].map(([v, l]) => (
              <button
                className={`button ${tab === v ? "" : "secondary"}`}
                key={v}
                onClick={() => setTab(v)}
              >
                {l}
              </button>
            ))}
            <button
              className="button secondary"
              onClick={() => {
                setAuthorized(false);
                qc.removeQueries({ queryKey: ["admin-list"] });
              }}
            >
              Подтвердить MFA заново
            </button>
          </div>
          <section className="panel">
            {q.data?.pages
              .flatMap((p) => p.items)
              .map((row) => (
                <article className="admin-row" key={row.id}>
                  <div>
                    <b>{row.email || row.kind || row.category || row.action}</b>
                    <p>
                      {row.status} {row.stage} {row.error_code} {row.target}
                    </p>
                    <code>{row.id}</code>
                    {row.body && <p>{row.body}</p>}
                    {row.reply && <blockquote>{row.reply}</blockquote>}
                  </div>
                  <div className="button-row">
                    {tab === "users" &&
                      me.data?.role === "admin" &&
                      row.id !== me.data.id &&
                      row.status !== "deleting" && (
                        <button
                          className="button secondary"
                          onClick={() =>
                            setAction({
                              row,
                              kind:
                                row.status === "suspended"
                                  ? "restore"
                                  : "suspend",
                            })
                          }
                        >
                          {row.status === "suspended"
                            ? "Вернуть доступ"
                            : "Приостановить доступ"}
                        </button>
                      )}
                    {tab === "jobs" &&
                      row.status === "failed" &&
                      ["import", "export", "comparison"].includes(
                        row.kind || "",
                      ) &&
                      [
                        "storage_unavailable",
                        "temporary_unavailable",
                        "timeout",
                      ].includes(row.error_code || "") &&
                      (row.attempts || 0) < 3 && (
                        <button
                          className="button secondary"
                          onClick={() => setAction({ row, kind: "retry" })}
                        >
                          Повтор технической задачи
                        </button>
                      )}
                    {tab === "support/tickets" && (
                      <button
                        className="button secondary"
                        onClick={() => setAction({ row, kind: "reply" })}
                      >
                        Ответить
                      </button>
                    )}
                  </div>
                </article>
              ))}
            {q.isPending && <Loader />}
            {!q.isPending && !q.data?.pages[0]?.items.length && (
              <p>Записей нет.</p>
            )}
            {q.hasNextPage && (
              <button
                className="button secondary"
                disabled={q.isFetchingNextPage}
                onClick={() => q.fetchNextPage()}
              >
                Ещё 50
              </button>
            )}
          </section>
        </>
      )}
      {action && (
        <Modal
          title={
            action.kind === "reply"
              ? "Ответ поддержки"
              : action.kind === "retry"
                ? "Повторить техническое задание?"
                : "Изменить доступ пользователя?"
          }
          onClose={() => setAction(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError(null);
              try {
                if (action.kind === "reply")
                  await api(`/admin/support/tickets/${action.row.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                      reply: data.get("reply"),
                      status: data.get("status"),
                    }),
                  });
                else
                  await post(
                    `/admin/${action.kind === "retry" ? "jobs" : "users"}/${action.row.id}/${action.kind}`,
                    action.kind === "retry"
                      ? {}
                      : { reason: data.get("reason") },
                  );
                setAction(null);
                qc.invalidateQueries({ queryKey: ["admin-list"] });
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {action.kind === "reply" ? (
              <>
                <label>
                  Ответ
                  <textarea
                    name="reply"
                    maxLength={5000}
                    required
                    defaultValue={action.row.reply}
                  />
                </label>
                <label>
                  Состояние
                  <select name="status" defaultValue={action.row.status}>
                    <option value="open">Открыто</option>
                    <option value="in_progress">В работе</option>
                    <option value="resolved">Решено</option>
                  </select>
                </label>
              </>
            ) : action.kind !== "retry" ? (
              <label>
                Причина
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={500}
                  required
                />
              </label>
            ) : (
              <p>
                Будет повторена только обработка сохранённых данных. Задания
                входа и сбора Instagram требуют действия владельца.
              </p>
            )}
            <ErrorNotice error={error} />
            <button className="button" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
