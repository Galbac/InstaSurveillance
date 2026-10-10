"use client";
import type { components } from "@/lib/generated-api";
import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Download, X, Loader2, CheckCircle2, AlertCircle, Check } from "lucide-react";
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
    "Instagram временно отклонил запросы сервиса.",
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
  identity_mismatch:
    "Сессия принадлежит другому аккаунту Instagram. Укажите username аккаунта, от которого взят sessionid.",
  provider_disabled:
    "Автоматическое подключение отключено оператором. История и архив доступны.",
  provider_unavailable:
    "Серверы Instagram временно недоступны или отклонили запрос. Попробуйте позже или используйте загрузку архива.",
};
export function JobProgress({ job }: { job: Job }) {
  const isCompleted = job.status === "completed";
  const isFailed = Boolean(job.error_code) || job.status === "failed" || job.status === "cancelled" || job.status === "canceled";
  const isActive = !isCompleted && !isFailed;

  // Calculate percentage and stage index
  let percent = 20;
  let activeStep = 1;

  if (isCompleted) {
    percent = 100;
    activeStep = 4;
  } else if (job.status === "queued") {
    percent = 12;
    activeStep = 0;
  } else if (job.stage === "validating_session" || job.stage === "prepare") {
    percent = 25;
    activeStep = 1;
  } else if (job.stage === "fetching_followers") {
    percent = 55;
    activeStep = 2;
  } else if (job.stage === "fetching_following") {
    percent = 78;
    activeStep = 3;
  } else if (job.stage === "validating_snapshot" || job.stage === "committing") {
    percent = 92;
    activeStep = 4;
  }

  const cardClass = isCompleted
    ? "sync-progress-card completed"
    : isFailed
      ? "sync-progress-card failed"
      : "sync-progress-card active";

  return (
    <section className={cardClass} aria-live="polite">
      <div className="sync-progress-header">
        <div className="sync-progress-title-box">
          <div
            className={`sync-progress-icon-wrap ${
              isCompleted ? "completed" : isFailed ? "failed" : ""
            }`}
          >
            {isCompleted ? (
              <CheckCircle2 size={24} />
            ) : isFailed ? (
              <AlertCircle size={24} />
            ) : (
              <Loader2 size={24} className="animate-spin" />
            )}
          </div>
          <div>
            <h3>
              {isCompleted
                ? "Сбор данных успешно завершён"
                : isFailed
                  ? "Сбор остановлен"
                  : job.status === "queued"
                    ? "В очереди на сбор данных…"
                    : "Идёт сбор данных из Instagram…"}
            </h3>
            <p>
              {isCompleted
                ? "Все списки обновлены и сохранены в истории профиля"
                : isFailed
                  ? errorCodes[job.error_code || ""] || "Не удалось завершить операцию."
                  : message(job.stage)}
            </p>
          </div>
        </div>

        {isActive && (
          <span className="badge" style={{ background: "#ede9fe", color: "#6d28d9", border: "none" }}>
            <span className="live-dot" style={{ background: "#7c3aed" }} />
            В процессе
          </span>
        )}
        {isCompleted && (
          <span className="badge success">
            <Check size={12} />
            Готово
          </span>
        )}
      </div>

      <div className="sync-progress-bar-track">
        <div
          className={`sync-progress-bar-fill ${isActive ? "animated" : ""} ${
            isCompleted ? "completed" : ""
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="sync-steps-track">
        <div className={`sync-step-item ${activeStep > 1 || isCompleted ? "done" : activeStep === 1 ? "active" : ""}`}>
          <span>{activeStep > 1 || isCompleted ? "✓" : "1"}</span>
          <span>Сессия</span>
        </div>
        <div className={`sync-step-item ${activeStep > 2 || isCompleted ? "done" : activeStep === 2 ? "active" : ""}`}>
          <span>{activeStep > 2 || isCompleted ? "✓" : "2"}</span>
          <span>Подписчики</span>
        </div>
        <div className={`sync-step-item ${activeStep > 3 || isCompleted ? "done" : activeStep === 3 ? "active" : ""}`}>
          <span>{activeStep > 3 || isCompleted ? "✓" : "3"}</span>
          <span>Подписки</span>
        </div>
        <div className={`sync-step-item ${isCompleted ? "done" : activeStep === 4 ? "active" : ""}`}>
          <span>{isCompleted ? "✓" : "4"}</span>
          <span>Анализ</span>
        </div>
      </div>

      <div className="sync-stats-chips">
        {job.details.stage_count !== undefined && (
          <span className="sync-stat-chip">
            Получено записей: <strong>{job.details.stage_count}</strong>
          </span>
        )}
        {job.details.requests !== undefined && (
          <span className="sync-stat-chip">
            Запросов к Instagram: <strong>{job.details.requests}</strong>
          </span>
        )}
        {isActive && (
          <span className="sync-stat-chip" style={{ color: "#7c3aed", background: "#f5f3ff" }}>
            Страница обновляется автоматически в реальном времени
          </span>
        )}
        {isCompleted && (
          <span className="sync-stat-chip">
            Завершено: {date(job.updated_at || job.created_at)}
          </span>
        )}
        {job.details.expires_at && (
          <span className="sync-stat-chip">
            Действует до {date(job.details.expires_at)}
          </span>
        )}
      </div>

      {job.error_code && (
        <p className="notice error" style={{ marginTop: 14 }}>
          {job.error_code === "cooldown" && job.kind === "connect"
            ? "Instagram отклонил создание новой сессии через сервис. Вход через официальный Instagram может при этом работать."
            : errorCodes[job.error_code] ||
              "Не удалось завершить операцию. История сохранена; обратитесь в поддержку."}
        </p>
      )}

      {job.error_code === "cooldown" && (
        <p className="muted" style={{ marginTop: 8 }}>
          {job.next_allowed_at
            ? `Повтор доступен после ${date(job.next_allowed_at)}.`
            : "Instagram не сообщил срок повторной попытки."}
        </p>
      )}

      {job.status === "partial" && (
        <p className="muted" style={{ marginTop: 8 }}>
          Частичный результат не используется для вывода об отписках.
        </p>
      )}
    </section>
  );
}
