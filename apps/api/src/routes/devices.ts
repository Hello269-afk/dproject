import { Router } from 'express';
import { z } from 'zod';
import { verifyPassword } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { clientIp, hasRole, requireAdmin } from '../middleware/auth.js';
import { hub } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { changeLifecycle } from '../services/devices.js';
import { emitDevice } from '../services/events.js';
import { cancelCommand, queueCommand } from '../services/commands.js';
import { requestSession } from '../services/screen.js';
import { auditDto, commandDto, loadDevice, loadDevices, loadPolicy, messageDto } from '../services/serialize.js';
import { db } from '../state.js';

export const devicesRouter = Router();
devicesRouter.use(requireAdmin('viewer'));

const actorOf = (req: any) => ({ type: 'user' as const, id: req.admin.id, name: req.admin.name });

/** Loads a device scoped to the caller's organisation. Cross-org ids are indistinguishable from missing ones. */
async function scopedDevice(orgId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound('Device');
  const d = await loadDevice(db(), orgId, id);
  if (!d) throw notFound('Device');
  return d;
}

devicesRouter.get('/', async (req, res) => {
  const { q, status, platform } = req.query as Record<string, string | undefined>;
  let devices = await loadDevices(db(), req.admin!.orgId);
  if (status) devices = devices.filter((d) => d.displayStatus === status);
  if (platform) devices = devices.filter((d) => d.platform === platform);
  if (q) {
    const needle = q.toLowerCase();
    devices = devices.filter((d) => [d.name, d.model, d.manufacturer, d.assignedUser?.name, d.assignedUser?.email]
      .some((v) => v?.toLowerCase().includes(needle)));
  }
  res.json({ devices });
});

devicesRouter.get('/:id', async (req, res) => {
  res.json({ device: await scopedDevice(req.admin!.orgId, String(req.params.id)) });
});

devicesRouter.patch('/:id', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  const body = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    assignedUserId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.string().max(60), z.string().max(500)).optional()
      .refine((m) => !m || Object.keys(m).length <= 30, 'At most 30 metadata keys'),
  }).parse(req.body);
  if (body.assignedUserId) {
    const [u] = await db().query(`SELECT id FROM users WHERE id = $1 AND org_id = $2`, [body.assignedUserId, a.orgId]);
    if (!u) throw badRequest('invalid_user', 'User not found in your organisation');
  }
  await db().query(
    `UPDATE devices SET name = COALESCE($2, name),
       assigned_user_id = CASE WHEN $3::boolean THEN $4::uuid ELSE assigned_user_id END,
       metadata = COALESCE($5::jsonb, metadata)
     WHERE id = $1`,
    [d.id, body.name ?? null, body.assignedUserId !== undefined, body.assignedUserId ?? null,
      body.metadata ? JSON.stringify(body.metadata) : null]);
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'device.updated', targetType: 'device', targetId: d.id,
    ip: clientIp(req), metadata: { changes: body } });
  res.json({ device: await emitDevice(a.orgId, d.id) });
});

devicesRouter.post('/:id/checkin', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  if (d.lifecycleStatus !== 'authenticated') throw conflict(`device_${d.lifecycleStatus}`, `Device is ${d.lifecycleStatus}`);
  if (!hub.toDevice(d.id, { type: 'checkin.request' })) throw conflict('device_offline', 'Device is offline');
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'device.checkin_requested', targetType: 'device', targetId: d.id, ip: clientIp(req) });
  res.status(202).json({ requested: true });
});

devicesRouter.post('/:id/suspend', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(req.body);
  if (d.lifecycleStatus !== 'authenticated') throw conflict('invalid_state', `Device is ${d.lifecycleStatus}`);
  res.json({ device: await changeLifecycle(d, 'suspended', reason, actorOf(req), clientIp(req)) });
});

devicesRouter.post('/:id/resume', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  if (d.lifecycleStatus !== 'suspended') throw conflict('invalid_state', 'Only suspended devices can be resumed');
  res.json({ device: await changeLifecycle(d, 'authenticated', '', actorOf(req), clientIp(req)) });
});

