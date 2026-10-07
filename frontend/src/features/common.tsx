"use client";
import type { components } from "@/lib/generated-api";
import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { message } from "@/lib/messages";
import { api, post, date, Job } from "@/lib/api";
import { errorText, polling, useVisible } from "@/lib/workflows";
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <div className="notice error" role="alert">
      {errorText(error)}
    </div>
  ) : null;
}
export function Loader() {
  return (
    <div className="loading min-w-0" role="status" aria-label="Загрузка">
      <span className="sr-only">Загружаем…</span>
      <div className="skeleton" aria-hidden="true" />
      <div className="skeleton" aria-hidden="true" />
      <div className="skeleton short" aria-hidden="true" />
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="panel modal-panel"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            closeButton.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
          }}
        >
          <header className="panel-heading">
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                ref={closeButton}
                type="button"
                className="icon-button"
                aria-label="Закрыть"
              >
                <X />
              </button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type ExportInput = components["schemas"]["ExportInput"];
export type ExportRequest = Pick<ExportInput, "scope" | "format"> &
  Partial<Omit<ExportInput, "scope" | "format">>;
type ExportStatus = components["schemas"]["ExportDTO"];
export function ExportButton({
  request,
  label = "Экспорт",
  className = "button secondary",
}: {
  request: ExportRequest;
  label?: string;
  className?: string;
}) {
  const [id, setId] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const visible = useVisible();
  const q = useQuery({
    queryKey: ["export", id],
    queryFn: ({ signal }) => api<ExportStatus>(`/exports/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (x) =>
      polling(x.state.data?.status, x.state.data?.job?.created_at, visible),
  });
  async function start() {
    setError(null);
    setBusy(true);
    try {
      const result = await post<{ id: string }>("/exports", request);
      setId(result.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="export-control">
      <button
        className={className}
        onClick={start}
        disabled={
          busy ||
          (!!id &&
            !["completed", "failed", "expired"].includes(q.data?.status || ""))
        }
      >
        <Download size={17} />
        {busy ? "Создаём…" : label}
      </button>
      {id && q.data?.status === "completed" ? (
        <a href={`/api/v1/exports/${id}/download`} className="text-link">
          Скачать {q.data.format.toUpperCase()} · до {date(q.data.expires_at)}
        </a>
      ) : id && q.data?.status === "failed" ? (
        <ErrorNotice
          error={new Error("Не удалось подготовить файл. Попробуйте ещё раз.")}
        />
      ) : id && q.data?.status === "expired" ? (
        <span className="muted">Файл истёк. Сформируйте заново.</span>
      ) : id ? (
        <span className="muted" role="status">
          Файл готовится в фоне…
        </span>
      ) : null}
      <ErrorNotice error={error || q.error} />
    </div>
  );
}
export const errorCodes: Record<string, string> = {
  expired: "Попытка входа истекла. Введите данные заново.",
  challenge_required:
    "Instagram просит подтвердить вход. Откройте официальное приложение, завершите проверку и переподключите аккаунт.",
  cooldown:
    "Instagram ограничил запросы. Дождитесь указанного времени; архив остаётся доступен.",
  reconnect_required:
    "Сессия больше не действует. Переподключите аккаунт явно.",
  request_budget_exhausted:
    "Бюджет запросов исчерпан. Полный снимок не опубликован. Можно использовать архив.",
  inconsistent_snapshot:
    "Списки изменились во время сбора. Предыдущий снимок сохранён.",
  needs_review:
    "Заметное изменение количества требует проверки. Предыдущая история сохранена; воспользуйтесь полным архивом.",
  worker_lost: "Фоновый процесс остановился. Предыдущие данные сохранены.",
  storage_quota: "Квота истории исчерпана. Удалите ненужные снимки.",
  missing_category: "Не найдены полные файлы подписчиков и подписок.",
  partial_archive: "Найдена только часть файлов подписчиков.",
  html_export: "Это HTML-экспорт. Выберите формат JSON.",
  unsupported_format: "Структура файла пока не поддерживается.",
  invalid_credentials: "Не удалось войти. Проверьте учётные данные.",
  account_in_use: "Этот аккаунт уже подключён. Обратитесь в поддержку.",
  provider_disabled:
    "Автоматическое подключение отключено оператором. История и архив доступны.",
};
export function JobProgress({ job }: { job: Job }) {
  return (
    <section className="job-progress" aria-live="polite">
      <span className={`badge ${job.status === "completed" ? "success" : ""}`}>
        {job.status === "completed"
          ? "Готово"
          : job.status === "queued"
            ? "В очереди"
            : job.status === "awaiting_confirmation"
              ? "Проверьте данные"
              : job.status === "awaiting_2fa"
                ? "Нужен код"
                : message(job.stage)}
      </span>
      <p>
        Задание: <code>{job.id}</code>
      </p>
      {job.details.stage_count !== undefined && (
        <p>Получено записей: {job.details.stage_count}</p>
      )}
      {job.details.requests !== undefined && (
        <p>Сетевых запросов: {job.details.requests}</p>
      )}
      {job.error_code && (
        <p className="notice error">
          {errorCodes[job.error_code] ||
            "Не удалось завершить операцию. История сохранена; обратитесь в поддержку."}
        </p>
      )}
      {job.status === "partial" && (
        <p>Частичный результат не используется для вывода об отписках.</p>
      )}
      {job.details.expires_at && (
        <p className="muted">Действует до {date(job.details.expires_at)}</p>
      )}
    </section>
  );
}
