import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { Queryable } from '../db/index.js';
import { hashPairingCode, normalisePairingCode, pairingCode, randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.js';
import { PERMISSION_KEYS, PERMISSION_STATUSES, catalogFor } from '../lib/permissions.js';
import { clientIp, requireAdmin } from '../middleware/auth.js';
import { hub } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { emitDevice, emitEnrollment } from '../services/events.js';
import { loadEnrollment, loadEnrollments } from '../services/serialize.js';
import { db } from '../state.js';

// ---------------------------------------------------------------------------------------------
// Shared lookup / state machine
// ---------------------------------------------------------------------------------------------

const STEP_ORDER = ['generated', 'scanned', 'app_opened', 'permissions_approved', 'authenticated', 'connected'] as const;
type Step = (typeof STEP_ORDER)[number];
const STEP_COLUMN: Partial<Record<Step, string>> = {
  scanned: 'scanned_at', app_opened: 'app_opened_at', permissions_approved: 'permissions_approved_at',
  authenticated: 'authenticated_at', connected: 'connected_at',
};

const credentialSchema = z.object({
  token: z.string().min(20).max(200).optional(),
  pairingCode: z.string().min(8).max(20).optional(),
}).refine((v) => v.token || v.pairingCode, { message: 'token or pairingCode is required' });

export const appLink = (token: string) =>
  `mdm://enroll?token=${encodeURIComponent(token)}&api=${encodeURIComponent(config.publicApiUrl)}`;

/** Finds an enrollment by link token or pairing code and checks it can still be used. */
async function usableEnrollment(q: Queryable, cred: { token?: string; pairingCode?: string }, lock = false) {
  const lockSql = lock ? ' FOR UPDATE' : '';
  const [e] = cred.token
    ? await q.query(`SELECT * FROM enrollments WHERE token_hash = $1${lockSql}`, [sha256(cred.token)])
    : normalisePairingCode(cred.pairingCode!).length === 8
      ? await q.query(`SELECT * FROM enrollments WHERE pairing_code_hash = $1${lockSql}`, [hashPairingCode(cred.pairingCode!)])
      : [];
  if (!e) throw new HttpError(404, 'enrollment_not_found', 'This enrollment link or code is not valid. Ask your IT administrator for a new one.');
  if (e.status === 'revoked') throw new HttpError(410, 'enrollment_revoked', 'This enrollment invitation was cancelled by your organisation.');
  if (e.device_id || e.status === 'authenticated' || e.status === 'connected') {
    throw new HttpError(410, 'enrollment_used', 'This enrollment invitation has already been used.');
  }
  if (new Date(e.expires_at).getTime() < Date.now()) throw new HttpError(410, 'enrollment_expired', 'This enrollment invitation has expired.');
  return e;
}

/** Moves an enrollment forward (never backwards) and stamps the step time once. */
export async function advanceEnrollment(q: Queryable, id: string, current: string, to: Step) {
  const cur = STEP_ORDER.indexOf(current as Step);
  const next = STEP_ORDER.indexOf(to);
  if (cur >= next) return false;
  const col = STEP_COLUMN[to];
  await q.query(`UPDATE enrollments SET status = $2${col ? `, ${col} = COALESCE(${col}, now())` : ''} WHERE id = $1`, [id, to]);
  return true;
}

async function orgPublic(q: Queryable, orgId: string) {
  const [o] = await q.query(`SELECT name, support_email, support_phone FROM organizations WHERE id = $1`, [orgId]);
  return { name: o.name as string, supportEmail: o.support_email ?? null, supportPhone: o.support_phone ?? null };
}

// ---------------------------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------------------------

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAdmin('operator'));

const permissionKey = z.enum(PERMISSION_KEYS);

enrollmentsRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  let list = await loadEnrollments(db(), req.admin!.orgId);
  if (status) list = list.filter((e) => e.status === status);
  res.json({ enrollments: list });
});

