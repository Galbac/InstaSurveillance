import json

from sqlalchemy import select

from app.core.commands import data_cipher
from app.core.config import get_settings
from app.models import Notification, Outbox, User


def notify(db, user_id: str, kind: str, title: str, body: str, link: str, event_key: str) -> None:
    user = db.get(User, user_id)
    if not user or user.status != "active":
        return
    key = user_id + ":" + event_key
    if db.scalar(select(Notification.id).where(Notification.event_key == key)):
        return
    preferences = user.notification_settings or {}
    # Keep a deduplication row even when the user opted out of visible notification; channel flags are separate.
    if preferences.get("in_app_" + kind, True):
        db.add(Notification(user_id=user_id, kind=kind, title=title, body=body, link=link, event_key=key))
    email_enabled = preferences.get("email_" + kind, user.email_notifications if kind == "results" else False)
    if get_settings().enable_email_notifications and email_enabled:
        mail_key = key + ":email"
        if not db.scalar(select(Outbox.id).where(Outbox.event_key == mail_key)):
            payload = {
                "to": user.email,
                "subject": title,
                "body": body + "\n" + get_settings().app_base_url + link,
            }
            db.add(
                Outbox(
                    kind="email",
                    reference=user_id,
                    event_key=mail_key,
                    payload={"sealed": data_cipher().encrypt(json.dumps(payload).encode()).decode()},
                )
            )
