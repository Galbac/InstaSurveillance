"use client";
import type { components } from "@/lib/generated-api";
import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, date } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { ErrorNotice, Loader } from "./common";
type Notice = components["schemas"]["NotificationDTO"];
type Ticket = components["schemas"]["TicketDTO"];
export function NotificationsPanel({ demo = false }: { demo?: boolean }) {
  const qc = useQueryClient(),
    [error, setError] = useState<unknown>(null);
  const q = useInfiniteQuery({
    queryKey: ["notifications"],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api<Page<Notice>>(
        "/notifications?limit=50" +
          (pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""),
        { signal },
      ),
    getNextPageParam: (x) => x.next_cursor || undefined,
    enabled: !demo,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) || [];
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Уведомления</h2>
        <Link href="/app/settings">Настроить</Link>
      </div>
      <ErrorNotice error={error || q.error} />
      {q.isPending && !demo ? (
        <Loader />
      ) : !rows.length ? (
        <p className="small-empty">
          {demo ? "В демо нет личных уведомлений" : "Новых событий пока нет"}
        </p>
      ) : (
        <>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await post("/notifications/read", {
                  ids: rows.filter((x) => !x.read).map((x) => x.id),
                });
                qc.invalidateQueries({ queryKey: ["notifications"] });
              } catch (e) {
                setError(e);
              }
            }}
          >
            Прочитать показанные
          </button>
          {rows.map((x) => (
            <article className="notification-row" key={x.id}>
              <div>
                <h3>{x.title}</h3>
                <p>{x.body}</p>
                <small>
                  {date(x.created_at)} · {x.read ? "прочитано" : "новое"}
                </small>
              </div>
              {x.link && x.link.startsWith("/app") && (
                <Link href={x.link}>Открыть</Link>
              )}
              {!x.read && (
                <button
                  className="text-link"
                  onClick={async () => {
                    try {
                      await post("/notifications/read", { ids: [x.id] });
                      qc.invalidateQueries({ queryKey: ["notifications"] });
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  Прочитано
                </button>
              )}
            </article>
          ))}
          {q.hasNextPage && (
            <button
              className="button secondary"
              onClick={() => q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              Ещё 50
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function SupportPanel({ demo = false }: { demo?: boolean }) {
  const qc = useQueryClient(),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const q = useInfiniteQuery({
    queryKey: ["tickets"],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      api<Page<Ticket>>(
        "/support/tickets?limit=50" +
          (pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""),
        { signal },
      ),
    getNextPageParam: (x) => x.next_cursor || undefined,
    enabled: !demo,
  });
  return (
    <div className="feature-stack">
      <section className="panel">
        <h2>Помощь</h2>
        <Link href="/help/import">
          Как получить полный JSON-архив Instagram
        </Link>
        <p>
          Первый снимок показывает текущие списки. Исчезновение между двумя
          наблюдениями может означать отписку, удаление, блокировку или
          изменение данных источника.
        </p>
        <p>
          При challenge_required откройте официальное приложение Instagram и
          завершите проверку. Не передавайте поддержке пароли, коды 2FA, архивы
          или cookie.
        </p>
      </section>
      <section className="panel">
        <h2>Обратиться в поддержку</h2>
        <ErrorNotice error={error || q.error} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            setBusy(true);
            setError(null);
            try {
              if (demo)
                throw new Error("Обращения доступны после регистрации.");
              await post("/support/tickets", {
                category: data.get("category"),
                body: data.get("body"),
                request_id: data.get("request_id") || null,
              });
              form.reset();
              qc.invalidateQueries({ queryKey: ["tickets"] });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Тема
            <select name="category">
              {[
                ["connection", "Подключение"],
                ["import", "Импорт"],
                ["analytics", "Аналитика"],
                ["privacy", "Данные и приватность"],
                ["other", "Другое"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Опишите проблему
            <textarea
              name="body"
              required
              minLength={10}
              maxLength={5000}
              rows={5}
            />
          </label>
          <label>
            Номер запроса, если есть
            <input name="request_id" maxLength={40} pattern="[a-zA-Z0-9-]+" />
          </label>
          <button className="button" disabled={busy}>
            Отправить
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Мои обращения</h2>
        {q.data?.pages
          .flatMap((p) => p.items)
          .map((t) => (
            <article className="ticket-row" key={t.id}>
              <b>
                {t.category} · {t.status}
              </b>
              <small>
                {date(t.created_at)} · {t.id}
              </small>
              <p>{t.body}</p>
              {t.reply && <blockquote>Ответ поддержки: {t.reply}</blockquote>}
            </article>
          ))}
        {!q.data?.pages[0]?.items.length && (
          <p className="muted">Пока нет обращений.</p>
        )}
        {q.hasNextPage && (
          <button
            className="button secondary"
            onClick={() => q.fetchNextPage()}
          >
            Ещё 50
          </button>
        )}
      </section>
    </div>
  );
}
