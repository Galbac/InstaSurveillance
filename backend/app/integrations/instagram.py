import asyncio
import logging
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlparse

import httpx
from aiograpi import Client

from app.core.errors import AppError
from app.domain.analytics import Relationships

SETTINGS_KEYS = {
    "uuids",
    "mid",
    "ig_u_rur",
    "ig_www_claim",
    "authorization_data",
    "cookies",
    "last_login",
    "device_settings",
    "user_agent",
    "country",
    "country_code",
    "locale",
    "timezone_offset",
    "timezone_name",
    "push_disabled",
    "usdid",
}

LOGIN_ENDPOINTS = {
    "com.bloks.www.bloks.caa.login.process_client_data_and_redirect": "caa/prepare",
    "com.bloks.www.caa.login.oauth.token.fetch.async": "caa/oauth",
    "com.bloks.www.bloks.caa.login.async.send_login_request": "caa/login",
}


def response_diagnostic(response: httpx.Response, url: str) -> dict:
    """Keep a closed set of response metadata, never payloads or credentials."""
    path = urlparse(url).path
    endpoint = "other"
    for app, label in LOGIN_ENDPOINTS.items():
        if path.endswith("/" + app + "/"):
            endpoint = label
            break
    else:
        for suffix, label in (
            ("/graphql_www", "device/registration"),
            ("/attestation/create_android_keystore/", "device/attestation"),
            ("/accounts/login/", "accounts/login"),
            ("/accounts/two_factor_login/", "accounts/2fa"),
            ("/accounts/current_user/", "accounts/identity"),
            ("/launcher/sync/", "device/launcher"),
            ("/qe/sync/", "device/password_key"),
            ("/feed/reels_tray/", "feed/reels"),
            ("/feed/timeline/", "feed/timeline"),
        ):
            if path.endswith(suffix):
                endpoint = label
                break
    category = None
    kind = "empty" if not response.content else "non_json"
    if response.content:
        try:
            data = response.json()
            kind = "json"
            if isinstance(data, dict):
                message = data.get("message")
                if isinstance(message, str) and "please wait a few minutes" in message.lower():
                    category = "please_wait_a_few_minutes"
                elif data.get("error_type") in (
                    "bad_password",
                    "needs_upgrade",
                    "rate_limit_error",
                    "sentry_block",
                    "two_factor_required",
                    "challenge_required",
                    "feedback_required",
                ):
                    category = data["error_type"]
        except ValueError:
            pass
    return {
        "endpoint": endpoint,
        "http_status": response.status_code,
        "response_kind": kind,
        "error_category": category,
        "retry_after_present": "Retry-After" in response.headers,
    }


class ProviderError(AppError):
    def __init__(self, code: str, retry_after: int = 0, http_status: int | None = None):
        super().__init__(
            code, "Instagram временно не разрешает выполнить эту операцию", 409, {"retry_after": retry_after}
        )
        if http_status is not None:
            self.details["provider_http_status"] = http_status


def safe_settings(client: Client) -> dict:
    return {k: v for k, v in client.get_settings().items() if k in SETTINGS_KEYS}


