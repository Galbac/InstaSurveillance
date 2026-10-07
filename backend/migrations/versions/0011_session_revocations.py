"""One-shot best-effort logout without granting API access to Instagram credentials."""

from alembic import op
import sqlalchemy as sa
from app.integrations.revocation import CREATE_FUNCTION

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "instagram_session_revocations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("profile_id", sa.String(36), sa.ForeignKey("instagram_profiles.id", ondelete="CASCADE")),
        sa.Column("encrypted_settings", sa.Text(), nullable=False),
        sa.Column("key_version", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_instagram_session_revocations_expires_at", "instagram_session_revocations", ["expires_at"]
    )
    op.execute(CREATE_FUNCTION)
    op.execute("REVOKE ALL ON FUNCTION public.prepare_instagram_logout(text,text,text) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION public.prepare_instagram_logout(text,text,text) TO insta_api")
    op.execute("REVOKE ALL ON instagram_session_revocations FROM insta_api")
    op.execute("GRANT SELECT,DELETE ON instagram_session_revocations TO insta_worker")


def downgrade():
    raise RuntimeError("Restore from a reviewed backup")
