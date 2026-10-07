"""Server-only privileged operations. Never expose these through public HTTP."""

import argparse
import getpass
import json
import os
from pathlib import Path
from urllib.parse import quote

from sqlalchemy import delete, select, text

from app.core.commands import audit, data_cipher
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.mfa import new_seed
from app.core.security import digest, hasher, token
from app.models import AdminMFA, AuthSession, SessionSecret, User


def enroll(db, user: User, output: Path) -> None:
    if output.resolve().is_relative_to(Path.cwd().resolve()) or output.exists() or not output.is_absolute():
        raise AppError("unsafe_output", "Use a new absolute path outside the repository")
    seed = new_seed()
    recovery = [token() for _ in range(10)]
    record = db.scalar(select(AdminMFA).where(AdminMFA.user_id == user.id).with_for_update())
    if record is None:
        record = AdminMFA(user_id=user.id)
        db.add(record)
    record.encrypted_seed = data_cipher().encrypt(seed.encode()).decode()
    record.recovery_hashes, record.last_counter = [digest(value) for value in recovery], -1
    content = json.dumps(
        {
            "totp_uri": f"otpauth://totp/InstaSurveillance:{quote(user.email)}?secret={seed}&issuer=InstaSurveillance&digits=6&period=30",
            "recovery_codes": recovery,
        },
        indent=2,
    )
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    audit(db, None, "admin.mfa_enroll", user.id)
    db.commit()
    print("Enrollment created in the specified private file. Import it, then securely remove the file.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    bootstrap = commands.add_parser("bootstrap-admin")
    bootstrap.add_argument("--email", required=True)
    bootstrap.add_argument("--role", choices=("admin", "support"), default="admin")
    bootstrap.add_argument("--output", type=Path, required=True)
    recovery = commands.add_parser("recover-admin-mfa")
    recovery.add_argument("--email", required=True)
    recovery.add_argument("--output", type=Path, required=True)
    commands.add_parser("rotate-instagram-key")
    commands.add_parser("rotate-data-key")
    args = parser.parse_args()
    with SessionLocal() as db:
        if not db.scalar(
            text(
                "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='users' AND n.nspname='public' AND pg_get_userbyid(c.relowner)=current_user) OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)"
            )
        ):
            raise SystemExit("Privileged CLI requires the protected schema-owner connection")
        if args.command == "rotate-data-key":
            from app.models import IdempotencyRecord, Outbox

            cipher = data_cipher()
            for model, field in ((AdminMFA, "encrypted_seed"), (IdempotencyRecord, "encrypted_response")):
                for row in db.scalars(select(model).with_for_update()):
                    value = getattr(row, field)
                    if value:
                        setattr(row, field, cipher.encrypt(cipher.decrypt(value.encode())).decode())
            for row in db.scalars(select(Outbox).with_for_update()):
                sealed = row.payload.get("sealed")
                if sealed:
                    row.payload = {
                        **row.payload,
                        "sealed": cipher.encrypt(cipher.decrypt(sealed.encode())).decode(),
                    }
            audit(db, None, "data_keys.rotate", "encrypted-data")
            db.commit()
            print(
                "Database records rotated. Retain previous keys for the independent deletion ledger until its retention window ends."
            )
            return
        if args.command == "rotate-instagram-key":
            from app.core.config import get_settings
            from app.jobs.tasks import session_cipher

            settings = get_settings()
            current = session_cipher(settings.instagram_session_key_version)
            count = 0
            for record in db.scalars(select(SessionSecret).with_for_update()):
                if record.key_version != settings.instagram_session_key_version:
                    raw = session_cipher(record.key_version).decrypt(record.encrypted_settings.encode())
                    record.encrypted_settings = current.encrypt(raw).decode()
                    record.key_version = settings.instagram_session_key_version
                    count += 1
            audit(db, None, "session_keys.rotate", "instagram-session-keys", count=count)
            db.commit()
            print(f"Rotated {count} encrypted records. Verify workers before removing previous keys.")
            return
        email = args.email.strip().lower()
        user = db.scalar(select(User).where(User.email == email).with_for_update())
        if args.command == "bootstrap-admin":
            password = getpass.getpass("New service password (12+ characters): ")
            if len(password) < 12 or password != getpass.getpass("Repeat password: "):
                raise SystemExit("Passwords must match and contain at least 12 characters")
            if not user:
                user = User(email=email, password_hash=hasher.hash(password), verified=True, role=args.role)
                db.add(user)
                db.flush()
            else:
                if user.status != "active":
                    raise SystemExit("Account is unavailable")
                user.role, user.verified, user.password_hash = args.role, True, hasher.hash(password)
            audit(db, None, "admin.bootstrap", user.id, role=args.role)
        elif not user or user.role not in ("admin", "support") or user.status != "active":
            raise SystemExit("No active operator with this email")
        enroll(db, user, args.output)


if __name__ == "__main__":
    main()
