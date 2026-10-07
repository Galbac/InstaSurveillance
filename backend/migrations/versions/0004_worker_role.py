"""Runtime worker is no longer the schema owner."""

import os

from alembic import op
from psycopg import sql
from sqlalchemy import text

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

TABLES = (
    "users",
    "instagram_profiles",
    "instagram_session_secrets",
    "jobs",
    "snapshots",
    "snapshot_members",
    "annotations",
    "notifications",
    "outbox_events",
    "support_tickets",
    "consents",
    "audit_events",
    "comparisons",
    "change_events",
    "deletion_requests",
    "file_objects",
    "export_jobs",
    "platform_runs",
)


def upgrade():
    bind = op.get_bind()
    exists = bind.scalar(text("SELECT 1 FROM pg_roles WHERE rolname='insta_worker'"))
    if not exists:
        password = os.environ.get("WORKER_DB_PASSWORD")
        if not password:
            raise RuntimeError("WORKER_DB_PASSWORD is required to create the runtime role")
        with bind.connection.driver_connection.cursor() as cursor:
            cursor.execute(
                sql.SQL(
                    "CREATE ROLE insta_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}"
                ).format(sql.Literal(password))
            )
    op.execute("GRANT USAGE ON SCHEMA public TO insta_worker")
    for table in TABLES:
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON " + table + " TO insta_worker")
    op.execute("GRANT SELECT, DELETE ON sessions, auth_tokens, idempotency_records TO insta_worker")
    op.execute("REVOKE ALL ON instagram_session_secrets FROM insta_api")
    op.execute("GRANT DELETE ON instagram_session_secrets TO insta_api")


def downgrade():
    raise RuntimeError("Role removal requires a controlled operator migration")
