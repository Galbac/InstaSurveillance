"""Deletion waits for in-flight object writes or their bounded deadline."""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE file_objects ADD COLUMN writing_until TIMESTAMP WITH TIME ZONE NULL")


def downgrade():
    raise RuntimeError("Restore through the protected procedure instead of dropping write fences")
