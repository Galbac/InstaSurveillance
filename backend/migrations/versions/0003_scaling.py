"""V1 security, jobs, analytics, exports and lifecycle schema."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "\nCREATE TABLE platform_runs (\n\texternal_hash VARCHAR(64) NOT NULL, \n\tjob_reference VARCHAR(36) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (job_reference)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_platform_runs_external_hash ON platform_runs (external_hash)")
    op.execute("ALTER TABLE annotations ADD COLUMN storage_bytes INTEGER DEFAULT '0' NOT NULL")
    op.execute(
        "CREATE INDEX members_normalized ON snapshot_members (snapshot_id, relation, lower(username), identity_key)"
    )
    op.execute("ALTER TABLE snapshots ALTER COLUMN job_id DROP NOT NULL")
    op.execute("ALTER TABLE snapshots DROP CONSTRAINT snapshots_job_id_fkey")
    op.execute(
        "ALTER TABLE snapshots ADD CONSTRAINT snapshots_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO insta_api")
    op.execute("REVOKE ALL ON instagram_session_secrets FROM insta_api")
    op.execute("GRANT DELETE ON instagram_session_secrets TO insta_api")


def downgrade():
    raise RuntimeError("Use a pre-migration backup; automatic destructive downgrade is disabled")
