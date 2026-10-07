"""V1 security, jobs, analytics, exports and lifecycle schema."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "\nCREATE TABLE audit_events (\n\tactor_id VARCHAR(36), \n\taction VARCHAR(80) NOT NULL, \n\ttarget VARCHAR(80) NOT NULL, \n\trequest_id VARCHAR(40), \n\tmetadata_json JSON NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE deletion_requests (\n\towner VARCHAR(36) NOT NULL, \n\ttarget_type VARCHAR(20) NOT NULL, \n\ttarget_id VARCHAR(36) NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\treceipt_hash VARCHAR(64), \n\treceipt_expires_at TIMESTAMP WITH TIME ZONE, \n\tfiles JSON NOT NULL, \n\tcompleted_at TIMESTAMP WITH TIME ZONE, \n\tattempts INTEGER NOT NULL, \n\tledger_written BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_deletion_requests_owner ON deletion_requests (owner)")
    op.execute(
        "\nCREATE TABLE file_objects (\n\towner VARCHAR(36) NOT NULL, \n\tjob_id VARCHAR(36), \n\tkey VARCHAR(200) NOT NULL, \n\tsize INTEGER NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (key)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_file_objects_expires_at ON file_objects (expires_at)")
    op.execute("CREATE INDEX ix_file_objects_owner ON file_objects (owner)")
    op.execute(
        "\nCREATE TABLE idempotency_records (\n\towner VARCHAR(36) NOT NULL, \n\tscope VARCHAR(240) NOT NULL, \n\tkey_hash VARCHAR(64) NOT NULL, \n\trequest_hash VARCHAR(64), \n\tencrypted_response TEXT, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (owner, scope, key_hash)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_idempotency_records_expires_at ON idempotency_records (expires_at)")
    op.execute("CREATE INDEX ix_idempotency_records_owner ON idempotency_records (owner)")
    op.execute(
        "ALTER TABLE outbox_events ADD COLUMN next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL"
    )
    op.execute("ALTER TABLE outbox_events ADD COLUMN delivery_state VARCHAR(20) DEFAULT 'pending' NOT NULL")
    op.execute("ALTER TABLE outbox_events ADD COLUMN last_error VARCHAR(80)")
    op.execute("ALTER TABLE outbox_events ADD COLUMN event_key VARCHAR(160)")
    op.execute("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active' NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'user' NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN timezone VARCHAR(80) DEFAULT 'UTC' NOT NULL")
    op.execute("ALTER TABLE users ADD COLUMN notification_settings JSON DEFAULT '{}' NOT NULL")
    op.execute(
        "\nCREATE TABLE admin_mfa (\n\tuser_id VARCHAR(36) NOT NULL, \n\tencrypted_seed TEXT NOT NULL, \n\trecovery_hashes JSON NOT NULL, \n\tlast_counter INTEGER NOT NULL, \n\tPRIMARY KEY (user_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("ALTER TABLE auth_tokens ADD COLUMN target_email VARCHAR(320)")
    op.execute(
        "\nCREATE TABLE consents (\n\tuser_id VARCHAR(36) NOT NULL, \n\tpurpose VARCHAR(40) NOT NULL, \n\tversion VARCHAR(40) NOT NULL, \n\trevoked_at TIMESTAMP WITH TIME ZONE, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_consents_user_id ON consents (user_id)")
    op.execute("ALTER TABLE instagram_profiles ADD COLUMN label VARCHAR(80) DEFAULT '' NOT NULL")
    op.execute("ALTER TABLE instagram_profiles ADD COLUMN interval_hours INTEGER DEFAULT '24' NOT NULL")
    op.execute("ALTER TABLE notifications ADD COLUMN event_key VARCHAR(160)")
    op.execute("ALTER TABLE notifications ADD COLUMN kind VARCHAR(30) DEFAULT 'result' NOT NULL")
    op.execute("ALTER TABLE notifications ADD COLUMN link VARCHAR(240) DEFAULT '/app' NOT NULL")
    op.execute("ALTER TABLE sessions ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE sessions ADD COLUMN device VARCHAR(160) DEFAULT '' NOT NULL")
    op.execute("ALTER TABLE sessions ADD COLUMN privileged_until TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE support_tickets ADD COLUMN category VARCHAR(30) DEFAULT 'other' NOT NULL")
    op.execute("ALTER TABLE support_tickets ADD COLUMN request_id VARCHAR(40)")
    op.execute("ALTER TABLE support_tickets ADD COLUMN reply TEXT DEFAULT '' NOT NULL")
    op.execute(
        "ALTER TABLE instagram_session_secrets ADD COLUMN key_version VARCHAR(40) DEFAULT '1' NOT NULL"
    )
    op.execute("ALTER TABLE jobs ADD COLUMN attempts INTEGER DEFAULT '0' NOT NULL")
    op.execute("ALTER TABLE jobs ADD COLUMN heartbeat_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE jobs ADD COLUMN started_at TIMESTAMP WITH TIME ZONE")
    op.execute("ALTER TABLE jobs ADD COLUMN finished_at TIMESTAMP WITH TIME ZONE")
    op.execute(
        "\nCREATE TABLE export_jobs (\n\tuser_id VARCHAR(36) NOT NULL, \n\tjob_id VARCHAR(36), \n\tprofile_id VARCHAR(36), \n\tscope VARCHAR(20) NOT NULL, \n\tformat VARCHAR(10) NOT NULL, \n\tfilters JSON NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\tobject_key VARCHAR(200), \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tFOREIGN KEY(job_id) REFERENCES jobs (id) ON DELETE SET NULL, \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_export_jobs_user_id ON export_jobs (user_id)")
    op.execute("ALTER TABLE snapshots ADD COLUMN counts JSON DEFAULT '{}' NOT NULL")
    op.execute("ALTER TABLE snapshots ADD COLUMN provenance JSON DEFAULT '{}' NOT NULL")
    op.execute("ALTER TABLE snapshots ADD COLUMN storage_bytes INTEGER DEFAULT '0' NOT NULL")
    op.execute(
        "\nCREATE TABLE comparisons (\n\tprofile_id VARCHAR(36) NOT NULL, \n\tbefore_id VARCHAR(36) NOT NULL, \n\tafter_id VARCHAR(36) NOT NULL, \n\talgorithm_version VARCHAR(20) NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\tcounts JSON NOT NULL, \n\tjob_id VARCHAR(36), \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (before_id, after_id, algorithm_version), \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE, \n\tFOREIGN KEY(before_id) REFERENCES snapshots (id) ON DELETE CASCADE, \n\tFOREIGN KEY(after_id) REFERENCES snapshots (id) ON DELETE CASCADE, \n\tFOREIGN KEY(job_id) REFERENCES jobs (id) ON DELETE SET NULL\n)\n\n"
    )
    op.execute("CREATE INDEX ix_comparisons_profile_id ON comparisons (profile_id)")
    op.execute("CREATE INDEX member_identity ON snapshot_members (snapshot_id, identity_key, relation)")
    op.execute(
        "\nCREATE TABLE change_events (\n\tcomparison_id VARCHAR(36) NOT NULL, \n\tidentity_key VARCHAR(80) NOT NULL, \n\tusername VARCHAR(30) NOT NULL, \n\trelation VARCHAR(12) NOT NULL, \n\ttype VARCHAR(10) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (comparison_id, identity_key, relation, type), \n\tFOREIGN KEY(comparison_id) REFERENCES comparisons (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX events_list ON change_events (comparison_id, username, id)")
    op.execute("CREATE INDEX ix_change_events_comparison_id ON change_events (comparison_id)")
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
