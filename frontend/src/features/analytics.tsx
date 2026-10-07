"use client";
import type { components } from "@/lib/generated-api";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { api, Profile, date, number } from "@/lib/api";
import { demoHistory } from "@/lib/demo";
import { useUrlValue } from "@/lib/workflows";
import { ErrorNotice, Loader } from "./common";
type Point = components["schemas"]["AnalyticsPoint"];
export default function AnalyticsPanel({
  profile,
  demo = false,
  compact = false,
}: {
  profile?: Profile;
  demo?: boolean;
  compact?: boolean;
}) {
  const [period, setPeriod] = useUrlValue("analytics_period", "all"),
    [start, setStart] = useUrlValue("analytics_start", ""),
    [end, setEnd] = useUrlValue("analytics_end", ""),
    [metric, setMetric] = useUrlValue("analytics_metric", "followers"),
    [shown, setShown] = useState(50);
  const params = new URLSearchParams();
  if (period !== "all" && period !== "custom") params.set("days", period);
  if (period === "custom" && start)
    params.set("start", new Date(start + "T00:00:00").toISOString());
  if (period === "custom" && end)
    params.set("end", new Date(end + "T23:59:59").toISOString());
  const q = useQuery({
    queryKey: ["analytics", profile?.id, params.toString()],
    queryFn: ({ signal }) =>
      api<Point[]>(`/profiles/${profile!.id}/analytics?${params}`, { signal }),
    enabled: !demo && !!profile && (period !== "custom" || (!!start && !!end)),
  });
  const points = demo
    ? demoHistory.map((x) => ({ id: x.id, date: x.observed_at, ...x.counts! }))
    : q.data || [];
  const data = points.map((x, index) => ({
    ...x,
    label: date(x.date, true),
    net_followers: index ? x.followers - points[index - 1].followers : null,
    net_following: index ? x.following - points[index - 1].following : null,
  }));
  return (
    <section className={`panel chart-panel ${compact ? "" : "large"}`}>
      <header className="panel-heading">
        <div>
          <h3>Твой круг в динамике</h3>
          <p>Каждая точка — фактический снимок</p>
        </div>
        {!compact && (
          <label>
            Период
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setShown(50);
              }}
            >
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="all">Всё время</option>
              <option value="custom">Свой диапазон</option>
            </select>
          </label>
        )}
      </header>
      {period === "custom" && (
        <div className="button-row">
          <label>
            От
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            До
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
      )}
      {!compact && (
        <label>
          Показатель
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="followers">Подписчики и подписки</option>
            <option value="mutual_rate">Доля взаимности</option>
            <option value="mutual">Количество взаимных</option>
            <option value="net_followers">Изменения между снимками</option>
          </select>
        </label>
      )}
      <ErrorNotice error={q.error} />
      {period === "custom" && (!start || !end) ? (
        <p className="muted">Выберите начало и конец диапазона.</p>
      ) : q.isPending && !demo && profile ? (
        <Loader />
      ) : data.length ? (
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 12, left: -18, bottom: 0 }}
            >
              <CartesianGrid
                vertical={false}
                strokeDasharray="4 5"
                stroke="var(--border)"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
              />
              <YAxis
                tickLine={false}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                }}
              />
              <Area
                type="linear"
                dataKey={metric}
                name={
                  metric === "mutual_rate"
                    ? "Взаимность, %"
                    : metric === "mutual"
                      ? "Взаимные"
                      : metric === "net_followers"
                        ? "Нетто-прирост подписчиков"
                        : "Подписчики"
                }
                stroke="#7c3aed"
                fill="#7c3aed"
                fillOpacity={0.1}
                dot={{ r: 3 }}
                connectNulls={false}
              />
              {(metric === "followers" || metric === "net_followers") && (
                <Area
                  type="linear"
                  dataKey={
                    metric === "net_followers" ? "net_following" : "following"
                  }
                  name={
                    metric === "net_followers"
                      ? "Нетто-прирост подписок"
                      : "Подписки"
                  }
                  stroke="#166534"
                  fill="transparent"
                  dot={{ r: 3 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="small-empty">
          В выбранном периоде нет наблюдений. Измените диапазон или добавьте
          снимок.
        </div>
      )}
      <p className="chart-footnote">
        Между датами списки не измерялись. Уход и возвращение внутри интервала
        не видны.
      </p>
      {!compact && data.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption>Даты наблюдений и размеры списков</caption>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Подписчики</th>
                  <th>Подписки</th>
                  <th>Взаимность</th>
                  <th>Нетто-прирост</th>
                </tr>
              </thead>
              <tbody>
                {points.slice(0, shown).map((point, index) => (
                  <tr key={point.id}>
                    <td>{date(point.date)}</td>
                    <td>{number(point.followers)}</td>
                    <td>{number(point.following)}</td>
                    <td>
                      {point.mutual_rate === null
                        ? "Нет данных"
                        : point.mutual_rate + "%"}
                    </td>
                    <td>
                      {index
                        ? number(point.followers - points[index - 1].followers)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown < points.length && (
            <button
              className="button secondary"
              onClick={() => setShown(shown + 50)}
            >
              Ещё 50 наблюдений
            </button>
          )}
        </>
      )}
      {!compact && <PeriodComparison profile={profile} demo={demo} />}
    </section>
  );
}

function PeriodComparison({
  profile,
  demo,
}: {
  profile?: Profile;
  demo: boolean;
}) {
  const [a, setA] = useUrlValue("period_a_start", ""),
    [b, setB] = useUrlValue("period_a_end", ""),
    [c, setC] = useUrlValue("period_b_start", ""),
    [d, setD] = useUrlValue("period_b_end", "");
  const ranges = [
    [a, b],
    [c, d],
  ];
  const query = useQuery({
    queryKey: ["period-comparison", profile?.id, a, b, c, d],
    enabled: !demo && !!profile && ranges.every((r) => r.every(Boolean)),
    queryFn: ({ signal }) =>
      Promise.all(
        ranges.map(([start, end]) =>
          api<Point[]>(
            `/profiles/${profile!.id}/analytics?start=${encodeURIComponent(new Date(start + "T00:00:00").toISOString())}&end=${encodeURIComponent(new Date(end + "T23:59:59").toISOString())}`,
            { signal },
          ),
        ),
      ),
  });
  const rows = demo ? [pointsForDemo(a, b), pointsForDemo(c, d)] : query.data;
  return (
    <section className="feature-stack">
      <h3>Сравнение периодов</h3>
      <div className="comparison-selectors">
        {[
          ["Начало A", a, setA],
          ["Конец A", b, setB],
          ["Начало B", c, setC],
          ["Конец B", d, setD],
        ].map(([label, value, set]) => (
          <label key={String(label)}>
            {String(label)}
            <input
              type="date"
              value={String(value)}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            />
          </label>
        ))}
      </div>
      <ErrorNotice error={query.error} />
      {rows && (
        <div className="table-scroll">
          <table className="data-table">
            <caption>Фактические крайние наблюдения каждого периода</caption>
            <thead>
              <tr>
                <th>Период</th>
                <th>Наблюдения</th>
                <th>Интервал</th>
                <th>Прирост подписчиков</th>
                <th>Прирост подписок</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((points, i) => (
                <tr key={i}>
                  <td>{i ? "B" : "A"}</td>
                  <td>{points.length}</td>
                  <td>
                    {points.length >= 2
                      ? `${date(points[0].date)} — ${date(points.at(-1)!.date)}`
                      : "Нужно минимум два снимка"}
                  </td>
                  <td>
                    {points.length >= 2
                      ? number(points.at(-1)!.followers - points[0].followers)
                      : "—"}
                  </td>
                  <td>
                    {points.length >= 2
                      ? number(points.at(-1)!.following - points[0].following)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        Сравниваются только наблюдения внутри выбранных диапазонов; данные за
        соседние даты не подставляются.
      </p>
    </section>
  );
}
function pointsForDemo(start: string, end: string): Point[] {
  return demoHistory
    .map((x) => ({ id: x.id, date: x.observed_at, ...x.counts! }))
    .filter(
      (x) =>
        start &&
        end &&
        x.date >= new Date(start + "T00:00:00").toISOString() &&
        x.date <= new Date(end + "T23:59:59").toISOString(),
    );
}
