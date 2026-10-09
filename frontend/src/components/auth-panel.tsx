"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import Brand from "./brand";
import { useQuery } from "@tanstack/react-query";
import { PublicConfig } from "@/lib/workflows";
import { api, post } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { authSchema, type AuthMode as Mode } from "@/lib/form-schemas";
export default function AuthPanel({ mode }: { mode: Mode }) {
  const router = useRouter();
  const config = useQuery({
    queryKey: ["public-config"],
    queryFn: () => api<PublicConfig>("/config/public"),
    staleTime: 60000,
  });
  const form = useForm({
    mode: "onChange",
    resolver: zodResolver(
      authSchema(mode, config.data?.local_email_verification ?? false),
    ),
    defaultValues: {
      email: "",
      password: "",
      confirm_password: "",
      remember: true,
      terms: false,
      verification_code: "",
    },
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const localCodeStep =
    mode === "register" &&
    !!verificationEmail &&
    !!config.data?.local_email_verification;
  useEffect(() => {
    if (mode === "login" && new URLSearchParams(window.location.search).get("verified") === "1") {
      setEmailVerified(true);
    }
  }, [mode]);
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
    verification_code: string;
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
        if (config.data?.local_email_verification) {
          setError("");
          setVerificationEmail(data.email);
          setVerificationCode("");
          form.reset({
            email: "",
            password: "",
            remember: false,
            terms: false,
            verification_code: "",
          });
        } else {
          setMessage(result.message);
        }
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
        await post(
          "/auth/verify-email",
          config.data?.local_email_verification
            ? { token: data.verification_code, email: data.email }
            : { token: rawToken },
        );
        window.history.replaceState(null, "", window.location.pathname);
        router.replace("/login?verified=1");
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
  async function verifyLocalEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(verificationCode)) {
      setError("Введи код из четырёх цифр");
      return;
    }
    setBusy(true);
    try {
      await post("/auth/verify-email", {
        token: verificationCode,
        email: verificationEmail,
      });
      setVerificationEmail("");
      router.replace("/login?verified=1");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось подтвердить email",
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
          <h2>{localCodeStep ? "Подтверди email" : titles[mode]}</h2>
          <p className="muted">
            {localCodeStep
              ? "Введи код подтверждения, чтобы завершить регистрацию."
              : mode === "register"
              ? "Создай личный кабинет для анализа подписок."
              : mode === "login"
                ? "Войди, чтобы увидеть изменения в твоем круге."
                : "Мы поможем продолжить безопасно."}
          </p>
          {emailVerified && (
            <div className="notice success" role="status">
              Email подтверждён. Теперь войди в аккаунт.
            </div>
          )}
          {message ? (
            <div className="notice success" role="status">
              {message}
              <Link
                href={
                  mode === "register" &&
                  config.data?.local_email_verification &&
                  !emailVerified
                    ? "/verify-email"
                    : "/login"
                }
                className="text-link"
              >
                {mode === "register" &&
                config.data?.local_email_verification &&
                !emailVerified
                  ? "Подтвердить email кодом"
                  : "Перейти ко входу"} <ArrowRight size={16} />
              </Link>
            </div>
          ) : localCodeStep ? (
            <form noValidate onSubmit={verifyLocalEmail}>
              <label>
                Код подтверждения
                <input
                  autoFocus
                  value={verificationCode}
                  onChange={(event) =>
                    setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={4}
                  required
                  aria-label="Код подтверждения"
                  placeholder="••••"
                />
              </label>
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <button className="button full" disabled={busy}>
                {busy ? "Проверяем…" : "Подтвердить email"}
                <ArrowRight size={18} />
              </button>
            </form>
          ) : (
            <form noValidate onSubmit={form.handleSubmit(submit)}>
              {(mode !== "verify-email" ||
                config.data?.local_email_verification) &&
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
                    {form.formState.errors.email && (
                      <span
                        id="auth-email-error"
                        className="field-error"
                        role="alert"
                      >
                        {String(form.formState.errors.email.message)}
                      </span>
                    )}
                  </label>
                )}
              {mode === "verify-email" &&
                config.data?.local_email_verification && (
                  <>
                    <label>
                      Код подтверждения
                      <input
                        {...form.register("verification_code")}
                        aria-invalid={
                          !!form.formState.errors.verification_code
                        }
                        aria-describedby={
                          form.formState.errors.verification_code
                            ? "auth-verification_code-error"
                            : undefined
                        }
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={4}
                        placeholder="••••"
                      />
                      {form.formState.errors.verification_code && (
                        <span
                          id="auth-verification_code-error"
                          className="field-error"
                          role="alert"
                        >
                          {String(
                            form.formState.errors.verification_code.message,
                          )}
                        </span>
                      )}
                    </label>
                  </>
                )}
              {["login", "register", "reset-password"].includes(mode) && (
                <label>
                  Пароль
                  <div style={{ position: "relative" }}>
                    <input
                      {...form.register("password")}
                      aria-invalid={!!form.formState.errors.password}
                      aria-describedby={
                        form.formState.errors.password
                          ? "auth-password-error"
                          : undefined
                      }
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      minLength={12}
                      maxLength={256}
                      required
                      placeholder="Не менее 12 символов"
                      style={{ paddingRight: 40 }}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                  {form.formState.errors.password && (
                    <span
                      id="auth-password-error"
                      className="field-error"
                      role="alert"
                    >
                      {String(form.formState.errors.password.message)}
                    </span>
                  )}
                </label>
              )}
              {mode === "register" && (
                <label>
                  Повтори пароль
                  <div style={{ position: "relative" }}>
                    <input
                      {...form.register("confirm_password")}
                      aria-invalid={!!form.formState.errors.confirm_password}
                      aria-describedby={
                        form.formState.errors.confirm_password
                          ? "auth-confirm-password-error"
                          : undefined
                      }
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={256}
                      required
                      placeholder="Повторите пароль"
                      style={{ paddingRight: 40 }}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={showConfirmPassword ? "Скрыть пароль" : "Показать пароль"}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      style={{
                        position: "absolute",
                        right: 12,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                      }}
                    >
                      {showConfirmPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </div>
                  {form.formState.errors.confirm_password && (
                    <span
                      id="auth-confirm-password-error"
                      className="field-error"
                      role="alert"
                    >
                      {String(form.formState.errors.confirm_password.message)}
                    </span>
                  )}
                </label>
              )}
              {mode === "login" && (
                <div className="form-inline">
                  <div>
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
                    {form.formState.errors.remember && (
                      <span
                        id="auth-remember-error"
                        className="field-error"
                        role="alert"
                      >
                        {String(form.formState.errors.remember.message)}
                      </span>
                    )}
                  </div>
                  <Link href="/forgot-password">Забыли пароль?</Link>
                </div>
              )}
              {mode === "register" && (
                <div style={{ margin: "18px 0" }}>
                  <label className="check" style={{ margin: 0 }}>
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
                  {form.formState.errors.terms && (
                    <span
                      id="auth-terms-error"
                      className="field-error"
                      role="alert"
                    >
                      {String(form.formState.errors.terms.message)}
                    </span>
                  )}
                </div>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              {(() => {
                const watchedValues = form.watch();
                const isMissingFields =
                  mode === "login"
                    ? !watchedValues.email?.trim() || !watchedValues.password?.trim()
                    : mode === "register"
                    ? !watchedValues.email?.trim() ||
                      !watchedValues.password?.trim() ||
                      !watchedValues.confirm_password?.trim() ||
                      !watchedValues.terms
                    : mode === "forgot-password"
                    ? !watchedValues.email?.trim()
                    : mode === "reset-password"
                    ? !watchedValues.password?.trim()
                    : mode === "verify-email"
                    ? (config.data?.local_email_verification && (!watchedValues.email?.trim() || !watchedValues.verification_code?.trim()))
                    : false;

                const isDisabled =
                  busy ||
                  Boolean(
                    (["register", "verify-email"].includes(mode) && !config.data) ||
                    isMissingFields
                  );

                return (
                  <button
                    className="button full"
                    disabled={isDisabled}
                  >
                    {busy
                      ? "Подождите…"
                      : mode === "login"
                        ? "Войти"
                        : mode === "register"
                          ? "Создать аккаунт"
                          : mode === "verify-email"
                            ? "Подтвердить email"
                            : mode === "forgot-password"
                              ? "Сбросить пароль"
                              : "Продолжить"}
                    <ArrowRight size={18} />
                  </button>
                );
              })()}
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