def parse_saved_session(raw: str) -> dict:
    """Accept private mobile settings, browser sessionid, or cookie header."""
    import json
    import re
    from urllib.parse import unquote

    if len(raw.encode()) > 65536:
        raise ValueError("Файл сессии слишком большой")
    raw_str = raw.strip()
    if not raw_str:
        raise ValueError("Нужен JSON-файл мобильной сессии или sessionid")

    # 1. Try full instagrapi JSON or custom JSON
    if raw_str.startswith("{"):
        try:
            value = json.loads(raw_str)
            if isinstance(value, dict):
                auth = value.get("authorization_data")
                uuids = value.get("uuids")
                device = value.get("device_settings")
                if (
                    isinstance(auth, dict)
                    and isinstance(auth.get("sessionid"), str)
                    and auth["sessionid"]
                    and str(auth.get("ds_user_id", "")).isdigit()
                    and isinstance(uuids, dict)
                    and all(isinstance(uuids.get(k), str) and uuids[k] for k in ("uuid", "phone_id"))
                    and isinstance(uuids.get("android_device_id") or uuids.get("device_id"), str)
                    and isinstance(device, dict)
                    and device.get("app_version")
                ):
                    return {k: v for k, v in value.items() if k in SETTINGS_KEYS}
                if "sessionid" in value and isinstance(value["sessionid"], str):
                    return _build_session_settings(value["sessionid"], str(value.get("ds_user_id", "")))
        except Exception:
            pass

    # 2. Try Cookie header string or raw sessionid
    sessionid = None
    ds_user_id = ""
    if "sessionid=" in raw_str:
        m = re.search(r"sessionid=([^;\s]+)", raw_str)
        if m:
            sessionid = m.group(1)
        m_uid = re.search(r"ds_user_id=([^;\s]+)", raw_str)
        if m_uid:
            ds_user_id = m_uid.group(1)
    elif not raw_str.startswith("{") and not raw_str.startswith("["):
        sessionid = raw_str

    if not sessionid or len(sessionid) < 20:
        raise ValueError("Нужна сохранённая мобильная сессия или корректный sessionid")

    if not ds_user_id:
        unquoted = unquote(sessionid)
        m_uid = re.search(r"^(\d+)", unquoted)
        if m_uid:
            ds_user_id = m_uid.group(1)

    if not ds_user_id or not ds_user_id.isdigit():
        raise ValueError("Не удалось определить ID пользователя из sessionid")

    return _build_session_settings(sessionid, ds_user_id)


def _build_session_settings(sessionid: str, ds_user_id: str) -> dict:
    if not str(ds_user_id).isdigit():
        raise ValueError("Некорректный ID пользователя в сессии")
    from secrets import token_hex
    from uuid import uuid4

    from aiograpi import config

    # Build a mobile settings document without opening HTTP clients during API validation.
    settings: dict = {
        "uuids": {
            "uuid": str(uuid4()),
            "phone_id": str(uuid4()),
            "android_device_id": "android-" + token_hex(8),
        },
        "device_settings": {**config.DEVICE_SETTINGS, **config.APP_SETTINGS[config.DEFAULT_APP_VERSION]},
    }
    settings["authorization_data"] = {
        "sessionid": sessionid,
        "ds_user_id": str(ds_user_id),
        "should_use_header_over_cookies": True,
    }
    settings["cookies"] = {
        "sessionid": sessionid,
        "ds_user_id": str(ds_user_id),
    }
    return {k: v for k, v in settings.items() if k in SETTINGS_KEYS}


class ControlledClient(Client):
    policy_requests: int = 0
    policy_pages: int = 0
    policy_responses: list[dict]

    async def login_flow(self) -> bool:
        # This service validates identity with account_info() after login.
        # Fetching unrelated feeds can fail after authentication succeeded.
        return True

    async def private_request(
        self,
        endpoint,
        data=None,
        params=None,
        login=False,
        with_signature=True,
        headers=None,
        extra_sig=None,
        domain=None,
    ):
        # Pinned-version seam: bypass library auto-challenge and implicit retries.
        if self.authorization:
            headers = {**(headers or {}), "Authorization": self.authorization}
        self.private_requests_count += 1
        await self._send_private_request(
            endpoint,
            data=data,
            params=params,
            login=login,
            with_signature=with_signature,
            headers=headers,
            extra_sig=extra_sig,
            domain=domain,
        )
        return self.last_json

    async def public_request(
        self,
        url,
        data=None,
        params=None,
        headers=None,
        update_headers=None,
        return_json=False,
        retries_count=None,
        retries_timeout=None,
    ):
        return await self._send_public_request(
            url,
            data=data,
            params=params,
            headers=headers,
            update_headers=update_headers,
            return_json=return_json,
        )

    async def challenge_code_handler(self, username, choice=None, **kwargs):
        # CAA profile-code flows can invoke this directly, bypassing challenge_resolve.
        # Workers have no interactive terminal; manual verification belongs in Instagram.
        raise ProviderError("challenge_required")

    async def change_password_handler(self, username):
        raise ProviderError("challenge_required")

    async def challenge_resolve(self, *args, **kwargs):
        raise ProviderError("challenge_required")


