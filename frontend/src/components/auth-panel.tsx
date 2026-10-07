"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import Brand from "./brand";
import { useQuery } from "@tanstack/react-query";
import { PublicConfig } from "@/lib/workflows";
import { api, post } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authSchema, type AuthMode as Mode } from "@/lib/form-schemas";
export default function AuthPanel({ mode }: { mode: Mode }) {
  const router = useRouter();
  const form = useForm({
    resolver: zodResolver(authSchema(mode)),
    defaultValues: { email: "", password: "", remember: false, terms: false },
  });
  const config = useQuery({
    queryKey: ["public-config"],
    queryFn: ({ signal }) => api<PublicConfig>("/config/public", { signal }),
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const titles = {
    login: "С возвращением",
    register: "Твой круг начинается здесь",
    "verify-email": "Подтверди email",
    "forgot-password": "Восстановим доступ",
    "reset-password": "Новый пароль",
    "confirm-email-change": "Подтвердите новый email",
  };
  async function submit(data: {
    email: string;
    password: string;
    remember: boolean;
    terms: boolean;
  }) {
    setError("");
    setBusy(true);
    try {
      const rawToken =
        new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
      if (mode === "login") {
        await post("/auth/login", {
          email: data.email,
          password: data.password,
          remember_me: data.remember,
        });
        const target =
          new URLSearchParams(location.search).get("return_to") || "/app";
        router.push(
          target.startsWith("/app") &&
            !target.startsWith("//") &&
            !target.includes("\\")
            ? target
            : "/app",
        );
      }
      if (mode === "register") {
        const result = await post<{ message: string }>("/auth/register", {
          email: data.email,
          password: data.password,
          accepted_terms: data.terms,
          terms_version: config.data?.terms_version,
          privacy_version: config.data?.privacy_version,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        setMessage(result.message);
      }
      if (mode === "forgot-password") {
        const result = await post<{ message: string }>(
          "/auth/forgot-password",
          { email: data.email },
        );
        setMessage(result.message);
      }
      if (mode === "confirm-email-change") {
        await post("/me/email-change/confirm", { token: rawToken });
        window.history.replaceState(null, "", location.pathname);
        setMessage("Email изменён. Войдите с новым адресом.");
      }
      if (mode === "verify-email") {
        await post("/auth/verify-email", { token: rawToken });
        window.history.replaceState(null, "", window.location.pathname);
        setMessage("Email подтвержден. Теперь можно войти в кабинет.");
      }
      if (mode === "reset-password") {
        await post("/auth/reset-password", {
          token: rawToken,
          password: data.password,
        });
        window.history.replaceState(null, "", window.location.pathname);
        setMessage("Пароль изменен. Войдите с новым паролем.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <header>
        <Brand />
        <Link href="/">На главную</Link>
      </header>
      <div className="auth-layout">
        <aside>
          <span className="eyebrow">ТВОЙ КРУГ ПОД КОНТРОЛЕМ</span>
          <h1>
            Чуть больше
            <br />
            <span className="purple">ясности.</span>
            <br />
            Чуть меньше шума.
          </h1>
          <p>
            Взаимность, история и изменения —<br />в удобном личном
            пространстве.
          </p>
          <div className="auth-art">
            <div className="orbit-ring">
              <span>ты</span>
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <span className="auth-trust">
            <ShieldCheck size={20} />
            Данные видны только тебе
          </span>
        </aside>
        <section className="auth-card">
          <span className="overline">INSTASURVEILLANCE</span>
          <h2>{titles[mode]}</h2>
          <p className="muted">
            {mode === "register"
              ? "Создай личный кабинет для анализа подписок."
              : mode === "login"
                ? "Войди, чтобы увидеть изменения в твоем круге."
                : "Мы поможем продолжить безопасно."}
          </p>
          {message ? (
            <div className="notice success" role="status">
              {message}
              <Link href="/login" className="text-link">
                Перейти ко входу <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <form noValidate onSubmit={form.handleSubmit(submit)}>
              {mode !== "verify-email" &&
                mode !== "reset-password" &&
                mode !== "confirm-email-change" && (
                  <label>
                    Email
                    <input
                      {...form.register("email")}
                      aria-invalid={!!form.formState.errors.email}
                      aria-describedby={
                        form.formState.errors.email
                          ? "auth-email-error"
                          : undefined
                      }
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="you@example.com"
                    />
                  </label>
                )}
              {["login", "register", "reset-password"].includes(mode) && (
                <label>
                  Пароль
                  <input
                    {...form.register("password")}
                    aria-invalid={!!form.formState.errors.password}
                    aria-describedby={
                      form.formState.errors.password
                        ? "auth-password-error"
                        : undefined
                    }
                    type="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    minLength={12}
                    maxLength={256}
                    required
                    placeholder="Не менее 12 символов"
                  />
                </label>
              )}
              {mode === "login" && (
                <div className="form-inline">
                  <label className="check">
                    <input
                      type="checkbox"
                      {...form.register("remember")}
                      aria-invalid={!!form.formState.errors.remember}
                      aria-describedby={
                        form.formState.errors.remember
                          ? "auth-remember-error"
                          : undefined
                      }
                    />
                    Запомнить меня
                  </label>
                  <Link href="/forgot-password">Забыли пароль?</Link>
                </div>
              )}
              {mode === "register" && (
                <label className="check">
                  <input
                    {...form.register("terms")}
                    aria-invalid={!!form.formState.errors.terms}
                    aria-describedby={
                      form.formState.errors.terms
                        ? "auth-terms-error"
                        : undefined
                    }
                    type="checkbox"
                    required
                  />
                  <span>
                    Принимаю <Link href="/terms">условия</Link> и{" "}
                    <Link href="/privacy">политику обработки данных</Link>
                  </span>
                </label>
              )}
              {Object.entries(form.formState.errors).map(([name, field]) => (
                <p
                  key={name}
                  id={`auth-${name}-error`}
                  className="notice error"
                  role="alert"
                >
                  {String(field.message)}
                </p>
              ))}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button full"
                disabled={busy || (mode === "register" && !config.data)}
              >
                {busy
                  ? "Подождите…"
                  : mode === "login"
                    ? "Войти"
                    : mode === "register"
                      ? "Создать аккаунт"
                      : mode === "verify-email"
                        ? "Подтвердить email"
                        : "Продолжить"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          <p className="auth-switch">
            {mode === "login" ? (
              <>
                Еще нет аккаунта? <Link href="/register">Создать</Link>
              </>
            ) : (
              <>
                Уже есть аккаунт? <Link href="/login">Войти</Link>
              </>
            )}
          </p>
          <div className="auth-divider" />
          <Link href="/demo" className="demo-link">
            Сначала посмотреть демо <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </main>
  );
}
