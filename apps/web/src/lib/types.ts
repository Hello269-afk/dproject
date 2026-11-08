// Types mirroring docs/PROTOCOL.md (v1 + Phase 2 §8-11). Change PROTOCOL.md first, then these.

export type ISODate = string;

// ---- Enums ---------------------------------------------------------------

export const DEVICE_STATUSES = [
  "pending_enrollment",
  "awaiting_user_approval",
  "authenticating",
  "authenticated",
  "connected",
  "disconnected",
  "permission_required",
  "non_compliant",
  "revoked",
  "suspended",
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export type LifecycleStatus = "authenticated" | "suspended" | "revoked";

export const ENROLLMENT_STATUSES = [
  "generated",
  "scanned",
  "app_opened",
  "permissions_approved",
  "authenticated",
  "connected",
  "expired",
  "revoked",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const PERMISSION_STATUSES = [
  "not_requested",
  "awaiting_approval",
  "granted",
  "denied",
  "restricted_by_os",
  "revoked",
  "not_supported",
] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

export const PERMISSION_KEYS = [
  "screen_capture",
  "camera",
  "microphone",
  "location",
  "notifications",
  "accessibility",
  "device_admin",
  "files",
  "usage_access",
  "background",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const SCREEN_SESSION_STATUSES = [
  "awaiting_consent",
  "connecting",
  "active",
  "ended",
  "rejected",
  "expired",
  "failed",
] as const;
export type ScreenSessionStatus = (typeof SCREEN_SESSION_STATUSES)[number];

export type Platform = "android" | "ios";

// ---- Phase 2 enums (§8-11) -------------------------------------------------

export type Ownership = "company" | "personal";
export type ManagementMode = "device_owner" | "device_admin" | "none";

export const CAPABILITIES = ["lock", "reboot", "wipe", "remote_control", "apply_policy"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const COMMAND_ACTIONS = ["lock", "reboot", "wipe", "apply_policy"] as const;
export type CommandAction = (typeof COMMAND_ACTIONS)[number];

export const COMMAND_STATUSES = ["pending", "sent", "succeeded", "failed", "unsupported", "cancelled", "expired"] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export type PasscodeLevel = "none" | "low" | "medium" | "high";
export type GlobalAction = "back" | "home" | "recents" | "notifications" | "quick_settings";

export type Role = "owner" | "admin" | "operator" | "viewer" | "member";
export const ROLES: Role[] = ["owner", "admin", "operator", "viewer", "member"];

export type ScreenEndReason =
  | "admin_stopped"
  | "user_stopped"
  | "device_disconnected"
  | "admin_disconnected"
  | "consent_timeout"
  | "max_duration"
  | "rejected"
  | "os_denied"
  | "device_revoked"
  | "error";

// ---- Objects -------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  slug: string;
  supportEmail: string | null;
  supportPhone: string | null;
  createdAt: ISODate;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  status: "active" | "disabled";
  createdAt: ISODate;
  lastLoginAt: ISODate | null;
}

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

export interface Enrollment {
  id: string;
  orgId: string;
  status: EnrollmentStatus;
  assignedUser: UserRef | null;
  deviceNameHint: string | null;
  requestedPermissions: PermissionKey[];
  requiredPermissions: PermissionKey[];
  expiresAt: ISODate;
  createdAt: ISODate;
  createdBy: { id: string; name: string };
  scannedAt: ISODate | null;
  appOpenedAt: ISODate | null;
  permissionsApprovedAt: ISODate | null;
  authenticatedAt: ISODate | null;
  connectedAt: ISODate | null;
  revokedAt: ISODate | null;
  deviceId: string | null;
  /** §8. Older API builds may omit it (treated as "personal"). */
  ownership?: Ownership;
}

export type NetworkType = "wifi" | "cellular" | "ethernet" | "none" | "other";
export type Orientation = "portrait" | "landscape";

export interface Telemetry {
  batteryPct: number | null;
  charging: boolean | null;
  networkType: NetworkType | null;
  wifiSsid: string | null;
  carrier: string | null;
  ipAddress: string | null;
  storageTotalBytes: number | null;
  storageFreeBytes: number | null;
  memoryTotalBytes: number | null;
  memoryAvailBytes: number | null;
  screenWidth: number | null;
  screenHeight: number | null;
  orientation: Orientation | null;
  location: { lat: number; lng: number; accuracyM: number | null; at: ISODate } | null;
  reportedAt: ISODate;
}

export interface DevicePermission {
  key: PermissionKey;
  status: PermissionStatus;
  required: boolean;
  updatedAt: ISODate;
}

export interface Device {
  id: string;
  orgId: string;
  name: string;
  platform: Platform;
  manufacturer: string;
  model: string;
  osVersion: string;
  appVersion: string;
  installationId: string;
  lifecycleStatus: LifecycleStatus;
  displayStatus: DeviceStatus;
  online: boolean;
  assignedUser: UserRef | null;
  metadata: Record<string, string>;
  lastSeenAt: ISODate | null;
  enrolledAt: ISODate;
  suspendedAt: ISODate | null;
  revokedAt: ISODate | null;
  telemetry: Telemetry | null;
  permissions: DevicePermission[];
  activeScreenSessionId: string | null;
  // §8 (Phase 2). Reported by the agent; read through the helpers in lib/devices.ts
  // so devices from an older API/agent degrade gracefully.
  ownership: Ownership;
  managementMode: ManagementMode;
  compliance: Compliance | null;
  /** Remote actions the agent says it can perform right now (string[] per protocol). */
  capabilities: string[];
}

export interface Compliance {
  policyVersion: number | null;
  enforced: boolean;
  passcodeSufficient: boolean | null;
  encrypted: boolean | null;
  securityPatch: string | null;
  issues: string[];
  checkedAt: ISODate;
}

export interface Policy {
  version: number;
  passcode: PasscodeLevel;
  maxScreenLockTimeoutSec: number | null;
  disableCamera: boolean;
  disallowUsbDebugging: boolean;
  disallowFactoryResetByUser: boolean;
  minAndroidPatchAgeDays: number | null;
  updatedAt: ISODate;
  updatedBy: { id: string; name: string } | null;
}

/** PUT /api/policy body: Policy fields without version/metadata. */
export type PolicyInput = Omit<Policy, "version" | "updatedAt" | "updatedBy">;

export interface DeviceCommand {
  id: string;
  deviceId: string;
  action: CommandAction;
  status: CommandStatus;
  requestedBy: { id: string; name: string } | null;
  reason: string;
  createdAt: ISODate;
  sentAt: ISODate | null;
  completedAt: ISODate | null;
  error: string | null;
}

export type ControlInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "long_press"; x: number; y: number }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; durationMs: number }
  | { kind: "global"; action: GlobalAction }
  | { kind: "text"; text: string };

export interface ScreenSession {
  id: string;
  orgId: string;
  deviceId: string;
  deviceName: string;
  requestedBy: UserRef;
  purpose: string;
  status: ScreenSessionStatus;
  requestedAt: ISODate;
  consentedAt: ISODate | null;
  startedAt: ISODate | null;
  endedAt: ISODate | null;
  expiresAt: ISODate;
  endReason: ScreenEndReason | string | null;
  // §9 remote control
  controlRequested: boolean;
  controlGranted: boolean;
  inputCount: number;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorType: "user" | "device" | "system";
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  createdAt: ISODate;
}

export interface SupportMessage {
  id: string;
  deviceId: string;
  direction: "to_device" | "from_device";
  senderName: string | null;
  body: string;
  createdAt: ISODate;
  readAt: ISODate | null;
}

export interface PlatformSupport {
  supported: boolean;
  mechanism: string;
  userApproval: boolean;
  notes: string;
}

export interface PermissionDefinition {
  key: PermissionKey;
  name: string;
  description: string;
  why: string;
  android: PlatformSupport;
  ios: PlatformSupport;
  manageInstructions: { android: string; ios: string };
}

export interface PermissionHistoryEntry {
  key: PermissionKey;
  from: PermissionStatus | null;
  to: PermissionStatus;
  at: ISODate;
}

// ---- REST responses ------------------------------------------------------

export interface AuthResponse {
  accessToken: string;
  user: User;
  organization: Organization;
}

export interface OverviewCounts {
  total: number;
  authenticated: number;
  online: number;
  offline: number;
  awaitingApproval: number;
  activeScreenSessions: number;
  needsAttention: number;
  suspended: number;
  revoked: number;
  nonCompliant: number;
  pendingCommands: number;
}

export interface OverviewResponse {
  counts: OverviewCounts;
  enrollmentsByDay: { date: string; count: number }[];
  activityByDay: { date: string; count: number }[];
  platformSplit: { platform: Platform; count: number }[];
  statusSplit: { status: DeviceStatus; count: number }[];
  recentActivity: AuditLog[];
}

export interface CreateEnrollmentBody {
  assignedUserId?: string;
  deviceNameHint?: string;
  expiresInMinutes: number;
  requestedPermissions: PermissionKey[];
  requiredPermissions: PermissionKey[];
  ownership: Ownership;
}

export interface AndroidProvisioning {
  /** JSON string to encode in the factory-reset (6-tap) QR code. */
  qrPayload: string;
  instructions: string;
}

export interface CreateEnrollmentResponse {
  enrollment: Enrollment;
  token: string;
  enrollmentUrl: string;
  pairingCode: string;
  appLink: string;
  /** Only for ownership "company" (§8). */
  androidProvisioning?: AndroidProvisioning | null;
  androidProvisioningUnavailableReason?: string | null;
}

export interface CreateScreenSessionResponse {
  session: ScreenSession;
  iceServers: RTCIceServer[];
}

export interface PublicScanResponse {
  organization: { name: string };
  expiresAt: ISODate;
  requestedPermissions: PermissionDefinition[];
  requiredPermissions: PermissionKey[];
  appDownloadUrl: string | null;
  appLink: string;
}

// ---- WebSocket -----------------------------------------------------------

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/** Server → admin messages, keyed by `type`. */
export interface ServerEventMap {
  hello: { user: User };
  "device.updated": { device: Device };
  "device.telemetry": { deviceId: string; telemetry: Telemetry; lastSeenAt: ISODate };
  "enrollment.updated": { enrollment: Enrollment };
  "screen.session.updated": { session: ScreenSession };
  "message.created": { message: SupportMessage };
  "audit.created": { log: AuditLog };
  "command.updated": { command: DeviceCommand };
  "rtc.answer": { sessionId: string; sdp: string };
  "rtc.ice": { sessionId: string; candidate: IceCandidatePayload };
  "screen.meta": { sessionId: string; orientation: Orientation; width: number; height: number };
  ping: Record<string, never>;
  pong: Record<string, never>;
}
export type ServerEventType = keyof ServerEventMap;

/** Admin → server messages. */
export type ClientMessage =
  | { type: "rtc.offer"; sessionId: string; sdp: string }
  | { type: "rtc.ice"; sessionId: string; candidate: IceCandidatePayload }
  | { type: "screen.connected"; sessionId: string }
  | { type: "screen.stats"; sessionId: string; bitrateKbps: number; fps: number; width: number; height: number }
  | { type: "control.input"; sessionId: string; input: ControlInput }
  | { type: "ping" }
  | { type: "pong" };
