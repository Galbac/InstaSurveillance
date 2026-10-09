"use client";
import type { components } from "@/lib/generated-api";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Star, ArrowUpRight, FileText, MoreHorizontal, ChevronDown, SlidersHorizontal } from "lucide-react";
import { api, post, Profile, Person, date, number } from "@/lib/api";
import { demoPeople } from "@/lib/demo";
import { ErrorNotice, ExportButton, Loader, Modal } from "./common";
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
  const category = categories.some(([key]) => key === params.get("category"))
    ? params.get("category")!
    : "followers";
  const favorite = params.get("favorite") === "true",
    hasNote = params.get("has_note") === "true",
    sort = params.get("sort") || "username",
    snapshot = params.get("snapshot_id") || "";
  const [input, setInput] = useState(params.get("search") || ""),
    [note, setNote] = useState<Person | null>(null),
    [error, setError] = useState<unknown>(null),
    [selected, setSelected] = useState<string[]>([]),
    [filterSheet, setFilterSheet] = useState(false);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(pathname + "?" + next.toString(), { scroll: false });
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
        <div className="sort-dropdown-pill">
          <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
            <option value="username">Username А–Я</option>
            <option value="username_desc">Username Я–А</option>
            <option value="first_observed">Первое наблюдение</option>
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
      {context?.completeness === "partial" && (
        <p className="notice" role="status">
          Показаны доступные аккаунты из неполного списка. Отсутствие аккаунта
          не подтверждает отписку или отсутствие взаимной подписки.
        </p>
      )}
      <div
        className="category-tabs-container"
        role="tablist"
        aria-label="Категории отношений"
      >
        {categories.map(([key, label]) => (
          <button
            role="tab"
            aria-selected={category === key}
            className={`category-tab-btn ${category === key ? "active" : ""}`}
            key={key}
            onClick={() => update({ category: key })}
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
          ? ` из ${number(context.category_total)} в категории · снимок ${date(context.observed_at || null)} · ${context.source === "archive" ? "полнота подтверждена пользователем" : "сбор проверен"}`
          : ""}
      </div>
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
      <div className="people-list-wrapper">
        {q.isPending && !demo ? (
          <Loader />
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
                <button
                  className={`icon-action-btn ${person.favorite ? "active-favorite" : ""}`}
                  aria-label={`${person.favorite ? "Убрать из" : "Добавить в"} избранное ${person.username}`}
                  aria-pressed={person.favorite}
                  onClick={() => star(person)}
                >
                  <Star
                    size={17}
                    fill={person.favorite ? "#f59e0b" : "none"}
                    color={person.favorite ? "#f59e0b" : "#94a3b8"}
                  />
                </button>
                <button
                  className={`icon-action-btn ${person.note ? "active-note" : ""}`}
                  aria-label={`Заметка для ${person.username}`}
                  onClick={() => setNote(person)}
                >
                  <FileText size={17} color={person.note ? "#7c3aed" : "#94a3b8"} />
                </button>
                <button
                  className="icon-action-btn"
                  aria-label={`Дополнительно для ${person.username}`}
                  onClick={() => {
                    if (demo) {
                      setError(new Error("Действия доступны в подключенном аккаунте."));
                    }
                  }}
                >
                  <MoreHorizontal size={17} color="#94a3b8" />
                </button>
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
      {q.hasNextPage && (
        <button
          className="button secondary"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {q.isFetchingNextPage ? "Загружаем…" : "Показать ещё 50"}
        </button>
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
    </section>
  );
}
