"use client";
import type { components } from "@/lib/generated-api";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, post, Profile, Event, date } from "@/lib/api";
import { Page, polling, useVisible, useUrlValue } from "@/lib/workflows";
import { demoEvents, demoHistory } from "@/lib/demo";
import { ErrorNotice, ExportButton, JobProgress, Loader } from "./common";
import { useSnapshots } from "./history";
type Comparison = components["schemas"]["ComparisonDTO"];
export default function ChangesPanel({
  profile,
  demo = false,
}: {
  profile?: Profile;
  demo?: boolean;
}) {
  const visible = useVisible();
  const history = useSnapshots(profile, !demo);
  const snapshots = demo
    ? demoHistory
    : history.data?.pages.flatMap((page) => page.items) || [];
  const [before, setBefore] = useUrlValue("before", ""),
    [after, setAfter] = useUrlValue("after", ""),
    [id, setId] = useUrlValue("comparison", ""),
    [error, setError] = useState<unknown>(null),
    [relation, setRelation] = useUrlValue("relation", ""),
    [type, setType] = useUrlValue("type", ""),
    [search, setSearch] = useUrlValue("search", ""),
    [mode, setMode] = useUrlValue("mode", "snapshots"),
    [days, setDays] = useUrlValue("days", "7");
  const q = useQuery({
    queryKey: ["comparison", id],
    queryFn: ({ signal }) => api<Comparison>(`/comparisons/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.job?.created_at, visible),
  });
  const filters = new URLSearchParams({ search });
  if (relation) filters.set("relation", relation);
  if (type) filters.set("type", type);
  const events = useInfiniteQuery({
    queryKey: ["events", id, filters.toString()],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Event & { id: string }>>(
        `/comparisons/${id}/events?${filters}${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!id && q.data?.status === "completed",
  });
  async function calculate() {
    setError(null);
    if (demo) {
      setId("");
      return;
    }
    try {
      let left = before,
        right = after;
      if (mode === "period") {
        const end = new Date(),
          start = new Date(end.getTime() - Number(days) * 86400000);
        const pair = await api<{
          before?: { id: string };
          after?: { id: string };
          count: number;
        }>(
          `/profiles/${profile!.id}/period-snapshots?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
        );
        if (pair.count < 2 || !pair.before || !pair.after)
          throw new Error(
            "В периоде нет двух наблюдений. Выберите снимки вручную; данные за соседние дни не подставляются.",
          );
        left = pair.before.id;
        right = pair.after.id;
      }
      const result = await post<{ id: string }>(
        `/profiles/${profile!.id}/comparisons`,
        { before_snapshot_id: left, after_snapshot_id: right },
      );
      if (id === result.id) await q.refetch();
      setId(result.id);
    } catch (error) {
      setError(error);
    }
  }
  const rows = demo
    ? demoEvents
    : events.data?.pages.flatMap((page) => page.items) || [];
  return (
    <div className="feature-stack">
      <section className="panel">
        <header className="panel-heading">
          <h2>Изменения между наблюдениями</h2>
          <select
            aria-label="Способ сравнения"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="snapshots">Два снимка</option>
            <option value="period">За период</option>
          </select>
        </header>
        <div className="comparison-selectors">
          {mode === "snapshots" ? (
            <>
              <label>
                Более ранний
                <select
                  value={before}
                  onChange={(e) => setBefore(e.target.value)}
                >
                  <option value="">Выберите снимок</option>
                  {snapshots.map((x) => (
                    <option key={x.id} value={x.id}>
                      {date(x.observed_at)} · {x.source}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Более поздний
                <select
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                >
                  <option value="">Выберите снимок</option>
                  {snapshots.map((x) => (
                    <option key={x.id} value={x.id}>
                      {date(x.observed_at)} · {x.source}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Период
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">7 дней</option>
                <option value="30">30 дней</option>
                <option value="90">90 дней</option>
              </select>
            </label>
          )}
          <button
            className="button"
            disabled={
              !demo &&
              (!profile || (mode === "snapshots" && (!before || !after)))
            }
            onClick={calculate}
          >
            Сравнить
          </button>
        </div>
        {history.hasNextPage && (
          <button
            className="button secondary small"
            onClick={() => history.fetchNextPage()}
          >
            Загрузить более ранние снимки
          </button>
        )}
        <ErrorNotice error={error || q.error || events.error} />
        {q.data && (
          <>
            <p>
              Фактический интервал: ({date(q.data.interval.start)},{" "}
              {date(q.data.interval.end)}]
            </p>
            <p className="muted">
              {q.data.identity_mode === "username"
                ? "Сопоставление по username; переименование может выглядеть как уход."
                : "Сопоставление по устойчивому ID."}{" "}
              Исчезновение из списка — возможная отписка; точная причина и время
              неизвестны.
            </p>
            {q.data.job && <JobProgress job={q.data.job} />}
          </>
        )}
      </section>
      {(demo || q.data?.status === "completed") && (
        <section className="panel">
          <div className="stat-grid">
            {[
              ["followers_added", "Новые подписчики"],
              ["followers_removed", "Исчезли из подписчиков"],
              ["following_added", "Новые подписки"],
              ["following_removed", "Исчезли из подписок"],
            ].map(([key, label]) => (
              <div className="stat-card" key={key}>
                <span>{label}</span>
                <strong>
                  {demo
                    ? key === "followers_added"
                      ? 2
                      : 3
                    : q.data?.counts[key] || 0}
                </strong>
              </div>
            ))}
          </div>
          <div className="list-toolbar">
            <input
              aria-label="Поиск событий"
              placeholder="Username"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Тип списка"
              value={relation}
              onChange={(e) => setRelation(e.target.value)}
            >
              <option value="">Все списки</option>
              <option value="followers">Подписчики</option>
              <option value="following">Подписки</option>
            </select>
            <select
              aria-label="Событие"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">Все события</option>
              <option value="added">Появились</option>
              <option value="removed">Исчезли</option>
            </select>
            {!demo && id && (
              <ExportButton
                label="Экспорт событий"
                request={{
                  scope: "comparison",
                  format: "csv",
                  comparison_id: id,
                  search,
                  relation:
                    relation === "followers" || relation === "following"
                      ? relation
                      : undefined,
                  type:
                    type === "added" || type === "removed" ? type : undefined,
                }}
              />
            )}
          </div>
          {events.isPending && !demo ? (
            <Loader />
          ) : (
            rows.map((event) => (
              <div
                className="person-row"
                key={event.identity_key + event.relation + event.type}
              >
                <span className={`event-dot ${event.type}`}>
                  {event.type === "added" ? "+" : "−"}
                </span>
                <div className="person-main">
                  <b>@{event.username}</b>
                  <small>
                    {event.type === "added" ? "Появился" : "Исчез"} ·{" "}
                    {event.relation === "followers" ? "подписчики" : "подписки"}
                  </small>
                </div>
              </div>
            ))
          )}
          {!rows.length && (
            <p className="small-empty">Изменений по выбранным фильтрам нет.</p>
          )}
          {events.hasNextPage && (
            <button
              className="button secondary"
              onClick={() => events.fetchNextPage()}
            >
              Ещё 50 событий
            </button>
          )}
        </section>
      )}
    </div>
  );
}
