"""Initial immutable PostgreSQL schema."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "\nCREATE TABLE outbox_events (\n\tkind VARCHAR(20) NOT NULL, \n\treference VARCHAR(36) NOT NULL, \n\tpayload JSON NOT NULL, \n\tdelivered BOOLEAN NOT NULL, \n\tattempts INTEGER NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE users (\n\temail VARCHAR(320) NOT NULL, \n\tpassword_hash TEXT NOT NULL, \n\tverified BOOLEAN NOT NULL, \n\ttheme VARCHAR(10) NOT NULL, \n\temail_notifications BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (email)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE auth_tokens (\n\tuser_id VARCHAR(36) NOT NULL, \n\ttoken_hash VARCHAR(64) NOT NULL, \n\tpurpose VARCHAR(30) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tUNIQUE (token_hash)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE instagram_profiles (\n\tuser_id VARCHAR(36) NOT NULL, \n\tusername VARCHAR(30) NOT NULL, \n\texternal_id VARCHAR(64), \n\tstatus VARCHAR(40) NOT NULL, \n\tpaused BOOLEAN NOT NULL, \n\tgeneration INTEGER NOT NULL, \n\tlast_sync TIMESTAMP WITH TIME ZONE, \n\tnext_sync TIMESTAMP WITH TIME ZONE, \n\tcooldown_until TIMESTAMP WITH TIME ZONE, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tUNIQUE (external_id)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE notifications (\n\tuser_id VARCHAR(36) NOT NULL, \n\ttitle VARCHAR(160) NOT NULL, \n\tbody TEXT NOT NULL, \n\tread BOOLEAN NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE sessions (\n\tuser_id VARCHAR(36) NOT NULL, \n\ttoken_hash VARCHAR(64) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tUNIQUE (token_hash)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE support_tickets (\n\tuser_id VARCHAR(36) NOT NULL, \n\tbody TEXT NOT NULL, \n\tstatus VARCHAR(20) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE annotations (\n\tprofile_id VARCHAR(36) NOT NULL, \n\tidentity_key VARCHAR(80) NOT NULL, \n\tfavorite BOOLEAN NOT NULL, \n\tnote TEXT NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (profile_id, identity_key), \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE instagram_session_secrets (\n\tprofile_id VARCHAR(36) NOT NULL, \n\tencrypted_settings TEXT NOT NULL, \n\tPRIMARY KEY (profile_id), \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE jobs (\n\tuser_id VARCHAR(36) NOT NULL, \n\tprofile_id VARCHAR(36), \n\tkind VARCHAR(30) NOT NULL, \n\tstatus VARCHAR(40) NOT NULL, \n\tstage VARCHAR(60) NOT NULL, \n\tdetails JSON NOT NULL, \n\terror_code VARCHAR(80), \n\tupdated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE snapshots (\n\tprofile_id VARCHAR(36) NOT NULL, \n\tsource VARCHAR(20) NOT NULL, \n\tobserved_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tcompleteness VARCHAR(30) NOT NULL, \n\tidentity_mode VARCHAR(20) NOT NULL, \n\tchecksum VARCHAR(64) NOT NULL, \n\tjob_id VARCHAR(36) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(profile_id) REFERENCES instagram_profiles (id) ON DELETE CASCADE, \n\tUNIQUE (job_id), \n\tFOREIGN KEY(job_id) REFERENCES jobs (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE snapshot_members (\n\tsnapshot_id VARCHAR(36) NOT NULL, \n\trelation VARCHAR(12) NOT NULL, \n\tidentity_key VARCHAR(80) NOT NULL, \n\tusername VARCHAR(30) NOT NULL, \n\tid VARCHAR(36) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (snapshot_id, relation, identity_key), \n\tFOREIGN KEY(snapshot_id) REFERENCES snapshots (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_auth_tokens_user_id ON auth_tokens (user_id)")
    op.execute("CREATE INDEX ix_instagram_profiles_user_id ON instagram_profiles (user_id)")
    op.execute("CREATE INDEX ix_notifications_user_id ON notifications (user_id)")
    op.execute("CREATE INDEX ix_sessions_user_id ON sessions (user_id)")
    op.execute("CREATE INDEX ix_jobs_user_id ON jobs (user_id)")
    op.execute("CREATE INDEX ix_snapshots_profile_id ON snapshots (profile_id)")
    op.execute("CREATE INDEX snapshot_timeline ON snapshots (profile_id, observed_at, id)")
    op.execute("CREATE INDEX members_list ON snapshot_members (snapshot_id, relation, username)")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO insta_api")
    op.execute("REVOKE ALL ON instagram_session_secrets FROM insta_api")
    op.execute("GRANT DELETE ON instagram_session_secrets TO insta_api")


def downgrade():
    op.execute("DROP TABLE snapshot_members")
    op.execute("DROP TABLE snapshots")
    op.execute("DROP TABLE jobs")
    op.execute("DROP TABLE instagram_session_secrets")
    op.execute("DROP TABLE annotations")
    op.execute("DROP TABLE support_tickets")
    op.execute("DROP TABLE sessions")
    op.execute("DROP TABLE notifications")
    op.execute("DROP TABLE instagram_profiles")
    op.execute("DROP TABLE auth_tokens")
    op.execute("DROP TABLE users")
    op.execute("DROP TABLE outbox_events")
