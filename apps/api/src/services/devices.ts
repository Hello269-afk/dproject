import { z } from 'zod';
import { PERMISSION_KEYS, PERMISSION_STATUSES } from '../lib/permissions.js';
import { hub } from '../realtime/hub.js';
import { advanceEnrollment } from '../routes/enrollments.js';
import { db } from '../state.js';
import { audit, type Actor } from './audit.js';
import { emitDevice, emitEnrollment } from './events.js';
import { cancelAllForDevice } from './commands.js';
import { endSessionsForDevice } from './screen.js';

const n = z.number().finite().nullable().optional().transform((v) => v ?? null);
const s = (max: number) => z.string().max(max).nullable().optional().transform((v) => v ?? null);

// Every field is optional/nullable: the agent sends null for anything the OS won't give it, and
// the dashboard renders that as "Unavailable". Nothing is ever back-filled with a guess.
export const telemetrySchema = z.object({
  batteryPct: n.pipe(z.number().min(0).max(100).nullable()),
  charging: z.boolean().nullable().optional().transform((v) => v ?? null),
  networkType: z.enum(['wifi', 'cellular', 'ethernet', 'none', 'other']).nullable().optional().transform((v) => v ?? null),
  wifiSsid: s(64),
  carrier: s(64),
  ipAddress: s(64),
  storageTotalBytes: n,
  storageFreeBytes: n,
  memoryTotalBytes: n,
  memoryAvailBytes: n,
  screenWidth: n,
  screenHeight: n,
  orientation: z.enum(['portrait', 'landscape']).nullable().optional().transform((v) => v ?? null),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nullable().optional().transform((v) => v ?? null),
    at: z.string().max(40),
  }).nullable().optional().transform((v) => v ?? null),
  reportedAt: z.string().max(40).optional().transform((v) => v ?? new Date().toISOString()),
});
export type Telemetry = z.infer<typeof telemetrySchema>;

export const permissionsSchema = z.object({
  permissions: z.array(z.object({ key: z.enum(PERMISSION_KEYS), status: z.enum(PERMISSION_STATUSES) })).max(30),
});

type DeviceRef = { id: string; orgId: string; name: string };

export async function ingestTelemetry(d: DeviceRef, raw: unknown) {
  const t = telemetrySchema.parse(raw);
  // Location is only kept when the device user has granted the location permission.
  if (t.location) {
    const [p] = await db().query(`SELECT status FROM device_permissions WHERE device_id = $1 AND key = 'location'`, [d.id]);
    if (p?.status !== 'granted') t.location = null;
  }
  const [row] = await db().query(
    `WITH t AS (
       INSERT INTO device_telemetry (device_id, data, received_at) VALUES ($1, $2, now())
       ON CONFLICT (device_id) DO UPDATE SET data = EXCLUDED.data, received_at = now()
     )
     UPDATE devices SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at`,
    [d.id, JSON.stringify(t)]);
  hub.toOrgAdmins(d.orgId, { type: 'device.telemetry', deviceId: d.id, telemetry: t, lastSeenAt: new Date(row.last_seen_at).toISOString() });
}

/** Records real OS permission state reported by the agent. Only permissions requested at enrollment are tracked. */
export async function ingestPermissions(d: DeviceRef, raw: unknown) {
  const { permissions } = permissionsSchema.parse(raw);
  const current = new Map<string, string>(
    (await db().query(`SELECT key, status FROM device_permissions WHERE device_id = $1`, [d.id])).map((r) => [r.key, r.status]));
  const changes: { key: string; from: string; to: string }[] = [];
  for (const p of permissions) {
    const from = current.get(p.key);
    if (from === undefined || from === p.status) continue;
    changes.push({ key: p.key, from, to: p.status });
  }
  if (!changes.length) return;
  await db().tx(async (q) => {
    for (const c of changes) {
      await q.query(`UPDATE device_permissions SET status = $3, updated_at = now() WHERE device_id = $1 AND key = $2`, [d.id, c.key, c.to]);
      await q.query(`INSERT INTO permission_history (device_id, key, from_status, to_status) VALUES ($1,$2,$3,$4)`, [d.id, c.key, c.from, c.to]);
    }
  });
  await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name }, action: 'device.permissions_changed',
    targetType: 'device', targetId: d.id, metadata: { changes } });
  // A user withdrawing screen-share consent ends any session in progress.
  if (changes.some((c) => c.key === 'screen_capture' && c.to !== 'granted')) {
    await endSessionsForDevice(d.id, 'user_stopped', { type: 'device', id: d.id, name: d.name });
  }
  await emitDevice(d.orgId, d.id);
}

