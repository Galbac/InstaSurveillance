"use client";

import type { components } from "@/lib/generated-api";
import { useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
  TrendingDown,
  Scale,
} from "lucide-react";
import { api, Profile, number } from "@/lib/api";
import { demoHistory } from "@/lib/demo";
import { ErrorNotice } from "./common";

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
          x={numX - 52}
          y={numY - 28}
          width={48}
          height={22}
          rx={6}
          fill="#7c3aed"
        />
        <text
          x={numX - 28}
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
  const [period, setPeriodState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search).get("analytics_period");
      if (sp) return sp;
    }
    return "7";
  });

  const handlePeriodChange = (val: string) => {
    setPeriodState(val);
    if (typeof window !== "undefined") {
      const next = new URLSearchParams(window.location.search);
      if (val === "7") next.delete("analytics_period");
      else next.set("analytics_period", val);
      const qs = next.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    }
  };

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
    placeholderData: keepPreviousData,
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
    const timestamps = rawPoints.map((p) => new Date(p.date).getTime()).filter((t) => !isNaN(t));
    const minTime = timestamps.length ? Math.min(...timestamps) : 0;
    const maxTime = timestamps.length ? Math.max(...timestamps) : 0;
    const spanHours = (maxTime - minTime) / (1000 * 3600);

    const dayKeys = rawPoints.map((p) => {
      const d = new Date(p.date);
      return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    });
    const hasDuplicateDays = new Set(dayKeys).size < dayKeys.length;
    const showTimeOnTicks = spanHours <= 48 || hasDuplicateDays;

    return rawPoints.map((p, index) => {
      const prev = index > 0 ? rawPoints[index - 1] : null;
      const d = new Date(p.date);
      const dayShort = `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`;
      const hours = String(d.getUTCHours()).padStart(2, "0");
      const minutes = String(d.getUTCMinutes()).padStart(2, "0");
      const label = showTimeOnTicks
        ? `${dayShort}, ${hours}:${minutes}`
        : dayShort;

      return {
        id: p.id,
        date: p.date,
        label,
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
  const comparison = useMemo(() => {
    if (demo) {
      return {
        hasEnoughData: true,
        totalPoints: 7,
        requiredPoints: 4,
        periodA: {
          label: "Период A",
          dateRange: "1–3 октября",
          followersDelta: 26,
          followingDelta: 6,
        },
        periodB: {
          label: "Период B",
          dateRange: "5–7 октября",
          followersDelta: 28,
          followingDelta: 6,
        },
        followersDiff: 2,
        growthPercent: "7,7",
      };
    }

    if (rawPoints.length < 4) {
      return {
        hasEnoughData: false,
        totalPoints: rawPoints.length,
        requiredPoints: 4,
        periodA: null,
        periodB: null,
        followersDiff: 0,
        growthPercent: "0",
      };
    }

    const mid = Math.floor(rawPoints.length / 2);
    const firstHalfStart = rawPoints[0];
    const firstHalfEnd = rawPoints[mid - 1];
    const secondHalfStart = rawPoints[mid];
    const secondHalfEnd = rawPoints[rawPoints.length - 1];

    const pAFollowers = firstHalfEnd.followers - firstHalfStart.followers;
    const pAFollowing = firstHalfEnd.following - firstHalfStart.following;

    const pBFollowers = secondHalfEnd.followers - secondHalfStart.followers;
    const pBFollowing = secondHalfEnd.following - secondHalfStart.following;

    const followersDiff = pBFollowers - pAFollowers;
    const growthPercent =
      pAFollowers !== 0
        ? ((followersDiff / Math.abs(pAFollowers)) * 100).toFixed(1).replace(".", ",")
        : "0";

    const dateA = `${formatShortDate(firstHalfStart.date)} – ${formatShortDate(firstHalfEnd.date)}`;
    const dateB = `${formatShortDate(secondHalfStart.date)} – ${formatShortDate(secondHalfEnd.date)}`;

    return {
      hasEnoughData: true,
      totalPoints: rawPoints.length,
      requiredPoints: 4,
      periodA: {
        label: "Период A",
        dateRange: dateA,
        followersDelta: pAFollowers,
        followingDelta: pAFollowing,
      },
      periodB: {
        label: "Период B",
        dateRange: dateB,
        followersDelta: pBFollowers,
        followingDelta: pBFollowing,
      },
      followersDiff,
      growthPercent,
    };
  }, [rawPoints, demo]);

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
                followersGrowth > 0 ? "green" : followersGrowth < 0 ? "red" : "neutral"
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
                followingGrowth > 0 ? "green" : followingGrowth < 0 ? "red" : "neutral"
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
                onClick={() => handlePeriodChange(val)}
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

        {q.isPending && !demo && profile && !chartData.length ? (
          <div className="analytics-v2-chart-skeleton" aria-busy="true">
            <div className="skeleton-shimmer" style={{ width: "100%", height: 320, borderRadius: 16 }} />
          </div>
        ) : chartData.length > 0 ? (
          <div className={`analytics-v2-chart-wrapper ${q.isFetching && q.isPlaceholderData ? "chart-updating" : ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 20, right: 16, left: 0, bottom: 12 }}
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
                  tickMargin={12}
                  padding={{ left: 24, right: 24 }}
                  minTickGap={28}
                  interval="preserveStartEnd"
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
                  Сравнивает динамику прироста между равными интервалами.
                </p>
              </div>
            </header>

            {!comparison.hasEnoughData ? (
              <div className="analytics-v2-compare-pending">
                <div className="analytics-v2-pending-icon-box">
                  <Scale size={22} />
                </div>
                <div className="analytics-v2-pending-info">
                  <h4 className="analytics-v2-pending-title">
                    Для точного сравнения требуется от 4 снимков
                  </h4>
                  <p className="analytics-v2-pending-desc">
                    Сохранено {comparison.totalPoints} из {comparison.requiredPoints} снимков. При следующих автоматических обновлениях здесь появится сравнительный анализ темпов роста.
                  </p>
                  <div className="analytics-v2-progress-bar-wrap">
                    <div
                      className="analytics-v2-progress-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(15, (comparison.totalPoints / comparison.requiredPoints) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="analytics-v2-progress-label">
                    {comparison.totalPoints} / {comparison.requiredPoints} снимков накоплено
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="analytics-v2-compare-boxes">
                  {/* Box A */}
                  <div className="analytics-v2-compare-box period-a">
                    <div className="analytics-v2-compare-box-head">
                      <div className="analytics-v2-box-badge-row">
                        <span className="analytics-v2-box-badge neutral">Период A</span>
                        <span className="analytics-v2-box-tag">Предыдущий</span>
                      </div>
                      <span className="analytics-v2-box-dates">
                        <Calendar size={13} className="text-gray-400" />
                        {comparison.periodA!.dateRange}
                      </span>
                    </div>
                    <div className="analytics-v2-compare-metrics">
                      <div className="analytics-v2-compare-metric-cell">
                        <span className="analytics-v2-metric-sub">Подписчики</span>
                        <div
                          className={`analytics-v2-metric-val ${
                            comparison.periodA!.followersDelta > 0
                              ? "positive"
                              : comparison.periodA!.followersDelta < 0
                              ? "negative"
                              : "zero"
                          }`}
                        >
                          {comparison.periodA!.followersDelta > 0
                            ? `+${comparison.periodA!.followersDelta} ↑`
                            : comparison.periodA!.followersDelta < 0
                            ? `${comparison.periodA!.followersDelta} ↓`
                            : "0"}
                        </div>
                      </div>
                      <div className="analytics-v2-compare-metric-cell">
                        <span className="analytics-v2-metric-sub">Подписки</span>
                        <div
                          className={`analytics-v2-metric-val ${
                            comparison.periodA!.followingDelta > 0
                              ? "positive"
                              : comparison.periodA!.followingDelta < 0
                              ? "negative"
                              : "zero"
                          }`}
                        >
                          {comparison.periodA!.followingDelta > 0
                            ? `+${comparison.periodA!.followingDelta} ↑`
                            : comparison.periodA!.followingDelta < 0
                            ? `${comparison.periodA!.followingDelta} ↓`
                            : "0"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Box B */}
                  <div className="analytics-v2-compare-box period-b">
                    <div className="analytics-v2-compare-box-head">
                      <div className="analytics-v2-box-badge-row">
                        <span className="analytics-v2-box-badge active">Период B</span>
                        <span className="analytics-v2-box-tag active">Текущий</span>
                      </div>
                      <span className="analytics-v2-box-dates">
                        <Calendar size={13} className="text-purple-500" />
                        {comparison.periodB!.dateRange}
                      </span>
                    </div>
                    <div className="analytics-v2-compare-metrics">
                      <div className="analytics-v2-compare-metric-cell">
                        <span className="analytics-v2-metric-sub">Подписчики</span>
                        <div
                          className={`analytics-v2-metric-val ${
                            comparison.periodB!.followersDelta > 0
                              ? "positive"
                              : comparison.periodB!.followersDelta < 0
                              ? "negative"
                              : "zero"
                          }`}
                        >
                          {comparison.periodB!.followersDelta > 0
                            ? `+${comparison.periodB!.followersDelta} ↑`
                            : comparison.periodB!.followersDelta < 0
                            ? `${comparison.periodB!.followersDelta} ↓`
                            : "0"}
                        </div>
                      </div>
                      <div className="analytics-v2-compare-metric-cell">
                        <span className="analytics-v2-metric-sub">Подписки</span>
                        <div
                          className={`analytics-v2-metric-val ${
                            comparison.periodB!.followingDelta > 0
                              ? "positive"
                              : comparison.periodB!.followingDelta < 0
                              ? "negative"
                              : "zero"
                          }`}
                        >
                          {comparison.periodB!.followingDelta > 0
                            ? `+${comparison.periodB!.followingDelta} ↑`
                            : comparison.periodB!.followingDelta < 0
                            ? `${comparison.periodB!.followingDelta} ↓`
                            : "0"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Insight Banner */}
                <div
                  className={`analytics-v2-compare-insight ${
                    comparison.followersDiff > 0
                      ? "positive"
                      : comparison.followersDiff < 0
                      ? "negative"
                      : "neutral"
                  }`}
                >
                  <div className="analytics-v2-insight-icon">
                    {comparison.followersDiff < 0 ? (
                      <TrendingDown size={18} />
                    ) : comparison.followersDiff > 0 ? (
                      <TrendingUp size={18} />
                    ) : (
                      <Scale size={18} />
                    )}
                  </div>
                  <div className="analytics-v2-insight-text">
                    <h4 className="analytics-v2-insight-title">
                      {comparison.followersDiff > 0
                        ? `Период B: прирост выше на +${comparison.followersDiff}`
                        : comparison.followersDiff < 0
                        ? `Период B: прирост ниже на ${comparison.followersDiff}`
                        : "Одинаковый темп прироста в обоих периодах"}
                    </h4>
                    <p className="analytics-v2-insight-desc">
                      {comparison.followersDiff > 0
                        ? `Во втором периоде аудитория росла быстрее на ${comparison.followersDiff} подписчиков (+${comparison.growthPercent}% к темпу периода A).`
                        : comparison.followersDiff < 0
                        ? `Во втором периоде прирост составил ${comparison.periodB!.followersDelta} против ${comparison.periodA!.followersDelta} в первом периоде.`
                        : "Количество новых подписчиков в обоих интервалах оказалось равным."}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
