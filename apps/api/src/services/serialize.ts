import type { Queryable } from '../db/index.js';
import { hub } from '../realtime/hub.js';

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (d instanceof Date ? d : new Date(d)).toISOString();

type Person = { id: string; name: string; email: string } | null;
const person = (id: string | null, name: string | null, email: string | null): Person =>
  id ? { id, name: name ?? '', email: email ?? '' } : null;

export function orgDto(r: any) {
  return {
    id: r.id, name: r.name, slug: r.slug,
    supportEmail: r.support_email ?? null, supportPhone: r.support_phone ?? null,
    createdAt: iso(r.created_at),
  };
}

export function userDto(r: any) {
  return {
    id: r.id, orgId: r.org_id, email: r.email, name: r.name, role: r.role, status: r.status,
    createdAt: iso(r.created_at), lastLoginAt: iso(r.last_login_at),
  };
}

// ---------- Enrollments ----------

const ENROLLMENT_SELECT = `
  SELECT e.*, au.name AS au_name, au.email AS au_email, cb.name AS cb_name
  FROM enrollments e
  LEFT JOIN users au ON au.id = e.assigned_user_id
  JOIN users cb ON cb.id = e.created_by`;

export function enrollmentDto(r: any) {
  // Expiry is evaluated lazily: a still-pending invitation past its deadline reads as expired.
  const pending = ['generated', 'scanned', 'app_opened', 'permissions_approved'].includes(r.status);
  const status = pending && new Date(r.expires_at).getTime() < Date.now() ? 'expired' : r.status;
  return {
    id: r.id, orgId: r.org_id, status, ownership: r.ownership ?? 'personal',
    assignedUser: person(r.assigned_user_id, r.au_name, r.au_email),
    deviceNameHint: r.device_name_hint ?? null,
    requestedPermissions: r.requested_permissions ?? [],
    requiredPermissions: r.required_permissions ?? [],
    expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
    createdBy: { id: r.created_by, name: r.cb_name },
    scannedAt: iso(r.scanned_at), appOpenedAt: iso(r.app_opened_at),
    permissionsApprovedAt: iso(r.permissions_approved_at), authenticatedAt: iso(r.authenticated_at),
    connectedAt: iso(r.connected_at), revokedAt: iso(r.revoked_at),
    deviceId: r.device_id ?? null,
  };
}

export async function loadEnrollments(q: Queryable, orgId: string, where = '', params: unknown[] = []) {
  const rows = await q.query(`${ENROLLMENT_SELECT} WHERE e.org_id = $1 ${where} ORDER BY e.created_at DESC LIMIT 500`, [orgId, ...params]);
  return rows.map(enrollmentDto);
}

export async function loadEnrollment(q: Queryable, id: string) {
  const [r] = await q.query(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [id]);
  return r ? enrollmentDto(r) : null;
}

// ---------- Devices ----------

export function telemetryDto(data: any) {
  if (!data) return null;
  return { ...data };
}

export function displayStatus(
  d: { lifecycle_status: string; ever_connected: boolean; compliance?: any },
  online: boolean,
  missingRequired: boolean,
) {
  if (d.lifecycle_status === 'revoked') return 'revoked';
  if (d.lifecycle_status === 'suspended') return 'suspended';
  if (online) {
    if (missingRequired) return 'permission_required';
    return d.compliance?.issues?.length ? 'non_compliant' : 'connected';
  }
  return d.ever_connected ? 'disconnected' : 'authenticated';
}

/** Loads full Device DTOs for an org, optionally restricted to specific ids. */
export async function loadDevices(q: Queryable, orgId: string, ids?: string[]) {
  const filter = ids ? 'AND d.id = ANY($2::uuid[])' : '';
  const params: unknown[] = ids ? [orgId, ids] : [orgId];
  const rows = await q.query(
    `SELECT d.*, u.name AS au_name, u.email AS au_email, t.data AS telemetry,
            (SELECT s.id FROM screen_sessions s WHERE s.device_id = d.id
               AND s.status IN ('awaiting_consent','connecting','active') LIMIT 1) AS active_session_id
     FROM devices d
     LEFT JOIN users u ON u.id = d.assigned_user_id
     LEFT JOIN device_telemetry t ON t.device_id = d.id
     WHERE d.org_id = $1 ${filter}
     ORDER BY d.enrolled_at DESC`,
    params,
  );
  if (!rows.length) return [];
  const perms = await q.query(
    `SELECT device_id, key, status, required, updated_at FROM device_permissions WHERE device_id = ANY($1::uuid[]) ORDER BY key`,
    [rows.map((r) => r.id)],
  );
  const byDevice = new Map<string, any[]>();
  for (const p of perms) {
    const list = byDevice.get(p.device_id) ?? [];
    list.push({ key: p.key, status: p.status, required: p.required, updatedAt: iso(p.updated_at) });
    byDevice.set(p.device_id, list);
  }
  return rows.map((r) => {
    const permissions = byDevice.get(r.id) ?? [];
    const online = hub.isDeviceOnline(r.id);
    const missingRequired = permissions.some((p) => p.required && p.status !== 'granted');
    return {
      id: r.id, orgId: r.org_id, name: r.name, platform: r.platform,
      manufacturer: r.manufacturer, model: r.model, osVersion: r.os_version, appVersion: r.app_version,
      installationId: r.installation_id,
      lifecycleStatus: r.lifecycle_status,
      displayStatus: displayStatus(r, online, missingRequired),
      online,
      ownership: r.ownership,
      managementMode: r.management_mode,
      capabilities: r.capabilities ?? [],
      compliance: r.compliance ?? null,
      assignedUser: person(r.assigned_user_id, r.au_name, r.au_email),
      metadata: r.metadata ?? {},
      lastSeenAt: iso(r.last_seen_at), enrolledAt: iso(r.enrolled_at),
      suspendedAt: iso(r.suspended_at), revokedAt: iso(r.revoked_at),
      telemetry: telemetryDto(r.telemetry),
      permissions,
      activeScreenSessionId: r.active_session_id ?? null,
    };
  });
}

