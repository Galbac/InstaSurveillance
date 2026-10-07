import { z } from "zod";

export type AuthMode =
  | "login"
  | "register"
  | "verify-email"
  | "forgot-password"
  | "reset-password"
  | "confirm-email-change";
export function authSchema(mode: AuthMode) {
  return z
    .object({
      email: z.string(),
      password: z.string(),
      remember: z.boolean(),
      terms: z.boolean(),
    })
    .superRefine((data, context) => {
      if (
        ["login", "register", "forgot-password"].includes(mode) &&
        !z.email().safeParse(data.email).success
      ) {
        context.addIssue({
          code: "custom",
          path: ["email"],
          message: "Укажи корректный email",
        });
      }
      if (
        ["login", "register", "reset-password"].includes(mode) &&
        (data.password.length < 12 || data.password.length > 256)
      ) {
        context.addIssue({
          code: "custom",
          path: ["password"],
          message: "Пароль должен содержать от 12 до 256 символов",
        });
      }
      if (mode === "register" && !data.terms) {
        context.addIssue({
          code: "custom",
          path: ["terms"],
          message: "Подтверди условия и политику обработки данных",
        });
      }
    });
}
export const settingsSchema = z
  .object({
    theme: z.enum(["light", "dark"]).optional(),
    timezone: z.string().min(1, "Выбери часовой пояс").max(100).optional(),
    current_password: z
      .string()
      .min(1, "Укажи текущий пароль")
      .max(256)
      .optional(),
    password: z
      .string()
      .min(12, "Не менее 12 символов")
      .max(256, "Не более 256 символов")
      .optional(),
    email: z.email("Укажи корректный email").optional(),
    label: z.string().max(80, "Не более 80 символов").optional(),
    interval: z.coerce
      .number()
      .int("Укажи целое число часов")
      .min(1)
      .max(8760)
      .optional(),
  })
  .passthrough();
