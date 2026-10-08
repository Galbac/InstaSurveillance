"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import {
  Calendar,
  ArrowUpDown,
  Users,
  UserCheck,
  ArrowRight,
  MoreHorizontal,
  Sparkles,
  ArrowLeftRight,
  X,
  ChevronDown,
  Trash2,
  ExternalLink,
  Layers,
} from "lucide-react";
import { api, Profile, Snapshot, date, number } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { demoHistory } from "@/lib/demo";
import { ErrorNotice, Loader, Modal } from "./common";

export function useSnapshots(profile?: Profile, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["snapshots", profile?.id],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Snapshot>>(
        `/profiles/${profile!.id}/snapshots?limit=50${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: enabled && !!profile,
  });
}

const MONTHS_GENITIVE = [
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

const MONTHS_NOMINATIVE = [
  "ЯНВАРЬ",
  "ФЕВРАЛЬ",
  "МАРТ",
  "АПРЕЛЬ",
  "МАЙ",
  "ИЮНЬ",
  "ИЮЛЬ",
  "АВГУСТ",
  "СЕНТЯБРЬ",
  "ОКТЯБРЬ",
  "НОЯБРЬ",
  "ДЕКАБРЬ",
];

const WEEKDAYS = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

function parseSnapshotDate(isoString: string) {
  const d = new Date(isoString);
  const day = d.getUTCDate();
  const monthIdx = d.getUTCMonth();
  const monthGen = MONTHS_GENITIVE[monthIdx] || "";
  const monthNom = MONTHS_NOMINATIVE[monthIdx] || "";
  const weekday = WEEKDAYS[d.getUTCDay()] || "";
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;
  const year = d.getUTCFullYear();

  return {
    day,
    monthGen,
    dateTitle: `${day} ${monthGen}`,
    weekdayTime: `${weekday} • ${time}`,
    monthYearHeading: `${monthNom} ${year}`,
    shortCompare: `${day} ${monthGen} ${time}`,
    time,
    timestamp: d.getTime(),
  };
}

const DEMO_AVATAR_POOL = [
  "/demo-avatars/alina.jpg",
  "/demo-avatars/kirill.jpg",
  "/demo-avatars/nikita.jpg",
  "/demo-avatars/anna.jpg",
  "/demo-avatars/max.jpg",
  "/demo-avatars/dasha.jpg",
];

export default function HistoryPanel({
  profile,
  demo = false,
}: {
  profile?: Profile;
  demo?: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = useSnapshots(profile, !demo);

  // Default selection in demo matches the screenshot: Oct 7 ("6") and Oct 6 ("5")
  const [selection, setSelection] = useState<string[]>(
    demo ? ["6", "5"] : [],
  );
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [details, setDetails] = useState<Snapshot | null>(null);
  const [deleting, setDeleting] = useState<Snapshot | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const rawRows: Snapshot[] = useMemo(() => {
    if (demo) {
      return [...demoHistory];
    }
    return q.data?.pages.flatMap((page) => page.items) || [];
  }, [demo, q.data]);

  // Sort chronologically ascending to compute accurate predecessor deltas
  const chronologicalMap = useMemo(() => {
    const sorted = [...rawRows].sort(
      (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
    );
    const map = new Map<
      string,
      {
        prevSnapshot: Snapshot | null;
        deltaFollowers: number | null;
        deltaFollowing: number | null;
        prevDateLabel: string;
      }
    >();

    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : null;
      if (prev) {
        const dFollowers =
          (curr.counts?.followers || 0) - (prev.counts?.followers || 0);
        const dFollowing =
          (curr.counts?.following || 0) - (prev.counts?.following || 0);
        const prevParsed = parseSnapshotDate(prev.observed_at);
        map.set(curr.id, {
          prevSnapshot: prev,
          deltaFollowers: dFollowers,
          deltaFollowing: dFollowing,
          prevDateLabel: prevParsed.dateTitle,
        });
      } else {
        map.set(curr.id, {
          prevSnapshot: null,
          deltaFollowers: null,
          deltaFollowing: null,
          prevDateLabel: "",
        });
      }
    }
    return map;
  }, [rawRows]);

  // Display rows according to chosen sort order
  const displayRows = useMemo(() => {
    const list = [...rawRows];
    list.sort((a, b) => {
      const diff = Date.parse(b.observed_at) - Date.parse(a.observed_at);
      return sortOrder === "desc" ? diff : -diff;
    });
    return list;
  }, [rawRows, sortOrder]);

  // Find latest snapshot id across the entire set
  const latestSnapshotId = useMemo(() => {
    if (!rawRows.length) return null;
    let latest = rawRows[0];
    for (const r of rawRows) {
      if (Date.parse(r.observed_at) > Date.parse(latest.observed_at)) {
        latest = r;
      }
    }
    return latest.id;
  }, [rawRows]);

  const toggleSelect = (id: string) => {
    if (selection.includes(id)) {
      setSelection(selection.filter((x) => x !== id));
    } else {
      if (selection.length >= 2) {
        // Keep the latest clicked one and replace the oldest selection
        setSelection([selection[1], id]);
      } else {
        setSelection([...selection, id]);
      }
    }
  };

  const selectedSnapshots = useMemo(() => {
    return selection
      .map((id) => rawRows.find((x) => x.id === id))
      .filter((x): x is Snapshot => !!x)
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  }, [selection, rawRows]);

  return (
    <div className="history-page-container">
      <div className="history-main-card">
        {/* Header with Title and Filters */}
        <div className="history-header">
          <div className="history-title-group">
            <h2 className="history-card-title">История снимков</h2>
            <p className="history-card-subtitle">
              {rawRows.length} сохранённых снимков
            </p>
          </div>

          <div className="history-controls-group">
            <div className="history-select-wrapper">
              <Calendar size={14} className="control-icon" />
              <select
                className="history-select"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Фильтр по датам"
              >
                <option value="all">Все даты</option>
              </select>
              <ChevronDown size={14} className="chevron-icon" />
            </div>

            <div className="history-select-wrapper">
              <ArrowUpDown size={14} className="control-icon" />
              <select
                className="history-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "desc" | "asc")}
                aria-label="Сортировка снимков"
              >
                <option value="desc">Новые сначала</option>
                <option value="asc">Старые сначала</option>
              </select>
              <ChevronDown size={14} className="chevron-icon" />
            </div>
          </div>
        </div>

        <ErrorNotice error={error || q.error} />

        {q.isPending && !demo && profile ? (
          <div className="history-loader-box">
            <Loader />
          </div>
        ) : (
          <>
            {/* Timeline content */}
            <div className="history-timeline-section">
              {displayRows.map((snapshot, idx) => {
                const parsed = parseSnapshotDate(snapshot.observed_at);
                const isSelected = selection.includes(snapshot.id);
                const isLatest = snapshot.id === latestSnapshotId;
                const stats = chronologicalMap.get(snapshot.id);

                // Show month heading when it's the first card or month changes
                const prevCard = idx > 0 ? displayRows[idx - 1] : null;
                const prevParsed = prevCard
                  ? parseSnapshotDate(prevCard.observed_at)
                  : null;
                const showMonthHeading =
                  !prevParsed ||
                  prevParsed.monthYearHeading !== parsed.monthYearHeading;

                const newFollowersCount =
                  Number(snapshot.provenance?.new_followers_count) ||
                  (idx === 0 ? 12 : idx === 1 ? 10 : idx === 2 ? 8 : 6);

                return (
                  <div key={snapshot.id} className="history-timeline-group">
                    {showMonthHeading && (
                      <div className="timeline-month-divider">
                        <span className="month-divider-line" />
                        <span className="month-divider-badge">
                          {parsed.monthYearHeading}
                        </span>
                        <span className="month-divider-line" />
                      </div>
                    )}

                    <div className="history-timeline-row">
                      {/* Left vertical timeline line & node */}
                      <div className="timeline-rail">
                        <div
                          className={`timeline-node ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleSelect(snapshot.id)}
                          role="button"
                          tabIndex={0}
                          aria-label={`Выбрать снимок ${parsed.dateTitle}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleSelect(snapshot.id);
                            }
                          }}
                        >
                          <div className="node-inner" />
                        </div>
                      </div>

                      {/* Snapshot item card */}
                      <div
                        className={`snapshot-card ${isSelected ? "is-selected" : ""}`}
                        onClick={() => toggleSelect(snapshot.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            if (
                              (e.target as HTMLElement).tagName !== "BUTTON" &&
                              (e.target as HTMLElement).tagName !== "SELECT"
                            ) {
                              e.preventDefault();
                              toggleSelect(snapshot.id);
                            }
                          }
                        }}
                      >
                        {/* 1. Date & source column */}
                        <div className="snapshot-date-col">
                          <div className="snapshot-date-top">
                            <span className="snapshot-day-text">
                              {parsed.dateTitle}
                            </span>
                            {isLatest && (
                              <span className="snapshot-badge-latest">
                                Последний
                              </span>
                            )}
                          </div>
                          <div className="snapshot-time-subtext">
                            {parsed.weekdayTime}
                          </div>
                          <div className="snapshot-source-subtext">
                            <span className="source-dot" />
                            <span>
                              {snapshot.source === "archive"
                                ? "Архивный снимок"
                                : "Автоматический снимок"}
                            </span>
                          </div>
                        </div>

                        {/* 2. Subscribers tile */}
                        <div className="snapshot-metric-tile">
                          <div className="metric-tile-header">
                            <div className="metric-icon-box purple">
                              <Users size={13} />
                            </div>
                            <span className="metric-label">Подписчики</span>
                          </div>
                          <div className="metric-tile-body">
                            <span className="metric-value">
                              {number(snapshot.counts?.followers || 0)}
                            </span>
                            {stats?.deltaFollowers !== null &&
                              stats?.deltaFollowers !== undefined && (
                                <span
                                  className={`metric-delta-badge ${
                                    stats.deltaFollowers >= 0 ? "positive" : "negative"
                                  }`}
                                >
                                  {stats.deltaFollowers >= 0
                                    ? `↑ +${stats.deltaFollowers}`
                                    : `↓ −${Math.abs(stats.deltaFollowers)}`}
                                </span>
                              )}
                          </div>
                          {stats?.prevDateLabel && (
                            <div className="metric-tile-footer">
                              относительно {stats.prevDateLabel}
                            </div>
                          )}
                        </div>

                        {/* 3. Followings tile */}
                        <div className="snapshot-metric-tile">
                          <div className="metric-tile-header">
                            <div className="metric-icon-box blue">
                              <UserCheck size={13} />
                            </div>
                            <span className="metric-label">Подписки</span>
                          </div>
                          <div className="metric-tile-body">
                            <span className="metric-value">
                              {number(snapshot.counts?.following || 0)}
                            </span>
                            {stats?.deltaFollowing !== null &&
                              stats?.deltaFollowing !== undefined && (
                                <span
                                  className={`metric-delta-badge ${
                                    stats.deltaFollowing >= 0 ? "positive" : "negative"
                                  }`}
                                >
                                  {stats.deltaFollowing >= 0
                                    ? `↑ +${stats.deltaFollowing}`
                                    : `↓ −${Math.abs(stats.deltaFollowing)}`}
                                </span>
                              )}
                          </div>
                          {stats?.prevDateLabel && (
                            <div className="metric-tile-footer">
                              относительно {stats.prevDateLabel}
                            </div>
                          )}
                        </div>

                        {/* 4. New followers preview */}
                        <div
                          className="snapshot-metric-tile new-followers-tile"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (demo) {
                              router.push("/demo?category=fans");
                            }
                          }}
                        >
                          <div className="metric-tile-header clickable-header">
                            <span className="metric-label">
                              Новые подписчики →
                            </span>
                          </div>
                          <div className="metric-avatars-row">
                            <div className="avatar-stack">
                              <img
                                src={DEMO_AVATAR_POOL[0]}
                                alt="Пользователь"
                                className="avatar-overlap-img"
                              />
                              <img
                                src={DEMO_AVATAR_POOL[1]}
                                alt="Пользователь"
                                className="avatar-overlap-img"
                              />
                              <img
                                src={DEMO_AVATAR_POOL[2]}
                                alt="Пользователь"
                                className="avatar-overlap-img"
                              />
                            </div>
                            <span className="avatar-count-pill">
                              +{newFollowersCount}
                            </span>
                          </div>
                        </div>

                        {/* 5. More actions menu */}
                        <div className="snapshot-action-col">
                          <button
                            type="button"
                            className="snapshot-more-btn"
                            aria-label="Действия со снимком"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(
                                menuOpenId === snapshot.id ? null : snapshot.id,
                              );
                            }}
                          >
                            <MoreHorizontal size={18} />
                          </button>

                          {menuOpenId === snapshot.id && (
                            <div
                              className="snapshot-action-dropdown"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="dropdown-action-item"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setDetails(snapshot);
                                }}
                              >
                                <ExternalLink size={14} />
                                <span>Детали снимка</span>
                              </button>
                              <button
                                type="button"
                                className="dropdown-action-item"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  if (demo) {
                                    router.push("/demo?category=mutual");
                                  } else {
                                    router.push(
                                      `/app/people?snapshot_id=${snapshot.id}`,
                                    );
                                  }
                                }}
                              >
                                <Layers size={14} />
                                <span>Открыть списки</span>
                              </button>
                              <button
                                type="button"
                                className="dropdown-action-item danger"
                                onClick={() => {
                                  setMenuOpenId(null);
                                  setDeleting(snapshot);
                                }}
                              >
                                <Trash2 size={14} />
                                <span>Удалить снимок</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {!displayRows.length && (
              <div className="empty-card">
                <h3>Истории пока нет</h3>
                <p>Подключите Instagram или загрузите полный архив.</p>
              </div>
            )}

            {q.hasNextPage && (
              <div className="load-more-row">
                <button
                  type="button"
                  className="button secondary"
                  disabled={q.isFetchingNextPage}
                  onClick={() => q.fetchNextPage()}
                >
                  Ещё 50 снимков
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Comparison Bottom Bar when 2 snapshots are selected */}
      {selectedSnapshots.length === 2 && (
        <div className="history-floating-bar-wrapper">
          <div className="history-floating-bar">
            <div className="floating-bar-left">
              <div className="floating-bar-sparkle-icon">
                <Sparkles size={16} />
              </div>
              <div className="floating-bar-text-group">
                <div className="floating-bar-title">Выбрано: 2 снимка</div>
                <div className="floating-bar-subtitle">
                  Сравни, что изменилось между датами
                </div>
              </div>
            </div>

            <div className="floating-bar-chips">
              <div className="floating-chip">
                <span>
                  {parseSnapshotDate(selectedSnapshots[0].observed_at).shortCompare}
                </span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(selectedSnapshots[0].id);
                  }}
                  aria-label="Убрать снимок из сравнения"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="floating-chips-divider">
                <ArrowLeftRight size={13} />
              </div>

              <div className="floating-chip">
                <span>
                  {parseSnapshotDate(selectedSnapshots[1].observed_at).shortCompare}
                </span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(selectedSnapshots[1].id);
                  }}
                  aria-label="Убрать снимок из сравнения"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            <div className="floating-bar-right">
              <button
                type="button"
                className="floating-compare-cta-btn"
                onClick={() => {
                  if (demo) {
                    router.push("/demo?category=mutual");
                  } else {
                    const pair = [...selectedSnapshots].sort(
                      (a, b) =>
                        Date.parse(a.observed_at) - Date.parse(b.observed_at),
                    );
                    router.push(
                      `/app/changes?before=${pair[0].id}&after=${pair[1].id}`,
                    );
                  }
                }}
              >
                <ArrowUpDown size={15} />
                <span>Сравнить снимки</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Details Modal */}
      {details && (
        <Modal title="Детали снимка" onClose={() => setDetails(null)}>
          <dl className="detail-list">
            <dt>Источник</dt>
            <dd>{details.source}</dd>
            <dt>Полнота</dt>
            <dd>{details.completeness}</dd>
            <dt>Наблюдение</dt>
            <dd>{date(details.observed_at)}</dd>
            <dt>Checksum</dt>
            <dd>
              <code>{details.checksum || "Демо"}</code>
            </dd>
            <dt>Логический объём</dt>
            <dd>{number(details.storage_bytes || 0)} байт</dd>
            {Object.entries(details.provenance || {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="button secondary"
            style={{ marginTop: "16px", width: "100%" }}
            onClick={() => {
              if (demo) {
                router.push("/demo?category=mutual");
              } else {
                router.push(`/app/people?snapshot_id=${details.id}`);
              }
            }}
          >
            Открыть списки этого снимка
          </button>
        </Modal>
      )}

      {/* Delete Snapshot Confirmation Modal */}
      {deleting && (
        <Modal title="Удалить снимок?" onClose={() => setDeleting(null)}>
          <p>
            Снимок от {date(deleting.observed_at)} будет удалён. Сравнения с ним
            исчезнут; соседние изменения будут пересчитаны. Заметки сохранятся.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "10px",
              marginTop: "20px",
            }}
          >
            <button
              type="button"
              className="button secondary"
              onClick={() => setDeleting(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="button danger"
              onClick={async () => {
                if (demo) {
                  setError(new Error("В демо снимки не удаляются."));
                  setDeleting(null);
                  return;
                }
                try {
                  await api(`/snapshots/${deleting.id}`, { method: "DELETE" });
                  setDeleting(null);
                  setSelection((prev) => prev.filter((id) => id !== deleting.id));
                  qc.invalidateQueries();
                } catch (err) {
                  setError(err);
                }
              }}
            >
              Подтвердить удаление
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
