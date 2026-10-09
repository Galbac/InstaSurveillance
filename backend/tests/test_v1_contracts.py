import asyncio
import io
import json
import zipfile
from types import SimpleNamespace

import pytest
from cryptography.exceptions import InvalidTag

from app.backups import CHUNK, decrypt_stream, encrypt_stream
from app.core.errors import AppError
from app.core.mfa import matching_counter, totp
from app.core.pagination import cursor_decode, cursor_encode
from app.integrations.archive import parse_archive
from app.jobs.exporter import safe_csv


def archive(names=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as writer:
        for name, body in (
            names or {"followers_1.json": [], "following.json": {"relationships_following": []}}
        ).items():
            writer.writestr(name, json.dumps(body))
    return stream.getvalue()


def test_cursor_signed_and_bound_to_filters():
    scope = {"owner": "u1", "category": "followers"}
    cursor = cursor_encode(["alice", "123"], scope)
    assert cursor_decode(cursor, scope) == ["alice", "123"]
    with pytest.raises(AppError):
        cursor_decode(cursor, {**scope, "owner": "u2"})
    with pytest.raises(AppError):
        cursor_decode(cursor, {**scope, "category": "fans"})
    with pytest.raises(AppError):
        cursor_decode(cursor[:-4] + "AAAA", scope)


def test_rfc6238_totp_and_replay_guard():
    seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp(seed, 1) == "287082"
    assert matching_counter(seed, "287082", -1, 59) == 1
    assert matching_counter(seed, "287082", 1, 59) is None


def test_local_email_code_is_only_accepted_in_local_environment(monkeypatch):
    from app.modules import auth

    user = SimpleNamespace(email="owner@example.com", verified=False, id="user-1")
    commits = []

    class FakeDB:
        def __init__(self, return_user):
            self.return_user = return_user

        def scalar(self, _query):
            return user if self.return_user else None

        def execute(self, _query):
            return None

        def commit(self):
            commits.append(True)

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(app_env="local"))
    monkeypatch.setattr(auth, "email_limits", lambda *_args: None)
    auth.verify_email(auth.VerifyEmailInput(token="1234", email="owner@example.com"), None, FakeDB(True))
    assert user.verified is True
    assert commits == [True]

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(app_env="development"))
    with pytest.raises(AppError) as result:
        auth.verify_email(auth.VerifyEmailInput(token="1234", email="owner@example.com"), None, FakeDB(False))
    assert result.value.code == "invalid_token"


def test_registration_reports_existing_address_before_code_in_all_environments(monkeypatch):
    from app.modules import auth

    existing = SimpleNamespace(email="owner@example.com")

    class FakeDB:
        def scalar(self, _query):
            return existing

    settings = SimpleNamespace(app_env="local", terms_version="2026-10-07", privacy_version="2026-10-07")
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    monkeypatch.setattr(auth, "email_limits", lambda *_args: None)
    body = auth.Registration(
        email="owner@example.com",
        password="long-enough-password",
        accepted_terms=True,
    )
    with pytest.raises(AppError) as result:
        auth.register(body, None, FakeDB())
    assert result.value.code == "email_registered"

    settings.app_env = "development"
    with pytest.raises(AppError) as result:
        auth.register(body, None, FakeDB())
    assert result.value.code == "email_registered"


def test_archive_part_gaps_and_nested_zip_rejected():
    for content, code in [
        (
            archive({"followers_2.json": [], "following.json": {"relationships_following": []}}),
            "partial_archive",
        ),
        (archive({"inner.zip": "x"}), "nested_archive"),
    ]:
        with pytest.raises(AppError) as result:
            parse_archive(content, "archive.zip", 5000000, 5000, 100000)
        assert result.value.code == code


