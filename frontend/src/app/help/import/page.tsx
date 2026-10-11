import Link from "next/link";

const exportUrl =
  "https://accountscenter.instagram.com/info_and_permissions/dyi/?theme=dark";

export default function Page() {
  return (
    <main className="public-document archive-guide">
      <p className="archive-guide-back">
        <Link href="/app/imports/new">← Вернуться к загрузке архива</Link>
      </p>
      <span className="archive-guide-kicker">ПОШАГОВАЯ ИНСТРУКЦИЯ</span>
      <h1>Как скачать архив подписчиков Instagram</h1>
      <p className="archive-guide-intro">
        Архив создаётся на стороне Instagram. Вы загружаете его в InstaSurveillance,
        проверяете списки и только после этого сохраняете снимок.
      </p>

      <a
        className="button archive-guide-open"
        href={exportUrl}
        target="_blank"
        rel="noreferrer"
      >
        Открыть экспорт Instagram ↗
      </a>
      <p className="archive-guide-url">
        Официальный адрес: <code>accountscenter.instagram.com/info_and_permissions/dyi/</code>
      </p>

      <ol className="archive-guide-steps">
        <li>
          <strong>Откройте экспорт данных</strong>
          <span>
            Перейдите по кнопке выше. Если Instagram попросит, войдите в нужный
            аккаунт и подтвердите вход.
          </span>
        </li>
        <li>
          <strong>Создайте экспорт на устройство</strong>
          <span>
            Нажмите «Подготовить файлы для экспорта» → «Экспортировать на
            устройство».
          </span>
        </li>
        <li>
          <strong>Оставьте только нужные данные</strong>
          <span>
            В «Выбрать информацию» отметьте «Подписки и подписчики» в разделе
            «Контакты». Остальные категории можно не выбирать.
          </span>
        </li>
        <li>
          <strong>Установите период и формат</strong>
          <span>
            Выберите «Всё время» и формат «JSON». Проверьте, что уведомление о
            готовности отправится на доступную вам почту.
          </span>
        </li>
        <li>
          <strong>Подтвердите запрос и скачайте архив</strong>
          <span>
            Нажмите кнопку подтверждения внизу окна. Когда Instagram сообщит о
            готовности, скачайте ZIP в Центре аккаунтов. По сообщению на экране
            ссылка на скачивание будет доступна четыре дня.
          </span>
        </li>
        <li>
          <strong>Загрузите архив в проект</strong>
          <span>
            Откройте импорт и выберите ZIP. Если загружаете распакованные файлы,
            выберите все части <code>followers_*.json</code> и
            <code> following.json</code> из этой же выгрузки.
          </span>
        </li>
        <li>
          <strong>Проверьте и сохраните снимок</strong>
          <span>
            Сверьте количество и примеры аккаунтов, укажите дату выгрузки,
            подтвердите полноту обоих списков и нажмите «Подтвердить и сохранить
            снимок».
          </span>
        </li>
      </ol>

      <aside className="archive-guide-note">
        Используйте один профиль и одну выгрузку: не смешивайте архивы и файлы
        разных дат. Если подписчики разбиты на части, загрузите все части.
        Нужен именно JSON, не HTML. ZIP не распаковывайте, если загружаете его
        целиком.
      </aside>

      <div className="archive-guide-actions">
        <Link className="button" href="/app/imports/new">
          Перейти к загрузке архива
        </Link>
        <a className="button secondary" href={exportUrl} target="_blank" rel="noreferrer">
          Вернуться к экспорту Instagram ↗
        </a>
      </div>

      <p className="archive-guide-privacy">
        Не отправляйте архив, пароль Instagram, коды подтверждения или cookie в
        поддержку. После обработки исходные файлы удаляются; сохранённый снимок
        и история остаются в проекте, пока вы их не удалите. Первая выгрузка
        показывает текущее состояние и сама по себе не раскрывает прошлые
        отписки.
      </p>
    </main>
  );
}
