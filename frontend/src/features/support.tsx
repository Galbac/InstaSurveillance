"use client";
import type { components } from "@/lib/generated-api";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, date } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { ErrorNotice, Loader } from "./common";
type Notice = components["schemas"]["NotificationDTO"];
type Ticket = components["schemas"]["TicketDTO"];
export function NotificationsPanel({ demo = false }: { demo?: boolean }) {
  const qc = useQueryClient(),
    [error, setError] = useState<unknown>(null);
  const [newlyReadIds, setNewlyReadIds] = useState<Set<string>>(() => new Set());
  const markedRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (demo || !rows.length) return;
    const unread = rows.filter((x) => !x.read && !markedRef.current.has(x.id));
    if (unread.length > 0) {
      const ids = unread.map((x) => x.id);
      ids.forEach((id) => markedRef.current.add(id));
      setNewlyReadIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      post("/notifications/read", { ids })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["notifications", "count"] });
        })
        .catch((e) => {
          setError(e);
        });
    }
  }, [rows, demo, qc]);

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
          {rows.map((x) => {
            const isNew = newlyReadIds.has(x.id);
            return (
              <article
                className={`notification-row ${isNew ? "is-newly-read" : ""}`}
                key={x.id}
              >
                <div className="notification-content">
                  <div className="notification-title-wrap">
                    <h3>{x.title}</h3>
                    {isNew && <span className="notification-new-badge">Новое</span>}
                  </div>
                  <p>{x.body}</p>
                  <small>
                    {date(x.created_at)}
                  </small>
                </div>
                {x.link && x.link.startsWith("/app") && (
                  <Link href={x.link} className="notification-open-link">
                    Открыть
                  </Link>
                )}
              </article>
            );
          })}
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
const CATEGORY_LABELS: Record<string, string> = {
  connection: "Подключение",
  import: "Импорт",
  analytics: "Аналитика",
  privacy: "Данные и приватность",
  other: "Другое",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Открыто",
  in_progress: "В работе",
  resolved: "Решено",
  closed: "Закрыто",
};

export function SupportPanel({ demo = false }: { demo?: boolean }) {
  const qc = useQueryClient(),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [ticketErrors, setTicketErrors] = useState<{
    body?: string;
  }>({});
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
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            const body = String(data.get("body") || "").trim();

            const errs: { body?: string } = {};
            if (!body || body.length < 10) {
              errs.body = "Опиши проблему подробнее (не менее 10 символов)";
            }

            if (Object.keys(errs).length > 0) {
              setTicketErrors(errs);
              return;
            }

            setTicketErrors({});
            setBusy(true);
            setError(null);
            try {
              if (demo)
                throw new Error("Обращения доступны после регистрации.");
              await post("/support/tickets", {
                category: data.get("category"),
                body,
                request_id: null,
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
              {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
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
              aria-invalid={!!ticketErrors.body}
              onChange={() => {
                if (ticketErrors.body) {
                  setTicketErrors((p) => ({ ...p, body: undefined }));
                }
              }}
            />
            {ticketErrors.body && (
              <span className="field-error" role="alert">
                {ticketErrors.body}
              </span>
            )}
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
                {CATEGORY_LABELS[t.category] || t.category} ·{" "}
                {STATUS_LABELS[t.status] || t.status}
              </b>
              <small>{date(t.created_at)}</small>
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
