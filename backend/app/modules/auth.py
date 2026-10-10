from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Body, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.async_io import blocking_call
from app.core.commands import audit, data_cipher
from app.core.config import get_settings
from app.core.dependencies import DB, UserDep, rate_limit
from app.core.errors import AppError, required
from app.core.router import APIRouter
from app.core.security import csrf, digest, hasher, now, token, verify_password
from app.models import AuthSession, AuthToken, Consent, Outbox, User
from app.modules.contracts import CSRFDTO, MessageDTO, SessionDTO, UserDTO

router = APIRouter(prefix="/api/v1")
DUMMY_HASH = hasher.hash("This is not a usable account password")


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=256)
    remember_me: bool = False


class Registration(Credentials):
    timezone: str = Field(default="UTC", max_length=80)
    accepted_terms: bool
    terms_version: str = "2026-10-07"
    privacy_version: str = "2026-10-07"


class EmailInput(BaseModel):
    email: EmailStr


class TokenInput(BaseModel):
    token: str = Field(min_length=16, max_length=200)


class VerifyEmailInput(BaseModel):
    token: str = Field(min_length=4, max_length=200)
    email: EmailStr | None = None


class ResetInput(TokenInput):
    password: str = Field(min_length=12, max_length=256)


class ChangePassword(BaseModel):
    current_password: str = Field(max_length=256)
    password: str = Field(min_length=12, max_length=256)


class Preferences(BaseModel):
    theme: str = Field(pattern="^(light|dark)$")
    email_notifications: bool
    timezone: str = Field(default="UTC", max_length=80)


def validate_timezone(value: str) -> None:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise AppError("invalid_timezone", "Выберите существующий часовой пояс") from error


def user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "verified": user.verified,
        "theme": user.theme,
        "email_notifications": user.email_notifications,
        "timezone": user.timezone,
        "role": user.role,
        "permissions": ["admin.metadata"] if user.role in ("admin", "support") else [],
    }


def issue_email_token(db, user: User, purpose: str) -> None:
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == purpose))
    raw = token()
    db.add(
        AuthToken(
            user_id=user.id,
            token_hash=digest(raw),
            purpose=purpose,
            expires_at=now() + timedelta(minutes=30) if purpose == "reset" else now() + timedelta(days=1),
        )
    )
    route = "reset-password" if purpose == "reset" else "verify-email"
    # Fragment prevents email tokens appearing in HTTP access logs or referrers.
    url = get_settings().app_base_url + "/" + route + "#token=" + raw
    code = "1234" if (get_settings().app_env == "local" and purpose == "verify") else None
    subject = "Восстановление доступа" if purpose == "reset" else "Подтвердите email"
    body = (
        f"Код подтверждения: {code}\nОткройте ссылку: {url}\nЕсли вы не запрашивали это действие, проигнорируйте письмо."
        if code
        else f"Откройте ссылку: {url}\nЕсли вы не запрашивали это действие, проигнорируйте письмо."
    )
    db.add(
        Outbox(
            kind="email",
            reference=user.id,
            payload={
                "sealed": data_cipher()
                .encrypt(
                    json_payload(
                        {
                            "to": user.email,
                            "subject": subject,
                            "body": body,
                            "action_url": url,
                            "code": code,
                        }
                    )
                )
                .decode()
            },
        )
    )


def email_limits(request: Request, email: str, action: str, maximum: int) -> None:
    rate_limit(action + ":email:" + digest(email.lower()), maximum, 3600)
    rate_limit(action + ":ip:" + (request.client.host if request.client else "unknown"), maximum * 5, 3600)


@router.get("/auth/csrf", response_model=CSRFDTO)
def get_csrf(request: Request, response: Response):
    s = get_settings()
    raw = request.cookies.get(s.session_cookie_name) or request.cookies.get("insta_csrf_seed") or token()
    response.set_cookie(
        "insta_csrf_seed", raw, httponly=True, secure=s.session_cookie_secure, samesite="lax", max_age=3600
    )
    return {"csrf_token": csrf(raw)}


