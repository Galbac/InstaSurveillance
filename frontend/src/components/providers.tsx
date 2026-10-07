"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import PWAUpdate from "./pwa-update";
import InstallPWA from "./install-pwa";
export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [pwa, setPwa] = useState(false);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    fetch("/api/v1/config/public", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (!alive) return;
        setPwa(config?.enable_pwa === true);
        if ("serviceWorker" in navigator) {
          if (config?.enable_pwa)
            navigator.serviceWorker.register("/sw.js").catch(() => {});
          else
            navigator.serviceWorker
              .getRegistrations()
              .then((rs) => rs.forEach((r) => r.unregister()));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);
  return (
    <QueryClientProvider client={client}>
      {children}
      {pwa && (
        <>
          <InstallPWA />
          <PWAUpdate />
        </>
      )}
    </QueryClientProvider>
  );
}
