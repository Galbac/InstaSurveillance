"use client";

import type { components } from "@/lib/generated-api";
import { useState, useMemo } from "react";
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
import {
  Users,
  User,
  HeartHandshake,
  Calendar,
  TrendingUp,
  Scale,
} from "lucide-react";
import { api, Profile, number } from "@/lib/api";
import { demoHistory } from "@/lib/demo";
import { useUrlValue } from "@/lib/workflows";
import { ErrorNotice, Loader } from "./common";

type Point = components["schemas"]["AnalyticsPoint"];

const SHORT_MONTHS = [
  "янв.",
  "фев.",
  "мар.",
  "апр.",
  "мая",
  "июн.",
  "июл.",
  "авг.",
  "сен.",
  "окт.",
  "ноя.",
  "дек.",
];

const FULL_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function formatShortDate(isoString: string) {
  const d = new Date(isoString);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
}

function formatTableDate(isoString: string) {
  const d = new Date(isoString);
  const day = d.getUTCDate();
  const month = FULL_MONTHS[d.getUTCMonth()];
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month}, ${hours}:${minutes}`;
}

interface CustomPointLabelProps {
  x?: number | string;
  y?: number | string;
  value?: unknown;
  index?: number;
  total?: number;
  [key: string]: unknown;
}

function ChartPointLabel(props: CustomPointLabelProps) {
  const { x, y, value, index = 0, total = 0 } = props;
  if (value === undefined || value === null) return null;
  const isLast = index === total - 1;

  if (isLast) {
    const numX = Number(x) || 0;
    const numY = Number(y) || 0;
    return (
      <g>
        <rect
          x={numX - 24}
          y={numY - 28}
          width={48}
          height={22}
          rx={6}
          fill="#7c3aed"
        />
        <text
          x={numX}
          y={numY - 13}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={11.5}
          fontWeight="700"
        >
          {number(Number(value))}
        </text>
      </g>
    );
  }

  return null;
}

export default function AnalyticsPanel({
  profile,
  demo = false,
  compact = false,
}: {
  profile?: Profile;
  demo?: boolean;
  compact?: boolean;
}) {
  const [period, setPeriod] = useUrlValue("analytics_period", "7");
  const [metricView, setMetricView] = useState<"followers" | "following" | "both">("followers");

  const params = new URLSearchParams();
  if (period !== "all") {
    const numDays = parseInt(period, 10);
    if (!isNaN(numDays)) params.set("days", String(numDays));
  }

  const q = useQuery({
    queryKey: ["analytics", profile?.id, params.toString()],
    queryFn: ({ signal }) =>
      api<Point[]>(`/profiles/${profile!.id}/analytics?${params}`, { signal }),
    enabled: !demo && !!profile,
  });

  const rawPoints: Point[] = useMemo(() => {
    if (demo) {
      return demoHistory.map((x) => ({
        id: x.id,
        date: x.observed_at,
        followers: x.counts?.followers || 0,
        following: x.counts?.following || 0,
        mutual: x.counts?.mutual || 405,
        mutual_rate: 49.4,
        fans: x.counts?.fans || 0,
        not_following_back: x.counts?.not_following_back || 0,
      }));
    }
    return q.data || [];
  }, [demo, q.data]);

  const chartData = useMemo(() => {
    return rawPoints.map((p, index) => {
      const prev = index > 0 ? rawPoints[index - 1] : null;
      return {
        id: p.id,
        date: p.date,
        label: formatShortDate(p.date),
        followers: p.followers,
        following: p.following,
        followersDelta: prev ? p.followers - prev.followers : null,
        followingDelta: prev ? p.following - prev.following : null,
        mutual_rate: p.mutual_rate ?? 49.4,
      };
    });
  }, [rawPoints]);

  const latestPoint = chartData[chartData.length - 1];
  const firstPoint = chartData[0];

  const totalFollowers = demo
    ? latestPoint?.followers || 1240
    : latestPoint?.followers ?? 0;
  const totalFollowing = demo
    ? latestPoint?.following || 828
    : latestPoint?.following ?? 0;
  const followersGrowth = demo
    ? totalFollowers - (firstPoint?.followers || 1160)
    : chartData.length > 1
    ? totalFollowers - (firstPoint?.followers ?? 0)
    : 0;
  const followingGrowth = demo
    ? totalFollowing - (firstPoint?.following || 810)
    : chartData.length > 1
    ? totalFollowing - (firstPoint?.following ?? 0)
    : 0;
  const mutualDisplay = demo
    ? "49,4%"
    : latestPoint?.mutual_rate != null
    ? `${latestPoint.mutual_rate.toString().replace(".", ",")}%`
    : "0%";
  const snapshotCount = rawPoints.length;

  // History table rows (reverse chronological: latest first)
  const historyRows = useMemo(() => {
    return [...chartData].reverse();
  }, [chartData]);

  // Period comparison calculations
  const periodA = useMemo(() => {
    if (rawPoints.length >= 3) {
      const start = rawPoints[0];
      const end = rawPoints[2];
      return {
        start,
        end,
        followersDelta: end.followers - start.followers,
        followingDelta: end.following - start.following,
      };
    }
    if (demo) {
      return { followersDelta: 26, followingDelta: 6 };
    }
    return { followersDelta: 0, followingDelta: 0 };
  }, [rawPoints, demo]);

  const periodB = useMemo(() => {
    if (rawPoints.length >= 7) {
      const start = rawPoints[4];
      const end = rawPoints[6];
      return {
        start,
        end,
        followersDelta: end.followers - start.followers,
        followingDelta: end.following - start.following,
      };
    }
    if (demo) {
      return { followersDelta: 28, followingDelta: 6 };
    }
    return { followersDelta: 0, followingDelta: 0 };
  }, [rawPoints, demo]);

  const growthDiff = periodB.followersDelta - periodA.followersDelta;
  const growthPercent =
    periodA.followersDelta > 0
      ? ((growthDiff / periodA.followersDelta) * 100).toFixed(1).replace(".", ",")
      : demo
      ? "7,7"
      : "0";

  return (
    <div className="analytics-v2-container">
      {/* 1. Four KPI Metric Cards */}
      {!compact && <section className="analytics-v2-stat-grid">
        {/* Card 1: Подписчики */}
        <div className="analytics-v2-stat-card">
          <div className="analytics-v2-stat-card-top">
            <div className="analytics-v2-stat-icon purple">
              <Users size={20} />
            </div>
            <span
              className={`analytics-v2-stat-badge ${
                followersGrowth >= 0 ? "green" : "red"
              }`}
            >
              {chartData.length < 2 ? "Первый снимок" : followersGrowth === 0 ? "Без изменения" : followersGrowth > 0 ? `+${followersGrowth} ↑` : `${followersGrowth} ↓`}
            </span>
          </div>
          <div>
            <h3 className="analytics-v2-stat-label">Подписчики</h3>
            <div className="analytics-v2-stat-value">{number(totalFollowers)}</div>
            <p className="analytics-v2-stat-subtext">Последний снимок</p>
          </div>
        </div>

        {/* Card 2: Подписки */}
        <div className="analytics-v2-stat-card">
          <div className="analytics-v2-stat-card-top">
            <div className="analytics-v2-stat-icon blue">
              <User size={20} />
            </div>
            <span
              className={`analytics-v2-stat-badge ${
                followingGrowth >= 0 ? "green" : "red"
              }`}
            >
              {chartData.length < 2 ? "Первый снимок" : followingGrowth === 0 ? "Без изменения" : followingGrowth > 0 ? `+${followingGrowth} ↑` : `${followingGrowth} ↓`}
            </span>
          </div>
          <div>
            <h3 className="analytics-v2-stat-label">Подписки</h3>
            <div className="analytics-v2-stat-value">{number(totalFollowing)}</div>
            <p className="analytics-v2-stat-subtext">Последний снимок</p>
          </div>
        </div>

        {/* Card 3: Взаимность */}
        <div className="analytics-v2-stat-card">
          <div className="analytics-v2-stat-card-top">
            <div className="analytics-v2-stat-icon pink">
              <HeartHandshake size={20} />
            </div>
          </div>
          <div>
            <h3 className="analytics-v2-stat-label">Взаимность</h3>
            <div className="analytics-v2-stat-value">{mutualDisplay}</div>
            <p className="analytics-v2-stat-subtext">По сохранённым данным</p>
          </div>
        </div>

        {/* Card 4: Снимки */}
        <div className="analytics-v2-stat-card">
          <div className="analytics-v2-stat-card-top">
            <div className="analytics-v2-stat-icon purple">
              <Calendar size={20} />
            </div>
          </div>
          <div>
            <h3 className="analytics-v2-stat-label">Снимки</h3>
            <div className="analytics-v2-stat-value">{snapshotCount}</div>
            <p className="analytics-v2-stat-subtext">За выбранный период</p>
          </div>
        </div>
      </section>}

      {/* 2. Main Dynamic Chart Card */}
      <section className="analytics-v2-chart-card">
        <header className="analytics-v2-chart-header">
          <div>
            <h2 className="analytics-v2-chart-title">Динамика твоего круга</h2>
            <p className="analytics-v2-chart-subtitle">
              Как менялись показатели по дням
            </p>
          </div>

          <div className="analytics-v2-timeframe-group" role="tablist">
            {[
              ["7", "7 дней"],
              ["30", "30 дней"],
              ["90", "90 дней"],
              ["all", "Всё время"],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                role="tab"
                aria-selected={period === val}
                className={`analytics-v2-timeframe-btn ${
                  period === val ? "active" : ""
                }`}
                onClick={() => setPeriod(val)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* Controls row: metric toggle */}
        <div className="analytics-v2-chart-controls">
          <div className="analytics-v2-metric-group">
            <button
              type="button"
              className={`analytics-v2-metric-btn ${
                metricView === "followers" ? "active" : ""
              }`}
              onClick={() => setMetricView("followers")}
            >
              <Users size={15} />
              <span>Подписчики</span>
            </button>
            <button
              type="button"
              className={`analytics-v2-metric-btn ${
                metricView === "following" ? "active" : ""
              }`}
              onClick={() => setMetricView("following")}
            >
              <User size={15} />
              <span>Подписки</span>
            </button>
            <button
              type="button"
              className={`analytics-v2-metric-btn ${
                metricView === "both" ? "active" : ""
              }`}
              onClick={() => setMetricView("both")}
            >
              <Scale size={15} />
              <span className="analytics-v2-metric-full">Оба показателя</span>
              <span className="analytics-v2-metric-short">Оба</span>
            </button>
          </div>
        </div>

        <ErrorNotice error={q.error} />

        {q.isPending && !demo && profile ? (
          <div style={{ padding: 48, display: "flex", justifyContent: "center" }}>
            <Loader />
          </div>
        ) : chartData.length > 0 ? (
          <div className="analytics-v2-chart-wrapper">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="purpleGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="blueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.16} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 4"
                  stroke="#edf0f5"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(val) => number(val)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#ffffff",
                    color: "#171a27",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
                    fontSize: 13,
                  }}
                  formatter={(val: unknown) => [number(Number(val)), ""]}
                  labelFormatter={(lbl) => `Снимок: ${lbl}`}
                />
                {(metricView === "followers" || metricView === "both") && (
                  <Area
                    type="monotone"
                    dataKey="followers"
                    name="Подписчики"
                    stroke="#7c3aed"
                    strokeWidth={2.5}
                    fill="url(#purpleGradient)"
                    dot={{
                      r: 4,
                      stroke: "#7c3aed",
                      strokeWidth: 2,
                      fill: "#ffffff",
                    }}
                    activeDot={{ r: 6, fill: "#7c3aed" }}
                    label={(props) => (
                      <ChartPointLabel
                        {...props}
                        total={chartData.length}
                      />
                    )}
                  />
                )}
                {(metricView === "following" || metricView === "both") && (
                  <Area
                    type="monotone"
                    dataKey="following"
                    name="Подписки"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    fill="url(#blueGradient)"
                    dot={{
                      r: 4,
                      stroke: "#3b82f6",
                      strokeWidth: 2,
                      fill: "#ffffff",
                    }}
                    activeDot={{ r: 6, fill: "#3b82f6" }}
                    label={
                      metricView === "following"
                        ? (props) => (
                            <ChartPointLabel
                              {...props}
                              total={chartData.length}
                            />
                          )
                        : undefined
                    }
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

        <footer className="analytics-v2-chart-footer">
          <span>{chartData.length} наблюдений</span>
          <span>
            {latestPoint
              ? `Последнее обновление: ${formatTableDate(latestPoint.date)}`
              : "Нет данных"}
          </span>
        </footer>
      </section>

      {/* 3. Bottom Grid: History Table & Period Comparison */}
      {!compact && (
        <section className="analytics-v2-bottom-grid">
          {/* Bottom Left Card: История показателей */}
          <div className="analytics-v2-history-card">
            <header className="analytics-v2-card-header">
              <div>
                <h3 className="analytics-v2-card-title">История показателей</h3>
                <p className="analytics-v2-card-subtitle">
                  Все сохранённые снимки за период.
                </p>
              </div>
            </header>

            <div className="analytics-v2-table-wrapper">
              <table className="analytics-v2-history-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Подписчики</th>
                    <th>Δ</th>
                    <th>Подписки</th>
                    <th>Δ</th>
                    <th>Взаимность</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => {
                    const fDelta = row.followersDelta;
                    const foDelta = row.followingDelta;

                    return (
                      <tr key={row.id} className="analytics-v2-history-row">
                        <td className="analytics-v2-date-cell">
                          {formatTableDate(row.date)}
                        </td>
                        <td>
                          <strong>{number(row.followers)}</strong>
                        </td>
                        <td>
                          {fDelta !== null && fDelta !== undefined ? (
                            fDelta > 0 ? (
                              <span className="analytics-v2-pill-delta green">
                                ↑ +{fDelta}
                              </span>
                            ) : fDelta < 0 ? (
                              <span className="analytics-v2-pill-delta red">
                                ↓ -{Math.abs(fDelta)}
                              </span>
                            ) : (
                              <span className="analytics-v2-dash">0</span>
                            )
                          ) : (
                            <span className="analytics-v2-dash">—</span>
                          )}
                        </td>
                        <td>
                          <span>{number(row.following)}</span>
                        </td>
                        <td>
                          {foDelta !== null && foDelta !== undefined ? (
                            foDelta > 0 ? (
                              <span className="analytics-v2-pill-delta green">
                                ↑ +{foDelta}
                              </span>
                            ) : foDelta < 0 ? (
                              <span className="analytics-v2-pill-delta red">
                                ↓ -{Math.abs(foDelta)}
                              </span>
                            ) : (
                              <span className="analytics-v2-dash">0</span>
                            )
                          ) : (
                            <span className="analytics-v2-dash">—</span>
                          )}
                        </td>
                        <td>
                          <span>
                            {typeof row.mutual_rate === "number"
                              ? `${row.mutual_rate.toString().replace(".", ",")}%`
                              : "49,4%"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (Same pattern as changes-v2-mobile-list) */}
            <div className="analytics-v2-mobile-list">
              {historyRows.map((row) => {
                const fDelta = row.followersDelta;
                const foDelta = row.followingDelta;

                return (
                  <div key={row.id} className="analytics-v2-mobile-card">
                    <div className="analytics-v2-mobile-card-top">
                      <div className="analytics-v2-mobile-date">
                        <Calendar size={14} className="text-purple-600 inline mr-1.5" />
                        <span>{formatTableDate(row.date)}</span>
                      </div>
                      <span className="analytics-v2-stat-badge purple">
                        {typeof row.mutual_rate === "number"
                          ? `${row.mutual_rate.toString().replace(".", ",")}%`
                          : "49,4%"}{" "}
                        взаимно
                      </span>
                    </div>

                    <div className="analytics-v2-mobile-card-grid">
                      <div className="analytics-v2-mobile-metric-box">
                        <span className="label">Подписчики</span>
                        <div className="val-row">
                          <span className="val">{number(row.followers)}</span>
                          {fDelta !== null && fDelta !== undefined && (
                            <span
                              className={`analytics-v2-pill-delta ${
                                fDelta > 0 ? "green" : fDelta < 0 ? "red" : ""
                              }`}
                            >
                              {fDelta > 0
                                ? `↑ +${fDelta}`
                                : fDelta < 0
                                ? `↓ -${Math.abs(fDelta)}`
                                : "0"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="analytics-v2-mobile-metric-box">
                        <span className="label">Подписки</span>
                        <div className="val-row">
                          <span className="val">{number(row.following)}</span>
                          {foDelta !== null && foDelta !== undefined && (
                            <span
                              className={`analytics-v2-pill-delta ${
                                foDelta > 0 ? "green" : foDelta < 0 ? "red" : ""
                              }`}
                            >
                              {foDelta > 0
                                ? `↑ +${foDelta}`
                                : foDelta < 0
                                ? `↓ -${Math.abs(foDelta)}`
                                : "0"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Right Card: Сравнение периодов */}
          <div className="analytics-v2-compare-card">
            <header className="analytics-v2-card-header">
              <div>
                <h3 className="analytics-v2-card-title">Сравнение периодов</h3>
                <p className="analytics-v2-card-subtitle">
                  Узнай, в какой период твой круг рос быстрее.
                </p>
              </div>
            </header>

            <div className="analytics-v2-compare-boxes">
              {/* Box A */}
              <div className="analytics-v2-compare-box">
                <div className="analytics-v2-compare-box-head">
                  <span className="analytics-v2-box-label">Период A</span>
                  <span className="analytics-v2-box-dates">
                    <Calendar size={14} className="text-gray-400" />
                    {periodA.start && periodA.end
                      ? `${formatShortDate(periodA.start.date)} – ${formatShortDate(periodA.end.date)}`
                      : demo
                      ? "1–3 октября"
                      : "Нет данных"}
                  </span>
                </div>
                <div className="analytics-v2-compare-metrics">
                  <div>
                    <p className="analytics-v2-metric-sub">
                      Прирост подписчиков
                    </p>
                    <div className="analytics-v2-metric-val">
                      {periodA.followersDelta >= 0
                        ? `+${periodA.followersDelta}`
                        : periodA.followersDelta}
                    </div>
                  </div>
                  <div>
                    <p className="analytics-v2-metric-sub">Прирост подписок</p>
                    <div className="analytics-v2-metric-val">
                      {periodA.followingDelta >= 0
                        ? `+${periodA.followingDelta}`
                        : periodA.followingDelta}
                    </div>
                  </div>
                </div>
              </div>

              {/* Box B */}
              <div className="analytics-v2-compare-box">
                <div className="analytics-v2-compare-box-head">
                  <span className="analytics-v2-box-label">Период B</span>
                  <span className="analytics-v2-box-dates">
                    <Calendar size={14} className="text-gray-400" />
                    {periodB.start && periodB.end
                      ? `${formatShortDate(periodB.start.date)} – ${formatShortDate(periodB.end.date)}`
                      : demo
                      ? "5–7 октября"
                      : "Нет данных"}
                  </span>
                </div>
                <div className="analytics-v2-compare-metrics">
                  <div>
                    <p className="analytics-v2-metric-sub">
                      Прирост подписчиков
                    </p>
                    <div className="analytics-v2-metric-val">
                      {periodB.followersDelta >= 0
                        ? `+${periodB.followersDelta}`
                        : periodB.followersDelta}
                    </div>
                  </div>
                  <div>
                    <p className="analytics-v2-metric-sub">Прирост подписок</p>
                    <div className="analytics-v2-metric-val">
                      {periodB.followingDelta >= 0
                        ? `+${periodB.followingDelta}`
                        : periodB.followingDelta}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Insight Banner */}
            <div className="analytics-v2-compare-insight">
              <div className="analytics-v2-insight-icon">
                <TrendingUp size={18} />
              </div>
              <div className="analytics-v2-insight-text">
                <h4 className="analytics-v2-insight-title">
                  {growthDiff >= 0
                    ? `Период B: +${growthDiff} подписчиков`
                    : `Период B: ${growthDiff} подписчиков`}
                </h4>
                <p className="analytics-v2-insight-desc">
                  {chartData.length >= 7 || demo
                    ? `Прирост за второй период отличается на ${growthDiff}. Темп роста: ${growthPercent}%.`
                    : "Для точного сопоставления периодов требуется накопить от 7 снимков."}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
