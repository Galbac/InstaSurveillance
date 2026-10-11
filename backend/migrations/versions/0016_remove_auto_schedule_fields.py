"""Drop fields used only by automatic Instagram collection schedules."""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("instagram_profiles", "interval_hours")
    op.drop_column("instagram_profiles", "next_sync")


def downgrade():
    op.add_column(
        "instagram_profiles",
        sa.Column("interval_hours", sa.Integer(), server_default="24", nullable=False),
    )
    op.add_column(
        "instagram_profiles",
        sa.Column("next_sync", sa.DateTime(timezone=True), nullable=True),
    )
