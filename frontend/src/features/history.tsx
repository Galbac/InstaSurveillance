"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Profile, Snapshot, date, number } from "@/lib/api";
import { Page } from "@/lib/workflows";
import { demoHistory } from "@/lib/demo";
import { ErrorNotice, Loader, Modal } from "./common";
export function useSnapshots(profile?: Profile, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["snapshots", profile?.id],
    queryFn: ({ pageParam, signal }) =>
      api<Page<Snapshot>>(
        `/profiles/${profile!.id}/snapshots?limit=50${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: enabled && !!profile,
  });
}
export default function HistoryPanel({
  profile,
  demo = false,
}: {
  profile?: Profile;
  demo?: boolean;
}) {
  const router = useRouter(),
    qc = useQueryClient();
  const q = useSnapshots(profile, !demo);
  const [details, setDetails] = useState<Snapshot | null>(null),
    [deleting, setDeleting] = useState<Snapshot | null>(null),
    [selection, setSelection] = useState<string[]>([]),
    [error, setError] = useState<unknown>(null);
  const rows = demo
    ? [...demoHistory].reverse()
    : q.data?.pages.flatMap((page) => page.items) || [];
  return (
    <section className="panel">
      <header className="panel-heading">
        <h2>Сохранённые снимки</h2>
        <button
          className="button secondary"
          disabled={selection.length !== 2}
          onClick={() => {
            const pair = selection
              .map((id) => rows.find((x) => x.id === id)!)
              .sort(
                (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
              );
            router.push(
              `/app/changes?before=${pair[0].id}&after=${pair[1].id}`,
            );
          }}
        >
          Сравнить выбранные
        </button>
      </header>
      <ErrorNotice error={error || q.error} />
      {q.isPending && !demo && profile ? (
        <Loader />
      ) : (
        rows.map((snapshot) => (
          <article className="snapshot-row" key={snapshot.id}>
            <label className="checkbox-row">
              <input
                aria-label={`Выбрать снимок ${date(snapshot.observed_at)}`}
                type="checkbox"
                checked={selection.includes(snapshot.id)}
                onChange={(e) =>
                  setSelection(
                    e.target.checked
                      ? [...selection, snapshot.id].slice(-2)
                      : selection.filter((x) => x !== snapshot.id),
                  )
                }
              />
              <span>
                <b>{date(snapshot.observed_at)}</b>
                <small>
                  {snapshot.source === "archive"
                    ? "Архив · дата заявлена пользователем"
                    : "Автоматический сбор"}{" "}
                  ·{" "}
                  {snapshot.identity_mode === "username"
                    ? "username"
                    : "устойчивый ID"}
                </small>
                <small>Сохранено: {date(snapshot.created_at)}</small>
              </span>
            </label>
            <span>
              {number(snapshot.counts?.followers || 0)} подписчиков /{" "}
              {number(snapshot.counts?.following || 0)} подписок
            </span>
            <div className="button-row">
              <button
                className="button secondary small"
                onClick={() => setDetails(snapshot)}
              >
                Детали
              </button>
              <button
                className="button secondary small danger"
                onClick={() => setDeleting(snapshot)}
              >
                Удалить
              </button>
            </div>
          </article>
        ))
      )}
      {!rows.length && (
        <div className="empty-card">
          <h3>Истории пока нет</h3>
          <p>Подключите Instagram или загрузите полный архив.</p>
        </div>
      )}
      {q.hasNextPage && (
        <button
          className="button secondary"
          disabled={q.isFetchingNextPage}
          onClick={() => q.fetchNextPage()}
        >
          Ещё 50 снимков
        </button>
      )}
      {details && (
        <Modal title="Детали снимка" onClose={() => setDetails(null)}>
          <dl className="detail-list">
            <dt>Источник</dt>
            <dd>{details.source}</dd>
            <dt>Полнота</dt>
            <dd>{details.completeness}</dd>
            <dt>Наблюдение</dt>
            <dd>{date(details.observed_at)}</dd>
            <dt>Checksum</dt>
            <dd>
              <code>{details.checksum || "Демо"}</code>
            </dd>
            <dt>Логический объём</dt>
            <dd>{number(details.storage_bytes || 0)} байт</dd>
            {Object.entries(details.provenance || {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
          </dl>
          <button
            className="button secondary"
            onClick={() => router.push(`/app/people?snapshot_id=${details.id}`)}
          >
            Открыть списки этого снимка
          </button>
        </Modal>
      )}
      {deleting && (
        <Modal title="Удалить снимок?" onClose={() => setDeleting(null)}>
          <p>
            Снимок от {date(deleting.observed_at)} будет удалён. Сравнения с ним
            исчезнут; соседние изменения будут пересчитаны. Заметки сохранятся.
          </p>
          <button
            className="button danger"
            onClick={async () => {
              if (demo) {
                setError(new Error("В демо снимки не удаляются."));
                setDeleting(null);
                return;
              }
              try {
                await api(`/snapshots/${deleting.id}`, { method: "DELETE" });
                setDeleting(null);
                setSelection([]);
                qc.invalidateQueries();
              } catch (error) {
                setError(error);
              }
            }}
          >
            Подтвердить удаление
          </button>
        </Modal>
      )}
    </section>
  );
}
