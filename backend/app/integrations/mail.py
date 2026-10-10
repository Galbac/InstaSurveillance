import html
import re
import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings


def render_email_html(
    subject: str,
    text: str,
    action_url: str | None = None,
    code: str | None = None,
) -> str:
    escaped_subject = html.escape(subject)

    # Detect code if not provided
    if not code:
        code_match = re.search(r"(?:код(?: подтверждения)?[:\s]+)(\d{4,8})", text, re.IGNORECASE)
        if code_match:
            code = code_match.group(1)

    # Detect action_url if not provided
    if not action_url:
        url_match = re.search(r"https?://[^\s\"'<>]+", text)
        if url_match:
            action_url = url_match.group(0)

    # Clean description paragraphs
    paragraphs = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        # Skip raw url lines if we have action_url button
        if action_url and line == action_url:
            continue
        # Skip raw code lines if we display code badge
        if code and f"Код подтверждения: {code}" in line:
            continue
        paragraphs.append(html.escape(line))

    body_html = "".join(f'<p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 15px; line-height: 1.6;">{p}</p>' for p in paragraphs)

    code_block = ""
    if code:
        code_block = f"""
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
          <tr>
            <td align="center" style="background: linear-gradient(180deg, #1e192f 0%, #171524 100%); border: 1px solid #7c3aed; border-radius: 12px; padding: 20px 24px;">
              <div style="color: #a78bfa; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">Код подтверждения</div>
              <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #ffffff; text-shadow: 0 0 20px rgba(124, 58, 237, 0.4);">{html.escape(code)}</div>
            </td>
          </tr>
        </table>
        """

    button_block = ""
    if action_url:
        btn_label = "Подтвердить email"
        if "reset" in action_url.lower() or "парол" in subject.lower():
            btn_label = "Сбросить пароль"
        elif "confirm" in action_url.lower():
            btn_label = "Подтвердить новый email"

        button_block = f"""
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0 20px 0;">
          <tr>
            <td align="center">
              <a href="{html.escape(action_url)}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35); letter-spacing: 0.3px;">
                {btn_label} &rarr;
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 0 0 20px 0; color: #71717a; font-size: 12px; line-height: 1.5; text-align: center; word-break: break-all;">
          Или скопируйте ссылку в браузер:<br />
          <a href="{html.escape(action_url)}" target="_blank" style="color: #8b5cf6; text-decoration: underline;">{html.escape(action_url)}</a>
        </p>
        """

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escaped_subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #09090b; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #121217; border: 1px solid #272732; border-radius: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
          <!-- Header with Logo -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; text-align: center; border-bottom: 1px solid #1f1f28;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center">
                <tr>
                  <td style="width: 36px; height: 36px; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); border-radius: 10px; text-align: center; vertical-align: middle; color: #ffffff; font-weight: 800; font-size: 16px; box-shadow: 0 0 16px rgba(124,58,237,0.5);">
                    IS
                  </td>
                  <td style="padding-left: 12px; text-align: left;">
                    <div style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #f4f4f5; text-transform: uppercase;">INSTASURVEILLANCE</div>
                    <div style="font-size: 11px; color: #71717a; letter-spacing: 0.5px;">Личное пространство аналитики</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding: 32px 32px 24px 32px;">
              <h1 style="margin: 0 0 16px 0; color: #f4f4f5; font-size: 22px; font-weight: 700; line-height: 1.3; text-align: center;">
                {escaped_subject}
              </h1>

              {body_html}
              {code_block}
              {button_block}

              <!-- Security Note -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #18181f; border-left: 3px solid #7c3aed; border-radius: 8px; padding: 12px 16px; margin-top: 16px;">
                <tr>
                  <td style="color: #71717a; font-size: 12px; line-height: 1.5;">
                    <strong style="color: #a1a1aa;">Безопасность:</strong> Если вы не совершали этот запрос, проигнорируйте письмо. Никому не сообщайте ваш код.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 28px 32px; background-color: #0e0e13; border-top: 1px solid #1f1f28; text-align: center;">
              <p style="margin: 0 0 6px 0; color: #52525b; font-size: 11px;">
                &copy; InstaSurveillance &bull; Автоматический мониторинг изменений и подписок Instagram
              </p>
              <p style="margin: 0; color: #3f3f46; font-size: 10px;">
                Письмо отправлено автоматически, отвечать на него не требуется.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def send_email(
    recipient: str,
    subject: str,
    text: str,
    message_id: str | None = None,
    html: str | None = None,
) -> None:
    s = get_settings()
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = s.mail_from, recipient, subject
    if message_id:
        message["Message-ID"] = "<" + message_id + "@instasurveillance>"
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype="html")

    client = (
        smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15, context=ssl.create_default_context())
        if s.smtp_tls_mode == "ssl"
        else smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
    )
    with client as smtp:
        if s.smtp_tls_mode == "starttls":
            smtp.starttls(context=ssl.create_default_context())
        if s.smtp_username:
            smtp.login(s.smtp_username, s.smtp_password.get_secret_value())
        smtp.send_message(message)