export async function markOnline(d: DeviceRef, ip: string | null) {
  const [row] = await db().query(
    `UPDATE devices SET ever_connected = true, last_seen_at = now() WHERE id = $1 RETURNING enrollment_id`, [d.id]);
  if (row?.enrollment_id) {
    const [e] = await db().query(`SELECT id, status FROM enrollments WHERE id = $1`, [row.enrollment_id]);
    if (e && (await advanceEnrollment(db(), e.id, e.status, 'connected'))) await emitEnrollment(e.id);
  }
  await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name }, action: 'device.connected', targetType: 'device', targetId: d.id, ip });
  await emitDevice(d.orgId, d.id);
}

export async function markOffline(d: DeviceRef) {
  await db().query(`UPDATE devices SET last_seen_at = now() WHERE id = $1`, [d.id]);
  await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name }, action: 'device.disconnected', targetType: 'device', targetId: d.id });
  await emitDevice(d.orgId, d.id);
}

/** Suspend or revoke: end sessions, tell the agent, drop its socket, invalidate its tokens (revoke only). */
export async function changeLifecycle(d: DeviceRef, to: 'suspended' | 'revoked' | 'authenticated', reason: string, actor: Actor, ip: string | null) {
  if (to === 'revoked') {
    await db().query(`UPDATE devices SET lifecycle_status = 'revoked', revoked_at = now(), revoke_reason = $2,
                        secret_version = secret_version + 1 WHERE id = $1`, [d.id, reason]);
  } else if (to === 'suspended') {
    await db().query(`UPDATE devices SET lifecycle_status = 'suspended', suspended_at = now() WHERE id = $1`, [d.id]);
  } else {
    await db().query(`UPDATE devices SET lifecycle_status = 'authenticated', suspended_at = NULL WHERE id = $1`, [d.id]);
  }
  if (to === 'revoked') await cancelAllForDevice(d.id, 'device_revoked');
  if (to !== 'authenticated') {
    await endSessionsForDevice(d.id, 'device_revoked', actor);
    hub.toDevice(d.id, { type: to === 'revoked' ? 'device.revoked' : 'device.suspended', reason });
    hub.closeDevice(d.id, 4003, to);
  }
  const action = to === 'revoked' ? 'device.revoked' : to === 'suspended' ? 'device.suspended' : 'device.resumed';
  await audit({ orgId: d.orgId, actor, action, targetType: 'device', targetId: d.id, ip, metadata: reason ? { reason } : {} });
  return emitDevice(d.orgId, d.id);
}

export const CAPABILITIES = ['lock', 'reboot', 'wipe', 'remote_control', 'apply_policy'] as const;

export const deviceStateSchema = z.object({
  managementMode: z.enum(['device_owner', 'device_admin', 'none']),
  capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length),
});

export const complianceSchema = z.object({
  policyVersion: z.number().int().nullable().optional().transform((v) => v ?? null),
  enforced: z.boolean(),
  passcodeSufficient: z.boolean().nullable().optional().transform((v) => v ?? null),
  encrypted: z.boolean().nullable().optional().transform((v) => v ?? null),
  securityPatch: s(20),
  issues: z.array(z.string().max(200)).max(20),
  checkedAt: z.string().max(40).optional().transform((v) => v ?? new Date().toISOString()),
});

/** What the agent can actually do right now. Reported by the device, never assumed by the server. */
export async function ingestDeviceState(d: DeviceRef, raw: unknown) {
  const st = deviceStateSchema.parse(raw);
  const caps = [...new Set(st.capabilities)].sort();
  const [prev] = await db().query(`SELECT management_mode, capabilities FROM devices WHERE id = $1`, [d.id]);
  if (prev && prev.management_mode === st.managementMode && JSON.stringify(prev.capabilities) === JSON.stringify(caps)) return;
  await db().query(`UPDATE devices SET management_mode = $2, capabilities = $3 WHERE id = $1`, [d.id, st.managementMode, JSON.stringify(caps)]);
  if (prev?.management_mode !== st.managementMode) {
    await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name }, action: 'device.management_mode_changed',
      targetType: 'device', targetId: d.id, metadata: { from: prev?.management_mode ?? null, to: st.managementMode } });
  }
  await emitDevice(d.orgId, d.id);
}

export async function ingestCompliance(d: DeviceRef, raw: unknown) {
  const c = complianceSchema.parse(raw);
  const [prev] = await db().query(`SELECT compliance FROM devices WHERE id = $1`, [d.id]);
  await db().query(`UPDATE devices SET compliance = $2 WHERE id = $1`, [d.id, JSON.stringify(c)]);
  const was = (prev?.compliance?.issues?.length ?? 0) > 0;
  const now = c.issues.length > 0;
  if (was !== now || !prev?.compliance) {
    await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name },
      action: now ? 'device.non_compliant' : 'device.compliant', targetType: 'device', targetId: d.id, metadata: { issues: c.issues } });
  }
  await emitDevice(d.orgId, d.id);
}
