import smtplib
import ssl
from email.message import EmailMessage

from app.core.config import get_settings


def send_email(recipient: str, subject: str, text: str, message_id: str | None = None) -> None:
    s = get_settings()
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = s.mail_from, recipient, subject
    if message_id:
        message["Message-ID"] = "<" + message_id + "@instasurveillance>"
    message.set_content(text)
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
