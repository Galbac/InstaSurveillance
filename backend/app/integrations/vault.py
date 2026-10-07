"""Bounded best-effort cleanup after the durable local revocation commits."""

from app.core.config import get_settings
from app.core.redis_io import redis_command


def clear_attempts(identities: list[str]) -> None:
    if not identities:
        return
    try:
        redis_command(
            get_settings().auth_vault_url,
            "delete",
            *[prefix + identity for identity in identities for prefix in ("login:", "pending:", "code:")],
        )
    except Exception:
        pass  # Every key has a bounded TTL; generation/status already prevents use.
