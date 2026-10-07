"""RFC 6238 TOTP, replay protection is enforced by the locked database row."""

import base64
import hashlib
import hmac
import secrets
import struct
import time


def new_seed() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode()


def totp(seed: str, counter: int) -> str:
    raw = hmac.new(base64.b32decode(seed), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = raw[-1] & 15
    value = struct.unpack(">I", raw[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1000000:06d}"


def matching_counter(seed: str, code: str, last_counter: int, timestamp: float | None = None) -> int | None:
    current = int((timestamp if timestamp is not None else time.time()) // 30)
    for counter in (current, current - 1, current + 1):
        if counter > last_counter and hmac.compare_digest(totp(seed, counter), code):
            return counter
    return None