devicesRouter.post('/:id/revoke', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  const body = z.object({ reason: z.string().trim().min(1).max(300), confirm: z.string() }).parse(req.body);
  if (body.confirm !== d.name) throw badRequest('confirmation_mismatch', 'Type the device name exactly to confirm');
  if (d.lifecycleStatus === 'revoked') throw conflict('invalid_state', 'Device is already revoked');
  res.json({ device: await changeLifecycle(d, 'revoked', body.reason, actorOf(req), clientIp(req)) });
});

devicesRouter.get('/:id/activity', async (req, res) => {
  const d = await scopedDevice(req.admin!.orgId, String(req.params.id));
  const rows = await db().query(
    `SELECT * FROM audit_logs WHERE org_id = $1 AND (target_id = $2 OR (actor_type = 'device' AND actor_id = $2))
     ORDER BY id DESC LIMIT 200`, [d.orgId, d.id]);
  res.json({ logs: rows.map(auditDto) });
});

devicesRouter.get('/:id/permission-history', async (req, res) => {
  const d = await scopedDevice(req.admin!.orgId, String(req.params.id));
  const rows = await db().query(`SELECT key, from_status, to_status, at FROM permission_history WHERE device_id = $1 ORDER BY at DESC, id DESC LIMIT 300`, [d.id]);
  res.json({ history: rows.map((r) => ({ key: r.key, from: r.from_status, to: r.to_status, at: new Date(r.at).toISOString() })) });
});

devicesRouter.get('/:id/messages', requireAdmin('operator'), async (req, res) => {
  const d = await scopedDevice(req.admin!.orgId, String(req.params.id));
  const rows = await db().query(`SELECT * FROM support_messages WHERE device_id = $1 ORDER BY created_at ASC LIMIT 500`, [d.id]);
  res.json({ messages: rows.map(messageDto) });
});

devicesRouter.post('/:id/messages', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  if (d.lifecycleStatus === 'revoked') throw conflict('device_revoked', 'Device is revoked');
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
  const [row] = await db().query(
    `INSERT INTO support_messages (org_id, device_id, direction, sender_id, sender_name, body)
     VALUES ($1,$2,'to_device',$3,$4,$5) RETURNING *`, [a.orgId, d.id, a.id, a.name, body]);
  const message = messageDto(row);
  hub.toDevice(d.id, { type: 'message', message });
  hub.toOrgAdmins(a.orgId, { type: 'message.created', message });
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'message.sent', targetType: 'device', targetId: d.id, ip: clientIp(req) });
  res.status(201).json({ message });
});

devicesRouter.post('/:id/screen-sessions', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  const { purpose, control } = z.object({
    purpose: z.string().trim().min(3, 'Give the user a reason (at least 3 characters)').max(200),
    control: z.boolean().default(false),
  }).parse(req.body);
  const out = await requestSession(a, d.id, purpose, clientIp(req), control);
  res.status(201).json(out);
});

// ---------- Remote commands ----------

devicesRouter.get('/:id/commands', async (req, res) => {
  const d = await scopedDevice(req.admin!.orgId, String(req.params.id));
  const rows = await db().query(
    `SELECT c.*, u.name AS rb_name FROM device_commands c LEFT JOIN users u ON u.id = c.requested_by
     WHERE c.device_id = $1 ORDER BY c.created_at DESC LIMIT 100`, [d.id]);
  res.json({ commands: rows.map(commandDto) });
});

const ACTION_ROLE = { lock: 'operator', reboot: 'admin', wipe: 'admin' } as const;

