"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  CircleHelp,
  Clock3,
  HeartHandshake,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Upload,
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
  { view: "overview", label: "Обзор", icon: LayoutDashboard },
  { view: "people", label: "Люди", icon: Users },
  { view: "changes", label: "Изменения", icon: ArrowDownLeft },
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
    "Каждый снимок — отдельная точка наблюдения.",
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
    qc = useQueryClient();
  const [demoView, setDemoView] = useState(initialView),
    [more, setMore] = useState(false),
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
  useEffect(() => {
    setDisplayTimezone(me.data?.timezone);
    document.documentElement.dataset.theme =
      !demo && me.data?.theme === "dark" ? "dark" : "light";
    return () => {
      document.documentElement.dataset.theme = "light";
    };
  }, [me.data?.theme, me.data?.timezone, demo]);
  const go = (target: string) => {
    if (demo) setDemoView(target);
    else
      router.push(
        target === "overview"
          ? "/app"
          : target === "connect"
            ? "/app/instagram/connect"
            : target === "import"
              ? "/app/imports/new"
              : "/app/" + target,
      );
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
        <nav>
          {nav.map(({ view: v, label, icon: Icon }) => (
            <button
              key={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => go(v)}
            >
              <Icon size={19} />
              {label}
              {view === v && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <ShieldCheck size={18} />
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
              <Icon size={19} />
              {label}
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
            <LogOut size={19} />
            {demo ? "Создать аккаунт" : "Выйти"}
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span className="breadcrumb">
            Мое пространство <span>/</span>{" "}
            {view === "overview" ? "Обзор" : title}
          </span>
          <div className="topbar-right">
            {demo && <span className="badge demo-badge">ДЕМО</span>}
            <button
              className="icon-button"
              aria-label="Уведомления"
              onClick={() => go("notifications")}
            >
              <Bell size={20} />
            </button>
            <div className="avatar small gradient">
              {p?.username?.[0]?.toUpperCase() || "Y"}
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
            <div>
              <span className="overline">ТВОЯ КАРТИНА СВЯЗЕЙ</span>
              <h1>
                {title}
                <span className="heading-spark">✳</span>
              </h1>
              <p>{subtitle}</p>
            </div>
            {view === "overview" && (
              <button className="button" onClick={sync}>
                <RefreshCw size={17} />
                Обновить данные
              </button>
            )}
          </div>
          {demo && (
            <div className="demo-strip">
              <Sparkles size={16} />
              <span>
                Демо на вымышленных данных. Твой аккаунт здесь не подключен.
              </span>
              <Link href="/register">
                Начать <ArrowUpRight size={16} />
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
            <LogOut size={19} />
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
