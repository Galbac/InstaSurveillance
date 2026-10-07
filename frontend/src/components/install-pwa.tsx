"use client";
import { useEffect, useState } from "react";
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function InstallPWA() {
  const [event, setEvent] = useState<InstallEvent | null>(null),
    [ios, setIos] = useState(false),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) return;
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    const handler = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    const installed = () => setHidden(true);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  if (hidden || (!event && !ios)) return null;
  return (
    <aside className="install-banner" aria-label="Установка приложения">
      {event ? (
        <button
          className="button"
          onClick={async () => {
            await event.prompt();
            await event.userChoice;
            setEvent(null);
          }}
        >
          Установить приложение
        </button>
      ) : (
        <p>
          Для установки на iPhone: «Поделиться» → «На экран Домой» в Safari.
        </p>
      )}
      <button
        className="icon-button"
        aria-label="Скрыть предложение установки"
        onClick={() => setHidden(true)}
      >
        ×
      </button>
    </aside>
  );
}
