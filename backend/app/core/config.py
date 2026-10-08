from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", hide_input_in_errors=True)
    app_env: Literal["local", "development", "staging", "production"] = "development"
    app_base_url: str = "http://localhost:3100"
    database_url: str
    redis_url: str = "redis://redis:6379/0"
    auth_vault_url: str = "redis://auth-vault:6379/0"
    broker_publish_timeout_seconds: int = Field(default=3, ge=1, le=30)
    session_cookie_name: str = "insta_session"
    session_cookie_secure: bool = False
    session_ttl_seconds: int = 604800
    csrf_secret: SecretStr
    instagram_pending_encryption_key: SecretStr
    instagram_session_encryption_key: SecretStr | None = None
    instagram_private_enabled: bool = True
    instagram_sync_interval_hours: int = 24
    instagram_manual_min_interval_hours: int = 6
    instagram_max_runs_per_24h: int = 2
    instagram_request_budget: int = 100
    instagram_request_spacing_seconds: float = 2
    instagram_platform_cooldown_hours: int = 24
    instagram_credential_ttl_seconds: int = Field(default=600, ge=1, le=600)
    max_profiles_per_user: int = 1
    max_upload_bytes: int = 104857600
    max_unpacked_bytes: int = 524288000
    max_archive_entries: int = 5000
    max_snapshot_members: int = 100000
    smtp_host: str = "mail"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_tls_mode: Literal["none", "starttls", "ssl"] = "none"
    mail_from: str = "InstaSurveillance <hello@localhost>"
    storage_backend: str = "s3"
    storage_directory: str = "/uploads"
    s3_endpoint: str = "http://storage:9000"
    s3_region: str = "us-east-1"
    s3_bucket: str = "insta-private"
    s3_access_key_id: str = "insta-dev"
    s3_secret_access_key: SecretStr
    cors_allowed_origins: str = ""
    trusted_hosts: str = "localhost,127.0.0.1,backend,testserver"
    log_level: str = "INFO"
    app_name: str = "InstaSurveillance"
    release_version: str = "local"
    db_connect_timeout_seconds: int = Field(default=3, ge=1, le=30)
    s3_storage_quota_bytes: int = Field(default=0, ge=0)
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=10, ge=0)
    session_absolute_ttl_seconds: int = Field(default=2592000, ge=60)
    instagram_login_max_attempts: int = Field(default=3, ge=1, le=3)
    instagram_session_key_version: str = "1"
    instagram_session_previous_keys: SecretStr = SecretStr("{}")
    encryption_key: SecretStr | None = None
    encryption_key_version: str = Field(default="1", pattern="^[a-zA-Z0-9._-]{1,20}$")
    encryption_previous_keys: SecretStr = SecretStr("{}")
    terms_version: str = "2026-10-07"
    privacy_version: str = "2026-10-07"
    connection_terms_version: str = "2026-10-07"
    user_storage_quota_bytes: int = Field(default=1073741824, ge=1)
    max_active_heavy_jobs_per_user: int = Field(default=2, ge=1)
    max_active_imports_per_profile: int = Field(default=1, ge=1)
    imports_per_hour: int = Field(default=10, ge=1)
    raw_file_ttl_hours: int = Field(default=24, ge=1, le=24)
    export_ttl_hours: int = Field(default=24, ge=1, le=24)
    import_confirm_ttl_hours: int = Field(default=24, ge=1, le=24)
    job_soft_timeout: int = Field(default=300, ge=30)
    job_hard_timeout: int = Field(default=600, ge=60)
    instagram_sync_soft_timeout: int = Field(default=1200, ge=60)
    instagram_sync_hard_timeout: int = Field(default=1800, ge=120)
    job_stale_seconds: int = Field(default=120, ge=60)
    job_metadata_retention_days: int = Field(default=30, ge=1)
    notification_retention_days: int = Field(default=180, ge=1)
    audit_retention_days: int = Field(default=90, ge=1)
    log_retention_days: int = Field(default=30, ge=1)
    backup_retention_days: int = Field(default=30, ge=1)
    instagram_large_change_fraction: float = Field(default=0.5, ge=0, le=1)
    instagram_large_change_min_members: int = Field(default=100, ge=1)
    enable_email_notifications: bool = True
    enable_pwa: bool = True
    enable_official_instagram: bool = False
    metrics_enabled: bool = True
    metrics_token: SecretStr = SecretStr("")
    support_email: str = ""
    operator_name: str = ""
    operator_address: str = ""
    operator_jurisdiction: str = ""
    ledger_directory: str = "/ledger"
    ledger_s3_bucket: str = ""
    ledger_s3_endpoint: str = ""
    ledger_s3_access_key_id: str = ""
    ledger_s3_secret_access_key: SecretStr = SecretStr("")
    trusted_proxy_cidrs: str = "127.0.0.1/32"
    error_tracking_dsn: str = ""
    worker_concurrency: int = Field(default=2, ge=1)
    celery_broker_url: str = ""
    s3_use_tls: bool = True
    s3_server_side_encryption: Literal["", "AES256", "aws:kms"] = "AES256"
    s3_kms_key_id: str = ""
    storage_write_timeout_seconds: int = Field(default=300, ge=30, le=900)

    @field_validator("instagram_session_encryption_key", mode="before")
    @classmethod
    def empty_worker_key(cls, value):
        return None if value == "" else value

    @model_validator(mode="after")
    def validate_runtime(self):
        from cryptography.fernet import Fernet

        if self.app_env == "local" and urlsplit(self.app_base_url).hostname not in {
            "localhost",
            "127.0.0.1",
            "::1",
        }:
            raise ValueError("Local-only authentication shortcuts require a loopback APP_BASE_URL")
        Fernet(self.instagram_pending_encryption_key.get_secret_value().encode())
        if self.instagram_session_encryption_key:
            Fernet(self.instagram_session_encryption_key.get_secret_value().encode())
        if len(self.csrf_secret.get_secret_value()) < 32:
            raise ValueError("CSRF_SECRET must contain at least 32 characters")
        if "*" in self.cors_allowed_origins:
            raise ValueError("Credentialed CORS never accepts wildcard origins")
        positive = [
            self.session_ttl_seconds,
            self.instagram_sync_interval_hours,
            self.instagram_manual_min_interval_hours,
            self.instagram_max_runs_per_24h,
            self.instagram_request_budget,
            self.instagram_request_spacing_seconds,
            self.instagram_platform_cooldown_hours,
            self.max_profiles_per_user,
            self.max_upload_bytes,
            self.max_unpacked_bytes,
            self.max_archive_entries,
            self.max_snapshot_members,
        ]
        if any(value <= 0 for value in positive):
            raise ValueError("Limits and intervals must be positive")
        if self.storage_backend not in ("s3", "filesystem"):
            raise ValueError("Unsupported storage backend")
        if (
            self.job_soft_timeout >= self.job_hard_timeout
            or self.instagram_sync_soft_timeout >= self.instagram_sync_hard_timeout
        ):
            raise ValueError("Soft timeout must precede hard timeout")
        if self.encryption_key:
            Fernet(self.encryption_key.get_secret_value().encode())
        if self.app_env == "production":
            if not self.encryption_key or not self.metrics_token.get_secret_value():
                raise ValueError("Production requires encryption and metrics keys")
            if not self.operator_name or not self.operator_jurisdiction or not self.support_email:
                raise ValueError("Production requires operator and support details")
            if self.ledger_s3_endpoint and not self.ledger_s3_endpoint.startswith("https://"):
                raise ValueError("Production deletion ledger requires TLS")
            if any(
                not origin.strip().startswith("https://")
                for origin in self.cors_allowed_origins.split(",")
                if origin.strip()
            ):
                raise ValueError("Production CORS requires HTTPS origins")
            if not self.s3_server_side_encryption:
                raise ValueError("Production object storage requires server-side encryption")
            if self.s3_server_side_encryption == "aws:kms" and not self.s3_kms_key_id:
                raise ValueError("KMS encryption requires a key identifier")
            if not self.s3_endpoint.startswith("https://") or not self.s3_use_tls:
                raise ValueError("Production S3 requires TLS")
            if not self.ledger_s3_bucket or not self.ledger_s3_secret_access_key.get_secret_value():
                raise ValueError("Production requires independent durable deletion ledger")
            if self.storage_backend != "s3":
                raise ValueError("Production requires private S3 storage")
            if not self.session_cookie_secure or not self.app_base_url.startswith("https://"):
                raise ValueError("Production requires HTTPS and secure cookies")
            if self.session_cookie_name != "__Host-session" or self.smtp_tls_mode == "none":
                raise ValueError("Production requires __Host-session and TLS SMTP")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue] -- BaseSettings populates mandatory values from environment.