enrollmentsRouter.post('/', async (req, res) => {
  const a = req.admin!;
  const body = z.object({
    assignedUserId: z.string().uuid().nullish(),
    deviceNameHint: z.string().trim().max(80).nullish(),
    expiresInMinutes: z.number().int().min(5).max(10_080),
    requestedPermissions: z.array(permissionKey).max(PERMISSION_KEYS.length),
    requiredPermissions: z.array(permissionKey).max(PERMISSION_KEYS.length),
    ownership: z.enum(['company', 'personal']).default('personal'),
  }).parse(req.body);

  const requested = [...new Set(body.requestedPermissions)];
  const required = [...new Set(body.requiredPermissions)];
  if (required.some((k) => !requested.includes(k))) throw badRequest('invalid_permissions', 'Required permissions must also be requested');
  // Remote control is always the user's choice, so it can be requested but never made a condition of enrollment.
  if (required.includes('accessibility')) throw badRequest('invalid_permissions', 'Remote control (accessibility) can be requested but not required');

  if (body.assignedUserId) {
    const [u] = await db().query(`SELECT id FROM users WHERE id = $1 AND org_id = $2 AND status = 'active'`, [body.assignedUserId, a.orgId]);
    if (!u) throw badRequest('invalid_user', 'Assigned user not found in your organisation');
  }

  const token = randomToken(32);
  const code = pairingCode();
  const [row] = await db().query(
    `INSERT INTO enrollments (org_id, created_by, assigned_user_id, device_name_hint, token_hash, pairing_code_hash,
                              requested_permissions, required_permissions, expires_at, ownership)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9), $10) RETURNING id`,
    [a.orgId, a.id, body.assignedUserId ?? null, body.deviceNameHint || null, sha256(token), hashPairingCode(code),
      JSON.stringify(requested), JSON.stringify(required), body.expiresInMinutes, body.ownership],
  );
  await audit({ orgId: a.orgId, actor: { type: 'user', id: a.id, name: a.name }, action: 'enrollment.created',
    targetType: 'enrollment', targetId: row.id, ip: clientIp(req),
    metadata: { expiresInMinutes: body.expiresInMinutes, ownership: body.ownership, requested, required, assignedUserId: body.assignedUserId ?? null } });
  const enrollment = await emitEnrollment(row.id);
  res.status(201).json({
    enrollment,
    token,
    pairingCode: code,
    // When the dashboard and API live on different origins, tell the app where the API is.
    enrollmentUrl: `${config.publicWebUrl}/enroll/${token}${config.publicWebUrl !== config.publicApiUrl ? `?api=${encodeURIComponent(config.publicApiUrl)}` : ''}`,
    appLink: appLink(token),
    ...(body.ownership === 'company' ? androidProvisioning(token) : {}),
  });
});

/** Android Enterprise QR payload for fully managed (device owner) setup of a factory-reset phone. */
function androidProvisioning(token: string) {
  const missing = [!config.appDownloadUrl && 'APP_DOWNLOAD_URL', !config.appSignatureChecksum && 'APP_SIGNATURE_CHECKSUM'].filter(Boolean);
  if (missing.length) {
    return {
      androidProvisioning: null,
      androidProvisioningUnavailableReason: `Factory-reset setup needs ${missing.join(' and ')} configured on the server. See apps/android/README.md.`,
    };
  }
  const payload = {
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': config.androidAdminComponent,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION': config.appDownloadUrl,
    'android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM': config.appSignatureChecksum,
    'android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': true,
    'android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE': { mdm_token: token, mdm_api: config.publicApiUrl },
  };
  return {
    androidProvisioning: {
      qrPayload: JSON.stringify(payload),
      instructions: 'Factory reset the phone. On the welcome screen tap 6 times in the same spot, connect to Wi-Fi, then scan this code.',
    },
    androidProvisioningUnavailableReason: null,
  };
}

enrollmentsRouter.get('/:id', async (req, res) => {
  const e = await loadEnrollment(db(), req.params.id);
  if (!e || e.orgId !== req.admin!.orgId) throw notFound('Enrollment');
  res.json({ enrollment: e });
});

