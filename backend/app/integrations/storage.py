from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import get_settings


def client(*, probe: bool = False):
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint,
        region_name=s.s3_region,
        aws_access_key_id=s.s3_access_key_id,
        aws_secret_access_key=s.s3_secret_access_key.get_secret_value(),
        config=Config(
            connect_timeout=2 if probe else 10,
            read_timeout=2 if probe else 30,
            retries={"mode": "standard", "total_max_attempts": 1 if probe else 3},
        ),
    )


def local_path(key: str) -> Path:
    root = Path(get_settings().storage_directory).resolve()
    target = (root / key).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError("Invalid storage key")
    return target


def put(key: str, content: bytes) -> None:
    s = get_settings()
    if s.storage_backend == "filesystem":
        path = local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(0o600)
        return
    c = client()
    try:
        c.head_bucket(Bucket=s.s3_bucket)
    except ClientError as e:
        if e.response["Error"]["Code"] not in ("404", "NoSuchBucket"):
            raise
        c.create_bucket(Bucket=s.s3_bucket)
    c.put_object(Bucket=s.s3_bucket, Key=key, Body=content, **encryption_arguments())


def read(key: str) -> bytes:
    s = get_settings()
    if s.storage_backend == "filesystem":
        with local_path(key).open("rb") as stream:
            return stream.read(s.max_upload_bytes + 1)
    c = client()
    response = c.get_object(Bucket=s.s3_bucket, Key=key)
    try:
        return response["Body"].read(s.max_upload_bytes + 1)
    finally:
        response["Body"].close()


def remove(key: str) -> None:
    if get_settings().storage_backend == "filesystem":
        local_path(key).unlink(missing_ok=True)
        return
    settings = get_settings()
    c = client()
    # Abort abandoned parts too: deleting a completed object alone does not remove multipart uploads.
    for page in c.get_paginator("list_multipart_uploads").paginate(Bucket=settings.s3_bucket, Prefix=key):
        for entry in page.get("Uploads", []):
            if entry["Key"] == key:
                c.abort_multipart_upload(Bucket=settings.s3_bucket, Key=key, UploadId=entry["UploadId"])
    c.delete_object(Bucket=settings.s3_bucket, Key=key)


class DeadlineStream:
    def __init__(self, stream, check=None):
        from time import monotonic

        self.stream, self.check = stream, check
        self.deadline = monotonic() + get_settings().storage_write_timeout_seconds
        self.last_check = 0.0

    def read(self, size=-1):
        from time import monotonic

        from app.core.errors import AppError

        current = monotonic()
        if current > self.deadline:
            raise AppError("storage_unavailable", "Истекло время записи файла", 503)
        if self.check and current - self.last_check > 1:
            self.check()
            self.last_check = current
        return self.stream.read(size)

    def tell(self):
        return self.stream.tell()

    def seek(self, offset, whence=0):
        return self.stream.seek(offset, whence)


def encryption_arguments():
    settings = get_settings()
    return (
        {
            "ServerSideEncryption": settings.s3_server_side_encryption,
            **({"SSEKMSKeyId": settings.s3_kms_key_id} if settings.s3_kms_key_id else {}),
        }
        if settings.s3_server_side_encryption
        else {}
    )


def put_stream(key: str, stream, size: int, check=None) -> None:
    s = get_settings()
    stream.seek(0)
    bounded = DeadlineStream(stream, check)
    if s.storage_backend == "filesystem":
        from shutil import copyfileobj

        path = local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("wb") as target:
            copyfileobj(bounded, target, length=1024 * 1024)
        path.chmod(0o600)
        return
    c = client()
    if size <= 8 * 1024 * 1024:
        c.put_object(Bucket=s.s3_bucket, Key=key, Body=bounded, ContentLength=size, **encryption_arguments())
        return
    upload = c.create_multipart_upload(Bucket=s.s3_bucket, Key=key, **encryption_arguments())
    identity = upload["UploadId"]
    try:
        parts = []
        while chunk := bounded.read(8 * 1024 * 1024):
            index = len(parts) + 1
            result = c.upload_part(
                Bucket=s.s3_bucket, Key=key, UploadId=identity, PartNumber=index, Body=chunk
            )
            parts.append({"ETag": result["ETag"], "PartNumber": index})
        if check:
            check()
        c.complete_multipart_upload(
            Bucket=s.s3_bucket, Key=key, UploadId=identity, MultipartUpload={"Parts": parts}
        )
    except BaseException:
        try:
            c.abort_multipart_upload(Bucket=s.s3_bucket, Key=key, UploadId=identity)
        except Exception:
            pass
        raise


def write_finished(key: str) -> None:
    from sqlalchemy import select

    from app.core.db import SessionLocal
    from app.models import FileObject

    try:
        with SessionLocal() as db:
            record = db.scalar(select(FileObject).where(FileObject.key == key).with_for_update())
            if record:
                record.writing_until = None
                db.commit()
    except Exception:
        # A durable deadline lets maintenance recover even if the process/database dies here.
        pass


def open_spooled(key: str, max_bytes: int):
    """Caller must close the returned file. Memory is bounded to 1 MiB."""
    import tempfile

    target = tempfile.SpooledTemporaryFile(max_size=1024 * 1024)
    source = (
        local_path(key).open("rb")
        if get_settings().storage_backend == "filesystem"
        else client().get_object(Bucket=get_settings().s3_bucket, Key=key)["Body"]
    )
    count = 0
    try:
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            if count > max_bytes:
                from app.core.errors import AppError

                raise AppError("storage_limit", "Превышен размер файла")
            target.write(chunk)
        target.seek(0)
        return target
    except Exception:
        target.close()
        raise
    finally:
        source.close()


def iter_object(key: str):
    source = (
        local_path(key).open("rb")
        if get_settings().storage_backend == "filesystem"
        else client().get_object(Bucket=get_settings().s3_bucket, Key=key)["Body"]
    )
    try:
        while chunk := source.read(65536):
            yield chunk
    finally:
        source.close()
