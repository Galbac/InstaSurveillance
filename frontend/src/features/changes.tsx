"use client";

import type { components } from "@/lib/generated-api";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Calendar,
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  UserPlus,
  UserMinus,
  UserCheck,
  Search,
  SlidersHorizontal,
  Star,
  ExternalLink,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  X,
  Layers,
  Check,
  Copy,
} from "lucide-react";
import { api, post, Profile, Event } from "@/lib/api";
import { Page, polling, useVisible, useUrlValue } from "@/lib/workflows";
import { demoEvents, demoHistory } from "@/lib/demo";
import { ErrorNotice, ExportButton, JobProgress, Loader } from "./common";
import { useSnapshots } from "./history";

type Comparison = components["schemas"]["ComparisonDTO"];

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

function formatSnapshotOption(isoString: string) {
  const d = new Date(isoString);
  const day = d.getUTCDate();
  const month = MONTHS_GENITIVE[d.getUTCMonth()] || "";
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

function formatRowDate(isoString?: string) {
  if (!isoString) {
    return { dateStr: "7 октября 2024", timeStr: "13:00" };
  }
  const d = new Date(isoString);
  const day = d.getUTCDate();
  const month = MONTHS_GENITIVE[d.getUTCMonth()] || "";
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    dateStr: `${day} ${month} ${year}`,
    timeStr: `${hours}:${minutes}`,
  };
}

