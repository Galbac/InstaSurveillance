import type { components } from "./generated-api";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");

  const isMutation = options.method && !["GET", "HEAD"].includes(options.method);
  if (isMutation) {
    const response = await fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Не удалось связаться с сервером");
    const data = await response.json();
    headers.set("X-CSRF-Token", data.csrf_token);
    if (!headers.has("Idempotency-Key"))
      headers.set("Idempotency-Key", crypto.randomUUID());
  }

  const response = await fetch("/api/v1" + path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "network_error",
        "Сервис временно недоступен",
        response.status,
      );
    }
    // If CSRF check failed on mutation (e.g. cookie expired or updated), retry once with fresh CSRF token
    if (data.error?.code === "csrf_failed" && isMutation) {
      const csrfRes = await fetch("/api/v1/auth/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (csrfRes.ok) {
        const csrfData = await csrfRes.json();
        headers.set("X-CSRF-Token", csrfData.csrf_token);
        const retryRes = await fetch("/api/v1" + path, {
          ...options,
          headers,
          credentials: "same-origin",
          cache: "no-store",
        });
        if (retryRes.ok) {
          return retryRes.status === 204 ? (undefined as T) : retryRes.json();
        }
        try {
          data = await retryRes.json();
        } catch {}
      }
    }
    throw new ApiError(
      data.error?.code || "unknown",
      data.error?.message || "Не удалось выполнить действие",
      response.status,
      data.error?.request_id,
      data.error?.details,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export type User = components["schemas"]["UserDTO"];
export type Profile = components["schemas"]["ProfileDTO"];
export type Counts = components["schemas"]["Counts"];
export type Snapshot = components["schemas"]["SnapshotDTO"];
export type Event = components["schemas"]["EventDTO"] & {
  full_name?: string;
  avatar_url?: string;
  created_at?: string;
  favorite?: boolean;
};
export type Summary = components["schemas"]["SummaryDTO"];
export type Person = components["schemas"]["PersonDTO"] & {
  full_name?: string;
};
export type Job = components["schemas"]["JobDTO"];
let displayTimezone: string | undefined;

export function getDisplayTimezone(): string {
  if (displayTimezone) return displayTimezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";
  } catch {
    return "Europe/Moscow";
  }
}

export function setDisplayTimezone(value?: string) {
  try {
    if (value) new Intl.DateTimeFormat("ru", { timeZone: value });
    displayTimezone = value;
  } catch {
    displayTimezone = undefined;
  }
}

export interface DateParts {
  d: Date;
  day: number;
  monthIdx: number;
  year: number;
  hours: string;
  minutes: string;
  weekday: string;
  time: string;
  timestamp: number;
}

export function getDateParts(isoString?: string | null): DateParts {
  const d = isoString ? new Date(isoString) : new Date();
  const tz = getDisplayTimezone();
  try {
    const formatter = new Intl.DateTimeFormat("ru-RU", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    const day = parseInt(map.day || "1", 10);
    const monthIdx = parseInt(map.month || "1", 10) - 1;
    const year = parseInt(map.year || "2026", 10);
    const hours = (map.hour || "00").padStart(2, "0");
    const minutes = (map.minute || "00").padStart(2, "0");
    const rawWd = map.weekday || "";
    const weekday = rawWd ? rawWd.charAt(0).toUpperCase() + rawWd.slice(1) : "";
    return {
      d,
      day,
      monthIdx,
      year,
      hours,
      minutes,
      weekday,
      time: `${hours}:${minutes}`,
      timestamp: d.getTime(),
    };
  } catch {
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return {
      d,
      day: d.getDate(),
      monthIdx: d.getMonth(),
      year: d.getFullYear(),
      hours,
      minutes,
      weekday: "",
      time: `${hours}:${minutes}`,
      timestamp: d.getTime(),
    };
  }
}

export const date = (value: string | null, short = false) =>
  value
    ? new Intl.DateTimeFormat(
        "ru-RU",
        short
          ? { day: "numeric", month: "short", timeZone: getDisplayTimezone() }
          : {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: getDisplayTimezone(),
            },
      ).format(new Date(value))
    : "Нет данных";
export const number = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(value);
