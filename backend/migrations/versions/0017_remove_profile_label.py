"""Remove the unused custom label from Instagram profiles."""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("instagram_profiles", "label")


def downgrade():
    op.add_column(
        "instagram_profiles",
        sa.Column("label", sa.String(length=80), server_default="", nullable=False),
    )
