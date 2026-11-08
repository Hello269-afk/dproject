import type {
  Capability,
  CommandAction,
  CommandStatus,
  DeviceStatus,
  ManagementMode,
  Ownership,
  PasscodeLevel,
  EnrollmentStatus,
  NetworkType,
  PermissionKey,
  PermissionStatus,
  Platform,
  Role,
  ScreenSessionStatus,
} from "./types";

/** `caution` is the orange tone used for non-compliance (distinct from amber `warning`). */
export type Tone = "success" | "warning" | "caution" | "danger" | "neutral" | "session" | "info" | "accent";

interface Meta {
  label: string;
  tone: Tone;
  description?: string;
}

export const DEVICE_STATUS_META: Record<DeviceStatus, Meta> = {
  pending_enrollment: { label: "Pending enrollment", tone: "neutral", description: "Enrollment created, device not yet enrolled." },
  awaiting_user_approval: { label: "Awaiting approval", tone: "warning", description: "Waiting for the device user to review permissions." },
  authenticating: { label: "Authenticating", tone: "info", description: "Device is completing enrollment." },
  authenticated: { label: "Authenticated", tone: "accent", description: "Enrolled, but has not connected yet." },
  connected: { label: "Connected", tone: "success", description: "Online with all required permissions granted." },
  disconnected: { label: "Disconnected", tone: "neutral", description: "Enrolled device that is currently offline." },
  permission_required: { label: "Permission required", tone: "warning", description: "Online, but a required permission is not granted." },
  non_compliant: { label: "Non-compliant", tone: "caution", description: "Online, but the device reports security-policy compliance issues." },
  revoked: { label: "Revoked", tone: "danger", description: "Credentials revoked. The device can no longer connect." },
  suspended: { label: "Suspended", tone: "danger", description: "Temporarily blocked by an administrator." },
};

export const ENROLLMENT_STATUS_META: Record<EnrollmentStatus, Meta> = {
  generated: { label: "Generated", tone: "neutral" },
  scanned: { label: "Scanned", tone: "info" },
  app_opened: { label: "App opened", tone: "info" },
  permissions_approved: { label: "Permissions approved", tone: "accent" },
  authenticated: { label: "Authenticated", tone: "accent" },
  connected: { label: "Connected", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "danger" },
};

/** The happy-path order used by the enrollment stepper / progress. */
export const ENROLLMENT_STEPS: { status: EnrollmentStatus; label: string; atKey: string | null }[] = [
  { status: "generated", label: "Generated", atKey: "createdAt" },
  { status: "scanned", label: "Scanned", atKey: "scannedAt" },
  { status: "app_opened", label: "App Opened", atKey: "appOpenedAt" },
  { status: "permissions_approved", label: "Permissions Approved", atKey: "permissionsApprovedAt" },
  { status: "authenticated", label: "Authenticated", atKey: "authenticatedAt" },
  { status: "connected", label: "Connected", atKey: "connectedAt" },
];

export function enrollmentStepIndex(status: EnrollmentStatus): number {
  return ENROLLMENT_STEPS.findIndex((s) => s.status === status);
}

