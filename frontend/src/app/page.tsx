import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  HeartHandshake,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import Brand from "@/components/brand";
export default function Home() {
  return (
    <main className="landing">
      <header className="public-nav">
        <Brand />
        <nav>
          <Link href="/help">Как это работает</Link>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="button small">
            Начать <ArrowUpRight size={17} />
          </Link>
        </nav>
      </header>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-dot" /> МЕНЬШЕ ДОГАДОК. БОЛЬШЕ ЯСНОСТИ.
          </span>
          <h1>
            Кто в твоем
            <br />
            круге <span className="hero-highlight">на самом деле?</span>
          </h1>
          <p className="hero-description">
            Взаимные подписки, новые связи и те, кто исчез из списка. Вся
            картина твоего Instagram — в одном месте.
          </p>
          <div className="hero-buttons">
            <Link href="/register" className="button">
              Разобраться в подписках <ArrowRight size={18} />
            </Link>
            <Link href="/demo" className="button secondary">
              Посмотреть демо <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="hero-assurances">
            <span>
              <Check size={16} />
              Без автоматических отписок
            </span>
            <span>
              <Check size={16} />
              История изменений
            </span>
          </div>
          <p className="hero-note">
            Автоматическое чтение через неофициальную библиотеку. Ограничения
            Instagram возможны.
          </p>
        </div>
        <div className="hero-visual">
          <div className="float-label">
            <Sparkles size={15} /> ТВОЙ КРУГ, БЕЗ ШУМА
          </div>
          <div className="preview-window">
            <div className="window-bar">
              <i />
              <i />
              <i />
              <span>Обзор твоего круга</span>
            </div>
            <div className="preview-head">
              <div className="avatar gradient">Y</div>
              <div>
                <b>@your.circle</b>
                <span>Демо · вымышленные данные</span>
              </div>
              <span className="badge success">
                <span className="live-dot" />
                Обновлено
              </span>
            </div>
            <div className="preview-counts">
              <div>
                <span>Подписчики</span>
                <strong>1 240</strong>
                <small>+24 между снимками</small>
              </div>
              <div>
                <span>Взаимные</span>
                <strong>612</strong>
                <small>49,4% твоего круга</small>
              </div>
            </div>
            <div className="preview-chart">
              <div className="mini-bars">
                {[30, 38, 35, 52, 48, 70, 66, 88, 80, 100, 95, 118].map(
                  (h, i) => (
                    <i key={i} style={{ height: h }} />
                  ),
                )}
              </div>
              <span>История наблюдений</span>
            </div>
            <div className="preview-bottom">
              <span>
                <HeartHandshake size={18} />
                Взаимность стала понятнее
              </span>
              <span className="mini-arrow">
                <ArrowUpRight size={18} />
              </span>
            </div>
          </div>
          <div className="float-notice">
            <div className="notice-icon">
              <Users size={19} />
            </div>
            <div>
              <b>Изменения под рукой</b>
              <span>Узнай, что нового между снимками</span>
            </div>
          </div>
        </div>
      </section>
      <section className="value-section">
        <div className="section-heading">
          <span className="eyebrow">ПОДПИСКИ БЕЗ ЛИШНИХ ВОПРОСОВ</span>
          <h2>Увидеть. Понять. Решить самому.</h2>
        </div>
        <div className="value-grid">
          {[
            {
              icon: HeartHandshake,
              title: "Кто отвечает взаимностью",
              text: "Два понятных списка: кого читаешь без ответа и кто подписан на тебя без твоей подписки.",
            },
            {
              icon: ScanLine,
              title: "Что изменилось",
              text: "Сравнивай снимки. Смотри, какие аккаунты появились или исчезли, и выбирай период.",
            },
            {
              icon: ShieldCheck,
              title: "Контроль остается у тебя",
              text: "Поставь сбор на паузу, отключи аккаунт, выгрузи историю или удали свои данные.",
            },
          ].map(({ icon: Icon, title, text }, i) => (
            <article className="value-card" key={title}>
              <span className={`feature-icon tone-${i}`}>
                <Icon size={24} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="how-section">
        <div>
          <span className="eyebrow">ВСЕГО ТРИ ШАГА</span>
          <h2>
            Подключи.
            <br />
            Остальное —<br />
            <span className="purple">наглядно.</span>
          </h2>
          <Link href="/help" className="text-link">
            Подробнее о подключении <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="steps">
          {[
            [
              "01",
              "Создай свой аккаунт",
              "Подтверди email и открой личный кабинет.",
            ],
            [
              "02",
              "Подключи Instagram",
              "Авторизуйся, при необходимости введи 2FA-код. Пароль не хранится постоянно.",
            ],
            [
              "03",
              "Открой картину подписок",
              "Первый сбор показывает взаимность. Следующие снимки добавляют историю изменений.",
            ],
          ].map(([n, t, d]) => (
            <div className="step" key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="cta-section">
        <div>
          <span className="eyebrow">ТВОИ ДАННЫЕ. ТВОЙ ВЫБОР.</span>
          <h2>Пусть картина станет яснее.</h2>
          <p>Начни с демо и посмотри, как устроен твой будущий кабинет.</p>
        </div>
        <Link href="/demo" className="button white">
          Открыть демо <ArrowUpRight size={18} />
        </Link>
      </section>
      <footer className="public-footer">
        <Brand />
        <span>Независимый сервис. Не связан с Meta или Instagram.</span>
        <div>
          <Link href="/privacy">Приватность</Link>
          <Link href="/terms">Условия</Link>
        </div>
      </footer>
    </main>
  );
}