function getEventDetails(event: Event) {
  const isFollower = event.relation === "followers";
  const isAdded = event.type === "added";

  const femaleUsers = new Set([
    "anna.wave",
    "dasha.sun",
    "alina.space",
    "polina.notes",
    "elena.studio",
    "olga.art",
  ]);
  const isFemale = femaleUsers.has(event.username);

  let title = "";
  let subtitle = "";

  if (isFollower) {
    if (isAdded) {
      title = "Новый подписчик";
      subtitle = "Появился в списке";
    } else {
      title = isFemale ? "Исчезла из подписчиков" : "Исчез из подписчиков";
      subtitle = isFemale
        ? "Больше не обнаружена в списке"
        : "Больше не обнаружен в списке";
    }
  } else {
    if (isAdded) {
      title = "Новая подписка";
      subtitle = isFemale
        ? "Появилась в твоих подписках"
        : "Появился в твоих подписках";
    } else {
      title = isFemale ? "Исчезла из подписок" : "Исчез из подписок";
      subtitle = "Больше нет в списке";
    }
  }

  return { title, subtitle };
}

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

  const [before, setBefore] = useUrlValue("before", "");
  const [after, setAfter] = useUrlValue("after", "");
  const [id, setId] = useUrlValue("comparison", "");
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useUrlValue("search", "");
  const [activeTab, setActiveTab] = useState<
    "all" | "followers" | "following" | "added" | "removed"
  >("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [copiedUser, setCopiedUser] = useState<string | null>(null);
  const [menuEventKey, setMenuEventKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuEventKey(null);
      }
    }
    if (menuEventKey) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuEventKey]);

  // Selected snapshot IDs (demo defaults: snapshot 5 = 6 Oct, snapshot 6 = 7 Oct)
  const defaultBefore = demo && snapshots.length >= 2 ? snapshots[snapshots.length - 2]?.id : "";
  const defaultAfter = demo && snapshots.length >= 1 ? snapshots[snapshots.length - 1]?.id : "";
  const selectedBefore = before || defaultBefore;
  const selectedAfter = after || defaultAfter;

  const q = useQuery({
    queryKey: ["comparison", id],
    queryFn: ({ signal }) => api<Comparison>(`/comparisons/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.job?.created_at, visible),
  });

  const filters = new URLSearchParams();
  if (search) filters.set("search", search);

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
      if (!selectedBefore || !selectedAfter) {
        throw new Error("Выберите оба снимка для сравнения.");
      }
      const result = await post<{ id: string }>(
        `/profiles/${profile!.id}/comparisons`,
        { before_snapshot_id: selectedBefore, after_snapshot_id: selectedAfter },
      );
      if (id === result.id) await q.refetch();
      setId(result.id);
    } catch (err) {
      setError(err);
    }
  }

  // Point 4: Automatically calculate comparison if before & after are selected but comparison is not loaded
  useEffect(() => {
    if (selectedBefore && selectedAfter && !id && !demo && profile && !error) {
      calculate();
    }
  }, [selectedBefore, selectedAfter, id, demo, profile]);

  const handleSwap = () => {
    const curBefore = selectedBefore;
    const curAfter = selectedAfter;
    setBefore(curAfter);
    setAfter(curBefore);
  };

  const rawRows: Event[] = demo
    ? demoEvents
    : events.data?.pages.flatMap((page) => page.items) || [];

  // Favorites local state
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const set = new Set<string>();
    demoEvents.forEach((e) => {
      if (e.favorite) set.add(e.id || e.username);
    });
    return set;
  });

  const toggleFavorite = (itemKey: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  const handleCopyUsername = (username: string) => {
    navigator.clipboard?.writeText(`@${username}`);
    setCopiedUser(username);
    setTimeout(() => setCopiedUser(null), 2000);
  };

  // Counts calculations
  const followersAdded = demo ? 2 : q.data?.counts?.followers_added || 0;
  const followersComparable = demo || !q.data || q.data.compared_relations.includes("followers");
  const followingComparable = demo || !q.data || q.data.compared_relations.includes("following");
  const followersRemoved = demo ? 3 : q.data?.counts?.followers_removed || 0;
  const followingAdded = demo ? 3 : q.data?.counts?.following_added || 0;
  const followingRemoved = demo ? 3 : q.data?.counts?.following_removed || 0;

  const totalEvents = followersAdded + followersRemoved + followingAdded + followingRemoved;
  const followersTotal = followersAdded + followersRemoved;
  const followingTotal = followingAdded + followingRemoved;
  const addedTotal = followersAdded + followingAdded;
  const removedTotal = followersRemoved + followingRemoved;

  // Filtered rows for display
  const displayRows = useMemo(() => {
    return rawRows.filter((row) => {
      // 1. Text search
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const matchUser = row.username.toLowerCase().includes(query);
        const matchName = row.full_name?.toLowerCase().includes(query);
        if (!matchUser && !matchName) return false;
      }

      // 2. Tab filter
      if (activeTab === "followers" && row.relation !== "followers") return false;
      if (activeTab === "following" && row.relation !== "following") return false;
      if (activeTab === "added" && row.type !== "added") return false;
      if (activeTab === "removed" && row.type !== "removed") return false;

      // 3. Dropdown event type filter
      if (eventTypeFilter === "followers_added") {
        if (!(row.relation === "followers" && row.type === "added")) return false;
      } else if (eventTypeFilter === "followers_removed") {
        if (!(row.relation === "followers" && row.type === "removed")) return false;
      } else if (eventTypeFilter === "following_added") {
        if (!(row.relation === "following" && row.type === "added")) return false;
      } else if (eventTypeFilter === "following_removed") {
        if (!(row.relation === "following" && row.type === "removed")) return false;
      }

      return true;
    });
  }, [rawRows, search, activeTab, eventTypeFilter]);

  const beforeSnapshot = snapshots.find((s) => s.id === selectedBefore);
  const afterSnapshot = snapshots.find((s) => s.id === selectedAfter);
  const beforeLabel = beforeSnapshot
    ? formatSnapshotOption(beforeSnapshot.observed_at)
    : "Выберите снимок";
  const afterLabel = afterSnapshot
    ? formatSnapshotOption(afterSnapshot.observed_at)
    : "Выберите снимок";

  return (
    <div className="changes-v2-container">
      {q.data && q.data.compared_relations.length < 2 && (
        <p className="notice" role="status">
          Сравнение выполнено только для полных списков. Неполные списки
          не используются для выводов о добавлениях и исчезновениях аккаунтов.
        </p>
      )}
      {/* 1. Comparison Picker Card */}
      <section className="changes-v2-picker-card">
        <header className="changes-v2-picker-header">
          <div className="changes-v2-picker-icon-box" aria-hidden="true">
            <Layers size={22} />
          </div>
          <div className="changes-v2-picker-title-group">
            <h2 className="changes-v2-picker-title">Сравнение снимков</h2>
            <p className="changes-v2-picker-subtitle">
              Выбери два снимка, чтобы увидеть все изменения между ними.
            </p>
          </div>
        </header>

        <div className="changes-v2-picker-body">
          {/* Earlier Snapshot Selector */}
          <div className="changes-v2-picker-field">
            <span className="changes-v2-picker-label">Более ранний снимок</span>
            <div className="changes-v2-picker-select-box">
              <div className="changes-v2-select-content">
                <Calendar size={18} className="text-violet-500" />
                <span className="changes-v2-select-text">{beforeLabel}</span>
              </div>
              <ChevronDown size={18} className="text-gray-400" />
              <select
                className="changes-v2-picker-select-native"
                aria-label="Более ранний снимок"
                value={selectedBefore}
                onChange={(e) => setBefore(e.target.value)}
              >
                <option value="">Выберите снимок</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSnapshotOption(s.observed_at)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Swap Button */}
          <button
            type="button"
            className="changes-v2-swap-btn"
            title="Поменять местами"
            aria-label="Поменять местами снимки"
            onClick={handleSwap}
          >
            <ArrowLeftRight size={18} />
          </button>

          {/* Later Snapshot Selector */}
          <div className="changes-v2-picker-field">
            <span className="changes-v2-picker-label">Более поздний снимок</span>
            <div className="changes-v2-picker-select-box">
              <div className="changes-v2-select-content">
                <Calendar size={18} className="text-violet-500" />
                <span className="changes-v2-select-text">{afterLabel}</span>
              </div>
              <ChevronDown size={18} className="text-gray-400" />
              <select
                className="changes-v2-picker-select-native"
                aria-label="Более поздний снимок"
                value={selectedAfter}
                onChange={(e) => setAfter(e.target.value)}
              >
                <option value="">Выберите снимок</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSnapshotOption(s.observed_at)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Button */}
          <button
            type="button"
            className="changes-v2-compare-cta"
            disabled={!demo && (!profile || !selectedBefore || !selectedAfter)}
            onClick={calculate}
          >
            Сравнить снимки
            <ArrowRight size={16} />
          </button>
        </div>

        <ErrorNotice error={error || q.error || events.error} />
        {q.data?.job && <JobProgress job={q.data.job} />}
      </section>

      {/* 2. Four Metric Cards */}
      <section className="changes-v2-stat-grid">
        {/* Card 1: New followers */}
        <div className="changes-v2-stat-card">
          <div className="changes-v2-stat-card-top">
            <div className="changes-v2-stat-icon green">
              <UserPlus size={20} />
            </div>
            <span className="changes-v2-stat-badge green">
              {followersComparable ? `+${followersAdded} ↑` : "Не проверено"}
            </span>
          </div>
          <div>
            <h3 className="changes-v2-stat-label">Новые подписчики</h3>
            <div className="changes-v2-stat-value">{followersComparable ? followersAdded : "—"}</div>
            <p className="changes-v2-stat-subtext">
              {followersComparable
                ? "Появились в списке"
                : "Список в снимке неполный (защита от ложных отписок)"}
            </p>
          </div>
        </div>

        {/* Card 2: Lost followers */}
        <div className="changes-v2-stat-card">
          <div className="changes-v2-stat-card-top">
            <div className="changes-v2-stat-icon red">
              <UserMinus size={20} />
            </div>
            <span className="changes-v2-stat-badge red">
              {followersComparable ? `-${followersRemoved} ↓` : "Не проверено"}
            </span>
          </div>
          <div>
            <h3 className="changes-v2-stat-label">Исчезли из подписчиков</h3>
            <div className="changes-v2-stat-value">{followersComparable ? followersRemoved : "—"}</div>
            <p className="changes-v2-stat-subtext">
              {followersComparable
                ? "Больше не обнаружены"
                : "Список в снимке неполный (защита от ложных отписок)"}
            </p>
          </div>
        </div>

        {/* Card 3: New following */}
        <div className="changes-v2-stat-card">
          <div className="changes-v2-stat-card-top">
            <div className="changes-v2-stat-icon green">
              <UserCheck size={20} />
            </div>
            <span className="changes-v2-stat-badge green">
              {followingComparable ? `+${followingAdded} ↑` : "Не проверено"}
            </span>
          </div>
          <div>
            <h3 className="changes-v2-stat-label">Новые подписки</h3>
            <div className="changes-v2-stat-value">{followingComparable ? followingAdded : "—"}</div>
            <p className="changes-v2-stat-subtext">Новые в твоих подписках</p>
          </div>
        </div>

        {/* Card 4: Lost following */}
        <div className="changes-v2-stat-card">
          <div className="changes-v2-stat-card-top">
            <div className="changes-v2-stat-icon red">
              <UserMinus size={20} />
            </div>
            <span className="changes-v2-stat-badge red">
              {followingComparable ? `-${followingRemoved} ↓` : "Не проверено"}
            </span>
          </div>
          <div>
            <h3 className="changes-v2-stat-label">Исчезли из подписок</h3>
            <div className="changes-v2-stat-value">{followingComparable ? followingRemoved : "—"}</div>
            <p className="changes-v2-stat-subtext">Больше нет в списке</p>
          </div>
        </div>
      </section>

      {/* 3. Main Changes Card */}
      <section className="changes-v2-main-card">
        <header className="changes-v2-main-header">
          <div className="changes-v2-title-row">
            <div>
              <h2 className="changes-v2-main-title">Все изменения</h2>
              <p className="changes-v2-main-subtitle">
                Найдено {displayRows.length} событий между выбранными снимками.
              </p>
            </div>
            {!demo && id && (
              <ExportButton
                label="Экспорт событий"
                request={{
                  scope: "comparison",
                  format: "csv",
                  comparison_id: id,
                  search,
                }}
              />
            )}
          </div>

          {/* Search & Event Type Toolbar */}
          <div className="changes-v2-toolbar">
            <div className="changes-v2-search-box">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                className="changes-v2-search-input"
                aria-label="Поиск по username"
                placeholder="Поиск по username..."
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="changes-v2-clear-btn"
                  title="Очистить поиск"
                  onClick={() => setSearch("")}
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="changes-v2-filter-dropdown">
              <SlidersHorizontal size={15} className="text-gray-500" />
              <span>
                {eventTypeFilter === "all" && "Все события"}
                {eventTypeFilter === "followers_added" && "Новые подписчики"}
                {eventTypeFilter === "followers_removed" && "Исчезли из подписчиков"}
                {eventTypeFilter === "following_added" && "Новые подписки"}
                {eventTypeFilter === "following_removed" && "Исчезли из подписок"}
              </span>
              <ChevronDown size={15} className="text-gray-400" />
              <select
                className="changes-v2-filter-select-native"
                aria-label="Фильтр по типу события"
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
              >
                <option value="all">Все события</option>
                <option value="followers_added">Новые подписчики</option>
                <option value="followers_removed">Исчезли из подписчиков</option>
                <option value="following_added">Новые подписки</option>
                <option value="following_removed">Исчезли из подписок</option>
              </select>
            </div>
          </div>

          {/* Filter Pills Bar */}
          <div className="changes-v2-pills-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "all"}
              className={`changes-v2-pill ${activeTab === "all" ? "active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              Все • {totalEvents}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "followers"}
              className={`changes-v2-pill ${activeTab === "followers" ? "active" : ""}`}
              onClick={() => setActiveTab("followers")}
            >
              Подписчики • {followersTotal}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "following"}
              className={`changes-v2-pill ${activeTab === "following" ? "active" : ""}`}
              onClick={() => setActiveTab("following")}
            >
              Подписки • {followingTotal}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "added"}
              className={`changes-v2-pill ${activeTab === "added" ? "active" : ""}`}
              onClick={() => setActiveTab("added")}
            >
              <span className="changes-v2-pill-dot green" />
              Появились • {addedTotal}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "removed"}
              className={`changes-v2-pill ${activeTab === "removed" ? "active" : ""}`}
              onClick={() => setActiveTab("removed")}
            >
              <span className="changes-v2-pill-dot red" />
              Исчезли • {removedTotal}
            </button>
          </div>
        </header>

        {/* Events Table (Desktop) */}
        {events.isPending && !demo ? (
          <div style={{ padding: 48, display: "flex", justifyContent: "center" }}>
            <Loader />
          </div>
        ) : displayRows.length > 0 ? (
          <>
            <div className="changes-v2-table-container">
              <table className="changes-v2-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Тип изменения</th>
                    <th>Категория</th>
                    <th>Дата</th>
                    <th style={{ textAlign: "right" }}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((event, idx) => {
                    const itemKey = event.id || `${event.username}-${idx}`;
                    const isFav = favorites.has(itemKey);
                    const { title: changeTitle, subtitle: changeSub } =
                      getEventDetails(event);
                    const { dateStr, timeStr } = formatRowDate(event.created_at);
                    const isFollower = event.relation === "followers";

                    return (
                      <tr key={itemKey} className="changes-v2-row">
                        {/* User Cell */}
                        <td>
                          <div className="changes-v2-user-cell">
                            {event.avatar_url ? (
                              <img
                                src={event.avatar_url}
                                alt={event.username}
                                className="changes-v2-avatar"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const fallback = e.currentTarget
                                    .nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <div
                              className="changes-v2-avatar-fallback"
                              style={{
                                display: event.avatar_url ? "none" : "flex",
                              }}
                            >
                              {(event.full_name || event.username)[0].toUpperCase()}
                            </div>
                            <div className="changes-v2-user-info">
                              <span className="changes-v2-user-name">
                                {event.full_name || event.username}
                              </span>
                              <span className="changes-v2-username">
                                @{event.username}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Change Type Cell */}
                        <td>
                          <div className="changes-v2-change-cell">
                            <div
                              className={`changes-v2-change-icon ${
                                event.type === "added" ? "added" : "removed"
                              }`}
                            >
                              {event.type === "added" ? (
                                <ArrowUp size={15} />
                              ) : (
                                <ArrowDown size={15} />
                              )}
                            </div>
                            <div className="changes-v2-change-info">
                              <span className="changes-v2-change-title">
                                {changeTitle}
                              </span>
                              <span className="changes-v2-change-sub">
                                {changeSub}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Category Cell */}
                        <td>
                          <span
                            className={`changes-v2-badge ${
                              isFollower ? "followers" : "following"
                            }`}
                          >
                            {isFollower ? "Подписчики" : "Подписки"}
                          </span>
                        </td>

                        {/* Date Cell */}
                        <td>
                          <div className="changes-v2-date-cell">
                            <span className="changes-v2-date-primary">
                              {dateStr}
                            </span>
                            <span className="changes-v2-date-secondary">
                              {timeStr}
                            </span>
                          </div>
                        </td>

                        {/* Actions Cell */}
                        <td>
                          <div
                            className="changes-v2-actions-cell"
                            style={{ justifyContent: "flex-end" }}
                          >
                            <button
                              type="button"
                              className={`changes-v2-action-btn ${
                                isFav ? "favorited" : ""
                              }`}
                              title={
                                isFav
                                  ? "Удалить из избранного"
                                  : "Добавить в избранное"
                              }
                              onClick={() => toggleFavorite(itemKey)}
                            >
                              <Star
                                size={15}
                                fill={isFav ? "#f59e0b" : "none"}
                              />
                            </button>
                            <a
                              href={`https://instagram.com/${event.username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="changes-v2-action-btn"
                              title="Открыть в Instagram"
                            >
                              <ExternalLink size={15} />
                            </a>
                            <div
                              className="person-more-box"
                              ref={menuEventKey === itemKey ? menuRef : undefined}
                            >
                              <button
                                type="button"
                                className="changes-v2-action-btn"
                                title="Дополнительные действия"
                                onClick={() => setMenuEventKey(menuEventKey === itemKey ? null : itemKey)}
                              >
                                <MoreHorizontal size={15} />
                              </button>
                              {menuEventKey === itemKey && (
                                <div className="person-action-menu" style={{ right: 0 }}>
                                  {event.relation === "followers" && event.type === "added" && (
                                    <a
                                      href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="person-action-item primary"
                                      onClick={() => setMenuEventKey(null)}
                                    >
                                      <UserPlus size={16} />
                                      <span>Подписаться в ответ</span>
                                    </a>
                                  )}
                                  {event.relation === "followers" && event.type === "removed" && (
                                    <a
                                      href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="person-action-item"
                                      onClick={() => setMenuEventKey(null)}
                                    >
                                      <ExternalLink size={16} />
                                      <span>Проверить в Instagram</span>
                                    </a>
                                  )}
                                  {event.relation === "following" && event.type === "removed" && (
                                    <a
                                      href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="person-action-item primary"
                                      onClick={() => setMenuEventKey(null)}
                                    >
                                      <UserPlus size={16} />
                                      <span>Подписаться снова</span>
                                    </a>
                                  )}
                                  {event.relation === "following" && event.type === "added" && (
                                    <a
                                      href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="person-action-item danger"
                                      onClick={() => setMenuEventKey(null)}
                                    >
                                      <UserMinus size={16} />
                                      <span>Отписаться в Instagram</span>
                                    </a>
                                  )}
                                  <a
                                    href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="person-action-item"
                                    onClick={() => setMenuEventKey(null)}
                                  >
                                    <ExternalLink size={16} />
                                    <span>Открыть профиль</span>
                                  </a>
                                  <a
                                    href={`/app/people?search=${encodeURIComponent(event.username)}`}
                                    className="person-action-item"
                                    onClick={() => setMenuEventKey(null)}
                                  >
                                    <Search size={16} />
                                    <span>Найти в списках людей</span>
                                  </a>
                                  <div className="person-action-divider" />
                                  <button
                                    type="button"
                                    className="person-action-item"
                                    onClick={() => {
                                      handleCopyUsername(event.username);
                                      setMenuEventKey(null);
                                    }}
                                  >
                                    {copiedUser === event.username ? (
                                      <>
                                        <Check size={16} color="#16a34a" />
                                        <span style={{ color: "#16a34a" }}>Скопировано!</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy size={16} />
                                        <span>Скопировать @username</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="person-action-item"
                                    onClick={() => {
                                      toggleFavorite(itemKey);
                                      setMenuEventKey(null);
                                    }}
                                  >
                                    <Star
                                      size={16}
                                      fill={isFav ? "#f59e0b" : "none"}
                                      color={isFav ? "#f59e0b" : "#94a3b8"}
                                    />
                                    <span>{isFav ? "Убрать из избранного" : "В избранное"}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List (< 860px) */}
            <div className="changes-v2-mobile-list">
              {displayRows.map((event, idx) => {
                const itemKey = event.id || `${event.username}-${idx}`;
                const isFav = favorites.has(itemKey);
                const { title: changeTitle, subtitle: changeSub } =
                  getEventDetails(event);
                const { dateStr, timeStr } = formatRowDate(event.created_at);
                const isFollower = event.relation === "followers";

                return (
                  <div key={itemKey} className="changes-v2-mobile-card">
                    <div className="changes-v2-mobile-card-top">
                      <div className="changes-v2-user-cell">
                        {event.avatar_url ? (
                          <img
                            src={event.avatar_url}
                            alt={event.username}
                            className="changes-v2-avatar"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                              const fallback = e.currentTarget
                                .nextElementSibling as HTMLElement;
                              if (fallback) fallback.style.display = "flex";
                            }}
                          />
                        ) : null}
                        <div
                          className="changes-v2-avatar-fallback"
                          style={{
                            display: event.avatar_url ? "none" : "flex",
                          }}
                        >
                          {(event.full_name || event.username)[0].toUpperCase()}
                        </div>
                        <div className="changes-v2-user-info">
                          <span className="changes-v2-user-name">
                            {event.full_name || event.username}
                          </span>
                          <span className="changes-v2-username">
                            @{event.username}
                          </span>
                        </div>
                      </div>

                      <div className="changes-v2-actions-cell">
                        <button
                          type="button"
                          className={`changes-v2-action-btn ${
                            isFav ? "favorited" : ""
                          }`}
                          title="Избранное"
                          onClick={() => toggleFavorite(itemKey)}
                        >
                          <Star size={15} fill={isFav ? "#f59e0b" : "none"} />
                        </button>
                        <a
                          href={`https://instagram.com/${event.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="changes-v2-action-btn"
                          title="Открыть в Instagram"
                        >
                          <ExternalLink size={15} />
                        </a>
                        <div
                          className="person-more-box"
                          ref={menuEventKey === `m-${itemKey}` ? menuRef : undefined}
                        >
                          <button
                            type="button"
                            className="changes-v2-action-btn"
                            title="Дополнительные действия"
                            onClick={() =>
                              setMenuEventKey(
                                menuEventKey === `m-${itemKey}` ? null : `m-${itemKey}`
                              )
                            }
                          >
                            <MoreHorizontal size={15} />
                          </button>
                          {menuEventKey === `m-${itemKey}` && (
                            <div className="person-action-menu" style={{ right: 0 }}>
                              {event.relation === "followers" && event.type === "added" && (
                                <a
                                  href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="person-action-item primary"
                                  onClick={() => setMenuEventKey(null)}
                                >
                                  <UserPlus size={16} />
                                  <span>Подписаться в ответ</span>
                                </a>
                              )}
                              {event.relation === "followers" && event.type === "removed" && (
                                <a
                                  href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="person-action-item"
                                  onClick={() => setMenuEventKey(null)}
                                >
                                  <ExternalLink size={16} />
                                  <span>Проверить в Instagram</span>
                                </a>
                              )}
                              {event.relation === "following" && event.type === "removed" && (
                                <a
                                  href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="person-action-item primary"
                                  onClick={() => setMenuEventKey(null)}
                                >
                                  <UserPlus size={16} />
                                  <span>Подписаться снова</span>
                                </a>
                              )}
                              {event.relation === "following" && event.type === "added" && (
                                <a
                                  href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="person-action-item danger"
                                  onClick={() => setMenuEventKey(null)}
                                >
                                  <UserMinus size={16} />
                                  <span>Отписаться в Instagram</span>
                                </a>
                              )}
                              <a
                                href={`https://www.instagram.com/${encodeURIComponent(event.username)}/`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="person-action-item"
                                onClick={() => setMenuEventKey(null)}
                              >
                                <ExternalLink size={16} />
                                <span>Открыть профиль</span>
                              </a>
                              <a
                                href={`/app/people?search=${encodeURIComponent(event.username)}`}
                                className="person-action-item"
                                onClick={() => setMenuEventKey(null)}
                              >
                                <Search size={16} />
                                <span>Найти в списках людей</span>
                              </a>
                              <div className="person-action-divider" />
                              <button
                                type="button"
                                className="person-action-item"
                                onClick={() => {
                                  handleCopyUsername(event.username);
                                  setMenuEventKey(null);
                                }}
                              >
                                {copiedUser === event.username ? (
                                  <>
                                    <Check size={16} color="#16a34a" />
                                    <span style={{ color: "#16a34a" }}>Скопировано!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={16} />
                                    <span>Скопировать @username</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                className="person-action-item"
                                onClick={() => {
                                  toggleFavorite(itemKey);
                                  setMenuEventKey(null);
                                }}
                              >
                                <Star
                                  size={16}
                                  fill={isFav ? "#f59e0b" : "none"}
                                  color={isFav ? "#f59e0b" : "#94a3b8"}
                                />
                                <span>{isFav ? "Убрать из избранного" : "В избранное"}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="changes-v2-mobile-card-mid">
                      <div className="changes-v2-change-cell">
                        <div
                          className={`changes-v2-change-icon ${
                            event.type === "added" ? "added" : "removed"
                          }`}
                        >
                          {event.type === "added" ? (
                            <ArrowUp size={14} />
                          ) : (
                            <ArrowDown size={14} />
                          )}
                        </div>
                        <div className="changes-v2-change-info">
                          <span className="changes-v2-change-title">
                            {changeTitle}
                          </span>
                          <span className="changes-v2-change-sub">
                            {changeSub}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`changes-v2-badge ${
                          isFollower ? "followers" : "following"
                        }`}
                      >
                        {isFollower ? "Подписчики" : "Подписки"}
                      </span>
                    </div>

                    <div className="changes-v2-mobile-card-bottom">
                      <span>{dateStr}</span>
                      <span>{timeStr}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="changes-v2-empty-state">
            <div className="changes-v2-empty-icon">
              <Search size={22} />
            </div>
            <h3 className="changes-v2-empty-title">Ничего не найдено</h3>
            <p className="changes-v2-empty-text">
              По выбранным фильтрам или поисковому запросу нет изменений.
              Попробуйте сбросить фильтры.
            </p>
            {(search || activeTab !== "all" || eventTypeFilter !== "all") && (
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setSearch("");
                  setActiveTab("all");
                  setEventTypeFilter("all");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        )}

        {events.hasNextPage && (
          <div className="changes-v2-load-more-row">
            <button
              className="button secondary"
              onClick={() => events.fetchNextPage()}
            >
              Загрузить ещё 50 событий
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
