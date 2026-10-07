# UI: стек, формы и приёмка

## Реализованный стек

Next.js 16.4/React 19.3, Tailwind CSS 4.3.3, Radix Dialog 1.2.0, Lucide, React Hook Form 7.89.0, Zod 4.6.5 и resolver 5.9.1.

- Tailwind подключён официальным PostCSS plugin. Theme и utilities сочетаются с предметными CSS компонентов; Preflight не подключается, чтобы не менять текущие базовые правила оформления. Utility classes компилируются, используются в компонентах. Цвета и тема остаются в CSS variables.
- Общий Modal использует Radix Portal/Overlay/Content/Title/Close: modal focus scope, Escape/outside close, фокус на кнопке закрытия и возврат на доступный исходный элемент. Диалог и mobile filter sheet используют этот компонент.
- AuthPanel: React Hook Form и Zod проверяют email, границы пароля и согласие; field errors связаны с полями через aria. API остаётся источником обязательной проверки.
- ActionForm настроек использует FormProvider/RHF/Zod и общие FormInput/FormSelect. Поддерживаются тема, timezone, пароль, email, профиль и уведомления; checkbox values сохраняются. Специальные формы upload/2FA/операторских команд сохраняют свои предметные состояния и серверную проверку.
- Новые поля следует добавлять в общий слой форм; валидаторы не должны включать исходные значения пароля/токена в ошибки или telemetry.

Версии stable и peer dependencies проверены в official npm registry 7 октября 2026. Radix и RHF поддерживают React 19; RHF требует Node >=18, Docker использует Node 24; resolver поддерживает Zod 4 и RHF >=7.55. Остальные direct versions сохранены. npm ci, unit, lint, typecheck и production build выполнены; native dependencies Tailwind проверены сборкой на Alpine.

Официальные источники: [Tailwind/Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog), [RHF/Zod resolver](https://github.com/react-hook-form/resolvers).

## Browser/device приёмка

Автоматические unit checks не подтверждают визуальную адаптивность и управление фокусом. Browser runtime не предоставил подключённый браузер.

Проверить и записать конкретные браузеры/устройства:

1. 320/360/390/768/1024/1440 px: регистрация, кабинет, people filters, сравнения, аналитика, настройки, admin. Отсутствие горизонтального скролла всей страницы, доступность действий/ошибок; таблицы прокручиваются внутри своего контейнера.
2. Клавиатура: Tab/Shift+Tab остаются в открытом диалоге; Escape, кнопка Close и overlay закрывают его; фокус возвращается на инициатор. Title объявляется screen reader.
3. Text zoom 200%, contrast light/dark, reduced motion, длинные username/ошибки. Mobile filter sheet доступен с экранной клавиатурой и safe area.
4. Auth/settings: пустое поле, неверный email, короткий/длинный пароль, отказ от consent, server errors, повтор отправки, checkbox/number/select, автозаполнение менеджером паролей. После успеха секретные поля очищаются/форма закрывается.
5. URL фильтров: reload/back/forward; отмена старых fetch при смене фильтра; выбранные файлы и upload переживают уведомление об обновлении PWA.
6. Android Chrome и iOS Safari: установка, самостоятельный запуск, offline fallback без личных списков, waiting update → явное обновление → возврат в рабочий интерфейс.

Пункты не отмечать PASS без соответствующей проверки. Публичный HTTP probe проверяет assets/headers, не выполняет эти сценарии.