enrollmentsRouter.post('/:id/revoke', async (req, res) => {
  const a = req.admin!;
  const [e] = await db().query(`SELECT * FROM enrollments WHERE id = $1 AND org_id = $2`, [req.params.id, a.orgId]);
  if (!e) throw notFound('Enrollment');
  if (e.device_id) throw conflict('enrollment_used', 'This invitation was already used. Revoke the device instead.');
  if (e.status === 'revoked') throw conflict('already_revoked', 'Invitation is already revoked');
  await db().query(`UPDATE enrollments SET status = 'revoked', revoked_at = now() WHERE id = $1`, [e.id]);
  await audit({ orgId: a.orgId, actor: { type: 'user', id: a.id, name: a.name }, action: 'enrollment.revoked',
    targetType: 'enrollment', targetId: e.id, ip: clientIp(req) });
  res.json({ enrollment: await emitEnrollment(e.id) });
});

// ---------------------------------------------------------------------------------------------
// Public landing page endpoint (QR scan in a browser)
// ---------------------------------------------------------------------------------------------

export const publicEnrollRouter = Router();

publicEnrollRouter.post('/scan', async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  const e = await usableEnrollment(db(), { token });
  if (await advanceEnrollment(db(), e.id, e.status, 'scanned')) {
    await audit({ orgId: e.org_id, actor: { type: 'system' }, action: 'enrollment.scanned',
      targetType: 'enrollment', targetId: e.id, ip: clientIp(req) });
    await emitEnrollment(e.id);
  }
  const org = await orgPublic(db(), e.org_id);
  res.json({
    organization: { name: org.name },
    expiresAt: new Date(e.expires_at).toISOString(),
    requestedPermissions: catalogFor(e.requested_permissions),
    requiredPermissions: e.required_permissions,
    appDownloadUrl: config.appDownloadUrl,
    appLink: appLink(token),
  });
});

// ---------------------------------------------------------------------------------------------
// Device-side enrollment (the agent app)
// ---------------------------------------------------------------------------------------------

export const deviceEnrollRouter = Router();

const permissionReport = z.array(z.object({ key: permissionKey, status: z.enum(PERMISSION_STATUSES) })).max(30);

deviceEnrollRouter.post('/inspect', async (req, res) => {
  const cred = credentialSchema.parse(req.body);
  const e = await usableEnrollment(db(), cred);
  if (await advanceEnrollment(db(), e.id, e.status, 'app_opened')) {
    await audit({ orgId: e.org_id, actor: { type: 'system' }, action: 'enrollment.app_opened',
      targetType: 'enrollment', targetId: e.id, ip: clientIp(req), metadata: { via: cred.token ? 'link' : 'pairing_code' } });
    await emitEnrollment(e.id);
  }
  const [assignee] = e.assigned_user_id ? await db().query(`SELECT name FROM users WHERE id = $1`, [e.assigned_user_id]) : [];
  res.json({
    enrollmentId: e.id,
    organization: await orgPublic(db(), e.org_id),
    assignedUserName: assignee?.name ?? null,
    deviceNameHint: e.device_name_hint ?? null,
    expiresAt: new Date(e.expires_at).toISOString(),
    requestedPermissions: catalogFor(e.requested_permissions),
    requiredPermissions: e.required_permissions,
  });
});

deviceEnrollRouter.post('/permissions-reviewed', async (req, res) => {
  const body = z.object({ permissions: permissionReport }).and(credentialSchema).parse(req.body);
  const e = await usableEnrollment(db(), body);
  if (await advanceEnrollment(db(), e.id, e.status, 'permissions_approved')) {
    await audit({ orgId: e.org_id, actor: { type: 'system' }, action: 'enrollment.permissions_reviewed',
      targetType: 'enrollment', targetId: e.id, ip: clientIp(req),
      metadata: { permissions: Object.fromEntries(body.permissions.map((p) => [p.key, p.status])) } });
    await emitEnrollment(e.id);
  }
  res.json({ ok: true });
});

