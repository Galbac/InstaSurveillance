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


def test_instagram_transport_read_allowlist_budget_and_no_hidden_retry(monkeypatch):
    import requests

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    def fake(session, method, url, **kwargs):
        calls.append((method, url, kwargs))
        response = requests.Response()
        response.status_code = 200
        response._content = b"{}"
        return response

    monkeypatch.setattr(requests.sessions.Session, "request", fake)
    client = new_client(None, 2, 0, lambda: None, mode="sync")
    client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/")
    with pytest.raises(ProviderError) as error:
        client.private.request("POST", "https://i.instagram.com/api/v1/friendships/create/123/")
    assert error.value.code == "operation_not_allowed"
    client.private.request("GET", "https://i.instagram.com/api/v1/friendships/123/followers/")
    with pytest.raises(ProviderError) as error:
        client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/")
    assert error.value.code == "request_budget_exhausted"
    assert len(calls) == 2 and all(not c[2]["allow_redirects"] for c in calls)


def test_instagram_429_stops_at_one_request(monkeypatch):
    import requests

    from app.integrations.instagram import ProviderError, new_client

    calls = []

    def fake(session, method, url, **kwargs):
        calls.append(url)
        response = requests.Response()
        response.status_code = 429
        response.headers["Retry-After"] = "90000"
        return response

    monkeypatch.setattr(requests.sessions.Session, "request", fake)
    client = new_client(None, 100, 0, lambda: None, mode="sync")
    with pytest.raises(ProviderError) as error:
        client.private.request("GET", "https://i.instagram.com/api/v1/users/123/info/")
    assert error.value.code == "cooldown" and error.value.details["retry_after"] == 90000 and len(calls) == 1
    assert error.value.details["provider_http_status"] == 429


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
        collect(Client(), "2", 100, lambda *args: None)
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
