from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.security import now


class Base(DeclarativeBase):
    pass


class RuntimeLimit(Base):
    __tablename__ = "runtime_limits"
    name: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[int] = mapped_column(BigInteger)


class Identified:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class User(Identified, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    theme: Mapped[str] = mapped_column(String(10), default="light")
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    role: Mapped[str] = mapped_column(String(20), server_default="user")
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", server_default="UTC")
    notification_settings: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")


class AuthSession(Identified, Base):
    __tablename__ = "sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    device: Mapped[str] = mapped_column(String(160), default="", server_default="")
    privileged_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthToken(Identified, Base):
    __tablename__ = "auth_tokens"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    purpose: Mapped[str] = mapped_column(String(30))
    target_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Profile(Identified, Base):
    __tablename__ = "instagram_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    username: Mapped[str] = mapped_column(String(30))
    label: Mapped[str] = mapped_column(String(80), default="", server_default="")
    interval_hours: Mapped[int] = mapped_column(Integer, default=24, server_default="24")
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="disconnected")
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    generation: Mapped[int] = mapped_column(Integer, default=0)
    last_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_sync: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SessionSecret(Base):
    __tablename__ = "instagram_session_secrets"
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("instagram_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    encrypted_settings: Mapped[str] = mapped_column(Text)
    key_version: Mapped[str] = mapped_column(String(40), default="1", server_default="1")


class Job(Identified, Base):
    __tablename__ = "jobs"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("instagram_profiles.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(30))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="queued")
    stage: Mapped[str] = mapped_column(String(60), default="queued")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Snapshot(Identified, Base):
    __tablename__ = "snapshots"
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("instagram_profiles.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(20))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completeness: Mapped[str] = mapped_column(String(30))
    identity_mode: Mapped[str] = mapped_column(String(20), default="username")
    checksum: Mapped[str] = mapped_column(String(64))
    job_id: Mapped[str | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    counts: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    provenance: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (
        Index("snapshot_timeline", "profile_id", "observed_at", "id"),
        UniqueConstraint("id", "profile_id", name="snapshot_profile_key"),
    )


class Member(Identified, Base):
    __tablename__ = "snapshot_members"
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("snapshots.id", ondelete="CASCADE"))
    relation: Mapped[str] = mapped_column(String(12))
    identity_key: Mapped[str] = mapped_column(String(80))
    username: Mapped[str] = mapped_column(String(30))
    source_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (
        UniqueConstraint("snapshot_id", "relation", "identity_key"),
        Index("members_list", "snapshot_id", "relation", "username"),
        Index("member_identity", "snapshot_id", "identity_key", "relation"),
    )


class Annotation(Identified, Base):
    __tablename__ = "annotations"
    profile_id: Mapped[str] = mapped_column(ForeignKey("instagram_profiles.id", ondelete="CASCADE"))
    identity_key: Mapped[str] = mapped_column(String(80))
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    __table_args__ = (UniqueConstraint("profile_id", "identity_key"),)


class Notification(Identified, Base):
    __tablename__ = "notifications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    event_key: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)
    kind: Mapped[str] = mapped_column(String(30), default="result", server_default="result")
    link: Mapped[str] = mapped_column(String(240), default="/app", server_default="/app")


class Outbox(Identified, Base):
    __tablename__ = "outbox_events"
    kind: Mapped[str] = mapped_column(String(20))
    reference: Mapped[str] = mapped_column(String(36))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now, server_default=func.now()
    )
    delivery_state: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    last_error: Mapped[str | None] = mapped_column(String(80), nullable=True)
    event_key: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True)


class SupportTicket(Identified, Base):
    __tablename__ = "support_tickets"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")
    category: Mapped[str] = mapped_column(String(30), default="other", server_default="other")
    request_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reply: Mapped[str] = mapped_column(Text, default="", server_default="")


class Consent(Identified, Base):
    __tablename__ = "consents"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(40))
    version: Mapped[str] = mapped_column(String(40))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(Identified, Base):
    __tablename__ = "audit_events"
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(80))
    target: Mapped[str] = mapped_column(String(80))
    request_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AdminMFA(Base):
    __tablename__ = "admin_mfa"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    encrypted_seed: Mapped[str] = mapped_column(Text)
    recovery_hashes: Mapped[list] = mapped_column(JSON, default=list)
    last_counter: Mapped[int] = mapped_column(Integer, default=-1)


