"""Persist avatar URLs returned with relationship pages."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("snapshot_members", sa.Column("avatar_url", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("snapshot_members", "avatar_url")
