"""API may identify rows for revocation, but cannot read encrypted session settings."""

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    # DELETE ... WHERE profile_id requires SELECT on that predicate column.
    op.execute("GRANT SELECT(profile_id) ON instagram_session_secrets TO insta_api")


def downgrade():
    op.execute("REVOKE SELECT(profile_id) ON instagram_session_secrets FROM insta_api")
