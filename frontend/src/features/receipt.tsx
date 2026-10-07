"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, date } from "@/lib/api";
import { ErrorNotice } from "./common";
export default function Receipt() {
  const [receipt, setReceipt] = useState<{ id: string; token: string } | null>(
    null,
  );
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get("id"),
      token = params.get("token");
    if (id && token) setReceipt({ id, token });
    history.replaceState(null, "", location.pathname);
  }, []);
  const q = useQuery({
    queryKey: ["deletion", receipt?.id],
    queryFn: ({ signal }) =>
      api<{
        status: string;
        completed_at: string | null;
        cleanup_deadline: string;
      }>(`/privacy/requests/${receipt?.id}`, {
        signal,
        headers: { Authorization: `Receipt ${receipt?.token}` },
      }),
    enabled: !!receipt,
    refetchInterval: (x) =>
      x.state.data?.status === "completed" ? false : 5000,
    retry: false,
  });
  return (
    <main className="legal-page">
      <Link href="/">На главную</Link>
      <h1>
        {q.data?.status === "completed"
          ? "Удаление завершено"
          : "Запрос на удаление принят"}
      </h1>
      <p>
        {q.data?.status === "completed"
          ? "Рабочие данные и связанные файлы удалены."
          : "Доступ к удаляемым данным уже прекращён. Очистка выполняется в фоне."}
      </p>
      {q.data && <p>Срок очистки: {date(q.data.cleanup_deadline)}</p>}
      <p className="muted">
        Квитанция действует только для проверки удаления, до 24 часов. После
        завершения она отзывается. При обновлении страницы ссылка не сохраняется
        на устройстве.
      </p>
      <ErrorNotice error={q.error} />
      <Link className="button" href="/login">
        Войти в другой аккаунт
      </Link>
    </main>
  );
}