devicesRouter.post('/:id/commands', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const d = await scopedDevice(a.orgId, String(req.params.id));
  const body = z.object({
    action: z.enum(['lock', 'reboot', 'wipe']),
    reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(300),
    confirm: z.string().optional(),
    password: z.string().max(200).optional(),
  }).parse(req.body);
  if (!hasRole(a.role, ACTION_ROLE[body.action])) throw new HttpError(403, 'forbidden', `${body.action} requires the ${ACTION_ROLE[body.action]} role or higher`);
  if (d.lifecycleStatus !== 'authenticated') throw conflict(`device_${d.lifecycleStatus}`, `Device is ${d.lifecycleStatus}`);

  if (body.action === 'wipe') {
    if (d.ownership !== 'company') throw conflict('not_company_owned', 'Only company-owned devices can be erased. For personal devices, revoke enrollment instead.');
    if (body.confirm !== d.name) throw badRequest('confirmation_mismatch', 'Type the device name exactly to confirm');
    // Step-up: an erase needs the admin's password again, not just a live session token.
    const [u] = await db().query(`SELECT password_hash FROM users WHERE id = $1`, [a.id]);
    if (!(await verifyPassword(body.password ?? '', u?.password_hash ?? null))) {
      await audit({ orgId: a.orgId, actor: actorOf(req), action: 'auth.reauth_failed', targetType: 'device', targetId: d.id, ip: clientIp(req) });
      throw new HttpError(401, 'reauth_failed', 'Password is incorrect');
    }
  }
  // While online the agent's reported capabilities are authoritative; offline we queue and let it answer.
  if (d.online && !d.capabilities.includes(body.action)) {
    throw conflict('not_supported', body.action === 'lock'
      ? 'Remote lock needs the device-administrator permission on this phone.'
      : `This needs a company-owned (fully managed) setup. The device reports it can't ${body.action}.`);
  }
  const command = await queueCommand(d, body.action, body.reason, actorOf(req), clientIp(req));
  res.status(201).json({ command });
});

export const commandsRouter = Router();
commandsRouter.post('/:id/cancel', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const id = String(req.params.id);
  if (!z.string().uuid().safeParse(id).success) throw notFound('Command');
  const [row] = await db().query(`SELECT status FROM device_commands WHERE id = $1 AND org_id = $2`, [id, a.orgId]);
  if (!row) throw notFound('Command');
  if (!['pending', 'sent'].includes(row.status)) throw conflict('invalid_state', `Command is already ${row.status}`);
  res.json({ command: await cancelCommand(a.orgId, id, actorOf(req), clientIp(req)) });
});

// ---------- Security policy ----------

export const policyRouter = Router();
policyRouter.get('/', requireAdmin('viewer'), async (req, res) => {
  res.json({ policy: await loadPolicy(db(), req.admin!.orgId) });
});

policyRouter.put('/', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const body = z.object({
    passcode: z.enum(['none', 'low', 'medium', 'high']),
    maxScreenLockTimeoutSec: z.number().int().min(15).max(86_400).nullable(),
    disableCamera: z.boolean(),
    disallowUsbDebugging: z.boolean(),
    disallowFactoryResetByUser: z.boolean(),
    minAndroidPatchAgeDays: z.number().int().min(1).max(3650).nullable(),
  }).parse(req.body);
  await loadPolicy(db(), a.orgId);
  await db().query(
    `UPDATE org_policies SET version = version + 1, passcode = $2, max_screen_lock_timeout_sec = $3, disable_camera = $4,
       disallow_usb_debugging = $5, disallow_factory_reset = $6, min_android_patch_age_days = $7, updated_at = now(), updated_by = $8
     WHERE org_id = $1`,
    [a.orgId, body.passcode, body.maxScreenLockTimeoutSec, body.disableCamera, body.disallowUsbDebugging,
      body.disallowFactoryResetByUser, body.minAndroidPatchAgeDays, a.id]);
  const policy = await loadPolicy(db(), a.orgId);
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'policy.updated', targetType: 'organization', targetId: a.orgId,
    ip: clientIp(req), metadata: { version: policy.version, ...body } });
  // Enforcement only on company-owned devices; personal devices just evaluate compliance against it.
  const devices = await db().query(
    `SELECT id, org_id, name, ownership FROM devices WHERE org_id = $1 AND lifecycle_status = 'authenticated'`, [a.orgId]);
  let queued = 0;
  for (const d of devices) {
    if (d.ownership === 'company') {
      await queueCommand({ id: d.id, orgId: d.org_id, name: d.name }, 'apply_policy', `Policy v${policy.version}`, actorOf(req), clientIp(req), policy);
      queued++;
    } else {
      hub.toDevice(d.id, { type: 'policy.updated', policy });
    }
  }
  res.json({ policy, queuedToDevices: queued });
});
