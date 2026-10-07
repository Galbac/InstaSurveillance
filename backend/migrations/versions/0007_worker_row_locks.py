"""Allow worker row locks without granting access to role or authentication mutations."""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    # PostgreSQL SELECT FOR UPDATE requires UPDATE on at least one column.
    # Theme is a non-sensitive preference; password, role, verification and status remain read-only.
    op.execute("GRANT UPDATE(theme) ON users TO insta_worker")


def downgrade():
    op.execute("REVOKE UPDATE(theme) ON users FROM insta_worker")
