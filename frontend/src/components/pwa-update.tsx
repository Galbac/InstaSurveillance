"use client";
import { useEffect, useRef, useState } from "react";
import { uploadIsActive } from "@/lib/upload-activity";
export default function PWAUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [busy, setBusy] = useState(false);
  const approved = useRef(false);
  useEffect(() => {
    let alive = true;
    const cleanups: Array<() => void> = [];
    const activity = () => setBusy(uploadIsActive());
    activity();
    const changed = () => {
      if (approved.current) window.location.reload();
    };
    window.addEventListener("insta-upload-active", activity);
    navigator.serviceWorker?.addEventListener("controllerchange", changed);
    navigator.serviceWorker?.ready
      .then((registration) => {
        if (!alive) return;
        const inspect = () => {
          if (
            alive &&
            registration.waiting &&
            navigator.serviceWorker.controller
          )
            setWaiting(registration.waiting);
        };
        const found = () => {
          const worker = registration.installing;
          if (worker) {
            worker.addEventListener("statechange", inspect);
            cleanups.push(() =>
              worker.removeEventListener("statechange", inspect),
            );
          }
        };
        inspect();
        found();
        registration.addEventListener("updatefound", found);
        cleanups.push(() =>
          registration.removeEventListener("updatefound", found),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
      cleanups.forEach((clean) => clean());
      window.removeEventListener("insta-upload-active", activity);
      navigator.serviceWorker?.removeEventListener("controllerchange", changed);
    };
  }, []);
  if (!waiting) return null;
  return (
    <aside className="install-banner" role="status">
      <p>
        {busy
          ? "Обновление готово. Сначала завершите загрузку или отмените выбор файлов."
          : "Доступна новая версия приложения."}
      </p>
      <button
        className="button"
        disabled={busy}
        onClick={() => {
          if (uploadIsActive()) return;
          approved.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Обновить и перезагрузить
      </button>
    </aside>
  );
}
