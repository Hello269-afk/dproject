import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { HttpError, conflict } from '../lib/errors.js';
import { hub } from '../realtime/hub.js';
import { db } from '../state.js';
import { audit, type Actor } from './audit.js';
import { emitDevice, emitSession } from './events.js';

export type LiveStatus = 'awaiting_consent' | 'connecting' | 'active';
type Live = {
  id: string; orgId: string; deviceId: string; requestedBy: string; status: LiveStatus; purpose: string; expiresAt: Date;
  control: boolean;        // admin asked for remote control
  controlGranted: boolean; // user allowed it on the device (and hasn't withdrawn it)
  inputs: number;
};

// In-memory view of non-terminal sessions, used to authorise signalling frames without a DB hit
// per ICE candidate. The database stays the source of truth for history and the audit trail.
const live = new Map<string, Live>();
const timers = new Map<string, Partial<Record<'consent' | 'max' | 'device' | 'admin', NodeJS.Timeout>>>();

function setTimer(id: string, kind: 'consent' | 'max' | 'device' | 'admin', ms: number, fn: () => void) {
  const t = timers.get(id) ?? {};
  if (t[kind]) clearTimeout(t[kind]);
  t[kind] = setTimeout(() => { fn(); }, ms);
  t[kind]!.unref?.();
  timers.set(id, t);
}
function clearTimer(id: string, kind?: 'consent' | 'max' | 'device' | 'admin') {
  const t = timers.get(id);
  if (!t) return;
  for (const k of kind ? [kind] : (Object.keys(t) as (keyof typeof t)[])) {
    if (t[k]) clearTimeout(t[k]);
    delete t[k];
  }
  if (!kind) timers.delete(id);
}

export const getLive = (id: string) => live.get(id);
export const liveForDevice = (deviceId: string) => [...live.values()].find((s) => s.deviceId === deviceId);

