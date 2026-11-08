import { Router } from 'express';
import { z } from 'zod';
import { randomToken, safeEqualHex, sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { signDevice } from '../lib/jwt.js';
import { clientIp, requireDevice } from '../middleware/auth.js';
import { hub } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { changeLifecycle, ingestPermissions, ingestTelemetry } from '../services/devices.js';
import { loadDevice, messageDto, orgDto } from '../services/serialize.js';
import { db } from '../state.js';

export const deviceRouter = Router();

const deviceActor = (req: any) => ({ type: 'device' as const, id: req.device.id, name: req.device.name });

deviceRouter.post('/token', async (req, res) => {
  const body = z.object({ deviceId: z.string().uuid(), deviceSecret: z.string().min(20).max(200) }).parse(req.body);
  const [d] = await db().query(`SELECT id, org_id, name, secret_hash, secret_version, lifecycle_status FROM devices WHERE id = $1`, [body.deviceId]);
  if (!d || !safeEqualHex(d.secret_hash, sha256(body.deviceSecret))) {
    throw new HttpError(401, 'invalid_credentials', 'Device credentials are not valid');
  }
  if (d.lifecycle_status === 'revoked') throw new HttpError(403, 'device_revoked', 'This device has been unenrolled');
  // Suspended devices may still authenticate so the app can show the suspended state; the
  // WebSocket and every other endpoint refuse them.
  const accessToken = await signDevice({ sub: d.id, org: d.org_id, sv: d.secret_version });
  res.json({ accessToken, expiresIn: 3600, lifecycleStatus: d.lifecycle_status });
});

deviceRouter.post('/ws-ticket', requireDevice(), (req, res) => {
  const d = req.device!;
  res.json({ ticket: hub.issueTicket({ kind: 'device', deviceId: d.id, orgId: d.orgId }) });
});

deviceRouter.get('/me', requireDevice({ allowSuspended: true }), async (req, res) => {
  const d = req.device!;
  const [o] = await db().query(`SELECT * FROM organizations WHERE id = $1`, [d.orgId]);
  res.json({ device: await loadDevice(db(), d.orgId, d.id), organization: orgDto(o) });
});

deviceRouter.post('/credentials/rotate', requireDevice(), async (req, res) => {
  const d = req.device!;
  const secret = randomToken(32);
  await db().query(`UPDATE devices SET secret_hash = $2, secret_version = secret_version + 1, secret_rotated_at = now() WHERE id = $1`,
    [d.id, sha256(secret)]);
  await audit({ orgId: d.orgId, actor: deviceActor(req), action: 'device.credentials_rotated', targetType: 'device', targetId: d.id, ip: clientIp(req) });
  res.json({ deviceSecret: secret });
});

deviceRouter.post('/telemetry', requireDevice(), async (req, res) => {
  await ingestTelemetry(req.device!, req.body);
  res.status(204).end();
});

deviceRouter.post('/permissions', requireDevice(), async (req, res) => {
  await ingestPermissions(req.device!, req.body);
  res.status(204).end();
});

deviceRouter.get('/messages', requireDevice(), async (req, res) => {
  const d = req.device!;
  const rows = await db().query(`SELECT * FROM support_messages WHERE device_id = $1 ORDER BY created_at ASC LIMIT 500`, [d.id]);
  await db().query(`UPDATE support_messages SET read_at = now() WHERE device_id = $1 AND direction = 'to_device' AND read_at IS NULL`, [d.id]);
  res.json({ messages: rows.map(messageDto) });
});

deviceRouter.post('/messages', requireDevice(), async (req, res) => {
  const d = req.device!;
  const { body } = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
  const [row] = await db().query(
    `INSERT INTO support_messages (org_id, device_id, direction, sender_id, sender_name, body)
     VALUES ($1,$2,'from_device',$2,$3,$4) RETURNING *`, [d.orgId, d.id, d.name, body]);
  const message = messageDto(row);
  hub.toOrgAdmins(d.orgId, { type: 'message.created', message });
  res.status(201).json({ message });
});

// The device user can always remove the organisation from their device.
deviceRouter.post('/unenroll', requireDevice({ allowSuspended: true }), async (req, res) => {
  const d = req.device!;
  await changeLifecycle(d, 'revoked', 'user_unenrolled', deviceActor(req), clientIp(req));
  res.status(204).end();
});
