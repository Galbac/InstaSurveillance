import type { components } from "./generated-api";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
export type Page<T> = { items: T[]; next_cursor: string | null };
export async function pageItems<T>(path: string): Promise<T[]> {
  return (await api<Page<T>>(path)).items;
}
export function useVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
export const terminalStates = [
  "completed",
  "failed",
  "cancelled",
  "expired",
  "partial",
  "needs_review",
  "cooldown",
  "challenge_required",
  "reconnect_required",
];
export function polling(
  status: string | undefined,
  createdAt: string | undefined,
  visible: boolean,
) {
  if (
    !visible ||
    terminalStates.includes(status || "") ||
    status === "awaiting_confirmation" ||
    status === "awaiting_2fa"
  )
    return false;
  return createdAt && Date.now() - Date.parse(createdAt) > 30000 ? 5000 : 2000;
}
export function errorText(error: unknown) {
  return error instanceof ApiError
    ? error.message +
        (error.requestId ? ` · Номер запроса: ${error.requestId}` : "")
    : error instanceof Error
      ? error.message
      : "Не удалось выполнить действие";
}
export type PublicConfig = components["schemas"]["PublicConfigDTO"];

export function useUrlValue(
  name: string,
  fallback: string,
): readonly [string, (value: string) => void] {
  const params = useSearchParams(),
    pathname = usePathname();
  const raw = params.get(name);
  const value =
    raw &&
    /(?:_start|_end)$/.test(name) &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) ||
      new Date(raw).toISOString().slice(0, 10) !== raw)
      ? fallback
      : (raw ?? fallback);
  return [
    value,
    (value) => {
      const next = new URLSearchParams(window.location.search);
      if (value === fallback || !value) next.delete(name);
      else next.set(name, value);
      window.history.replaceState(
        null,
        "",
        pathname + (next.size ? "?" + next.toString() : ""),
      );
    },
  ];
}
