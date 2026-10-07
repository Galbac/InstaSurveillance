"""Independent encrypted deletion ledger, intentionally outside database backup volumes."""

import json
from pathlib import Path

import boto3
from botocore.config import Config

from app.core.commands import data_cipher
from app.core.config import get_settings
from app.core.security import now


def ledger_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.ledger_s3_endpoint or settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.ledger_s3_access_key_id,
        aws_secret_access_key=settings.ledger_s3_secret_access_key.get_secret_value(),
        config=Config(
            connect_timeout=3, read_timeout=10, retries={"mode": "standard", "total_max_attempts": 2}
        ),
    )


def record(request_id: str, target_type: str, target_id: str, *, cutoff: str | None = None) -> None:
    settings = get_settings()
    content = data_cipher().encrypt(
        json.dumps(
            {
                "id": request_id,
                "target_type": target_type,
                "target_id": target_id,
                "created_at": now().isoformat(),
                **({"cutoff": cutoff} if cutoff else {}),
            }
        ).encode()
    )
    key = "deletions/" + request_id + ".bin"
    if settings.app_env == "production":
        ledger_client().put_object(Bucket=settings.ledger_s3_bucket, Key=key, Body=content)
    else:
        path = Path(settings.ledger_directory) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic replacement and fsync before API acknowledges revocation.
        temporary = path.with_suffix(".tmp")
        with temporary.open("wb") as file:
            file.write(content)
            file.flush()
            import os

            os.fsync(file.fileno())
        temporary.chmod(0o600)
        temporary.replace(path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def records():
    settings = get_settings()
    if settings.app_env == "production":
        client = ledger_client()
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=settings.ledger_s3_bucket, Prefix="deletions/"):
            for entry in page.get("Contents", []):
                body = client.get_object(Bucket=settings.ledger_s3_bucket, Key=entry["Key"])["Body"]
                try:
                    yield json.loads(data_cipher().decrypt(body.read(65536)))
                finally:
                    body.close()
    else:
        for path in (Path(settings.ledger_directory) / "deletions").glob("*.bin"):
            yield json.loads(data_cipher().decrypt(path.read_bytes()))


def prune() -> None:
    from datetime import datetime, timedelta

    cutoff = now() - timedelta(days=get_settings().backup_retention_days + 1)
    for item in records():
        if datetime.fromisoformat(item["created_at"]) >= cutoff:
            continue
        key = "deletions/" + item["id"] + ".bin"
        if get_settings().app_env == "production":
            ledger_client().delete_object(Bucket=get_settings().ledger_s3_bucket, Key=key)
        else:
            (Path(get_settings().ledger_directory) / key).unlink(missing_ok=True)