def new_client(
    settings: dict | None,
    budget: int,
    spacing: float,
    check: Callable[[], None],
    mode: str = "connect",
    proxy_url: str | None = None,
) -> ControlledClient:

    for name in ("aiograpi", "private_request", "public_request"):
        logging.getLogger(name).disabled = True

    # aiograpi counts public attempts rather than retries; force exactly one attempt.
    # Only session/device fields may influence client initialization.
    stored = {k: v for k, v in (settings or {}).items() if k in SETTINGS_KEYS}
    if stored.get("uuids", {}).get("device_id") and not stored["uuids"].get("android_device_id"):
        stored["uuids"] = {**stored["uuids"], "android_device_id": stored["uuids"]["device_id"]}
    client = ControlledClient(settings=stored, public_request_retries_count=1, session_retry_total=0)
    client.request_logger.disabled = True
    client.logger.disabled = True
    if proxy_url:
        client.set_proxy(proxy_url)
    client.delay_range = None
    client.policy_responses = []
    count = 0
    last = 0.0
    for session in (client.private, client.public, client.graphql):
        original = session.request

        async def guarded(method, url, _original=original, _session=session, **kwargs):
            nonlocal count, last
            await asyncio.to_thread(check)
            if mode == "sync":
                import re
                from urllib.parse import urlparse

                parsed = urlparse(url)
                if (
                    method.upper() != "GET"
                    or parsed.hostname != "i.instagram.com"
                    or not re.fullmatch(
                        r"/api/v1/(users/[^/]+/info/|friendships/[^/]+/(followers|following)/)", parsed.path
                    )
                ):
                    raise ProviderError("operation_not_allowed")
            if mode == "revoke":
                from urllib.parse import urlparse

                parsed = urlparse(url)
                if (
                    method.upper() != "POST"
                    or parsed.hostname != "i.instagram.com"
                    or parsed.path != "/api/v1/accounts/logout/"
                ):
                    raise ProviderError("operation_not_allowed")
            if count >= budget:
                raise ProviderError("request_budget_exhausted")
            delay = max(0, spacing - (time.monotonic() - last))
            if delay:
                await asyncio.sleep(delay)
            await asyncio.to_thread(check)
            count += 1
            client.policy_requests = count
            last = time.monotonic()
            kwargs["timeout"] = httpx.Timeout(30, connect=10)
            kwargs["follow_redirects"] = False
            # Public Session drops false kwargs, so its default must also deny redirects.
            _session._client.follow_redirects = False
            result = await _original(method, url, **kwargs)
            if mode == "connect":
                client.policy_responses.append(response_diagnostic(result, url))
            if result.status_code == 429:
                # Preserve the actual rejected response for safe diagnostics;
                # otherwise the library still points at the preceding response.
                client.last_response = result
                client.last_json = {}
                try:
                    retry_after = int(result.headers.get("Retry-After", "0"))
                except ValueError:
                    from email.utils import parsedate_to_datetime

                    from app.core.security import now

                    try:
                        retry_after = max(
                            0,
                            int(
                                (parsedate_to_datetime(result.headers["Retry-After"]) - now()).total_seconds()
                            ),
                        )
                    except ValueError, KeyError, TypeError:
                        retry_after = 0
                error = ProviderError("cooldown", retry_after=max(0, retry_after), http_status=429)
                if mode == "connect":
                    error.details.update(provider_responses=client.policy_responses.copy(), requests=count)
                raise error
            if result.status_code >= 500 or 300 <= result.status_code < 400:
                # Stop before upstream can discard a failed pagination cursor and resend.
                client.last_response = result
                client.last_json = {}
                raise ProviderError("provider_unavailable", http_status=result.status_code)
            return result

        session.request = guarded  # pyright: ignore[reportAttributeAccessIssue] -- pinned library passes method, URL and keyword arguments; policy tests cover this seam.
    return client


