"""Authenticated streaming PostgreSQL backups, outside web routes and public queues."""

import argparse
import base64
import hashlib
import json
import os
import secrets
import struct
import subprocess
import tempfile
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, select
from sqlalchemy.engine import make_url

from app.core.streams import BinaryReader, BinaryWriter

MAGIC = b"INSTABACKUP1\n"
CHUNK = 1024 * 1024
EXCLUDE = (
    "instagram_session_secrets",
    "instagram_session_revocations",
    "sessions",
    "auth_tokens",
    "admin_mfa",
    "idempotency_records",
    "file_objects",
    "export_jobs",
    "outbox_events",
    "deletion_requests",
)


def encryption_key() -> bytes:
    key = base64.urlsafe_b64decode(os.environ["BACKUP_ENCRYPTION_KEY"])
    if len(key) != 32:
        raise ValueError("BACKUP_ENCRYPTION_KEY must be base64 of 32 random bytes")
    return key


def encrypt_stream(source: BinaryReader, destination: BinaryWriter, key: bytes) -> None:
    salt = secrets.token_bytes(8)
    destination.write(MAGIC + salt)
    cipher, digest, counter = AESGCM(key), hashlib.sha256(), 0
    while data := source.read(CHUNK):
        digest.update(data)
        nonce = salt + struct.pack(">I", counter)
        payload = cipher.encrypt(nonce, b"D" + data, MAGIC + nonce)
        destination.write(struct.pack(">I", len(payload)) + payload)
        counter += 1
        if counter >= 2**32 - 1:
            raise ValueError("Backup exceeds framing limit")
    nonce = salt + struct.pack(">I", counter)
    footer = cipher.encrypt(nonce, b"F" + struct.pack(">I", counter) + digest.digest(), MAGIC + nonce)
    destination.write(struct.pack(">I", len(footer)) + footer)


def decrypt_stream(source: BinaryReader, destination: BinaryWriter, key: bytes) -> None:
    if source.read(len(MAGIC)) != MAGIC:
        raise ValueError("Unknown backup format")
    salt = source.read(8)
    if len(salt) != 8:
        raise ValueError("Truncated backup")
    cipher, digest, counter = AESGCM(key), hashlib.sha256(), 0
    while header := source.read(4):
        if len(header) != 4:
            raise ValueError("Truncated frame")
        size = struct.unpack(">I", header)[0]
        if not 17 <= size <= CHUNK + 17:
            raise ValueError("Invalid frame length")
        payload = source.read(size)
        if len(payload) != size:
            raise ValueError("Truncated frame")
        nonce = salt + struct.pack(">I", counter)
        data = cipher.decrypt(nonce, payload, MAGIC + nonce)
        if data[:1] == b"F":
            if data != b"F" + struct.pack(">I", counter) + digest.digest() or source.read(1):
                raise ValueError("Invalid terminal frame")
            return
        if data[:1] != b"D":
            raise ValueError("Invalid frame type")
        destination.write(data[1:])
        digest.update(data[1:])
        counter += 1
    raise ValueError("Missing authenticated terminal frame")


def pg_environment() -> dict[str, str]:
    # Password is never a command-line argument or subprocess error message.
    url = make_url(os.environ.get("BACKUP_DATABASE_URL") or os.environ["DATABASE_URL"])
    environment = os.environ.copy()
    environment.update(
        PGHOST=url.host or "db",
        PGPORT=str(url.port or 5432),
        PGUSER=url.username or "insta",
        PGPASSWORD=url.password or "",
        PGDATABASE=url.database or "insta",
    )
    return environment


def object_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["BACKUP_S3_ENDPOINT"],
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=os.environ["BACKUP_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["BACKUP_S3_SECRET_ACCESS_KEY"],
    )