class IdempotencyRecord(Identified, Base):
    __tablename__ = "idempotency_records"
    owner: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[str] = mapped_column(String(240))
    key_hash: Mapped[str] = mapped_column(String(64))
    request_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    encrypted_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    __table_args__ = (UniqueConstraint("owner", "scope", "key_hash"),)


class Comparison(Identified, Base):
    __tablename__ = "comparisons"
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("instagram_profiles.id", ondelete="CASCADE"), index=True
    )
    before_id: Mapped[str] = mapped_column(ForeignKey("snapshots.id", ondelete="CASCADE"))
    after_id: Mapped[str] = mapped_column(ForeignKey("snapshots.id", ondelete="CASCADE"))
    algorithm_version: Mapped[str] = mapped_column(String(20), default="1")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    counts: Mapped[dict] = mapped_column(JSON, default=dict)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    __table_args__ = (
        UniqueConstraint("before_id", "after_id", "algorithm_version"),
        ForeignKeyConstraint(
            ["before_id", "profile_id"],
            ["snapshots.id", "snapshots.profile_id"],
            name="comparison_before_profile",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["after_id", "profile_id"],
            ["snapshots.id", "snapshots.profile_id"],
            name="comparison_after_profile",
            ondelete="CASCADE",
        ),
    )


class ChangeEvent(Identified, Base):
    __tablename__ = "change_events"
    comparison_id: Mapped[str] = mapped_column(ForeignKey("comparisons.id", ondelete="CASCADE"), index=True)
    identity_key: Mapped[str] = mapped_column(String(80))
    username: Mapped[str] = mapped_column(String(30))
    relation: Mapped[str] = mapped_column(String(12))
    type: Mapped[str] = mapped_column(String(10))
    __table_args__ = (
        UniqueConstraint("comparison_id", "identity_key", "relation", "type"),
        Index("events_list", "comparison_id", "username", "id"),
    )


class DeletionRequest(Identified, Base):
    __tablename__ = "deletion_requests"
    owner: Mapped[str] = mapped_column(String(36), index=True)
    target_type: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    receipt_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    receipt_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    files: Mapped[list] = mapped_column(JSON, default=list)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    ledger_written: Mapped[bool] = mapped_column(Boolean, default=False)


class FileObject(Identified, Base):
    writing_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __tablename__ = "file_objects"
    owner: Mapped[str] = mapped_column(String(36), index=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    key: Mapped[str] = mapped_column(String(200), unique=True)
    size: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ExportJob(Identified, Base):
    __tablename__ = "export_jobs"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True)
    profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("instagram_profiles.id", ondelete="CASCADE"), nullable=True
    )
    scope: Mapped[str] = mapped_column(String(20))
    format: Mapped[str] = mapped_column(String(10))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    object_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlatformRun(Identified, Base):
    __tablename__ = "platform_runs"
    external_hash: Mapped[str] = mapped_column(String(64), index=True)
    job_reference: Mapped[str] = mapped_column(String(36), unique=True)


Index(
    "members_normalized",
    Member.snapshot_id,
    Member.relation,
    func.lower(Member.username),
    Member.identity_key,
)


class SessionRevocation(Base):
    __tablename__ = "instagram_session_revocations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    profile_id: Mapped[str] = mapped_column(ForeignKey("instagram_profiles.id", ondelete="CASCADE"))
    encrypted_settings: Mapped[str] = mapped_column(Text)
    key_version: Mapped[str] = mapped_column(String(40))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