@router.post(
    "/auth/register",
    status_code=202,
    response_model=MessageDTO,
    responses={409: {"description": "Email is already registered"}},
)
def register(body: Registration, request: Request, db: DB):
    settings = get_settings()
    if body.terms_version != settings.terms_version or body.privacy_version != settings.privacy_version:
        raise AppError("consent_version_changed", "Условия обновились. Обновите страницу и подтвердите их")
    if not body.accepted_terms:
        raise AppError("terms_required", "Примите условия сервиса")
    email = str(body.email).lower()
    email_limits(request, email, "register", 5)
    existing = db.scalar(select(User).where(User.email == email))
    if existing:
        raise AppError(
            "email_registered", "Аккаунт с таким email уже существует. Войди или укажи другой адрес.", 409
        )
    validate_timezone(body.timezone)
    user = User(timezone=body.timezone, email=email, password_hash=blocking_call(hasher.hash, body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise AppError(
            "email_registered", "Аккаунт с таким email уже существует. Войди или укажи другой адрес.", 409
        ) from error
    db.add_all(
        [
            Consent(user_id=user.id, purpose="terms", version=body.terms_version),
            Consent(user_id=user.id, purpose="privacy", version=body.privacy_version),
        ]
    )
    audit(db, user.id, "user.register", user.id, request.state.request_id)
    issue_email_token(db, user, "verify")
    db.commit()
    return {"message": "Аккаунт создан. Проверь почту, чтобы подтвердить адрес."}


@router.post("/auth/login", response_model=UserDTO)
def login(body: Credentials, request: Request, response: Response, db: DB):
    email = str(body.email).lower()
    rate_limit("login:ip:" + (request.client.host if request.client else "unknown"), 30, 900)
    rate_limit("login:email:" + digest(email), 5, 900)
    user = db.scalar(select(User).where(User.email == email))
    valid = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid or user.status != "active":
        raise AppError("invalid_credentials", "Неверный email или пароль", 401)
    s, raw = get_settings(), token()
    lifespan = min(2592000 if body.remember_me else s.session_ttl_seconds, s.session_absolute_ttl_seconds)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=digest(raw),
            expires_at=now() + timedelta(seconds=lifespan),
            last_seen=now(),
            device=device_label(request),
        )
    )
    db.commit()
    response.set_cookie(
        s.session_cookie_name,
        raw,
        max_age=lifespan,
        httponly=True,
        secure=s.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return user_dict(user)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: DB):
    s = get_settings()
    db.execute(
        delete(AuthSession).where(
            AuthSession.token_hash == digest(request.cookies.get(s.session_cookie_name, ""))
        )
    )
    db.commit()
    response.delete_cookie(s.session_cookie_name, path="/")
    response.delete_cookie("insta_csrf_seed", path="/")


@router.post("/auth/verify-email", status_code=204)
def verify_email(body: VerifyEmailInput, request: Request, db: DB):
    settings = get_settings()
    if settings.app_env == "local" and body.token == "1234" and body.email:
        email = str(body.email).lower()
        email_limits(request, email, "verify", 10)
        user = db.scalar(select(User).where(User.email == email).with_for_update())
        if not user or user.verified:
            raise AppError("invalid_token", "Код недействителен или email уже подтвержден")
        user.verified = True
        db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == "verify"))
        db.commit()
        return
    entry = db.scalar(
        select(AuthToken)
        .where(
            AuthToken.token_hash == digest(body.token),
            AuthToken.purpose == "verify",
            AuthToken.expires_at > now(),
        )
        .with_for_update()
    )
    if not entry:
        message = (
            "Неверный код подтверждения" if len(body.token) <= 8 else "Ссылка недействительна или истекла"
        )
        raise AppError("invalid_token", message)
    required(db.get(User, entry.user_id), "invalid_token").verified = True
    db.delete(entry)
    db.commit()


