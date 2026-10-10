from datetime import datetime
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, Field

Category = Literal["followers", "following", "mutual", "not_following_back", "fans"]
Sort = Literal["username", "username_desc", "first_observed"]


class Counts(BaseModel):
    followers: int
    following: int
    mutual: int
    fans: int
    not_following_back: int
    mutual_rate: float | None


class SnapshotDTO(BaseModel):
    id: str
    source: str
    observed_at: datetime
    created_at: datetime
    completeness: str
    identity_mode: str
    checksum: str
    counts: Counts
    provenance: dict[str, Any]
    storage_bytes: int


class PersonDTO(BaseModel):
    identity_key: str
    username: str
    avatar_url: str | None = None
    favorite: bool
    note: str
    first_observed_at: datetime | None = None


class PeoplePage(BaseModel):
    items: list[PersonDTO]
    next_cursor: str | None
    total: int
    category_total: int
    snapshot_id: str | None
    observed_at: datetime | None = None
    source: str | None = None
    completeness: str | None = None
    identity_mode: str | None = None


T = TypeVar("T")


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None


class ComparisonInput(BaseModel):
    before_snapshot_id: str
    after_snapshot_id: str


class ExportInput(BaseModel):
    scope: Literal["list", "comparison", "account"]
    format: Literal["csv", "json"]
    profile_id: str | None = None
    snapshot_id: str | None = None
    comparison_id: str | None = None
    category: Category = "followers"
    search: str = Field(default="", max_length=100)
    favorite: bool = False
    has_note: bool = False
    sort: Sort = "username"
    relation: Literal["followers", "following"] | None = None
    type: Literal["added", "removed"] | None = None


class EventDTO(BaseModel):
    id: str
    identity_key: str
    username: str
    relation: Literal["followers", "following"]
    type: Literal["added", "removed"]


class ProviderResponseDTO(BaseModel):
    endpoint: str
    http_status: int
    response_kind: Literal["empty", "json", "non_json"]
    error_category: str | None
    retry_after_present: bool


class JobDetails(BaseModel):
    provider_http_status: int | None = None
    provider_responses: list[ProviderResponseDTO] = []
    counts: Counts | None = None
    stage_count: int | None = None
    snapshot_id: str | None = None
    comparison_id: str | None = None
    export_id: str | None = None
    requests: int | None = None
    pages: int | None = None
    filename: str | None = None
    warnings: list[str] = []
    samples: dict[str, list[str]] = {}
    used_bytes: int | None = None
    expected_bytes: int | None = None
    provider_version: str | None = None
    method: str | None = None
    destination_mask: str | None = None
    expires_at: datetime | None = None


class JobDTO(BaseModel):
    id: str
    kind: str
    status: str
    stage: str
    error_code: str | None
    details: JobDetails
    created_at: datetime
    updated_at: datetime | None = None
    allowed_actions: list[str] = []
    next_allowed_at: datetime | None = None


class UserDTO(BaseModel):
    id: str
    email: str
    verified: bool
    theme: Literal["light", "dark"]
    email_notifications: bool
    timezone: str
    role: str
    permissions: list[str]


class ProfileDTO(BaseModel):
    id: str
    username: str
    label: str
    interval_hours: int
    status: str
    paused: bool
    last_sync: datetime | None
    next_sync: datetime | None
    cooldown_until: datetime | None


class SummaryDTO(BaseModel):
    last_import: JobDTO | None = None
    profile: ProfileDTO
    snapshot: SnapshotDTO | None
    counts: Counts | None
    changes: list[dict[str, str]] | None
    change_counts: dict[str, int] | None = None
    previous_snapshot: SnapshotDTO | None = None


class ExportDTO(BaseModel):
    id: str
    status: str
    format: Literal["csv", "json"]
    expires_at: datetime
    job: JobDTO | None = None


class ComparisonDTO(BaseModel):
    id: str
    status: str
    counts: dict[str, int]
    identity_mode: str
    interval: dict[str, datetime]
    job: JobDTO | None = None
    compared_relations: list[Literal["followers", "following"]] = []


class AnalyticsPoint(Counts):
    id: str
    date: datetime


class PeriodSnapshotsDTO(BaseModel):
    before: SnapshotDTO | None
    after: SnapshotDTO | None
    count: int


class CommandDTO(BaseModel):
    id: str
    status: str


class NotificationDTO(BaseModel):
    id: str
    title: str
    body: str
    kind: str
    read: bool
    link: str
    created_at: datetime


class DeliveryDTO(BaseModel):
    id: str
    status: str
    attempts: int
    created_at: datetime
    next_attempt_at: datetime | None
    error_code: str | None


class SessionDTO(BaseModel):
    id: str
    device: str
    created_at: datetime
    last_seen: datetime | None
    expires_at: datetime
    current: bool


class ConnectionDTO(ProfileDTO):
    display_status: str
    job: JobDTO | None
    can_sync: bool
    next_allowed_at: datetime | None
    provider_enabled: bool


class TicketDTO(BaseModel):
    id: str
    category: str
    body: str
    reply: str
    status: str
    created_at: datetime


class PublicConfigDTO(BaseModel):
    local_email_verification: bool
    instagram_enabled: bool
    max_upload_bytes: int
    sync_interval_hours: int
    manual_min_interval_hours: int
    max_runs_per_24h: int
    terms_version: str
    privacy_version: str
    connection_terms_version: str
    user_storage_quota_bytes: int
    enable_email_notifications: bool
    enable_pwa: bool
    enable_official_instagram: bool
    operator_name: str
    operator_address: str
    operator_jurisdiction: str
    support_email: str
    backup_retention_days: int


class StatusDTO(BaseModel):
    status: str


class MessageDTO(BaseModel):
    message: str


class CSRFDTO(BaseModel):
    csrf_token: str


class AnnotationDTO(BaseModel):
    favorite: bool
    note: str


class PrivilegeDTO(BaseModel):
    expires_at: datetime


class DeletionDTO(BaseModel):
    id: str
    status: str
    receipt_token: str
    expires_at: datetime
    cleanup_deadline: datetime
    backup_retention_days: int


class DeletionStatusDTO(BaseModel):
    id: str
    status: str
    completed_at: datetime | None
    cleanup_deadline: datetime


class AdminUserDTO(BaseModel):
    id: str
    email: str
    verified: bool
    role: str
    status: str
    created_at: datetime


class AdminJobDTO(BaseModel):
    id: str
    kind: str
    status: str
    stage: str
    error_code: str | None
    attempts: int
    created_at: datetime
    heartbeat_at: datetime | None


class AdminTicketDTO(TicketDTO):
    request_id: str | None


class AuditDTO(BaseModel):
    id: str
    actor_id: str | None
    action: str
    target: str
    request_id: str | None
    metadata: dict[str, Any]
    created_at: datetime


class AdminOverviewDTO(BaseModel):
    users: int
    jobs: dict[str, int]
    limits: dict[str, int]
    release: str