deviceEnrollRouter.post('/complete', async (req, res) => {
  const body = z.object({
    installationId: z.string().trim().min(8).max(100),
    device: z.object({
      name: z.string().trim().max(80).optional().default(''),
      platform: z.enum(['android', 'ios']),
      manufacturer: z.string().trim().max(80).nullish(),
      model: z.string().trim().max(80).nullish(),
      osVersion: z.string().trim().max(40).nullish(),
      appVersion: z.string().trim().max(40).nullish(),
      managementMode: z.enum(['device_owner', 'device_admin', 'none']).optional(),
    }),
    permissions: permissionReport,
  }).and(credentialSchema).parse(req.body);

  const secret = randomToken(32);
  const result = await db().tx(async (q) => {
    // Lock the invitation row so two devices racing the same token can't both enroll.
    const e = await usableEnrollment(q, body, true);
    const reported = new Map(body.permissions.map((p) => [p.key, p.status]));
    const required: string[] = e.required_permissions;
    const missing = required.filter((k) => reported.get(k as any) !== 'granted');
    if (missing.length) {
      throw new HttpError(422, 'required_permissions_missing', `Required permissions not granted: ${missing.join(', ')}`);
    }

    // Re-enrolling the same installation replaces its previous registration.
    const replaced = await q.query(
      `UPDATE devices SET lifecycle_status = 'revoked', revoked_at = now(), revoke_reason = 're_enrolled', secret_version = secret_version + 1
       WHERE org_id = $1 AND installation_id = $2 AND lifecycle_status <> 'revoked' RETURNING id`,
      [e.org_id, body.installationId]);

    const d = body.device;
    const name = d.name || e.device_name_hint || [d.manufacturer, d.model].filter(Boolean).join(' ') || 'Unnamed device';
    const [device] = await q.query(
      `INSERT INTO devices (org_id, enrollment_id, assigned_user_id, name, platform, manufacturer, model, os_version,
                            app_version, installation_id, secret_hash, ownership, management_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, name`,
      [e.org_id, e.id, e.assigned_user_id, name, d.platform, d.manufacturer ?? null, d.model ?? null, d.osVersion ?? null,
        d.appVersion ?? null, body.installationId, sha256(secret), e.ownership, d.managementMode ?? 'none']);

    for (const key of e.requested_permissions as string[]) {
      const status = reported.get(key as any) ?? 'not_requested';
      await q.query(`INSERT INTO device_permissions (device_id, key, status, required) VALUES ($1,$2,$3,$4)`,
        [device.id, key, status, required.includes(key)]);
      await q.query(`INSERT INTO permission_history (device_id, key, from_status, to_status) VALUES ($1,$2,NULL,$3)`,
        [device.id, key, status]);
    }
    await advanceEnrollment(q, e.id, e.status, 'authenticated');
    await q.query(`UPDATE enrollments SET device_id = $2 WHERE id = $1`, [e.id, device.id]);
    await audit({ orgId: e.org_id, actor: { type: 'device', id: device.id, name: device.name }, action: 'device.enrolled',
      targetType: 'device', targetId: device.id, ip: clientIp(req),
      metadata: { enrollmentId: e.id, platform: d.platform, model: d.model ?? null, replaced: replaced.map((r) => r.id) } }, q);
    return { orgId: e.org_id as string, enrollmentId: e.id as string, deviceId: device.id as string, replaced: replaced.map((r) => r.id as string) };
  });

  await emitEnrollment(result.enrollmentId);
  await emitDevice(result.orgId, result.deviceId);
  for (const id of result.replaced) {
    hub.toDevice(id, { type: 'device.revoked', reason: 're_enrolled' });
    hub.closeDevice(id, 4003, 'revoked');
    await emitDevice(result.orgId, id);
  }
  res.status(201).json({ deviceId: result.deviceId, deviceSecret: secret, organization: await orgPublic(db(), result.orgId) });
});