class ResendVerificationInput(BaseModel):
    email: str | None = None


@router.post("/auth/forgot-password", status_code=202, response_model=MessageDTO)
def forgot(body: EmailInput, request: Request, db: DB):
    email_limits(request, str(body.email), "reset", 3)
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    if not user:
        raise AppError("user_not_found", "Аккаунт с таким email не найден", 404)
    issue_email_token(db, user, "reset")
    db.commit()
    return {"message": "Письмо для сброса пароля отправлено на указанную почту"}


@router.post("/auth/resend-verification", status_code=202, response_model=MessageDTO)
def resend(request: Request, db: DB, body: ResendVerificationInput = Body(default_factory=ResendVerificationInput)):
    user = None
    if body.email:
        user = db.scalar(select(User).where(User.email == str(body.email).strip().lower()))
        if not user:
            raise AppError("user_not_found", "Аккаунт с таким email не найден", 404)
    else:
        s = get_settings()
        raw = request.cookies.get(s.session_cookie_name, "")
        if raw:
            session = db.scalar(
                select(AuthSession).where(AuthSession.token_hash == digest(raw), AuthSession.expires_at > now())
            )
            if session:
                user = db.get(User, session.user_id)
    if not user:
        raise AppError("unauthenticated", "Войдите в аккаунт или укажите email", 401)
    email_limits(request, user.email, "verify", 5)
    if not user.verified:
        issue_email_token(db, user, "verify")
        db.commit()
    return {"message": "Код подтверждения отправлен повторно"}


@router.post("/auth/reset-password", status_code=204)
def reset(body: ResetInput, db: DB):
    entry = db.scalar(
        select(AuthToken)
        .where(
            AuthToken.token_hash == digest(body.token),
            AuthToken.purpose == "reset",
            AuthToken.expires_at > now(),
        )
        .with_for_update()
    )
    if not entry:
        raise AppError("invalid_token", "Ссылка недействительна или истекла")
    required(db.get(User, entry.user_id), "invalid_token").password_hash = blocking_call(
        hasher.hash, body.password
    )
    db.execute(delete(AuthSession).where(AuthSession.user_id == entry.user_id))
    db.delete(entry)
    db.commit()


@router.get("/me", response_model=UserDTO)
def me(user: UserDep):
    return user_dict(user)


@router.patch("/me", response_model=UserDTO)
def preferences(body: Preferences, user: UserDep, db: DB):
    validate_timezone(body.timezone)
    user.theme, user.email_notifications, user.timezone = body.theme, body.email_notifications, body.timezone
    user.notification_settings = {**user.notification_settings, "email_results": body.email_notifications}
    db.commit()
    return user_dict(user)


@router.post("/me/change-password", status_code=204)
def change(body: ChangePassword, request: Request, user: UserDep, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise AppError("invalid_credentials", "Неверный текущий пароль", 401)
    user.password_hash = blocking_call(hasher.hash, body.password)
    db.execute(
        delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != request.state.session_id)
    )
    db.commit()


@router.get("/me/sessions", response_model=list[SessionDTO])
def sessions(user: UserDep, request: Request, db: DB):
    return [
        {
            "id": x.id,
            "created_at": x.created_at,
            "expires_at": x.expires_at,
            "current": x.id == request.state.session_id,
            "device": x.device,
            "last_seen": x.last_seen,
        }
        for x in db.scalars(
            select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at > now())
        )
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke(session_id: str, user: UserDep, db: DB):
    db.execute(delete(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user.id))
    db.commit()


class EmailChange(BaseModel):
    email: EmailStr
    current_password: str = Field(max_length=256)


def device_label(request: Request) -> str:
    agent = request.headers.get("user-agent", "")
    browser = next(
        (label for label in ("Firefox", "Edg", "Chrome", "Safari") if label in agent), "Другой браузер"
    )
    device = "телефон" if any(x in agent for x in ("Mobile", "Android", "iPhone")) else "компьютер"
    return browser + " · " + device