/** STUN plus TURN. With a coturn shared secret, mint short-lived credentials (TURN REST API). */
export function iceServers(subject: string): RTCIceServerLike[] {
  const out: RTCIceServerLike[] = config.stunUrls.length ? [{ urls: config.stunUrls }] : [];
  const t = config.turn;
  if (t.urls.length) {
    if (t.sharedSecret) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${subject}`;
      const credential = createHmac('sha1', t.sharedSecret).update(username).digest('base64');
      out.push({ urls: t.urls, username, credential });
    } else if (t.username) {
      out.push({ urls: t.urls, username: t.username, credential: t.credential });
    }
  }
  return out;
}
export type RTCIceServerLike = { urls: string[]; username?: string; credential?: string };

/** Admin asks to view a device's screen. Every precondition from the security model is checked here. */
export async function requestSession(
  admin: { id: string; orgId: string; name: string; email: string }, deviceId: string, purpose: string, ip: string | null, control = false,
) {
  const [d] = await db().query(`SELECT id, org_id, name, lifecycle_status FROM devices WHERE id = $1 AND org_id = $2`, [deviceId, admin.orgId]);
  if (!d) throw new HttpError(404, 'not_found', 'Device not found');
  if (d.lifecycle_status !== 'authenticated') throw conflict(`device_${d.lifecycle_status}`, `Device is ${d.lifecycle_status}`);
  if (!hub.isDeviceOnline(deviceId)) throw conflict('device_offline', 'Device is offline. Screen sharing needs the agent to be connected.');
  const [perm] = await db().query(`SELECT status FROM device_permissions WHERE device_id = $1 AND key = 'screen_capture'`, [deviceId]);
  if (!perm || perm.status !== 'granted') {
    throw conflict('permission_required', 'The device user has not allowed screen-sharing requests on this device.');
  }
  if (control) {
    const [acc] = await db().query(`SELECT status FROM device_permissions WHERE device_id = $1 AND key = 'accessibility'`, [deviceId]);
    if (acc?.status !== 'granted') {
      throw conflict('permission_required', 'Remote control is not switched on for this device. The user must enable it in the agent app first.');
    }
  }
  if (liveForDevice(deviceId)) throw conflict('session_in_progress', 'A screen-sharing session is already in progress for this device.');

  let row: any;
  try {
    [row] = await db().query(
      `INSERT INTO screen_sessions (org_id, device_id, requested_by, purpose, status, expires_at, control_requested)
       VALUES ($1,$2,$3,$4,'awaiting_consent', now() + make_interval(secs => $5), $6) RETURNING *`,
      [admin.orgId, deviceId, admin.id, purpose, config.consentTimeoutSec, control]);
  } catch (e: any) {
    if (e?.code === '23505' || /screen_sessions_live_uq/.test(String(e?.message))) {
      throw conflict('session_in_progress', 'A screen-sharing session is already in progress for this device.');
    }
    throw e;
  }
  const s: Live = { id: row.id, orgId: admin.orgId, deviceId, requestedBy: admin.id, status: 'awaiting_consent', purpose,
    expiresAt: new Date(row.expires_at), control, controlGranted: false, inputs: 0 };
  live.set(s.id, s);
  setTimer(s.id, 'consent', config.consentTimeoutSec * 1000, () => {
    void endSession(s.id, 'expired', 'consent_timeout', { type: 'system' });
  });

  const servers = iceServers(deviceId);
  hub.toDevice(deviceId, {
    type: 'screen.request', sessionId: s.id, requestedBy: { name: admin.name, email: admin.email },
    purpose, control, expiresAt: s.expiresAt.toISOString(), iceServers: servers,
  });
  await audit({ orgId: admin.orgId, actor: { type: 'user', id: admin.id, name: admin.name }, action: 'screen.requested',
    targetType: 'device', targetId: deviceId, ip, metadata: { sessionId: s.id, purpose, control } });
  const session = await emitSession(s.id);
  await emitDevice(admin.orgId, deviceId);
  return { session, iceServers: iceServers(admin.id) };
}

/** Device reports the user's decision. `approved` is only sent after the OS capture dialog succeeded. */
export async function onConsent(
  device: { id: string; orgId: string; name: string }, sessionId: string, decision: 'approved' | 'rejected' | 'os_denied', controlGranted = false,
) {
  const s = live.get(sessionId);
  if (!s || s.deviceId !== device.id || s.status !== 'awaiting_consent') return;
  const actor: Actor = { type: 'device', id: device.id, name: device.name };
  if (decision !== 'approved') {
    await endSession(sessionId, 'rejected', decision === 'os_denied' ? 'os_denied' : 'rejected', actor, false);
    return;
  }
  clearTimer(sessionId, 'consent');
  s.status = 'connecting';
  // Control can only be granted if it was asked for: the device can't widen its own session.
  s.controlGranted = s.control && controlGranted;
  await db().query(`UPDATE screen_sessions SET status = 'connecting', consented_at = now(), control_granted = $3,
                      expires_at = now() + make_interval(mins => $2) WHERE id = $1`, [sessionId, config.screenSessionMaxMinutes, s.controlGranted]);
  setTimer(sessionId, 'max', config.screenSessionMaxMinutes * 60_000, () => {
    void endSession(sessionId, 'ended', 'max_duration', { type: 'system' });
  });
  await audit({ orgId: s.orgId, actor, action: 'screen.consented', targetType: 'device', targetId: device.id, metadata: { sessionId } });
  if (s.controlGranted) {
    await audit({ orgId: s.orgId, actor, action: 'screen.control_granted', targetType: 'device', targetId: device.id, metadata: { sessionId } });
  }
  await emitSession(sessionId);
}

/** The requesting admin's peer connection reached `connected`. */
export async function onAdminConnected(adminId: string, sessionId: string) {
  const s = live.get(sessionId);
  if (!s || s.requestedBy !== adminId || s.status === 'awaiting_consent') return;
  if (s.status === 'active') return;
  s.status = 'active';
  await db().query(`UPDATE screen_sessions SET status = 'active', started_at = COALESCE(started_at, now()) WHERE id = $1`, [sessionId]);
  await audit({ orgId: s.orgId, actor: { type: 'system' }, action: 'screen.started', targetType: 'device', targetId: s.deviceId, metadata: { sessionId } });
  await emitSession(sessionId);
}

type Terminal = 'ended' | 'rejected' | 'expired' | 'failed';

/** Single exit point for every session. Idempotent. Tells the device to stop capture unless it told us. */
export async function endSession(sessionId: string, status: Terminal, reason: string, actor: Actor, notifyDevice = true) {
  const s = live.get(sessionId);
  if (!s) return null;
  live.delete(sessionId);
  clearTimer(sessionId);
  await db().query(`UPDATE screen_sessions SET status = $2, end_reason = $3, ended_at = now(), input_count = $4 WHERE id = $1`,
    [sessionId, status, reason, s.inputs]);
  if (notifyDevice) hub.toDevice(s.deviceId, { type: 'screen.cancel', sessionId, reason });
  await audit({ orgId: s.orgId, actor, action: status === 'rejected' ? 'screen.rejected' : status === 'expired' ? 'screen.expired' : 'screen.ended',
    targetType: 'device', targetId: s.deviceId, metadata: { sessionId, reason, ...(s.control ? { controlInputs: s.inputs } : {}) } });
  const session = await emitSession(sessionId);
  await emitDevice(s.orgId, s.deviceId);
  return session;
}

/** Relays one remote-control input if, and only if, the user granted control for this live session. */
export async function relayControlInput(adminId: string, orgId: string, sessionId: string, input: unknown) {
  const s = live.get(sessionId);
  if (!s || s.orgId !== orgId || s.requestedBy !== adminId || s.status !== 'active' || !s.controlGranted) return false;
  if (!hub.toDevice(s.deviceId, { type: 'control.input', sessionId, input })) return false;
  s.inputs++;
  // Persist and broadcast the running count periodically, not per input.
  if (s.inputs % 10 === 0) {
    await db().query(`UPDATE screen_sessions SET input_count = $2 WHERE id = $1`, [sessionId, s.inputs]);
    await emitSession(sessionId);
  }
  return true;
}

/** The device user switched control off; the session continues view-only. */
export async function onControlRevoked(device: { id: string; orgId: string; name: string }, sessionId: string) {
  const s = live.get(sessionId);
  if (!s || s.deviceId !== device.id || !s.controlGranted) return;
  s.controlGranted = false;
  await db().query(`UPDATE screen_sessions SET control_granted = false, input_count = $2 WHERE id = $1`, [sessionId, s.inputs]);
  await audit({ orgId: s.orgId, actor: { type: 'device', id: device.id, name: device.name }, action: 'screen.control_revoked',
    targetType: 'device', targetId: device.id, metadata: { sessionId, controlInputs: s.inputs } });
  await emitSession(sessionId);
}

export async function endSessionsForDevice(deviceId: string, reason: string, actor: Actor) {
  for (const s of [...live.values()]) if (s.deviceId === deviceId) await endSession(s.id, 'ended', reason, actor);
}

// --- Presence hooks from the WebSocket layer ---

export function onDeviceOffline(deviceId: string) {
  const s = liveForDevice(deviceId);
  if (!s) return;
  setTimer(s.id, 'device', config.reconnectGraceMs, () => {
    void endSession(s.id, 'ended', 'device_disconnected', { type: 'system' }, false);
  });
}

export function onDeviceOnline(deviceId: string) {
  const s = liveForDevice(deviceId);
  if (!s) return;
  clearTimer(s.id, 'device');
  // The request may have been sent while the socket was dropping; resend so the user still sees it.
  if (s.status === 'awaiting_consent') {
    void (async () => {
      const [u] = await db().query(`SELECT name, email FROM users WHERE id = $1`, [s.requestedBy]);
      hub.toDevice(deviceId, { type: 'screen.request', sessionId: s.id, requestedBy: { name: u?.name, email: u?.email },
        purpose: s.purpose, control: s.control, expiresAt: s.expiresAt.toISOString(), iceServers: iceServers(deviceId) });
    })();
  }
}

export function onAdminOffline(orgId: string, userId: string) {
  if (hub.isUserOnline(orgId, userId)) return;
  for (const s of live.values()) {
    if (s.requestedBy !== userId) continue;
    setTimer(s.id, 'admin', config.reconnectGraceMs, () => {
      if (!hub.isUserOnline(orgId, userId)) void endSession(s.id, 'ended', 'admin_disconnected', { type: 'system' });
    });
  }
}

export function onAdminOnline(userId: string) {
  for (const s of live.values()) if (s.requestedBy === userId) clearTimer(s.id, 'admin');
}

/** After a restart no peer connection survives, so close out anything left mid-flight. */
export async function recoverSessionsOnBoot() {
  const rows = await db().query(
    `UPDATE screen_sessions SET status = 'failed', end_reason = 'server_restart', ended_at = now()
     WHERE status IN ('awaiting_consent','connecting','active') RETURNING id`);
  if (rows.length) console.log(`[screen] closed ${rows.length} session(s) left open by a previous run`);
}

export function resetScreenState() {
  for (const id of timers.keys()) clearTimer(id);
  live.clear();
}
