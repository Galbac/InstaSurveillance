"""Allow configured quotas above 2 GiB without integer overflow."""

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("runtime_limits", "value", type_=sa.BigInteger(), existing_type=sa.Integer())


def downgrade():
    raise RuntimeError("Narrowing live quotas requires a reviewed data migration")
