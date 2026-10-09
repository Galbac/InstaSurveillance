import asyncio
import io
import json
import zipfile
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.domain.analytics import Relationships, compare
from app.integrations.archive import parse_archive
from app.integrations.instagram import ProviderError, collect, safe_settings


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as z:
        for name, data in files.items():
            z.writestr(name, json.dumps(data))
    return stream.getvalue()


def record(name):
    return {"string_list_data": [{"value": name}]}


def parse(data):
    return parse_archive(data, "archive.zip", 100000, 100, 1000)


def test_relationships_spec_example():
    a = Relationships({x: x for x in ["anna", "boris", "dasha"]}, {x: x for x in ["anna", "kirill"]})
    b = Relationships({x: x for x in ["anna", "dasha", "elena"]}, {x: x for x in ["anna", "dasha", "kirill"]})
    assert set(b.category("mutual")) == {"anna", "dasha"}
    assert set(b.category("not_following_back")) == {"kirill"}
    assert set(b.category("fans")) == {"elena"}
    assert [(e["username"], e["type"]) for e in compare(a, b) if e["relation"] == "followers"] == [
        ("boris", "removed"),
        ("elena", "added"),
    ]
    assert b.summary()["mutual_rate"] == 66.7


def test_stable_id_rename_is_not_an_unfollow():
    a, b = Relationships({"123": "old.name"}, {}), Relationships({"123": "new.name"}, {})
    assert compare(a, b) == []


def test_empty_ratio_is_unavailable():
    assert Relationships({}, {}).summary()["mutual_rate"] is None


def test_multifile_export_and_normalization():
    result = parse(
        archive(
            {
                "connections/followers_1.json": [record("Anna")],
                "connections/followers_2.json": [record("boris"), record("anna")],
                "connections/following.json": {"relationships_following": [record("anna")]},
            }
        )
    )
    assert set(result.followers) == {"anna", "boris"}
    assert set(result.following) == {"anna"}


@pytest.mark.parametrize(
    "files,code",
    [
        ({"followers_1.json": [record("anna")]}, "missing_category"),
        ({"../followers_1.json": []}, "unsafe_archive"),
        ({"followers_1.json": {}, "following.json": {"relationships_following": []}}, "unsupported_format"),
    ],
)
def test_invalid_export_never_means_zero_followers(files, code):
    with pytest.raises(AppError) as err:
        parse(archive(files))
    assert err.value.code == code


def test_zip_bomb_size_rejected_before_read():
    data = archive({"followers_1.json": [record("anna")], "following.json": {"relationships_following": []}})
    with pytest.raises(AppError, match="archive_limit"):
        parse_archive(data, "archive.zip", 10, 100, 1000)


class FakeClient:
    user_id = "owner"

    async def user_info_v1(self, _):
        return SimpleNamespace(follower_count=2, following_count=1)

    async def user_followers_v1_chunk(self, _, max_amount, max_id):
        if not max_id:
            return [SimpleNamespace(pk="1", username="anna")], "page2"
        return [SimpleNamespace(pk="2", username="boris")], None

    async def user_following_v1_chunk(self, _, max_amount, max_id):
        return [SimpleNamespace(pk="1", username="anna")], None


def test_collect_full_pages_uses_stable_ids():
    result = asyncio.run(collect(FakeClient(), "owner", 100, lambda *_: None))
    assert result.followers == {"1": "anna", "2": "boris"}


def test_partial_pagination_not_published():
    client = FakeClient()

    async def partial(*args, **kwargs):
        return [SimpleNamespace(pk="1", username="anna")], None

    client.user_followers_v1_chunk = partial
    with pytest.raises(ProviderError, match="inconsistent_snapshot"):
        asyncio.run(collect(client, "owner", 100, lambda *_: None))


def test_cannot_collect_another_instagram_owner():
    with pytest.raises(ProviderError, match="identity_mismatch"):
        asyncio.run(collect(FakeClient(), "another-id", 100, lambda *_: None))


def test_explicit_partial_collection_retains_available_records_and_real_counts():
    client = FakeClient()

    async def partial(*args, **kwargs):
        return [SimpleNamespace(pk="1", username="anna")], None

    client.user_followers_v1_chunk = partial
    result = asyncio.run(collect(client, "owner", 100, lambda *_: None, allow_partial=True))
    assert result.followers == {"1": "anna"}
    assert result.following == {"1": "anna"}
    assert result.collection_metadata == {
        "expected_followers": 2,
        "expected_following": 1,
        "followers_completeness": "partial",
        "following_completeness": "collection_validated",
        "completeness": "partial",
    }


def test_partial_collection_still_rejects_changing_profile_counts():
    client = FakeClient()
    calls = 0

    async def changing_info(_):
        nonlocal calls
        calls += 1
        return SimpleNamespace(follower_count=2 if calls == 1 else 3, following_count=1)

    client.user_info_v1 = changing_info
    with pytest.raises(ProviderError, match="inconsistent_snapshot"):
        asyncio.run(collect(client, "owner", 100, lambda *_: None, allow_partial=True))


def test_settings_allowlist_excludes_password_and_code():
    client = SimpleNamespace(
        get_settings=lambda: {
            "cookies": {"sessionid": "s"},
            "password": "secret",
            "verification_code": "123456",
            "pending": {"password": "secret"},
        }
    )
    assert safe_settings(client) == {"cookies": {"sessionid": "s"}}