def test_archive_depth_and_missing_categories():
    content = archive({"followers_1.json": []})
    with pytest.raises(AppError) as result:
        parse_archive(content, "archive.zip", 5000000, 5000, 100000)
    assert result.value.code == "missing_category"
    with pytest.raises(AppError) as result:
        parse_archive(b"[" * 40 + b"]" * 40, "followers_1.json", 5000000, 5000, 100000)
    assert result.value.code == "json_depth_limit"


def test_archive_display_case_and_provenance():
    report = {}
    content = archive(
        {
            "followers_1.json": [{"string_list_data": [{"value": "Alice.Example"}]}],
            "following.json": {"relationships_following": []},
            "profile.json": {},
        }
    )
    result = parse_archive(content, "archive.zip", 5000000, 5000, 100000, report)
    assert result.followers == {"alice.example": "Alice.Example"}
    assert report["accepted_files"] == ["followers_1.json", "following.json"]
    assert report["ignored_files"] == ["profile.json"]


@pytest.mark.parametrize("value", ["=SUM(A1)", "+cmd", "-1", "@a", "\t=1", "\r=1", "\n=1"])
def test_csv_prevents_formula_injection(value):
    assert safe_csv(value).startswith("'")


def test_backup_authenticated_roundtrip_and_truncation():
    key = b"k" * 32
    source = b"private backup" * (CHUNK // 3)
    encrypted = io.BytesIO()
    encrypt_stream(io.BytesIO(source), encrypted, key)
    payload = encrypted.getvalue()
    assert b"private backup" not in payload
    decoded = io.BytesIO()
    decrypt_stream(io.BytesIO(payload), decoded, key)
    assert decoded.getvalue() == source
    for bad in [payload[:-1], payload[:-60], payload + b"extra"]:
        with pytest.raises((ValueError, InvalidTag)):
            decrypt_stream(io.BytesIO(bad), io.BytesIO(), key)
    changed = bytearray(payload)
    changed[50] ^= 1
    with pytest.raises(InvalidTag):
        decrypt_stream(io.BytesIO(changed), io.BytesIO(), key)


@pytest.fixture
def instagram_runtime(monkeypatch):
    from app.integrations import instagram

    original = instagram.new_client
    with instagram.client_runtime() as (runner, clients):

        def tracked(*args, **kwargs):
            client = original(*args, **kwargs)
            clients.append(client)
            return client

        runner.clients = clients
        monkeypatch.setattr(instagram, "new_client", tracked)
        yield runner


def test_instagram_transport_read_allowlist_budget_and_no_hidden_retry(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    async def fake(session, method, url, **kwargs):
        calls.append((method, url, kwargs))
        response = httpx.Response(200, request=httpx.Request(method, url))
        response.status_code = 200
        response._content = b"{}"
        return response

    monkeypatch.setattr(httpx_ext.Session, "request", fake)
    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", fake)
    client = new_client(None, 2, 0, lambda: None, mode="sync")
    instagram_runtime.run(client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/"))
    with pytest.raises(ProviderError) as error:
        instagram_runtime.run(
            client.private.request("POST", "https://i.instagram.com/api/v1/friendships/create/123/")
        )
    assert error.value.code == "operation_not_allowed"
    instagram_runtime.run(
        client.private.request("GET", "https://i.instagram.com/api/v1/friendships/123/followers/")
    )
    with pytest.raises(ProviderError) as error:
        instagram_runtime.run(client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/"))
    assert error.value.code == "request_budget_exhausted"
    assert len(calls) == 2 and all(not c[2]["follow_redirects"] for c in calls)


def test_instagram_429_stops_at_one_request(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    async def fake(session, method, url, **kwargs):
        calls.append(url)
        response = httpx.Response(200, request=httpx.Request(method, url))
        response.status_code = 429
        response.headers["Retry-After"] = "90000"
        return response

    monkeypatch.setattr(httpx_ext.Session, "request", fake)
    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", fake)
    client = new_client(None, 100, 0, lambda: None, mode="sync")
    with pytest.raises(ProviderError) as error:
        instagram_runtime.run(client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/"))
    assert error.value.code == "cooldown" and error.value.details["retry_after"] == 90000 and len(calls) == 1
    assert error.value.details["provider_http_status"] == 429
    assert client.last_response is not None and client.last_response.status_code == 429
    assert client.last_json == {}


def test_instagram_login_diagnostic_identifies_rejected_step_without_secrets(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    async def fake(session, method, url, **kwargs):
        calls.append(url)
        response = httpx.Response(200, request=httpx.Request(method, url))
        response.status_code = 200 if len(calls) == 1 else 429
        response._content = b'{"message":"Please wait a few minutes", "sessionid":"private-token"}'
        response.headers["Authorization"] = "private-header"
        return response

    monkeypatch.setattr(httpx_ext.Session, "request", fake)
    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", fake)
    client = new_client(None, 30, 0, lambda: None)
    instagram_runtime.run(
        client.private.request(
            "POST",
            "https://b.i.instagram.com/api/v1/bloks/apps/com.bloks.www.bloks.caa.login.process_client_data_and_redirect/",
        )
    )
    with pytest.raises(ProviderError) as error:
        instagram_runtime.run(
            client.private.request(
                "POST",
                "https://b.i.instagram.com/api/v1/bloks/async_action/com.bloks.www.bloks.caa.login.async.send_login_request/?token=private-query",
            )
        )
    diagnostics = error.value.details["provider_responses"]
    assert [(item["endpoint"], item["http_status"]) for item in diagnostics] == [
        ("caa/prepare", 200),
        ("caa/login", 429),
    ]
    assert diagnostics[-1]["error_category"] == "please_wait_a_few_minutes"
    assert error.value.details["requests"] == 2
    assert "private-" not in json.dumps(error.value.details)
    assert len(calls) == 2


def test_instagram_login_does_not_fetch_unrelated_feeds(monkeypatch, instagram_runtime):
    from app.integrations.instagram import new_client

    client = new_client(None, 30, 0, lambda: None)

    def unexpected(*args, **kwargs):
        pytest.fail("Login must not fetch timeline or reels before identity verification")

    monkeypatch.setattr(client, "get_reels_tray_feed", unexpected)
    monkeypatch.setattr(client, "get_timeline_feed", unexpected)
    assert instagram_runtime.run(client.login_flow()) is True
    assert client.policy_requests == 0


def test_instagram_adapter_keeps_upstream_caa_credential_payload(monkeypatch, instagram_runtime):
    from copy import deepcopy
    from uuid import UUID

    import httpx
    from aiograpi import Client, httpx_ext
    from aiograpi.mixins import bloks

    from app.integrations.instagram import new_client

    calls = []

    async def fake(session, method, url, **kwargs):
        calls.append((method, url, deepcopy(kwargs.get("data"))))
        response = httpx.Response(200, request=httpx.Request(method, url))
        response.status_code = 200
        response._content = b'{"status":"ok"}'
        response.request = httpx.Request(method, url)
        return response

    monkeypatch.setattr(httpx_ext.Session, "request", fake)
    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", fake)
    monkeypatch.setattr(bloks, "uuid4", lambda: UUID(int=1))
    monkeypatch.setattr(bloks.time, "time", lambda: 1_700_000_000.0)
    guarded = new_client(None, 30, 0, lambda: None)
    upstream = Client(settings=guarded.get_settings())
    instagram_runtime.clients.append(upstream)
    for client in (upstream, guarded):
        client.caa_aac = "synthetic-context"
        client.caa_waterfall_id = "synthetic-flow"
        instagram_runtime.run(
            client.bloks_caa_login_send_request(
                "#PWD_TEST:synthetic-password", username="synthetic-user", auto_prepare=False
            )
        )
    assert len(calls) == 2
    assert calls[0] == calls[1]


def test_instagram_proxy_routes_private_and_password_key_requests(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import new_client, safe_settings

    calls = []

    async def fake(session, method, url, **kwargs):
        calls.append(session.proxy)
        response = httpx.Response(200, request=httpx.Request(method, url))
        response.status_code = 200
        response._content = b"{}"
        return response

    monkeypatch.setattr(httpx_ext.Session, "request", fake)
    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", fake)
    proxy = "http://synthetic-user:synthetic-password@proxy.example:8080"
    client = new_client(None, 30, 0, lambda: None, proxy_url=proxy)
    instagram_runtime.run(client.private.request("POST", "https://b.i.instagram.com/api/v1/accounts/login/"))
    instagram_runtime.run(client.public.request("GET", "https://i.instagram.com/api/v1/qe/sync/"))
    assert len(calls) == 2
    assert all(route == proxy for route in calls)
    assert proxy not in json.dumps(safe_settings(client))


def test_versioned_encryption_rotates_without_losing_old_records():
    from cryptography.fernet import Fernet, InvalidToken

    from app.core.encryption import VersionedCipher

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    original = VersionedCipher("1", old, {}).encrypt(b"private")
    rotated = VersionedCipher("2", new, {"1": old})
    assert rotated.decrypt(original) == b"private" and rotated.encrypt(b"private").startswith(b"v2:")
    assert rotated.decrypt(Fernet(old.encode()).encrypt(b"legacy")) == b"legacy"
    with pytest.raises(InvalidToken):
        VersionedCipher("2", new, {}).decrypt(original)


def test_own_id_mismatch_is_checked_before_any_instagram_request():
    from app.integrations.instagram import ProviderError, collect

    class Client:
        user_id = "1"

        def user_info_v1(self, value):
            raise AssertionError("Must not request foreign profile")

    with pytest.raises(ProviderError) as error:
        asyncio.run(collect(Client(), "2", 100, lambda *args: None))
    assert error.value.code == "identity_mismatch"


def test_settings_validation_never_prints_secrets():
    from cryptography.fernet import Fernet
    from pydantic import ValidationError

    from app.core.config import Settings

    secret = "TOP-SECRET-PASSWORD"
    with pytest.raises(ValidationError) as result:
        Settings(
            database_url="postgresql://x",
            csrf_secret=secret,
            instagram_pending_encryption_key=Fernet.generate_key().decode(),
            s3_secret_access_key=secret,
        )
    assert secret not in str(result.value)


def test_telemetry_contains_only_allowlisted_technical_fields():
    from app.integrations.telemetry import envelope

    payload = envelope("/profiles/{profile_id}/summary", "OperationalError", "technical-id")
    assert set(payload) == {"event_id", "timestamp", "platform", "level", "release", "exception", "tags"}
    assert "user" not in payload and "request" not in payload and "breadcrumbs" not in payload
    assert payload["exception"]["values"][0]["value"] == "Redacted server error"


def test_unexpected_error_does_not_escape_or_log_exception_values(monkeypatch, capsys):
    from fastapi.testclient import TestClient

    import app.main as main

    class FailedEngine:
        def connect(self):
            raise RuntimeError("SECRET-SQL-PARAMETER")

    failure = FailedEngine()

    async def dispose():
        pass

    failure.dispose = dispose
    monkeypatch.setattr(main, "async_engine", failure)
    with TestClient(main.app) as client:
        response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.headers["X-Request-ID"]
    assert "SECRET-SQL-PARAMETER" not in response.text
    output = capsys.readouterr()
    assert "SECRET-SQL-PARAMETER" not in output.out + output.err


def test_application_logs_are_allowlisted_and_expire(monkeypatch, tmp_path):
    import json
    from datetime import UTC, datetime, timedelta

    from app.core.config import get_settings
    from app.core.logging import prune_logs, whitelist_and_store

    monkeypatch.setenv("LOG_DIRECTORY", str(tmp_path))
    data = whitelist_and_store(
        None,
        "error",
        {
            "event": "technical_failure",
            "error_type": "RuntimeError",
            "password": "never-store",
            "body": "never-store",
        },
    )
    assert set(data) == {"event", "error_type"}
    logs = list(tmp_path.glob("application-*.jsonl"))
    assert json.loads(logs[0].read_text()) == data
    old = tmp_path / (
        "application-"
        + (datetime.now(UTC) - timedelta(days=get_settings().log_retention_days)).date().isoformat()
        + ".jsonl"
    )
    old.write_text("{}\n")
    prune_logs()
    assert not old.exists() and logs[0].exists()


def test_archive_source_timestamp_is_separate_from_observed_time():
    from datetime import UTC, datetime

    content = archive(
        {
            "followers_1.json": [{"string_list_data": [{"value": "Alice", "timestamp": 1700000000}]}],
            "following.json": {"relationships_following": []},
        }
    )
    data = parse_archive(content, "archive.zip", 5000000, 5000, 100000)
    assert data.timestamps["followers:alice"] == datetime.fromtimestamp(1700000000, UTC)


def test_saved_session_requires_mobile_identity_and_does_not_import_route():
    from app.integrations.instagram import parse_saved_session
    from app.modules.data import ConnectInput, parse_connection_session

    session = {
        "authorization_data": {"ds_user_id": "123", "sessionid": "secret-test-session"},
        "uuids": {"uuid": "u", "phone_id": "p", "device_id": "android-test"},
        "device_settings": {"app_version": "449.0.0.52.84"},
        "proxy": "http://untrusted.example",
        "password": "never-import",
    }
    body = ConnectInput(username="owner", session_json=json.dumps(session), accepted_connection_risks=True)
    assert "secret-test-session" not in repr(body)
    saved = parse_connection_session(body)
    assert saved is not None and "proxy" not in saved and "password" not in saved
    assert saved["authorization_data"]["ds_user_id"] == "123"
    for invalid in ("[]", "{}", "not-json", json.dumps({"cookies": {"sessionid": "web"}})):
        with pytest.raises(ValueError):
            parse_saved_session(invalid)
    # Raw sessionid support
    raw_session = "123456789%3AABCDEFGHIJKLM1234567890abcdef"
    saved_raw = parse_saved_session(raw_session)
    assert saved_raw["authorization_data"]["ds_user_id"] == "123456789"
    assert saved_raw["authorization_data"]["sessionid"] == raw_session
    assert "device_settings" in saved_raw and "uuids" in saved_raw

    # Cookie header support
    cookie_str = (
        "mid=xyz; ds_user_id=987654321; sessionid=987654321%3ASOMESESSIONKEY1234567890; csrftoken=123"
    )
    saved_cookie = parse_saved_session(cookie_str)
    assert saved_cookie["authorization_data"]["ds_user_id"] == "987654321"
    assert saved_cookie["authorization_data"]["sessionid"] == "987654321%3ASOMESESSIONKEY1234567890"

    with pytest.raises(ValueError):
        ConnectInput(
            username="owner",
            password="password",
            session_json=json.dumps(session),
            accepted_connection_risks=True,
        )
    with pytest.raises(ValueError):
        ConnectInput(username="owner", accepted_connection_risks=True)


@pytest.mark.parametrize("transport", ["private", "public", "graphql"])
def test_instagram_redirect_cannot_escape_guard(transport, instagram_runtime):
    import httpx

    from app.integrations.instagram import ProviderError, new_client

    client = new_client(None, 3, 0, lambda: None)
    session = getattr(client, transport)
    requests = []

    async def redirect(request):
        requests.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://unexpected.example/"})

    session._client._transport = httpx.MockTransport(redirect)
    session._client._mounts = {}
    with pytest.raises(ProviderError) as error:
        instagram_runtime.run(session.request("GET", "https://i.instagram.com/api/v1/qe/sync/"))
    assert error.value.code == "provider_unavailable"
    assert len(requests) == 1


def test_instagram_failed_cursor_is_not_retried(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    async def failure(session, method, url, **kwargs):
        calls.append(kwargs["params"].copy())
        return httpx.Response(500, request=httpx.Request(method, url))

    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", failure)
    client = new_client(None, 10, 0, lambda: None, mode="sync")
    with pytest.raises(ProviderError):
        instagram_runtime.run(
            client.private_request("friendships/123/followers/", params={"max_id": "page2"})
        )
    assert calls == [{"max_id": "page2"}]
    assert client.policy_requests == 1


def test_instagram_public_request_runs_once_even_with_retry_override(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import new_client

    calls = []

    async def success(session, method, url, **kwargs):
        calls.append(url)
        return httpx.Response(200, json={"status": "ok"}, request=httpx.Request(method, url))

    monkeypatch.setattr(httpx_ext.Session, "request", success)
    client = new_client(None, 10, 0, lambda: None)
    result = instagram_runtime.run(
        client.public_request("https://www.instagram.com/", return_json=True, retries_count=0)
    )
    assert result == {"status": "ok"}
    assert len(calls) == 1


def test_instagram_spacing_can_be_cancelled_without_blocking_loop(monkeypatch, instagram_runtime):
    import httpx
    from aiograpi import httpx_ext

    from app.integrations.instagram import new_client

    async def success(session, method, url, **kwargs):
        return httpx.Response(200, request=httpx.Request(method, url))

    monkeypatch.setattr(httpx_ext.CurlPrivateSession, "request", success)
    client = new_client(None, 10, 60, lambda: None)

    async def scenario():
        url = "https://i.instagram.com/api/v1/users/123/info/"
        await client.private.request("GET", url)
        request = asyncio.create_task(client.private.request("GET", url))
        await asyncio.sleep(0.02)
        assert not request.done()
        request.cancel()
        with pytest.raises(asyncio.CancelledError):
            await request
        assert client.policy_requests == 1

    instagram_runtime.run(asyncio.wait_for(scenario(), timeout=2))


def test_instagram_runtime_closes_all_sessions_on_failure():
    from app.integrations.instagram import client_runtime, new_client

    with pytest.raises(RuntimeError, match="synthetic"):
        with client_runtime() as (_, clients):
            client = new_client(None, 10, 0, lambda: None)
            clients.append(client)
            raise RuntimeError("synthetic")
    assert all(session._client.is_closed for session in (client.private, client.public, client.graphql))


def test_instagram_saved_device_survives_library_migration(instagram_runtime):
    from app.integrations.instagram import new_client, parse_saved_session, safe_settings

    client = new_client(None, 10, 0, lambda: None)
    saved = safe_settings(client)
    saved["authorization_data"] = {"sessionid": "synthetic-session", "ds_user_id": "123"}
    saved["cookies"] = {"sessionid": "synthetic-session", "ds_user_id": "123"}
    parsed = parse_saved_session(json.dumps(saved))
    restored = new_client(parsed, 10, 0, lambda: None)
    assert str(restored.user_id) == "123"
    assert safe_settings(restored)["uuids"] == saved["uuids"]
    legacy = {**saved, "uuids": {**saved["uuids"], "device_id": saved["uuids"]["android_device_id"]}}
    del legacy["uuids"]["android_device_id"]
    converted = new_client(parse_saved_session(json.dumps(legacy)), 10, 0, lambda: None)
    assert converted.android_device_id == client.android_device_id


@pytest.mark.parametrize("scheme", ["socks5", "socks5h"])
def test_instagram_socks_proxy_initializes_without_optional_import_error(scheme, instagram_runtime):
    from app.integrations.instagram import new_client, safe_settings

    proxy = scheme + "://synthetic-user:synthetic-password@proxy.example:1080"
    client = new_client(None, 3, 0, lambda: None, proxy_url=proxy)
    assert all(session.proxy == proxy for session in (client.private, client.public, client.graphql))
    assert proxy not in json.dumps(safe_settings(client))
