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
export function setDisplayTimezone(value?: string) {
  try {
    if (value) new Intl.DateTimeFormat("ru", { timeZone: value });
    displayTimezone = value;
  } catch {
    displayTimezone = undefined;
  }
}
export const date = (value: string | null, short = false) =>
  value
    ? new Intl.DateTimeFormat(
        "ru-RU",
        short
          ? { day: "numeric", month: "short", timeZone: displayTimezone }
          : {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: displayTimezone,
            },
      ).format(new Date(value))
    : "Нет данных";
export const number = (value: number) =>
  new Intl.NumberFormat("ru-RU").format(value);
