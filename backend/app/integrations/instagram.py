import logging
import time
from collections.abc import Callable

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


class ProviderError(AppError):
    def __init__(self, code: str, retry_after: int = 0, http_status: int | None = None):
        super().__init__(
            code, "Instagram временно не разрешает выполнить эту операцию", 409, {"retry_after": retry_after}
        )
        if http_status is not None:
            self.details["provider_http_status"] = http_status


def safe_settings(client) -> dict:
    return {k: v for k, v in client.get_settings().items() if k in SETTINGS_KEYS}


def new_client(
    settings: dict | None, budget: int, spacing: float, check: Callable[[], None], mode: str = "connect"
):
    from instagrapi import Client

    for name in ("instagrapi", "private_request", "public_request"):
        logging.getLogger(name).disabled = True

    class ControlledClient(Client):
        policy_requests: int = 0
        policy_pages: int = 0

        def private_request(
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
            self._send_private_request(
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

        def challenge_resolve(self, *args, **kwargs):
            raise ProviderError("challenge_required")

    client = ControlledClient(settings=settings or {}, public_request_retries_count=0, session_retry_total=0)
    client.private_request_logger.disabled = True
    client.logger.disabled = True
    client.delay_range = None
    count = 0
    last = 0.0
    for session in (client.private, client.public):
        original = session.request

        def guarded(method, url, _original=original, **kwargs):
            nonlocal count, last
            check()
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
                time.sleep(delay)
            check()
            count += 1
            client.policy_requests = count
            last = time.monotonic()
            kwargs["timeout"] = (10, 30)
            kwargs["allow_redirects"] = False
            result = _original(method, url, **kwargs)
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
                raise ProviderError("cooldown", retry_after=max(0, retry_after), http_status=429)
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
    if name in ("LoginRequired", "ClientLoginRequired"):
        return "reconnect_required"
    if name in ("BadPassword", "BadCredentials"):
        return "invalid_credentials"
    return "provider_unavailable"


def collect(
    client, external_id: str, max_members: int, progress: Callable[[str, int], None]
) -> Relationships:
    if str(client.user_id) != external_id:
        raise ProviderError("identity_mismatch")
    client.policy_pages = 0
    initial = client.user_info_v1(external_id)
    results = {}
    for relation, method in (
        ("followers", client.user_followers_v1_chunk),
        ("following", client.user_following_v1_chunk),
    ):
        rows = {}
        cursor = ""
        cursors = set()
        while True:
            page, next_cursor = method(external_id, max_amount=200, max_id=cursor)
            client.policy_pages += 1
            for person in page:
                key = str(person.pk)
                if key in rows:
                    raise ProviderError("inconsistent_snapshot")
                rows[key] = person.username
            if sum(len(x) for x in results.values()) + len(rows) > max_members:
                raise ProviderError("members_limit")
            progress(relation, len(rows))
            if not next_cursor:
                break
            if not page or next_cursor in cursors:
                raise ProviderError("incomplete_pagination")
            cursors.add(next_cursor)
            cursor = next_cursor
        results[relation] = rows
    final = client.user_info_v1(external_id)
    if (
        (initial.follower_count, initial.following_count) != (final.follower_count, final.following_count)
        or len(results["followers"]) != final.follower_count
        or len(results["following"]) != final.following_count
    ):
        raise ProviderError("inconsistent_snapshot")
    return Relationships(results["followers"], results["following"])