def create_backup(output: Path | None = None) -> str:
    environment = pg_environment()
    if os.environ.get("APP_ENV") == "production":
        if not os.environ.get("BACKUP_S3_ENDPOINT", "").startswith("https://"):
            raise ValueError("Production backup endpoint must use HTTPS")
        if os.environ.get("BACKUP_S3_BUCKET") in (
            os.environ.get("S3_BUCKET"),
            os.environ.get("LEDGER_S3_BUCKET"),
        ):
            raise ValueError("Backup requires a separate bucket")
        if os.environ.get("BACKUP_ENCRYPTION_KEY") in (
            os.environ.get("ENCRYPTION_KEY"),
            os.environ.get("INSTAGRAM_PENDING_ENCRYPTION_KEY"),
        ):
            raise ValueError("Backup encryption key must be independent")
    command = ["pg_dump", "--format=custom", "--no-owner", "--no-privileges"] + [
        f"--exclude-table-data=public.{table}" for table in EXCLUDE
    ]
    with tempfile.SpooledTemporaryFile(max_size=CHUNK) as encrypted:
        process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert process.stdout is not None
        try:
            encrypt_stream(process.stdout, encrypted, encryption_key())
        except BaseException:
            process.kill()
            process.wait()
            raise
        finally:
            process.stdout.close()
        # stderr is intentionally not logged: it can contain infrastructure identifiers.
        _error = process.stderr.read() if process.stderr else b""
        if process.wait() != 0:
            raise RuntimeError(
                "pg_dump failed; inspect PostgreSQL availability with protected operator tools"
            )
        encrypted.seek(0)
        key = "backups/" + datetime.now(UTC).strftime("%Y/%m/%d/%H%M%S-") + secrets.token_hex(4) + ".aesgcm"
        if output:
            descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as target:
                while data := encrypted.read(CHUNK):
                    target.write(data)
                target.flush()
                os.fsync(target.fileno())
        else:
            client = object_client()
            bucket = os.environ["BACKUP_S3_BUCKET"]
            client.upload_fileobj(
                encrypted, bucket, key, ExtraArgs={"ContentType": "application/octet-stream"}
            )
            client.put_object(
                Bucket=bucket,
                Key="status/latest.json",
                Body=json.dumps({"key": key, "completed_at": datetime.now(UTC).isoformat()}).encode(),
            )
            cutoff = datetime.now(UTC) - timedelta(days=int(os.environ.get("BACKUP_RETENTION_DAYS", "30")))
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="backups/"):
                for entry in page.get("Contents", []):
                    if entry["LastModified"] < cutoff:
                        client.delete_object(Bucket=bucket, Key=entry["Key"])
        # A shared metadata volume records success only after the durable upload succeeds.
        status = Path(os.environ.get("BACKUP_STATUS_DIRECTORY", "/backup-status"))
        status.mkdir(parents=True, exist_ok=True)
        temp = status / "latest.tmp"
        temp.write_text(str(time.time()))
        temp.replace(status / "latest")
        return key


