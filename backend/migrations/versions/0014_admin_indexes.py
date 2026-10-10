"""Add indexes for admin queries and filtering."""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "idx_users_status_created",
        "users",
        ["status", "created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_jobs_status_kind_created",
        "jobs",
        ["status", "kind", "created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_profiles_username",
        "instagram_profiles",
        ["username"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_support_tickets_status_created",
        "support_tickets",
        ["status", "created_at"],
        if_not_exists=True,
    )
    op.create_index(
        "idx_audit_action_created",
        "audit_events",
        ["action", "created_at"],
        if_not_exists=True,
    )


def downgrade():
    op.drop_index("idx_audit_action_created", table_name="audit_events", if_exists=True)
    op.drop_index("idx_support_tickets_status_created", table_name="support_tickets", if_exists=True)
    op.drop_index("idx_profiles_username", table_name="instagram_profiles", if_exists=True)
    op.drop_index("idx_jobs_status_kind_created", table_name="jobs", if_exists=True)
    op.drop_index("idx_users_status_created", table_name="users", if_exists=True)
