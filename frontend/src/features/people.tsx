"use client";
import type { components } from "@/lib/generated-api";
import { useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Search,
  Star,
  ArrowUpRight,
  FileText,
  MoreHorizontal,
  ChevronDown,
  SlidersHorizontal,
  UserPlus,
  UserMinus,
  UserX,
  ExternalLink,
  Copy,
  Check,
  X,
} from "lucide-react";
import { api, post, Profile, Person, date, number } from "@/lib/api";
import { demoPeople } from "@/lib/demo";
import { ErrorNotice, ExportButton, Modal } from "./common";

function PeopleSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="people-skeleton-list" aria-busy="true" aria-label="Загрузка списка">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="person-row-skeleton">
          <div className="skeleton-shimmer" style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0 }} />
          <div className="skeleton-shimmer" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="skeleton-shimmer" style={{ width: `${30 + (i % 3) * 12}%`, height: 14 }} />
            <div className="skeleton-shimmer" style={{ width: `${20 + (i % 2) * 10}%`, height: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <div className="skeleton-shimmer" style={{ width: 32, height: 32, borderRadius: 8 }} />
            <div className="skeleton-shimmer" style={{ width: 32, height: 32, borderRadius: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const categories = [
  ["followers", "Подписчики"],
  ["following", "Мои подписки"],
  ["mutual", "Взаимные"],
  ["not_following_back", "Я без ответа"],
  ["fans", "На меня без ответа"],
];
type PeoplePage = components["schemas"]["PeoplePage"];
export default function PeoplePanel({
  profile,
  demo = false,
}: {
  profile?: Profile;
  demo?: boolean;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams(),
    qc = useQueryClient();

  const [category, setCategory] = useState<string>(() => {
    const fromUrl = params.get("category");
    return categories.some(([key]) => key === fromUrl) ? fromUrl! : "followers";
  });

  useEffect(() => {
    const fromUrl = params.get("category");
    if (fromUrl && categories.some(([key]) => key === fromUrl) && fromUrl !== category) {
      setCategory(fromUrl);
    }
  }, [params, category]);

  const favorite = params.get("favorite") === "true",
    hasNote = params.get("has_note") === "true",
    sort = params.get("sort") || "username",
    snapshot = params.get("snapshot_id") || "";
  const [input, setInput] = useState(params.get("search") || ""),
    [note, setNote] = useState<Person | null>(null),
    [error, setError] = useState<unknown>(null),
    [selected, setSelected] = useState<string[]>([]),
    [filterSheet, setFilterSheet] = useState(false),
    [menuPerson, setMenuPerson] = useState<Person | null>(null),
    [copiedUser, setCopiedUser] = useState<string | null>(null);

  const [menuRef] = [useRef<HTMLDivElement>(null)];
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">("bottom");
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = activeTabRef.current;
    if (el) {
      const timer = setTimeout(() => {
        el.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [category]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPerson(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuPerson(null);
      }
    }
    if (menuPerson) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [menuPerson]);

  function handleCopyUsername(username: string) {
    try {
      navigator.clipboard.writeText(`@${username}`);
      setCopiedUser(username);
      setTimeout(() => setCopiedUser(null), 2000);
      setMenuPerson(null);
    } catch {}
  }

  function handleCategoryChange(key: string) {
    if (key === category) return;
    setCategory(key);
    setMenuPerson(null);
    const next = new URLSearchParams(params.toString());
    next.set("category", key);
    window.history.replaceState(null, "", pathname + "?" + next.toString());
    setSelected([]);
  }

  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    window.history.replaceState(null, "", pathname + "?" + next.toString());
    setSelected([]);
  }
  useEffect(() => {
    setInput(params.get("search") || "");
  }, [params]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (input !== (params.get("search") || "")) update({ search: input });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, params]);
  const queryParams = new URLSearchParams({
    category: category as components["schemas"]["ExportInput"]["category"],
    search: params.get("search") || "",
    favorite: String(favorite),
    has_note: String(hasNote),
    sort: sort as components["schemas"]["ExportInput"]["sort"],
    limit: "50",
  });
  if (snapshot) queryParams.set("snapshot_id", snapshot);
  const q = useInfiniteQuery({
    queryKey: ["people", profile?.id, queryParams.toString()],
    queryFn: ({ pageParam, signal }) =>
      api<PeoplePage>(
        `/profiles/${profile!.id}/people?${queryParams}${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    placeholderData: keepPreviousData,
    enabled: !demo && !!profile,
  });
  const rows: Person[] = demo
    ? demoPeople
        .filter(
          (x, i) =>
            (category === "followers"
              ? i < 6
              : category === "following"
                ? i >= 3
                : category === "mutual"
                  ? i >= 3 && i < 6
                  : category === "fans"
                    ? i < 3
                    : i >= 6) &&
            (!input ||
              x.username.toLowerCase().includes(input.toLowerCase())) &&
            (!favorite || x.favorite) &&
            (!hasNote || !!x.note),
        )
        .sort((a, b) =>
          sort === "username_desc"
            ? b.username.localeCompare(a.username)
            : a.username.localeCompare(b.username),
        )
    : (q.data?.pages.flatMap((page) => page.items) as Person[] || []);
  const total = demo ? rows.length : q.data?.pages[0]?.total || 0,
    context = q.data?.pages[0];

  const [showPartialNotice, setShowPartialNotice] = useState<boolean>(false);
  useEffect(() => {
    if (context?.completeness === "partial") {
      setShowPartialNotice(true);
    } else if (context?.completeness && context.completeness !== "partial") {
      setShowPartialNotice(false);
    }
  }, [context?.completeness]);

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && q.hasNextPage && !q.isFetchingNextPage) {
          q.fetchNextPage();
        }
      },
      { rootMargin: "350px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);

  async function star(person: Person) {
    if (demo) {
      setError(new Error("Пометки доступны в личном кабинете."));
      return;
    }
    try {
      await api(
        `/profiles/${profile!.id}/annotations/${encodeURIComponent(person.identity_key)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            favorite: !person.favorite,
            note: person.note,
          }),
        },
      );
      qc.invalidateQueries({ queryKey: ["people"] });
    } catch (e) {
      setError(e);
    }
  }

  const toggleMenu = (person: Person, e: React.MouseEvent<HTMLButtonElement>) => {
    if (menuPerson?.identity_key === person.identity_key) {
      setMenuPerson(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const openUp = window.innerHeight - rect.bottom < 280;
    setMenuPlacement(openUp ? "top" : "bottom");
    setMenuPerson(person);
  };

  function renderPersonActionItems(person: Person, isMobileSheet = false) {
    const itemClass = isMobileSheet ? "mobile-sheet-action-item" : "person-action-item";
    const dividerClass = isMobileSheet ? "mobile-sheet-divider" : "person-action-divider";

    return (
      <>
        {category === "fans" && (
          <>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} primary`}
              onClick={() => setMenuPerson(null)}
            >
              <UserPlus size={isMobileSheet ? 18 : 16} />
              <span>Подписаться в ответ</span>
            </a>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} danger`}
              onClick={() => setMenuPerson(null)}
            >
              <UserX size={isMobileSheet ? 18 : 16} />
              <span>Удалить из подписчиков</span>
            </a>
          </>
        )}
        {category === "not_following_back" && (
          <>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} danger`}
              onClick={() => setMenuPerson(null)}
            >
              <UserMinus size={isMobileSheet ? 18 : 16} />
              <span>Отписаться в Instagram</span>
            </a>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
              onClick={() => setMenuPerson(null)}
            >
              <ExternalLink size={isMobileSheet ? 18 : 16} />
              <span>Открыть профиль</span>
            </a>
          </>
        )}
        {category === "mutual" && (
          <>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
              onClick={() => setMenuPerson(null)}
            >
              <ExternalLink size={isMobileSheet ? 18 : 16} />
              <span>Открыть в Instagram</span>
            </a>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} danger`}
              onClick={() => setMenuPerson(null)}
            >
              <UserMinus size={isMobileSheet ? 18 : 16} />
              <span>Отписаться в Instagram</span>
            </a>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} danger`}
              onClick={() => setMenuPerson(null)}
            >
              <UserX size={isMobileSheet ? 18 : 16} />
              <span>Удалить из подписчиков</span>
            </a>
          </>
        )}
        {category === "followers" && (
          <>
            {person.is_following ? (
              <>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${itemClass} danger`}
                  onClick={() => setMenuPerson(null)}
                >
                  <UserMinus size={isMobileSheet ? 18 : 16} />
                  <span>Отписаться в Instagram</span>
                </a>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${itemClass} danger`}
                  onClick={() => setMenuPerson(null)}
                >
                  <UserX size={isMobileSheet ? 18 : 16} />
                  <span>Удалить из подписчиков</span>
                </a>
              </>
            ) : (
              <>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${itemClass} primary`}
                  onClick={() => setMenuPerson(null)}
                >
                  <UserPlus size={isMobileSheet ? 18 : 16} />
                  <span>Подписаться в ответ</span>
                </a>
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${itemClass} danger`}
                  onClick={() => setMenuPerson(null)}
                >
                  <UserX size={isMobileSheet ? 18 : 16} />
                  <span>Удалить из подписчиков</span>
                </a>
              </>
            )}
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
              onClick={() => setMenuPerson(null)}
            >
              <ExternalLink size={isMobileSheet ? 18 : 16} />
              <span>Открыть профиль</span>
            </a>
          </>
        )}
        {category === "following" && (
          <>
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={`${itemClass} danger`}
              onClick={() => setMenuPerson(null)}
            >
              <UserMinus size={isMobileSheet ? 18 : 16} />
              <span>Отписаться в Instagram</span>
            </a>
            {person.is_mutual && (
              <a
                href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${itemClass} danger`}
                onClick={() => setMenuPerson(null)}
              >
                <UserX size={isMobileSheet ? 18 : 16} />
                <span>Удалить из подписчиков</span>
              </a>
            )}
            <a
              href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={itemClass}
              onClick={() => setMenuPerson(null)}
            >
              <ExternalLink size={isMobileSheet ? 18 : 16} />
              <span>Открыть профиль</span>
            </a>
          </>
        )}
        <div className={dividerClass} />
        <button
          type="button"
          className={itemClass}
          onClick={() => handleCopyUsername(person.username)}
        >
          {copiedUser === person.username ? (
            <>
              <Check size={isMobileSheet ? 18 : 16} color="#16a34a" />
              <span style={{ color: "#16a34a" }}>Скопировано!</span>
            </>
          ) : (
            <>
              <Copy size={isMobileSheet ? 18 : 16} />
              <span>Скопировать @username</span>
            </>
          )}
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            setNote(person);
            setMenuPerson(null);
          }}
        >
          <FileText size={isMobileSheet ? 18 : 16} />
          <span>{person.note ? "Изменить заметку" : "Добавить заметку"}</span>
        </button>
        <button
          type="button"
          className={itemClass}
          onClick={() => {
            star(person);
            setMenuPerson(null);
          }}
        >
          <Star
            size={isMobileSheet ? 18 : 16}
            fill={person.favorite ? "#f59e0b" : "none"}
            color={person.favorite ? "#f59e0b" : "#94a3b8"}
          />
          <span>{person.favorite ? "Убрать из избранного" : "В избранное"}</span>
        </button>
      </>
    );
  }
  if (!profile && !demo)
    return (
      <section className="empty-card">
        <h2>Сначала добавь свой профиль</h2>
        <button
          className="button"
          onClick={() => router.push("/app/instagram/connect")}
        >
          Подключить
        </button>
      </section>
    );
  const filters = (
    <div className="people-toolbar-row">
      <div className="people-toolbar-left">
        <label className="people-search-box">
          <Search size={16} className="search-icon" />
          <input
            aria-label="Поиск username"
            placeholder="Найти username..."
            maxLength={100}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <label className="filter-chip-checkbox">
          <input
            type="checkbox"
            checked={favorite}
            onChange={(e) => update({ favorite: e.target.checked ? "true" : "" })}
          />
          <span className="custom-check-box" />
          <span className="chip-star">⭐</span>
          <span className="chip-text">Избранное</span>
        </label>
        <label className="filter-chip-checkbox">
          <input
            type="checkbox"
            checked={hasNote}
            onChange={(e) => update({ has_note: e.target.checked ? "true" : "" })}
          />
          <span className="custom-check-box" />
          <FileText size={15} className="chip-doc-icon" />
          <span className="chip-text">С заметкой</span>
        </label>
      </div>
      <div className="people-toolbar-right">
        <span className="sort-caption">Сортировка</span>
        <div
          className="sort-dropdown-pill"
          onClick={(e) => {
            const s = e.currentTarget.querySelector("select") as (HTMLSelectElement & { showPicker?: () => void }) | null;
            try {
              s?.showPicker?.();
            } catch {}
          }}
        >
          <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="username">Имя пользователя (А–Я)</option>
            <option value="username_desc">Имя пользователя (Я–А)</option>
            <option value="first_observed">Сначала новые (по дате)</option>
          </select>
          <ChevronDown size={14} className="sort-chevron-icon" />
        </div>
        {!demo && profile && (
          <ExportButton
            label="CSV"
            request={{
              scope: "list",
              format: "csv",
              profile_id: profile.id,
              snapshot_id: snapshot || undefined,
              category:
                category as components["schemas"]["ExportInput"]["category"],
              search: params.get("search") || "",
              favorite,
              has_note: hasNote,
              sort: sort as components["schemas"]["ExportInput"]["sort"],
            }}
          />
        )}
      </div>
    </div>
  );
  return (
    <section className="people-panel-card">
      <div
        className="category-tabs-container"
        role="tablist"
        aria-label="Категории отношений"
      >
        {categories.map(([key, label]) => (
          <button
            ref={category === key ? activeTabRef : undefined}
            role="tab"
            aria-selected={category === key}
            className={`category-tab-btn ${category === key ? "active" : ""}`}
            key={key}
            onClick={() => handleCategoryChange(key)}
          >
            {label}
            {category === key && <span className="category-tab-indicator" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mobile-filters-trigger"
        onClick={() => setFilterSheet(true)}
      >
        <SlidersHorizontal size={15} />
        <span>Фильтры и сортировка</span>
      </button>
      <div className="desktop-filters">{filters}</div>
      {filterSheet && (
        <Modal
          title="Фильтры и сортировка"
          onClose={() => setFilterSheet(false)}
        >
          <div className="filter-sheet">
            {filters}
            <button className="button" onClick={() => setFilterSheet(false)}>
              Показать результаты
            </button>
          </div>
        </Modal>
      )}
      <div className="people-results-count">
        Найдено {number(total)}
        {context && !demo
          ? ` из ${number(context.category_total)} в категории · снимок ${date(context.observed_at || null)} · ${context.completeness === "partial" ? "неполный список" : context.source === "archive" ? "полнота подтверждена пользователем" : "сбор проверен"}`
          : ""}
      </div>
      {showPartialNotice && (
        <p className="notice" role="status">
          Показаны доступные аккаунты из неполного списка. Отсутствие аккаунта
          не подтверждает отписку или отсутствие взаимной подписки.
        </p>
      )}
      {context?.identity_mode === "username" && (
        <p className="muted">
          Сопоставление по username: переименование может выглядеть как
          исчезновение и появление.
        </p>
      )}
      <ErrorNotice error={error || q.error} />
      {selected.length > 0 && (
        <div className="notice">
          <span>Выбрано: {selected.length}</span>
          <button
            className="button secondary small"
            onClick={async () => {
              try {
                await post(`/profiles/${profile!.id}/annotations/bulk`, {
                  identity_keys: selected,
                  favorite: true,
                });
                setSelected([]);
                qc.invalidateQueries({ queryKey: ["people"] });
              } catch (error) {
                setError(error);
              }
            }}
          >
            В избранное
          </button>
          <button
            className="button secondary small"
            onClick={() => setSelected([])}
          >
            Снять выбор
          </button>
        </div>
      )}
      <div className={`people-list-wrapper ${q.isFetching && q.isPlaceholderData ? "people-list-loading" : ""}`}>
        {q.isPending && !demo && !rows.length ? (
          <PeopleSkeleton />
        ) : rows.length ? (
          rows.map((person, index) => (
            <article className="person-row-card" key={person.identity_key}>
              {!demo && (
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${person.username}`}
                  checked={selected.includes(person.identity_key)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, person.identity_key].slice(0, 100)
                        : selected.filter((x) => x !== person.identity_key),
                    )
                  }
                />
              )}
              <span className="person-order-num">{index + 1}</span>
              <div className="person-avatar-box">
                {person.avatar_url ? (
                  <img
                    src={person.avatar_url}
                    alt={person.username}
                    className="person-avatar-img"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onLoad={(e) => {
                      e.currentTarget.style.display = "block";
                      const fallback = e.currentTarget.parentElement?.querySelector(".person-avatar-fallback") as HTMLElement | null;
                      if (fallback) fallback.style.display = "none";
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      const fallback = e.currentTarget.parentElement?.querySelector(".person-avatar-fallback") as HTMLElement | null;
                      if (fallback) fallback.style.display = "flex";
                    }}
                  />
                ) : null}
                <span
                  className="person-avatar-fallback"
                  style={{ display: person.avatar_url ? "none" : "flex" }}
                >
                  {person.username[0]?.toUpperCase()}
                </span>
              </div>
              <div className="person-main-col">
                <a
                  href={`https://www.instagram.com/${encodeURIComponent(person.username)}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="person-username-link"
                  title={person.username}
                >
                  @{person.username} <ArrowUpRight size={13} className="person-external-icon" />
                </a>
                <span className="person-display-name">
                  {person.full_name || (person.username.split('.')[0] ? person.username.split('.')[0].charAt(0).toUpperCase() + person.username.split('.')[0].slice(1) : person.username)}
                </span>
                {person.note && <p className="person-note">{person.note}</p>}
              </div>
              <div className="person-actions-col">
                <div
                  className={`person-more-box ${
                    menuPerson?.identity_key === person.identity_key ? "is-active" : ""
                  }`}
                  ref={menuPerson?.identity_key === person.identity_key ? menuRef : undefined}
                >
                  <button
                    className="icon-action-btn"
                    aria-label={`Дополнительно для ${person.username}`}
                    onClick={(e) => toggleMenu(person, e)}
                  >
                    <MoreHorizontal
                      size={18}
                      color={
                        menuPerson?.identity_key === person.identity_key
                          ? "#7c3aed"
                          : "#94a3b8"
                      }
                    />
                  </button>
                  {menuPerson?.identity_key === person.identity_key && (
                    <div className={`person-action-menu ${menuPlacement === "top" ? "placement-top" : ""}`}>
                      {renderPersonActionItems(person, false)}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-card">
            <h3>Здесь пока никого</h3>
            <p>Измените категорию или фильтры.</p>
          </div>
        )}
      </div>
      {/* Infinite scroll sentinel */}
      <div ref={observerTarget} style={{ height: "1px", width: "100%", pointerEvents: "none" }} />
      {q.isFetchingNextPage && (
        <div className="people-infinite-loading">
          <PeopleSkeleton count={3} />
        </div>
      )}
      {q.isError && (
        <div style={{ textAlign: "center", margin: "16px 0" }}>
          <button className="button secondary small" onClick={() => q.fetchNextPage()}>
            Повторить попытку
          </button>
        </div>
      )}
      {note && (
        <Modal
          title={`Заметка @${note.username}`}
          onClose={() => setNote(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (demo) {
                setError(new Error("В демо заметки не сохраняются."));
                setNote(null);
                return;
              }
              const data = new FormData(e.currentTarget);
              try {
                await api(
                  `/profiles/${profile!.id}/annotations/${encodeURIComponent(note.identity_key)}`,
                  {
                    method: "PUT",
                    body: JSON.stringify({
                      note: data.get("note"),
                      favorite: !!data.get("favorite"),
                    }),
                  },
                );
                setNote(null);
                qc.invalidateQueries({ queryKey: ["people"] });
              } catch (error) {
                setError(error);
              }
            }}
          >
            <label>
              Заметка
              <textarea name="note" defaultValue={note.note} maxLength={1000} />
            </label>
            <label className="checkbox-row">
              <input
                name="favorite"
                type="checkbox"
                defaultChecked={note.favorite}
              />
              Избранное
            </label>
            <div className="button-row">
              <button className="button">Сохранить</button>
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  if (!demo)
                    await api(
                      `/profiles/${profile!.id}/annotations/${encodeURIComponent(note.identity_key)}`,
                      { method: "DELETE" },
                    );
                  setNote(null);
                  qc.invalidateQueries({ queryKey: ["people"] });
                }}
              >
                Удалить пометку
              </button>
            </div>
          </form>
        </Modal>
      )}
      {menuPerson && (
        <div
          className="person-desktop-backdrop"
          onClick={() => setMenuPerson(null)}
          aria-hidden="true"
        />
      )}
      {menuPerson && (
        <div
          className="mobile-action-sheet-overlay"
          onClick={() => setMenuPerson(null)}
        >
          <div
            className="mobile-action-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-sheet-drag-handle" />
            <div className="mobile-sheet-header">
              <div className="mobile-sheet-user">
                {menuPerson.avatar_url ? (
                  <img
                    src={menuPerson.avatar_url}
                    alt={menuPerson.username}
                    className="mobile-sheet-avatar"
                  />
                ) : (
                  <span className="mobile-sheet-avatar-fallback">
                    {menuPerson.username[0]?.toUpperCase()}
                  </span>
                )}
                <div className="mobile-sheet-user-text">
                  <span className="mobile-sheet-name">
                    {menuPerson.full_name || `@${menuPerson.username}`}
                  </span>
                  <span className="mobile-sheet-username">@{menuPerson.username}</span>
                </div>
              </div>
              <button
                type="button"
                className="mobile-sheet-close-btn"
                onClick={() => setMenuPerson(null)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mobile-sheet-actions">
              {renderPersonActionItems(menuPerson, true)}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
