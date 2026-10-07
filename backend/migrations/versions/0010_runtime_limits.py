"""Operator policy overrides, with read-only worker access."""

from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "runtime_limits",
        sa.Column("name", sa.String(80), primary_key=True),
        sa.Column("value", sa.Integer(), nullable=False),
    )
    op.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON runtime_limits TO insta_api")
    op.execute("GRANT SELECT ON runtime_limits TO insta_worker")


def downgrade():
    raise RuntimeError("Use reviewed restore; policy is release data")
