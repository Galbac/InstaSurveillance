"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  HeartHandshake,
  History,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Brand from "./brand";
import PeoplePanel from "@/features/people";
import ChangesPanel from "@/features/changes";
import HistoryPanel from "@/features/history";
import AnalyticsPanel from "@/features/analytics";
import SettingsPanel from "@/features/settings";
import ConnectionPanel, { SyncPanel } from "@/features/connection";
import ImportPanel from "@/features/import";
import { NotificationsPanel, SupportPanel } from "@/features/support";
import {
  api,
  ApiError,
  post,
  date,
  number,
  setDisplayTimezone,
  type User,
  type Profile,
  type Summary,
  type Job,
} from "@/lib/api";
import { demoProfile, demoSummary } from "@/lib/demo";

const nav = [
  { view: "overview", label: "Обзор", icon: LayoutGrid },
  { view: "people", label: "Люди", icon: Users },
  { view: "changes", label: "Изменения", icon: Activity },
  { view: "history", label: "История", icon: History },
  { view: "analytics", label: "Аналитика", icon: TrendingUp },
];
const extra = [
  { view: "notifications", label: "Уведомления", icon: Bell },
  { view: "settings", label: "Настройки", icon: Settings },
  { view: "help", label: "Помощь", icon: CircleHelp },
];
const statusNames: Record<string, string> = {
  active: "Подключен",
  disconnected: "Не подключен",
  connecting: "Подключаем",
  syncing: "Идет сбор",
  cooldown: "Пауза после ограничения",
  challenge_required: "Нужна проверка Instagram",
  reconnect_required: "Нужно переподключить",
  provider_unavailable: "Источник недоступен",
};
const headings: Record<string, [string, string]> = {
  overview: [
    "Твой круг — на виду",
    "Все важное о твоих подписках. Без лишнего шума.",
  ],
  people: ["Люди в твоем круге", "Взаимность, поиск и личные пометки."],
  changes: [
    "Что изменилось",
    "Сравнение двух наблюдений. Причина исчезновения может быть разной.",
  ],
  history: [
    "История твоего круга",
    "Все изменения твоего окружения в одном месте. Просматривай снимки и сравнивай, как менялись твои связи.",
  ],
  analytics: [
    "Картина в динамике",
    "Реальные наблюдения, а не догадки между датами.",
  ],
  settings: [
    "Все под твоим контролем",
    "Подключение, уведомления, безопасность и данные.",
  ],
  notifications: [
    "Твои уведомления",
    "Результаты обновлений и важные события.",
  ],
  help: ["Разберемся вместе", "Ответы на вопросы и связь с поддержкой."],
  connect: [
    "Подключи свой Instagram",
    "Первые данные появятся после полного успешного сбора.",
  ],
  import: [
    "Загрузи архив Instagram",
    "Резервный способ обновить картину подписок.",
  ],
};
function HeroOrbitGraphic() {
  return (
    <div className="hero-orbit-graphic" aria-hidden="true">
      <div className="hero-orbit-glow" />
      <svg className="hero-orbit-svg" viewBox="0 0 240 120" fill="none">
        <ellipse
          cx="120"
          cy="60"
          rx="105"
          ry="44"
          transform="rotate(-10 120 60)"
          stroke="rgba(196, 181, 253, 0.45)"
          strokeWidth="1.2"
          strokeDasharray="4 4"
        />
        <path
          d="M36 50l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z"
          fill="#a78bfa"
          opacity="0.9"
        />
        <path
          d="M205 70l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z"
          fill="#a78bfa"
          opacity="0.8"
        />
        <path
          d="M175 22l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z"
          fill="#8b5cf6"
          opacity="0.95"
        />
      </svg>
      <div className="hero-orbit-avatars">
        <div className="hero-orbit-circle hero-orbit-left">
          <Users size={14} className="text-slate-300" />
        </div>
        <div className="hero-orbit-circle hero-orbit-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="white" opacity="0.95">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </div>
        <div className="hero-orbit-circle hero-orbit-right">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#94a3b8" opacity="0.85">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Workspace({
  demo = false,
  initialView = "overview",
  resourceId,
}: {
  demo?: boolean;
  initialView?: string;
  resourceId?: string;
}) {
  const router = useRouter(),
    searchParams = useSearchParams(),
    qc = useQueryClient();
  const categoryParam = searchParams.get("category");
  const demoView = categoryParam
    ? "people"
    : (searchParams.get("view") ?? initialView);
  const [more, setMore] = useState(false),
    [notice, setNotice] = useState("");
  const view = demo ? demoView : initialView;
  const me = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => api<User>("/me", { signal }),
    enabled: !demo,
  });
  const profileQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: ({ signal }) => api<Profile[]>("/profiles", { signal }),
    enabled: !demo && !!me.data?.verified,
    refetchInterval: 10000,
  });
  const p = demo ? demoProfile : profileQuery.data?.[0];
  const summaryQuery = useQuery({
    queryKey: ["summary", p?.id, p?.last_sync],
    queryFn: ({ signal }) =>
      api<Summary>(`/profiles/${p!.id}/summary`, { signal }),
    enabled: !demo && !!p,
    refetchInterval:
      p?.status === "syncing" || p?.status === "connecting" ? 10000 : false,
  });
  const summary = demo ? demoSummary : summaryQuery.data;
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      qc.clear();
      router.replace(
        "/login?return_to=" +
          encodeURIComponent(window.location.pathname + window.location.search),
      );
    }
  }, [me.error, router, qc]);
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setDisplayTimezone(me.data?.timezone);
    const saved = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    const resolvedTheme =
      saved === "dark" || (!demo && me.data?.theme === "dark") ? "dark" : "light";
    setCurrentTheme(resolvedTheme);
    document.documentElement.dataset.theme = resolvedTheme;
    return () => {
      document.documentElement.dataset.theme = "light";
    };
  }, [me.data?.theme, me.data?.timezone, demo]);

  const toggleTheme = () => {
    const next = currentTheme === "dark" ? "light" : "dark";
    setCurrentTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };
  const go = (target: string) => {
    if (demo) {
      if (target === "people") {
        router.push("/demo?category=mutual", { scroll: false });
      } else {
        router.push(`/demo?view=${target}`, { scroll: false });
      }
    } else {
      router.push(
        target === "overview"
          ? "/app"
          : target === "connect"
            ? "/app/instagram/connect"
            : target === "import"
              ? "/app/imports/new"
              : "/app/" + target,
      );
    }
    setMore(false);
  };
  async function logout() {
    try {
      await post("/auth/logout", {});
      qc.clear();
      router.replace("/login");
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function sync() {
    if (demo) {
      setNotice(
        "Это демо на вымышленных данных. Подключи аккаунт, чтобы обновлять свои списки.",
      );
      return;
    }
    if (!p) {
      go("connect");
      return;
    }
    try {
      const job = await post<Job>(`/profiles/${p.id}/syncs`, {});
      router.push(`/app/syncs/${job.id}`);
      setNotice(
        "Обновление поставлено в очередь. Предыдущие данные остаются доступны.",
      );
      qc.invalidateQueries({ queryKey: ["profiles"] });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Обновление недоступно");
    }
  }
  const [title, subtitle] = headings[view] || headings.overview;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-caption">МОЕ ПРОСТРАНСТВО</div>
        <nav className="sidebar-nav">
          {nav.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => go(v)}
            >
              <Icon size={19} className="nav-icon" />
              <span>{label}</span>
              {view === v && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <ShieldCheck size={20} />
            </span>
            <b>Твой круг — личное</b>
            <p>История доступна только тебе. Управляй данными в настройках.</p>
          </div>
          {extra.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => go(v)}
            >
              <Icon size={19} className="nav-icon" />
              <span>{label}</span>
            </button>
          ))}
          {!demo && me.data?.permissions?.includes("admin.metadata") && (
            <Link className="nav-item" href="/admin">
              Администрирование
            </Link>
          )}
          <button
            onClick={demo ? () => router.push("/register") : logout}
            className="nav-item"
          >
            {demo ? <UserPlus size={19} className="nav-icon" /> : <LogOut size={19} className="nav-icon" />}
            <span>{demo ? "Создать аккаунт" : "Выйти"}</span>
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-parent">Мое пространство</span>
            <ChevronRight size={13} className="breadcrumb-chevron" />
            <span className="breadcrumb-current">
              {view === "overview" ? "Обзор" : title}
            </span>
          </div>
          <div className="topbar-right">
            {demo && <span className="badge demo-badge">ДЕМО</span>}
            <button
              className="icon-button"
              aria-label={
                currentTheme === "dark"
                  ? "Включить светлую тему"
                  : "Включить тёмную тему"
              }
              title={currentTheme === "dark" ? "Светлая тема" : "Тёмная тема"}
              onClick={toggleTheme}
            >
              {currentTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button
              className="icon-button"
              aria-label="Уведомления"
              onClick={() => go("notifications")}
            >
              <Bell size={20} />
            </button>
            <div className="topbar-user-badge">
              <div className="topbar-user-avatar">
                {demo ? "N" : p?.username?.[0]?.toUpperCase() || "Y"}
              </div>
              <ChevronDown size={14} className="topbar-user-chevron" />
            </div>
            <button
              className="mobile-more icon-button"
              aria-label="Открыть меню"
              onClick={() => setMore(!more)}
            >
              <Menu size={21} />
            </button>
          </div>
        </header>
        <main className="dashboard-content">
          <div className="page-heading">
            <div className="page-heading-left">
              <span className="overline">ТВОЯ КАРТИНА СВЯЗЕЙ</span>
              <h1>
                {title}
                <span className="heading-spark">✱</span>
              </h1>
              <p>
                {view === "people" ? (
                  <>
                    Взаимность, поиск и личные пометки.
                    <br />
                    Здесь ты видишь людей, которые вокруг тебя в Instagram.
                  </>
                ) : (
                  subtitle
                )}
              </p>
            </div>
            {view === "people" && <HeroOrbitGraphic />}
            {view === "overview" && (
              <button className="button" onClick={sync}>
                <RefreshCw size={17} />
                Обновить данные
              </button>
            )}
          </div>
          {demo && (
            <div className="demo-strip">
              <div className="demo-strip-left">
                <Sparkles size={16} className="demo-strip-sparkle" />
                <span>
                  Демо на вымышленных данных. Твой аккаунт здесь не подключен.
                </span>
              </div>
              <Link href="/register" className="demo-strip-link">
                Начать <ArrowRight size={15} />
              </Link>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button
                className="icon-button"
                aria-label="Закрыть сообщение"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!demo && me.data && !me.data.verified && view !== "settings" ? (
            <div className="empty-card">
              <ShieldCheck size={38} />
              <h2>Подтверди свой email</h2>
              <p>
                Мы отправили письмо на {me.data.email}. Это поможет защитить
                твой кабинет.
              </p>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await post("/auth/resend-verification", {});
                    setNotice("Письмо отправлено. Проверь почту.");
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : "Ошибка");
                  }
                }}
              >
                Отправить письмо еще раз
              </button>
              <button className="button secondary" onClick={() => me.refetch()}>
                Я уже подтвердил
              </button>
              <button
                className="button secondary"
                onClick={() => go("settings")}
              >
                Настройки и удаление аккаунта
              </button>
            </div>
          ) : !demo && me.isPending ? (
            <Loading />
          ) : !demo && me.error ? (
            <div className="notice error">
              Не удалось загрузить кабинет.{" "}
              <button onClick={() => me.refetch()}>Повторить</button>
            </div>
          ) : (
            <>
              {view === "overview" &&
                (summary?.counts ? (
                  <Overview summary={summary} go={go} demo={demo} />
                ) : (
                  <Empty
                    go={go}
                    loading={summaryQuery.isPending && !!p}
                    profile={p}
                  />
                ))}
              {view === "people" && <PeoplePanel profile={p} demo={demo} />}
              {view === "changes" && <ChangesPanel profile={p} demo={demo} />}
              {view === "history" && <HistoryPanel profile={p} demo={demo} />}
              {view === "analytics" && (
                <AnalyticsPanel profile={p} demo={demo} />
              )}
              {view === "connect" && (
                <ConnectionPanel
                  profile={p}
                  demo={demo}
                  onDone={() => {
                    qc.invalidateQueries();
                    go("overview");
                  }}
                />
              )}
              {view === "import" && (
                <ImportPanel profile={p} demo={demo} id={resourceId} />
              )}
              {view === "onboarding" && (
                <section className="panel">
                  <h2>Выберите источник первого снимка</h2>
                  <p>
                    Подключите собственный Instagram с учётом рисков
                    неофициального доступа или загрузите официальный архив.
                  </p>
                  <div className="button-row">
                    <button className="button" onClick={() => go("connect")}>
                      Подключить Instagram
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => go("import")}
                    >
                      Загрузить JSON или ZIP
                    </button>
                  </div>
                  <p>
                    Первый снимок показывает текущие списки. Изменения появятся
                    после следующего сопоставимого наблюдения.
                  </p>
                </section>
              )}
              {view === "sync" && resourceId && <SyncPanel id={resourceId} />}
              {view === "settings" && (
                <SettingsPanel
                  profile={p}
                  user={me.data}
                  demo={demo}
                  onNotice={setNotice}
                />
              )}
              {view === "notifications" && <NotificationsPanel demo={demo} />}
              {view === "help" && <SupportPanel demo={demo} />}
            </>
          )}
          <footer className="workspace-footer">
            <span>Твои связи. Твоя история.</span>
            <span>
              InstaSurveillance <span className="footer-dot">•</span>{" "}
              Независимый сервис
            </span>
          </footer>
        </main>
      </div>
      {more && (
        <div className="mobile-menu">
          <button
            className="close-menu icon-button"
            aria-label="Закрыть меню"
            onClick={() => setMore(false)}
          >
            <X size={21} />
          </button>
          {[...nav, ...extra].map(({ view: v, label, icon: Icon }) => (
            <button className="nav-item" key={v} onClick={() => go(v)}>
              <Icon size={19} />
              {label}
            </button>
          ))}
          <button
            className="nav-item"
            onClick={demo ? () => router.push("/register") : logout}
          >
            {demo ? <UserPlus size={19} /> : <LogOut size={19} />}
            {demo ? "Создать аккаунт" : "Выйти"}
          </button>
        </div>
      )}
      <nav className="bottom-nav" aria-label="Основная мобильная навигация">
        {nav
          .filter((x) => ["overview", "people", "history"].includes(x.view))
          .map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => go(v)}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        <button className={more ? "active" : ""} onClick={() => setMore(!more)}>
          <MoreHorizontal size={20} />
          <span>Еще</span>
        </button>
      </nav>
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={22} className="spin" />
      Загружаем твою картину…
    </div>
  );
}
function Empty({
  go,
  loading,
  profile,
}: {
  go: (v: string) => void;
  loading?: boolean;
  profile?: Profile;
}) {
  if (loading) return <Loading />;
  return (
    <section className="empty-card">
      <span className="empty-icon">
        <Users size={35} />
      </span>
      <span className="overline">НАЧНЕМ С ПЕРВОГО СНИМКА</span>
      <h2>
        {profile?.status === "active"
          ? "Твой первый сбор выполняется"
          : "Здесь появится твой круг"}
      </h2>
      <p>
        Подключи Instagram, чтобы увидеть взаимность подписок. После следующего
        полного снимка станут доступны изменения.
      </p>
      <div className="hero-buttons">
        <button className="button" onClick={() => go("connect")}>
          <Plus size={18} />
          Подключить Instagram
        </button>
        <button className="button secondary" onClick={() => go("import")}>
          <Upload size={18} />
          Загрузить архив
        </button>
      </div>
      {profile && (
        <p className="muted">
          @{profile.username} · {statusNames[profile.status] || profile.status}
        </p>
      )}
    </section>
  );
}
function Overview({
  summary,
  go,
  demo,
}: {
  summary: Summary;
  go: (v: string) => void;
  demo: boolean;
}) {
  const c = summary.counts!;
  const removed =
    summary.change_counts?.followers_removed ??
    summary.changes?.filter(
      (e) => e.type === "removed" && e.relation === "followers",
    ).length;
  return (
    <>
      <div className="profile-strip">
        <div className="avatar gradient">
          {summary.profile.username[0].toUpperCase()}
        </div>
        <div className="profile-strip-name">
          <b>@{summary.profile.username}</b>
          <span>
            <Clock3 size={13} />
            {date(summary.snapshot?.observed_at || null)} ·{" "}
            {summary.snapshot?.source === "archive"
              ? "Архив"
              : "Автоматический сбор"}
          </span>
        </div>
        <span className="badge success">
          <span className="live-dot" />
          {summary.profile.paused
            ? "На паузе"
            : statusNames[summary.profile.status] || "Данные сохранены"}
        </span>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Подписчики",
            value: c.followers,
            icon: Users,
            tone: "violet",
            hint: "Те, кто читает тебя",
          },
          {
            label: "Мои подписки",
            value: c.following,
            icon: ArrowUpRight,
            tone: "blue",
            hint: "Аккаунты в твоей ленте",
          },
          {
            label: "Взаимные",
            value: c.mutual,
            icon: HeartHandshake,
            tone: "green",
            hint:
              c.mutual_rate !== null
                ? `${c.mutual_rate}% подписчиков`
                : "Нет данных для доли",
          },
          {
            label: "Исчезли из списка",
            value: removed,
            icon: ArrowDownLeft,
            tone: "peach",
            hint: "Между последними снимками",
          },
        ].map(({ label, value, icon: Icon, tone, hint }) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className={`stat-icon ${tone}`}>
                <Icon size={20} />
              </span>
            </div>
            <strong>{value === undefined ? "—" : number(value)}</strong>
            <span className="stat-hint">{hint}</span>
          </article>
        ))}
      </div>
      <div className="relationship-grid">
        <button className="relationship-card" onClick={() => go("people")}>
          <div>
            <span className="overline">ВЗАИМНОСТЬ ПОДПИСОК</span>
            <h3>Я подписан без ответа</h3>
            <p>Ты читаешь их, они не подписаны на тебя</p>
          </div>
          <strong>{number(c.not_following_back)}</strong>
          <span className="relationship-arrow">
            <ArrowUpRight size={21} />
          </span>
        </button>
        <button className="relationship-card mint" onClick={() => go("people")}>
          <div>
            <span className="overline">ТВОЯ АУДИТОРИЯ</span>
            <h3>На меня подписаны без ответа</h3>
            <p>Они читают тебя, ты не подписан на них</p>
          </div>
          <strong>{number(c.fans)}</strong>
          <span className="relationship-arrow">
            <ArrowUpRight size={21} />
          </span>
        </button>
      </div>
      {summary.last_import && (
        <section className="panel">
          <h3>Последний импорт</h3>
          <p>
            {date(summary.last_import.created_at)} ·{" "}
            {statusNames[summary.last_import.status] ||
              summary.last_import.stage}
          </p>
          <Link
            className="button secondary"
            href={`/app/imports/${summary.last_import.id}`}
          >
            Открыть результат импорта
          </Link>
        </section>
      )}
      <div className="overview-bottom">
        <AnalyticsPanel profile={summary.profile} demo={demo} compact />
        <section className="panel changes-panel">
          <div className="panel-heading">
            <div>
              <h3>Последние изменения</h3>
              <p>Между двумя снимками</p>
            </div>
            <button className="text-link" onClick={() => go("changes")}>
              Все <ArrowUpRight size={16} />
            </button>
          </div>
          {summary.changes?.length ? (
            summary.changes.slice(0, 4).map((e, i) => (
              <div className="change-row" key={i}>
                <div
                  className={`avatar ${e.type === "added" ? "mint-avatar" : "peach-avatar"}`}
                >
                  {e.username[0].toUpperCase()}
                </div>
                <div>
                  <b>@{e.username}</b>
                  <span>
                    {e.type === "added"
                      ? "Появился в списке"
                      : "Исчез из списка"}
                  </span>
                </div>
                <span className={`event-dot ${e.type}`}>
                  {e.type === "added" ? (
                    <Plus size={15} />
                  ) : (
                    <ArrowDownLeft size={15} />
                  )}
                </span>
              </div>
            ))
          ) : (
            <div className="small-empty">
              {summary.changes
                ? "Изменений между снимками нет"
                : summary.previous_snapshot
                  ? "Сравнение готовится в фоне или снимки несопоставимы"
                  : "Для изменений нужен следующий снимок"}
            </div>
          )}
          <p className="small-disclaimer">
            Исчезновение не всегда означает отписку. Удаление аккаунта и
            особенности источника тоже влияют.
          </p>
        </section>
      </div>
    </>
  );
}

export default function Dashboard(props: {
  demo?: boolean;
  initialView?: string;
  resourceId?: string;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <Workspace {...props} />
    </Suspense>
  );
}