def sanitize_restore(database_url: str) -> None:
    """Fail closed until the independent deletion ledger has been replayed."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    target_engine = create_engine(database_url)
    SessionLocal = sessionmaker(target_engine, expire_on_commit=False)
    from app.integrations import ledger
    from app.models import (
        AdminMFA,
        AuthSession,
        AuthToken,
        Comparison,
        ExportJob,
        FileObject,
        IdempotencyRecord,
        Job,
        Outbox,
        Profile,
        SessionRevocation,
        SessionSecret,
        Snapshot,
        User,
    )

    with SessionLocal() as db:
        for item in ledger.records():
            model = {"account": User, "profile": Profile, "snapshot": Snapshot}.get(item["target_type"])
            if item["target_type"] == "history":
                db.execute(
                    delete(Snapshot).where(
                        Snapshot.profile_id == item["target_id"],
                        Snapshot.created_at <= datetime.fromisoformat(item["cutoff"]),
                    )
                )
                for job in db.scalars(
                    select(Job).where(
                        Job.profile_id == item["target_id"],
                        Job.kind != "connect",
                        Job.created_at <= datetime.fromisoformat(item["cutoff"]),
                    )
                ):
                    job.details = {"warnings": ["history_cleared"]}
                continue
            if model is None:
                raise ValueError("Unknown deletion ledger target")
            db.execute(delete(model).where(model.id == item["target_id"]))
        for model in (
            SessionSecret,
            SessionRevocation,
            AuthSession,
            AuthToken,
            AdminMFA,
            IdempotencyRecord,
            ExportJob,
            FileObject,
            Outbox,
        ):
            db.execute(delete(model))
        for job in db.scalars(select(Job)):
            if job.status not in ("completed", "failed", "cancelled", "expired", "partial", "needs_review"):
                job.status, job.error_code = "cancelled", "restore_requires_action"
            job.details = {
                key: value
                for key, value in job.details.items()
                if key not in ("object_key", "run_token", "generation")
            }
        from app.core.security import now

        for profile in db.scalars(select(Profile)):
            profile.paused = True
            profile.generation += 1
            profile.external_id = None
            profile.status = "reconnect_required"
            profile.cooldown_until = now() + timedelta(hours=24)
        for comparison in db.scalars(select(Comparison).where(Comparison.status != "completed")):
            comparison.status = "failed"
        db.commit()
    target_engine.dispose()


def restore_backup(source: Path, database_confirmation: str) -> None:
    env = pg_environment()
    if env["PGDATABASE"] != database_confirmation:
        raise ValueError("--confirm-database must exactly match target database")
    # Dedicated empty database only. Public API must stay stopped throughout restoration.
    import psycopg

    with psycopg.connect(
        host=env["PGHOST"],
        port=env["PGPORT"],
        user=env["PGUSER"],
        password=env["PGPASSWORD"],
        dbname=env["PGDATABASE"],
    ) as db:
        if (db.execute("SELECT count(*) FROM pg_tables WHERE schemaname='public'").fetchone() or [1])[0]:
            raise ValueError("Restore requires an empty target database")
    with source.open("rb") as encrypted, tempfile.TemporaryFile() as plain:
        decrypt_stream(encrypted, plain, encryption_key())
        plain.seek(0)
        result = subprocess.run(
            ["pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", env["PGDATABASE"]],
            env=env,
            stdin=plain,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        if result.returncode:
            raise RuntimeError("pg_restore failed; keep API stopped")
    sanitize_restore(os.environ.get("BACKUP_DATABASE_URL") or os.environ["DATABASE_URL"])
    with psycopg.connect(
        host=env["PGHOST"],
        port=env["PGPORT"],
        user=env["PGUSER"],
        password=env["PGPASSWORD"],
        dbname=env["PGDATABASE"],
    ) as db:
        # Reapply role grants on restored tables; no migration has to pretend to downgrade.
        db.execute(
            "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO insta_worker,insta_api"
        )
        db.execute("REVOKE ALL ON instagram_session_revocations FROM insta_api")
        db.execute("REVOKE INSERT,UPDATE ON instagram_session_revocations FROM insta_worker")
        db.execute("REVOKE ALL ON FUNCTION public.prepare_instagram_logout(text,text,text) FROM PUBLIC")
        db.execute("GRANT EXECUTE ON FUNCTION public.prepare_instagram_logout(text,text,text) TO insta_api")
        db.execute("REVOKE SELECT,INSERT,UPDATE ON instagram_session_secrets FROM insta_api")
        db.execute("GRANT SELECT(profile_id) ON instagram_session_secrets TO insta_api")
        db.execute("REVOKE SELECT,INSERT,UPDATE ON admin_mfa FROM insta_worker")
        db.execute("REVOKE INSERT,UPDATE ON users FROM insta_api,insta_worker")
        db.execute("GRANT UPDATE(theme) ON users TO insta_worker")
        db.execute("REVOKE INSERT,UPDATE,DELETE ON runtime_limits FROM insta_worker")
        db.execute(
            "GRANT INSERT(id,created_at,email,password_hash,verified,theme,email_notifications,status,timezone,notification_settings) ON users TO insta_api"
        )
        db.execute(
            "GRANT UPDATE(email,password_hash,verified,theme,email_notifications,status,timezone,notification_settings) ON users TO insta_api"
        )
    print(
        "Restore and deletion replay completed. Sessions revoked; MFA re-enrollment and explicit Instagram reconnect required."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("create")
    backup.add_argument("--output", type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("--input", type=Path, required=True)
    restore.add_argument("--confirm-database", required=True)
    commands.add_parser("schedule")
    args = parser.parse_args()
    if args.command == "create":
        create_backup(args.output)
        print("Encrypted backup completed")
    elif args.command == "restore":
        restore_backup(args.input, args.confirm_database)
    else:
        while True:
            started = time.time()
            try:
                create_backup()
                print("backup_completed", flush=True)
            except Exception as error:
                print("backup_failed " + type(error).__name__, flush=True)
            time.sleep(max(60, 86400 - (time.time() - started)))


if __name__ == "__main__":
    main()