@router.post("/me/email-change", status_code=202, response_model=MessageDTO)
def change_email(body: EmailChange, request: Request, user: UserDep, db: DB):
    if not verify_password(body.current_password, user.password_hash):
        raise AppError("invalid_credentials", "Неверный текущий пароль", 401)
    email_limits(request, str(body.email), "email-change", 3)
    email = str(body.email).lower()
    if email == user.email or db.scalar(select(User.id).where(User.email == email)):
        raise AppError("email_unavailable", "Адрес недоступен для смены", 409)
    db.execute(delete(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == "email-change"))
    raw = token()
    db.add(
        AuthToken(
            user_id=user.id,
            token_hash=digest(raw),
            purpose="email-change",
            target_email=email,
            expires_at=now() + timedelta(minutes=30),
        )
    )
    db.add(
        Outbox(
            kind="email",
            reference=user.id,
            payload={
                "sealed": data_cipher()
                .encrypt(
                    json_payload(
                        {
                            "to": email,
                            "subject": "Подтвердите новый email",
                            "body": get_settings().app_base_url + "/confirm-email-change#token=" + raw,
                        }
                    )
                )
                .decode()
            },
        )
    )
    audit(db, user.id, "user.email_change_requested", user.id, request.state.request_id)
    db.commit()
    return {"message": "Подтвердите новый адрес по ссылке в письме"}


def json_payload(value: dict) -> bytes:
    import json

    return json.dumps(value, ensure_ascii=False).encode()


@router.post("/me/email-change/confirm", status_code=204)
def confirm_email_change(body: TokenInput, db: DB, request: Request):
    entry = db.scalar(
        select(AuthToken)
        .where(
            AuthToken.token_hash == digest(body.token),
            AuthToken.purpose == "email-change",
            AuthToken.expires_at > now(),
        )
        .with_for_update()
    )
    if not entry:
        raise AppError("invalid_token", "Ссылка недействительна или истекла")
    user = db.get(User, entry.user_id)
    if (
        not user
        or not entry.target_email
        or user.status != "active"
        or db.scalar(select(User.id).where(User.email == entry.target_email))
    ):
        raise AppError("email_unavailable", "Адрес недоступен для смены", 409)
    previous_email = user.email
    user.email, user.verified = entry.target_email, True
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.delete(entry)
    db.add(
        Outbox(
            kind="email",
            reference=user.id,
            payload={
                "sealed": data_cipher()
                .encrypt(
                    json_payload(
                        {
                            "to": previous_email,
                            "subject": "Email аккаунта изменён",
                            "body": "Если это сделали не вы, обратитесь в поддержку.",
                        }
                    )
                )
                .decode()
            },
        )
    )
    audit(db, user.id, "user.email_changed", user.id, request.state.request_id)
    db.commit()


@router.post("/me/sessions/revoke-others", status_code=204)
def revoke_others(request: Request, user: UserDep, db: DB):
    db.execute(
        delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != request.state.session_id)
    )
    audit(db, user.id, "session.revoke_others", user.id, request.state.request_id)
    db.commit()


class NotificationPreferences(BaseModel):
    email_results: bool = False
    email_connection: bool = False
    email_support: bool = False
    in_app_results: bool = True
    in_app_connection: bool = True


@router.get("/me/notification-settings", response_model=NotificationPreferences)
def notification_settings(user: UserDep):
    settings = dict(user.notification_settings or {})
    if "email_results" not in settings:
        settings["email_results"] = user.email_notifications
    return NotificationPreferences(**settings)


@router.patch("/me/notification-settings", response_model=NotificationPreferences)
def set_notification_settings(body: NotificationPreferences, user: UserDep, db: DB):
    user.notification_settings = body.model_dump()
    user.email_notifications = body.email_results
    db.commit()
    return body