export async function loadDevice(q: Queryable, orgId: string, id: string) {
  return (await loadDevices(q, orgId, [id]))[0] ?? null;
}

// ---------- Screen sessions ----------

const SESSION_SELECT = `
  SELECT s.*, d.name AS device_name, u.name AS rb_name, u.email AS rb_email
  FROM screen_sessions s
  JOIN devices d ON d.id = s.device_id
  JOIN users u ON u.id = s.requested_by`;

export function sessionDto(r: any) {
  return {
    id: r.id, orgId: r.org_id, deviceId: r.device_id, deviceName: r.device_name,
    requestedBy: { id: r.requested_by, name: r.rb_name, email: r.rb_email },
    purpose: r.purpose, status: r.status,
    controlRequested: r.control_requested, controlGranted: r.control_granted, inputCount: r.input_count,
    requestedAt: iso(r.requested_at), consentedAt: iso(r.consented_at), startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at), expiresAt: iso(r.expires_at), endReason: r.end_reason ?? null,
  };
}

export async function loadSession(q: Queryable, id: string) {
  const [r] = await q.query(`${SESSION_SELECT} WHERE s.id = $1`, [id]);
  return r ? sessionDto(r) : null;
}

export async function loadSessions(q: Queryable, orgId: string, where = '', params: unknown[] = []) {
  const rows = await q.query(`${SESSION_SELECT} WHERE s.org_id = $1 ${where} ORDER BY s.requested_at DESC LIMIT 200`, [orgId, ...params]);
  return rows.map(sessionDto);
}

// ---------- Messages & audit ----------

export function messageDto(r: any) {
  return {
    id: r.id, deviceId: r.device_id, direction: r.direction, senderName: r.sender_name ?? null,
    body: r.body, createdAt: iso(r.created_at), readAt: iso(r.read_at),
  };
}

export function auditDto(r: any) {
  return {
    id: String(r.id), orgId: r.org_id, actorType: r.actor_type, actorId: r.actor_id ?? null,
    actorName: r.actor_name ?? null, action: r.action, targetType: r.target_type ?? null,
    targetId: r.target_id ?? null, ip: r.ip ?? null, metadata: r.metadata ?? {}, createdAt: iso(r.created_at),
  };
}

// ---------- Commands & policy ----------

export function commandDto(r: any) {
  return {
    id: r.id, deviceId: r.device_id, action: r.action, status: r.status,
    requestedBy: r.requested_by ? { id: r.requested_by, name: r.rb_name ?? '' } : null,
    reason: r.reason, createdAt: iso(r.created_at), sentAt: iso(r.sent_at), completedAt: iso(r.completed_at),
    error: r.error ?? null,
  };
}

export async function loadCommand(q: Queryable, id: string) {
  const [r] = await q.query(`SELECT c.*, u.name AS rb_name FROM device_commands c LEFT JOIN users u ON u.id = c.requested_by WHERE c.id = $1`, [id]);
  return r ? commandDto(r) : null;
}

export function policyDto(r: any) {
  return {
    version: r.version, passcode: r.passcode, maxScreenLockTimeoutSec: r.max_screen_lock_timeout_sec ?? null,
    disableCamera: r.disable_camera, disallowUsbDebugging: r.disallow_usb_debugging,
    disallowFactoryResetByUser: r.disallow_factory_reset, minAndroidPatchAgeDays: r.min_android_patch_age_days ?? null,
    updatedAt: iso(r.updated_at), updatedBy: r.updated_by ? { id: r.updated_by, name: r.ub_name ?? '' } : null,
  };
}

/** The org's policy; every org has one (created with safe defaults on first read). */
export async function loadPolicy(q: Queryable, orgId: string) {
  await q.query(`INSERT INTO org_policies (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`, [orgId]);
  const [r] = await q.query(`SELECT p.*, u.name AS ub_name FROM org_policies p LEFT JOIN users u ON u.id = p.updated_by WHERE p.org_id = $1`, [orgId]);
  return policyDto(r);
}
