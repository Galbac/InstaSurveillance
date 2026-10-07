import hashlib
import hmac
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet

from app.core.async_io import blocking_call
from app.core.config import get_settings

hasher = PasswordHasher()


def now() -> datetime:
    return datetime.now(UTC)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def token() -> str:
    return secrets.token_urlsafe(32)


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return blocking_call(hasher.verify, hashed, raw)
    except VerificationError, InvalidHashError:
        return False


def csrf(session_token: str) -> str:
    return hmac.new(
        get_settings().csrf_secret.get_secret_value().encode(), session_token.encode(), hashlib.sha256
    ).hexdigest()


def cipher(key: str) -> Fernet:
    return Fernet(key.encode())
