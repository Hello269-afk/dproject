import { hub } from '../realtime/hub.js';
import { db } from '../state.js';
import { audit, type Actor } from './audit.js';
import { loadCommand, loadPolicy } from './serialize.js';

export type CommandAction = 'lock' | 'reboot' | 'wipe' | 'apply_policy';

const SENT_TIMEOUT_MS = 10 * 60_000;
const EXPIRY_DAYS = 7;

async function emitCommand(orgId: string, id: string) {
  const command = await loadCommand(db(), id);
  if (command) hub.toOrgAdmins(orgId, { type: 'command.updated', command });
  return command;
}

/** Sends one command to the device if it's online; otherwise it stays pending until it reconnects. */
async function deliver(c: { id: string; device_id: string; action: string; params: any }) {
  const sent = hub.toDevice(c.device_id, { type: 'command', commandId: c.id, action: c.action, params: c.params ?? {} });
  if (sent) await db().query(`UPDATE device_commands SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'pending'`, [c.id]);
  return sent;
}

export async function queueCommand(
  d: { id: string; orgId: string; name: string }, action: CommandAction, reason: string, actor: Actor, ip: string | null,
  params: Record<string, unknown> = {},
) {
  // apply_policy supersedes any older undelivered policy for the same device.
  if (action === 'apply_policy') {
    await db().query(`UPDATE device_commands SET status = 'cancelled', completed_at = now(), error = 'superseded'
                      WHERE device_id = $1 AND action = 'apply_policy' AND status IN ('pending','sent')`, [d.id]);
  }
  const [row] = await db().query(
    `INSERT INTO device_commands (org_id, device_id, action, params, requested_by, reason)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [d.orgId, d.id, action, JSON.stringify(params), actor.type === 'user' ? actor.id : null, reason]);
  await audit({ orgId: d.orgId, actor, action: `command.${action}.queued`, targetType: 'device', targetId: d.id, ip,
    metadata: { commandId: row.id, reason } });
  await deliver(row);
  return emitCommand(d.orgId, row.id);
}

/** On (re)connect: resend anything still open, oldest first. */
export async function deliverPending(deviceId: string) {
  const rows = await db().query(
    `SELECT * FROM device_commands WHERE device_id = $1 AND status IN ('pending','sent') ORDER BY created_at`, [deviceId]);
  for (const r of rows) {
    if (r.action === 'apply_policy') r.params = await loadPolicy(db(), r.org_id); // always the current policy
    const sent = hub.toDevice(deviceId, { type: 'command', commandId: r.id, action: r.action, params: r.params ?? {} });
    if (sent) {
      await db().query(`UPDATE device_commands SET status = 'sent', sent_at = now() WHERE id = $1`, [r.id]);
      await emitCommand(r.org_id, r.id);
    }
  }
}

export async function onCommandResult(
  d: { id: string; orgId: string; name: string }, commandId: string, status: 'succeeded' | 'failed' | 'unsupported', error?: string,
) {
  // Results are accepted once, and only for this device's own open commands.
  const [row] = await db().query(
    `UPDATE device_commands SET status = $3, completed_at = now(), error = $4
     WHERE id = $1 AND device_id = $2 AND status IN ('pending','sent') RETURNING action`,
    [commandId, d.id, status, error?.slice(0, 500) ?? null]);
  if (!row) return;
  await audit({ orgId: d.orgId, actor: { type: 'device', id: d.id, name: d.name }, action: `command.${row.action}.${status}`,
    targetType: 'device', targetId: d.id, metadata: { commandId, ...(error ? { error: error.slice(0, 200) } : {}) } });
  await emitCommand(d.orgId, commandId);
}

export async function cancelCommand(orgId: string, id: string, actor: Actor, ip: string | null) {
  const [row] = await db().query(
    `UPDATE device_commands SET status = 'cancelled', completed_at = now()
     WHERE id = $1 AND org_id = $2 AND status IN ('pending','sent') RETURNING device_id, action`, [id, orgId]);
  if (row) {
    await audit({ orgId, actor, action: `command.${row.action}.cancelled`, targetType: 'device', targetId: row.device_id, ip, metadata: { commandId: id } });
  }
  return emitCommand(orgId, id);
}

export async function cancelAllForDevice(deviceId: string, reason: string) {
  await db().query(`UPDATE device_commands SET status = 'cancelled', completed_at = now(), error = $2
                    WHERE device_id = $1 AND status IN ('pending','sent')`, [deviceId, reason]);
}

/** Housekeeping: unanswered `sent` commands go back to pending; week-old pending ones expire. */
export async function sweepCommands() {
  await db().query(`UPDATE device_commands SET status = 'pending'
                    WHERE status = 'sent' AND sent_at < now() - make_interval(secs => $1)`, [SENT_TIMEOUT_MS / 1000]);
  const expired = await db().query(
    `UPDATE device_commands SET status = 'expired', completed_at = now()
     WHERE status = 'pending' AND created_at < now() - make_interval(days => $1) RETURNING id, org_id, device_id, action`, [EXPIRY_DAYS]);
  for (const r of expired) {
    await audit({ orgId: r.org_id, actor: { type: 'system' }, action: `command.${r.action}.expired`, targetType: 'device', targetId: r.device_id, metadata: { commandId: r.id } });
    await emitCommand(r.org_id, r.id);
  }
}
