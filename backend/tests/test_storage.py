import io
from types import SimpleNamespace

import pytest

from app.integrations import storage


def test_multipart_is_bounded_and_encrypted(monkeypatch):
    calls = []

    class Client:
        def create_multipart_upload(self, **kw):
            calls.append(("create", kw))
            return {"UploadId": "synthetic"}

        def upload_part(self, **kw):
            assert len(kw["Body"]) <= 8 * 1024 * 1024
            calls.append(("part", len(kw["Body"])))
            return {"ETag": "synthetic"}

        def complete_multipart_upload(self, **kw):
            calls.append(("complete", len(kw["MultipartUpload"]["Parts"])))

        def abort_multipart_upload(self, **kw):
            calls.append(("abort", None))

    monkeypatch.setattr(
        storage,
        "get_settings",
        lambda: SimpleNamespace(
            storage_backend="s3",
            s3_bucket="private",
            s3_server_side_encryption="AES256",
            s3_kms_key_id="",
            storage_write_timeout_seconds=300,
        ),
    )
    monkeypatch.setattr(storage, "client", Client)
    storage.put_stream("export/synthetic", io.BytesIO(b"x" * (9 * 1024 * 1024)), 9 * 1024 * 1024)
    assert calls[0][1]["ServerSideEncryption"] == "AES256"
    assert calls[-1] == ("complete", 2)
    calls.clear()

    def canceled():
        raise RuntimeError("canceled")

    with pytest.raises(RuntimeError):
        storage.put_stream(
            "export/synthetic", io.BytesIO(b"x" * (9 * 1024 * 1024)), 9 * 1024 * 1024, check=canceled
        )
    assert calls[-1][0] == "abort" and not any(x[0] == "complete" for x in calls)


def test_storage_key_cannot_escape_private_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "get_settings", lambda: SimpleNamespace(storage_directory=str(tmp_path)))
    for key in ("../other", "/etc/passwd", "."):
        with pytest.raises(ValueError):
            storage.local_path(key)
