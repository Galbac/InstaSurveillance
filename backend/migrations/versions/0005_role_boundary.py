"""Only protected schema-owner commands may assign service roles."""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("REVOKE INSERT,UPDATE ON users FROM insta_api")
    columns = "id,created_at,email,password_hash,verified,theme,email_notifications,status,timezone,notification_settings"
    op.execute("GRANT INSERT(" + columns + ") ON users TO insta_api")
    op.execute(
        "GRANT UPDATE(email,password_hash,verified,theme,email_notifications,status,timezone,notification_settings) ON users TO insta_api"
    )
    op.execute("REVOKE INSERT,UPDATE ON users FROM insta_worker")


def downgrade():
    raise RuntimeError("Do not weaken role boundaries; use reviewed recovery procedures")
