import type { components } from "@/lib/generated-api";

export type Schemas = components["schemas"];

export type AdminAuthStatus = Schemas["AdminAuthStatusDTO"];
export type AdminOverview = Schemas["AdminOverviewDTO"];
export type AdminUser = Schemas["AdminUserDTO"];
export type AdminUserDetail = Schemas["AdminUserDetailDTO"];
export type AdminProfile = Schemas["AdminProfileDTO"];
export type AdminProfileDetail = Schemas["AdminProfileDetailDTO"];
export type AdminSnapshotDiagnostics = Schemas["AdminSnapshotDiagnosticsDTO"];
export type AdminJob = Schemas["AdminJobDTO"];
export type AdminJobDetail = Schemas["AdminJobDetailDTO"];
export type AdminTicket = Schemas["AdminTicketDTO"] & { user_id?: string | null };
export type AuditEventDTO = Schemas["AuditDTO"];
export type AdminSystemHealth = Schemas["AdminSystemHealthDTO"];
export type Privilege = Schemas["PrivilegeDTO"];