export const PERMISSION_STATUS_META: Record<PermissionStatus, Meta> = {
  not_requested: { label: "Not requested", tone: "neutral" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  granted: { label: "Granted", tone: "success" },
  denied: { label: "Denied", tone: "danger" },
  restricted_by_os: { label: "Restricted by OS", tone: "warning" },
  revoked: { label: "Revoked", tone: "danger" },
  not_supported: { label: "Not supported", tone: "neutral" },
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  screen_capture: "Screen capture",
  camera: "Camera",
  microphone: "Microphone",
  location: "Location",
  notifications: "Notifications",
  accessibility: "Accessibility",
  device_admin: "Device admin",
  files: "Files",
  usage_access: "Usage access",
  background: "Background activity",
};

export const SESSION_STATUS_META: Record<ScreenSessionStatus, Meta> = {
  awaiting_consent: { label: "Awaiting consent", tone: "warning" },
  connecting: { label: "Connecting", tone: "info" },
  active: { label: "Live", tone: "session" },
  ended: { label: "Ended", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export const TERMINAL_SESSION_STATUSES: ScreenSessionStatus[] = ["ended", "rejected", "expired", "failed"];
export function isSessionTerminal(status: ScreenSessionStatus) {
  return TERMINAL_SESSION_STATUSES.includes(status);
}

export const END_REASON_TEXT: Record<string, string> = {
  admin_stopped: "Stopped by an administrator.",
  user_stopped: "The device user stopped sharing.",
  device_disconnected: "The device disconnected and did not come back within 30 seconds.",
  admin_disconnected: "The requesting administrator disconnected for more than 30 seconds.",
  consent_timeout: "The device user did not respond within 60 seconds.",
  max_duration: "The session reached the maximum allowed duration.",
  rejected: "The device user declined the request.",
  os_denied: "The operating system's screen-capture prompt was cancelled or denied.",
  device_revoked: "The device was suspended or revoked.",
  user_unenrolled: "The device user unenrolled the device.",
  error: "The session ended because of an error.",
};

export function endReasonText(reason: string | null | undefined): string {
  if (!reason) return "No reason recorded.";
  return END_REASON_TEXT[reason] ?? reason.replace(/_/g, " ");
}

export const PLATFORM_LABEL: Record<Platform, string> = { android: "Android", ios: "iOS" };

export const NETWORK_LABEL: Record<NetworkType, string> = {
  wifi: "Wi-Fi",
  cellular: "Cellular",
  ethernet: "Ethernet",
  none: "No network",
  other: "Other",
};

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Everything, including organisation settings and managing admins." },
  admin: { label: "Admin", description: "Devices (suspend/revoke), enrollments, users (not owners), audit log." },
  operator: { label: "Operator", description: "View devices, create enrollments, screen sharing, messages, check-ins." },
  viewer: { label: "Viewer", description: "Read-only access to devices, telemetry and sessions." },
  member: { label: "Member", description: "A device user. Cannot sign in to the dashboard." },
};

export const ROLE_RANK: Record<Role, number> = { member: 0, viewer: 1, operator: 2, admin: 3, owner: 4 };

export function hasRole(role: Role | undefined | null, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// ---- Phase 2 (§8-11) --------------------------------------------------------

export const OWNERSHIP_META: Record<Ownership, { label: string; short: string; description: string }> = {
  company: {
    label: "Company-owned",
    short: "Company",
    description: "The organisation owns the phone. It can be fully managed (device owner): lock, reboot, wipe and enforced policy.",
  },
  personal: {
    label: "Personal (BYOD)",
    short: "Personal",
    description: "The employee owns the phone. Limited management: no wipe, policy is reported for compliance but not enforced.",
  },
};

export const MANAGEMENT_MODE_META: Record<ManagementMode, Meta & { explanation: string }> = {
  device_owner: {
    label: "Device owner",
    tone: "success",
    explanation: "Fully managed. Provisioned from a factory reset, so the agent can lock, reboot, wipe and enforce policy.",
  },
  device_admin: {
    label: "Device admin",
    tone: "info",
    explanation: "Device admin is active. The agent can usually lock the screen, but cannot reboot, wipe or enforce most policy.",
  },
  none: {
    label: "Not managed",
    tone: "neutral",
    explanation: "No device-management rights. The agent reports status and compliance only.",
  },
};

export const CAPABILITY_LABEL: Record<Capability, string> = {
  lock: "Lock",
  reboot: "Reboot",
  wipe: "Wipe",
  remote_control: "Remote control",
  apply_policy: "Apply policy",
};

export const COMMAND_ACTION_LABEL: Record<CommandAction, string> = {
  lock: "Lock screen",
  reboot: "Reboot",
  wipe: "Factory wipe",
  apply_policy: "Apply policy",
};

export const COMMAND_STATUS_META: Record<CommandStatus, Meta> = {
  pending: { label: "Queued", tone: "warning", description: "Waiting for the device to connect." },
  sent: { label: "Sent", tone: "info", description: "Delivered to the device, waiting for a result." },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  unsupported: { label: "Unsupported", tone: "neutral", description: "The device said it can't perform this action." },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral", description: "Not delivered within 7 days." },
};

export function isCommandOpen(status: CommandStatus) {
  return status === "pending" || status === "sent";
}

export const PASSCODE_META: Record<PasscodeLevel, { label: string; help: string }> = {
  none: { label: "None", help: "No screen-lock requirement." },
  low: { label: "Low", help: "Any screen lock: pattern or a simple PIN (e.g. 1111, 1234)." },
  medium: { label: "Medium", help: "PIN with no repeating or sequential digits (4+), or an alphabetic password (4+)." },
  high: { label: "High", help: "PIN with no repeats or sequences (8+), or an alphanumeric password (6+)." },
};
