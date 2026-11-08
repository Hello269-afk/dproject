import type { Capability, Device, ManagementMode, Ownership, PermissionKey, Role } from "./types";
import { hasRole } from "./labels";

/** Why screen sharing can't start right now, or null if it can. */
export function screenShareBlockReason(device: Device, role: Role | undefined): string | null {
  if (!hasRole(role, "operator")) return "Screen sharing requires the operator role or higher.";
  if (device.lifecycleStatus === "revoked") return "This device has been revoked.";
  if (device.lifecycleStatus === "suspended") return "This device is suspended. Resume it first.";
  if (!device.online) return "The device is offline. It must be connected to receive a request.";
  const sc = device.permissions.find((p) => p.key === "screen_capture");
  if (sc?.status === "denied") return "The device user opted out of screen-share requests.";
  if (sc?.status === "not_supported") return "Screen capture is not supported on this device.";
  return null;
}

export function deviceUserName(device: Device): string {
  return device.assignedUser?.name ?? "the device user";
}

export function deviceSubtitle(device: Device): string {
  const parts = [device.manufacturer, device.model].filter(Boolean);
  return parts.join(" ") || "Unknown model";
}

// ---- Phase 2 (§8-11) --------------------------------------------------------
// Devices from an older API/agent may not carry these fields yet: read them
// through these helpers so the UI degrades to "not reported" instead of crashing.

export function deviceOwnership(device: Device): Ownership {
  return device.ownership === "company" ? "company" : "personal";
}

export function deviceManagementMode(device: Device): ManagementMode {
  return device.managementMode ?? "none";
}

export function deviceCapabilities(device: Device): string[] {
  return Array.isArray(device.capabilities) ? device.capabilities : [];
}

export function hasCapability(device: Device, cap: Capability): boolean {
  return deviceCapabilities(device).includes(cap);
}

export function permissionStatus(device: Device, key: PermissionKey) {
  return device.permissions.find((p) => p.key === key)?.status ?? null;
}

export interface RemoteControlReadiness {
  accessibility: boolean;
  capability: boolean;
  online: boolean;
  /** Ready to request a control session right now. */
  ready: boolean;
  /** Why control can't be requested (null when ready). */
  reason: string | null;
}

/** §9: the device-side preconditions for requesting remote control. */
export function remoteControlReadiness(device: Device): RemoteControlReadiness {
  const accessibility = permissionStatus(device, "accessibility") === "granted";
  const capability = hasCapability(device, "remote_control");
  const online = device.online && device.lifecycleStatus === "authenticated";
  let reason: string | null = null;
  if (device.platform === "ios") reason = "iOS does not allow apps to control the screen.";
  else if (!accessibility) reason = "The device user hasn't turned on the MDM accessibility service, which remote control needs.";
  else if (!capability) reason = "The device app doesn't report remote-control support (update the MDM app).";
  else if (!online) reason = "The device is offline.";
  return { accessibility, capability, online, ready: !reason, reason };
}

export type SecurityAction = "lock" | "reboot" | "wipe";

const ACTION_MIN_ROLE: Record<SecurityAction, Role> = { lock: "operator", reboot: "admin", wipe: "admin" };

export interface SecurityActionAvailability {
  /** Why the action can't be requested (null when allowed). */
  blockReason: string | null;
  /** Allowed, but the device is offline so it will be queued. */
  queued: boolean;
}

/** §10 role, ownership and capability rules for a remote security action. */
export function securityActionAvailability(device: Device, action: SecurityAction, role: Role | undefined): SecurityActionAvailability {
  const min = ACTION_MIN_ROLE[action];
  const no = (blockReason: string): SecurityActionAvailability => ({ blockReason, queued: false });
  if (!hasRole(role, min)) return no(`Requires the ${min} role or higher.`);
  if (device.lifecycleStatus === "revoked") return no("This device has been revoked.");
  if (device.lifecycleStatus === "suspended") return no("This device is suspended, so it can't receive commands. Resume it first.");
  if (action === "wipe" && deviceOwnership(device) !== "company")
    return no("Wipe is only available on company-owned devices. For a personal phone, revoke it instead.");
  if (!hasCapability(device, action)) {
    const mode = deviceManagementMode(device);
    if (!Array.isArray(device.capabilities))
      return no("The device hasn't reported its capabilities yet. Update the MDM app on the device.");
    if (action === "lock" && mode === "none") return no("Requires device admin or company-owned setup (device owner).");
    if (mode !== "device_owner") return no("Requires company-owned setup (device owner).");
    return no("The device reports it can't perform this action right now.");
  }
  return { blockReason: null, queued: !device.online };
}
