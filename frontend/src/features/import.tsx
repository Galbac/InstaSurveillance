"use client";
import { setUploadActivity } from "@/lib/upload-activity";
import { message } from "@/lib/messages";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, Profile, Job, number } from "@/lib/api";
import {
  PublicConfig,
  polling,
  useVisible,
  terminalStates,
} from "@/lib/workflows";
import { ErrorNotice, JobProgress } from "./common";
export default function ImportPanel({
  profile,
  demo = false,
  id,
}: {
  profile?: Profile;
  demo?: boolean;
  id?: string;
}) {
  const router = useRouter(),
    qc = useQueryClient(),
    visible = useVisible();
  const [jobId, setJobId] = useState(id || ""),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const uploadOwner = useRef({});
  useEffect(() => {
    setUploadActivity(uploadOwner.current, busy || files.length > 0);
    return () => {
      setUploadActivity(uploadOwner.current, false);
    };
  }, [busy, files.length]);
  const flags = useQuery({
    queryKey: ["public-config"],
    queryFn: ({ signal }) => api<PublicConfig>("/config/public", { signal }),
  });
  const q = useQuery({
    queryKey: ["import-job", jobId],
    queryFn: ({ signal }) => api<Job>(`/imports/${jobId}`, { signal }),
    enabled: !!jobId && !demo,
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.created_at, visible),
  });
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (demo) throw new Error("Импорт доступен в личном кабинете.");
      if (!files.length) throw new Error("Выберите ZIP или JSON-файлы.");
      if (
        files.reduce((n, f) => n + f.size, 0) >
        (flags.data?.max_upload_bytes || 104857600)
      )
        throw new Error("Файлы превышают допустимый размер.");
      let p = profile;
      if (!p) {
        const username = String(
          new FormData(e.currentTarget as HTMLFormElement).get("username"),
        );
        p = await post<Profile>("/profiles", { username });
        qc.invalidateQueries({ queryKey: ["profiles"] });
      }
      const body = new FormData();
      files.forEach((f) => body.append("files[]", f));
      const job = await api<Job>(`/profiles/${p.id}/imports`, {
        method: "POST",
        body,
      });
      setJobId(job.id);
      setFiles([]);
      router.replace(`/app/imports/${job.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel import-panel">
      <h2>Импорт полного архива</h2>
      <p>
        В официальном экспорте Instagram выберите «Подписчики и подписки»,
        формат JSON и весь период. Загрузите один ZIP или все связанные
        followers_*.json вместе с following.json одного профиля.
      </p>
      <Link href="/help/import">Пошаговая инструкция</Link>
      <ErrorNotice error={error || q.error} />
      {!jobId ? (
        <form onSubmit={upload}>
          {!profile && (
            <label>
              Username владельца архива
              <input
                name="username"
                required
                maxLength={30}
                pattern="[A-Za-z0-9._]{1,30}"
              />
            </label>
          )}
          <label
            className="upload-area"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(Array.from(e.dataTransfer.files));
            }}
          >
            Выберите файлы или перетащите их сюда
            <input
              type="file"
              accept=".zip,.json"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
            />
          </label>
          <p className="muted">
            Общий размер до{" "}
            {number(
              Math.floor((flags.data?.max_upload_bytes || 104857600) / 1048576),
            )}{" "}
            МБ. HTML и вложенные архивы не поддерживаются.
          </p>
          {files.length > 0 && (
            <ul>
              {files.map((f, i) => (
                <li key={i}>
                  {f.name} · {number(f.size)} байт
                </li>
              ))}
            </ul>
          )}
          <button className="button" disabled={busy || !files.length}>
            {busy ? "Загружаем…" : "Проверить файлы"}
          </button>
        </form>
      ) : q.data ? (
        <>
          <JobProgress job={q.data} />
          {q.data.details.warnings?.includes("history_cleared") && (
            <p className="notice">
              История этого задания удалена. Подключение и заметки сохранены.
            </p>
          )}
          {q.data.status === "awaiting_confirmation" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                setBusy(true);
                setError(null);
                try {
                  await post(`/imports/${jobId}/confirm`, {
                    observed_at: new Date(
                      String(data.get("observed_at")),
                    ).toISOString(),
                    full_period: !!data.get("full_period"),
                    followers_complete: !!data.get("followers_complete"),
                    following_complete: !!data.get("following_complete"),
                    owns_data: !!data.get("owns_data"),
                  });
                  await q.refetch();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3>Проверьте предпросмотр</h3>
              <p>
                Подписчиков: {number(q.data.details.counts?.followers || 0)} ·
                подписок: {number(q.data.details.counts?.following || 0)}.
              </p>
              {q.data.details.warnings?.map((x) => (
                <p className="notice warning" key={x}>
                  {message(x)}
                </p>
              ))}
              {Object.entries(q.data.details.samples || {}).map(
                ([category, rows]) => (
                  <div key={category}>
                    <b>
                      {category === "followers"
                        ? "Пример подписчиков"
                        : "Пример подписок"}
                    </b>
                    <p>{rows.map((x) => "@" + x).join(", ")}</p>
                  </div>
                ),
              )}
              <p className="muted">
                Квота нормализованной истории: используется{" "}
                {number(q.data.details.used_bytes || 0)} байт, снимок займёт
                примерно {number(q.data.details.expected_bytes || 0)} байт.
              </p>
              <label>
                Дата получения данных (ваш часовой пояс)
                <input
                  type="datetime-local"
                  name="observed_at"
                  required
                  max={new Date(
                    Date.now() - new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                  defaultValue={new Date(
                    Date.now() - new Date().getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)}
                />
              </label>
              {[
                ["full_period", "Экспорт получен за весь период"],
                ["followers_complete", "Выбраны все части списка подписчиков"],
                ["following_complete", "Список подписок полный"],
                [
                  "owns_data",
                  "Это данные моего аккаунта, я разрешаю обработку",
                ],
              ].map(([name, label]) => (
                <label className="check" key={name}>
                  <input type="checkbox" name={name} required />
                  <span>{label}</span>
                </label>
              ))}
              <button className="button" disabled={busy}>
                Подтвердить и сохранить снимок
              </button>
            </form>
          )}
          {!terminalStates.includes(q.data.status) && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await post(`/imports/${jobId}/cancel`, {});
                  await q.refetch();
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Отменить импорт
            </button>
          )}
          {q.data.status === "completed" && (
            <Link href="/app/history" className="button">
              Открыть историю
            </Link>
          )}
          {terminalStates.includes(q.data.status) && (
            <Link href="/app/imports/new" className="button secondary">
              Новый импорт
            </Link>
          )}
        </>
      ) : (
        <p role="status">Загружаем состояние импорта…</p>
      )}
    </section>
  );
}
