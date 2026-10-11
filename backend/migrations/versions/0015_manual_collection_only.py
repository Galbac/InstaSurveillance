"""Remove obsolete automatic collection schedules."""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE instagram_profiles SET next_sync = NULL")
    op.execute("DELETE FROM runtime_limits WHERE name = 'instagram_sync_interval_hours'")


def downgrade():
    # Past scheduled timestamps cannot be reconstructed safely.
    pass