def classify(error: Exception) -> str:
    if isinstance(error, ProviderError):
        return error.code
    name = type(error).__name__
    if name == "TwoFactorRequired":
        return "awaiting_2fa"
    if name in ("ChallengeRequired", "ChallengeError", "ChallengeUnknownStep", "RecaptchaChallengeForm"):
        return "challenge_required"
    if name in (
        "ClientThrottledError",
        "RateLimitError",
        "PleaseWaitFewMinutes",
        "FeedbackRequired",
        "SentryBlock",
    ):
        return "cooldown"
    if name in ("LoginRequired", "ClientLoginRequired", "PreLoginRequired"):
        return "reconnect_required"
    if name in ("BadPassword", "BadCredentials"):
        return "invalid_credentials"
    return "provider_unavailable"


async def collect(
    client: ControlledClient,
    external_id: str,
    max_members: int,
    progress: Callable[[str, int], None],
    *,
    allow_partial: bool = False,
) -> Relationships:
    if str(client.user_id) != external_id:
        raise ProviderError("identity_mismatch")
    client.policy_pages = 0
    initial = await client.user_info_v1(external_id)
    results = {}
    for relation, method in (
        ("followers", client.user_followers_v1_chunk),
        ("following", client.user_following_v1_chunk),
    ):
        rows = {}
        cursor = ""
        cursors = set()
        while True:
            page, next_cursor = await method(external_id, max_amount=200, max_id=cursor)
            client.policy_pages += 1
            for person in page:
                key = str(person.pk)
                if key in rows:
                    raise ProviderError("inconsistent_snapshot")
                rows[key] = person.username
            if sum(len(x) for x in results.values()) + len(rows) > max_members:
                raise ProviderError("members_limit")
            await asyncio.to_thread(progress, relation, len(rows))
            if not next_cursor:
                break
            if not page or next_cursor in cursors:
                raise ProviderError("incomplete_pagination")
            cursors.add(next_cursor)
            cursor = next_cursor
        results[relation] = rows
    final = await client.user_info_v1(external_id)
    if (initial.follower_count, initial.following_count) != (final.follower_count, final.following_count):
        raise ProviderError("inconsistent_snapshot")
    expected = {"followers": final.follower_count, "following": final.following_count}
    incomplete = any(len(results[key]) != count for key, count in expected.items())
    if incomplete and (
        not allow_partial or any(len(results[key]) > count for key, count in expected.items())
    ):
        raise ProviderError("inconsistent_snapshot")
    return Relationships(
        results["followers"],
        results["following"],
        collection_metadata={
            "expected_followers": expected["followers"],
            "expected_following": expected["following"],
            "followers_completeness": "partial"
            if len(results["followers"]) != expected["followers"]
            else "collection_validated",
            "following_completeness": "partial"
            if len(results["following"]) != expected["following"]
            else "collection_validated",
            "completeness": "partial" if incomplete else "collection_validated",
        },
    )


async def close_client(client: Any) -> None:
    """Close all three transports, including retired and unopened HTTPX clients."""

    async def close_session(session: Any) -> None:
        try:
            await session._close_retired_clients()
        finally:
            await session._client.aclose()

    results = await asyncio.gather(
        *(close_session(session) for session in (client.private, client.public, client.graphql)),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, Exception):
            import structlog

            await structlog.get_logger().awarning(
                "instagram_transport_close_failed",
                error_type=type(result).__name__,
            )


@contextmanager
def client_runtime() -> Iterator[tuple[asyncio.Runner, list[Any]]]:
    """One loop per Celery task; transports never outlive their owning loop."""
    clients: list[Any] = []
    with asyncio.Runner() as runner:
        try:
            yield runner, clients
        finally:
            for client in clients:
                runner.run(close_client(client))
