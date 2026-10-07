"""Enforce same-profile comparisons and preserve optional source timestamps."""

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_unique_constraint("snapshot_profile_key", "snapshots", ["id", "profile_id"])
    for side in ("before", "after"):
        op.create_foreign_key(
            "comparison_" + side + "_profile",
            "comparisons",
            "snapshots",
            [side + "_id", "profile_id"],
            ["id", "profile_id"],
            ondelete="CASCADE",
        )
    op.add_column(
        "snapshot_members", sa.Column("source_timestamp", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade():
    raise RuntimeError("Use reviewed restore; do not weaken tenant constraints")
