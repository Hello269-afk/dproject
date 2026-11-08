import { Router } from 'express';
import { z } from 'zod';
import { hashPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { PERMISSION_CATALOG } from '../lib/permissions.js';
import { ROLE_RANK, clientIp, hasRole, requireAdmin } from '../middleware/auth.js';
import { hub } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { endSession, getLive, iceServers } from '../services/screen.js';
import { auditDto, loadDevices, loadSession, loadSessions, orgDto, userDto } from '../services/serialize.js';
import { db } from '../state.js';
import { password } from './auth.js';

const actorOf = (req: any) => ({ type: 'user' as const, id: req.admin.id, name: req.admin.name });

// ---------- Screen sessions ----------

export const screenSessionsRouter = Router();
screenSessionsRouter.use(requireAdmin('viewer'));

screenSessionsRouter.get('/', async (req, res) => {
  const { deviceId, status } = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: unknown[] = [];
  if (deviceId && z.string().uuid().safeParse(deviceId).success) { params.push(deviceId); where.push(`AND s.device_id = $${params.length + 1}`); }
  if (status) { params.push(status); where.push(`AND s.status = $${params.length + 1}`); }
  res.json({ sessions: await loadSessions(db(), req.admin!.orgId, where.join(' '), params) });
});

screenSessionsRouter.post('/:id/end', requireAdmin('operator'), async (req, res) => {
  const a = req.admin!;
  const s = z.string().uuid().safeParse(req.params.id).success ? await loadSession(db(), String(req.params.id)) : null;
  if (!s || s.orgId !== a.orgId) throw notFound('Session');
  // Operators can stop their own sessions; admins can stop anyone's.
  if (s.requestedBy.id !== a.id && !hasRole(a.role, 'admin')) throw forbidden('Only the requesting operator or an admin can stop this session');
  if (!getLive(s.id)) return res.json({ session: s });
  const session = await endSession(s.id, 'ended', 'admin_stopped', actorOf(req));
  res.json({ session });
});

export const rtcRouter = Router();
rtcRouter.get('/ice-servers', requireAdmin('operator'), (req, res) => {
  res.json({ iceServers: iceServers(req.admin!.id) });
});

// ---------- Overview ----------

export const overviewRouter = Router();
overviewRouter.get('/', requireAdmin('viewer'), async (req, res) => {
  const orgId = req.admin!.orgId;
  const devices = await loadDevices(db(), orgId);
  const live = devices.filter((d) => d.lifecycleStatus !== 'revoked');
  const [{ awaiting }] = (await db().query(
    `SELECT count(*)::int AS awaiting FROM enrollments WHERE org_id = $1
       AND status IN ('scanned','app_opened','permissions_approved') AND expires_at > now()`, [orgId])) as [{ awaiting: number }];
  const [{ active }] = (await db().query(
    `SELECT count(*)::int AS active FROM screen_sessions WHERE org_id = $1 AND status IN ('awaiting_consent','connecting','active')`, [orgId])) as [{ active: number }];
  const lowBattery = (d: (typeof devices)[number]) => d.telemetry?.batteryPct != null && d.telemetry.batteryPct < 15 && d.telemetry.charging === false;
  const staleMs = 24 * 3_600_000;
  const needsAttention = live.filter((d) => d.displayStatus === 'permission_required' || d.displayStatus === 'non_compliant' || d.lifecycleStatus === 'suspended' || lowBattery(d)
    || (!d.online && d.lastSeenAt && Date.now() - new Date(d.lastSeenAt).getTime() > staleMs)).length;

  const days = (rows: any[]) => {
    const map = new Map(rows.map((r) => [r.day, r.count]));
    return Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
      return { date, count: map.get(date) ?? 0 };
    });
  };
  const enrollmentsByDay = days(await db().query(
    `SELECT to_char(enrolled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count FROM devices
     WHERE org_id = $1 AND enrolled_at > now() - interval '14 days' GROUP BY 1`, [orgId]));
  const activityByDay = days(await db().query(
    `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS count FROM audit_logs
     WHERE org_id = $1 AND created_at > now() - interval '14 days' GROUP BY 1`, [orgId]));
  const tally = (key: (d: (typeof devices)[number]) => string, list = devices) => {
    const m = new Map<string, number>();
    for (const d of list) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
    return [...m.entries()].map(([k, count]) => ({ k, count }));
  };
  const [{ pending }] = (await db().query(
    `SELECT count(*)::int AS pending FROM device_commands WHERE org_id = $1 AND status IN ('pending','sent')`, [orgId])) as [{ pending: number }];
  const recent = await db().query(`SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY id DESC LIMIT 12`, [orgId]);

  res.json({
    counts: {
      total: live.length,
      authenticated: live.filter((d) => d.lifecycleStatus === 'authenticated').length,
      online: live.filter((d) => d.online).length,
      offline: live.filter((d) => !d.online).length,
      awaitingApproval: awaiting,
      activeScreenSessions: active,
      needsAttention,
      suspended: devices.filter((d) => d.lifecycleStatus === 'suspended').length,
      revoked: devices.filter((d) => d.lifecycleStatus === 'revoked').length,
      nonCompliant: live.filter((d) => d.displayStatus === 'non_compliant').length,
      pendingCommands: pending,
    },
    enrollmentsByDay,
    activityByDay,
    platformSplit: tally((d) => d.platform, live).map(({ k, count }) => ({ platform: k, count })),
    statusSplit: tally((d) => d.displayStatus).map(({ k, count }) => ({ status: k, count })),
    recentActivity: recent.map(auditDto),
  });
});

// ---------- Users ----------

export const usersRouter = Router();
usersRouter.use(requireAdmin('operator'));

usersRouter.get('/', async (req, res) => {
  const a = req.admin!;
  // Operators only need the member directory to assign devices at enrollment.
  const onlyMembers = req.query.role === 'member' || !hasRole(a.role, 'admin');
  const rows = await db().query(
    `SELECT * FROM users WHERE org_id = $1 ${onlyMembers ? `AND role = 'member'` : ''} ORDER BY created_at`, [a.orgId]);
  res.json({ users: rows.map(userDto) });
});

const roleSchema = z.enum(['owner', 'admin', 'operator', 'viewer', 'member']);

/** Admins may manage roles below their own; only owners touch owners. */
function assertCanAssign(actorRole: string, targetRole: string) {
  if ((ROLE_RANK[targetRole] ?? 0) > (ROLE_RANK[actorRole] ?? 0) || (targetRole === 'owner' && actorRole !== 'owner')) {
    throw forbidden(`Your role cannot manage ${targetRole} accounts`);
  }
}

usersRouter.post('/', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const body = z.object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(1).max(120),
    role: roleSchema,
    password: password.optional(),
  }).parse(req.body);
  assertCanAssign(a.role, body.role);
  if (body.role !== 'member' && !body.password) throw badRequest('password_required', 'Dashboard users need a password');
  const [exists] = await db().query(`SELECT id FROM users WHERE lower(email) = $1`, [body.email]);
  if (exists) throw conflict('email_taken', 'A user with that email already exists');
  const hash = body.role !== 'member' && body.password ? await hashPassword(body.password) : null;
  const [row] = await db().query(
    `INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [a.orgId, body.email, body.name, hash, body.role]);
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'user.created', targetType: 'user', targetId: row.id,
    ip: clientIp(req), metadata: { email: body.email, role: body.role } });
  res.status(201).json({ user: userDto(row) });
});

usersRouter.patch('/:id', requireAdmin('admin'), async (req, res) => {
  const a = req.admin!;
  const body = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    role: roleSchema.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  }).parse(req.body);
  const [u] = z.string().uuid().safeParse(req.params.id).success
    ? await db().query(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [req.params.id, a.orgId]) : [];
  if (!u) throw notFound('User');
  assertCanAssign(a.role, u.role);
  if (body.role) assertCanAssign(a.role, body.role);
  if (u.id === a.id && (body.role || body.status)) throw forbidden('You cannot change your own role or status');
  if (body.role && body.role !== 'member' && !u.password_hash) {
    throw badRequest('password_required', 'This member has no password. Create a new dashboard user instead.');
  }
  if (u.role === 'owner' && (body.role && body.role !== 'owner' || body.status === 'disabled')) {
    const [{ n }] = (await db().query(`SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'owner' AND status = 'active'`, [a.orgId])) as [{ n: number }];
    if (n <= 1) throw conflict('last_owner', 'An organisation must keep at least one active owner');
  }
  const [row] = await db().query(
    `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), status = COALESCE($4, status) WHERE id = $1 RETURNING *`,
    [u.id, body.name ?? null, body.role ?? null, body.status ?? null]);
  if (body.status === 'disabled' || body.role) {
    // Kill live sessions so the change bites now, not at token expiry.
    await db().query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
    hub.closeUser(a.orgId, u.id, 4003, 'account_changed');
  }
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'user.updated', targetType: 'user', targetId: u.id,
    ip: clientIp(req), metadata: { changes: body, previousRole: u.role } });
  res.json({ user: userDto(row) });
});

// ---------- Organization ----------

export const orgRouter = Router();
orgRouter.get('/', requireAdmin('viewer'), async (req, res) => {
  const [o] = await db().query(`SELECT * FROM organizations WHERE id = $1`, [req.admin!.orgId]);
  res.json({ organization: orgDto(o) });
});
orgRouter.patch('/', requireAdmin('owner'), async (req, res) => {
  const a = req.admin!;
  const body = z.object({
    name: z.string().trim().min(2).max(120).optional(),
    supportEmail: z.string().trim().email().nullable().optional(),
    supportPhone: z.string().trim().max(40).nullable().optional(),
  }).parse(req.body);
  const [o] = await db().query(
    `UPDATE organizations SET name = COALESCE($2, name),
       support_email = CASE WHEN $3::boolean THEN $4 ELSE support_email END,
       support_phone = CASE WHEN $5::boolean THEN $6 ELSE support_phone END
     WHERE id = $1 RETURNING *`,
    [a.orgId, body.name ?? null, body.supportEmail !== undefined, body.supportEmail ?? null,
      body.supportPhone !== undefined, body.supportPhone ?? null]);
  await audit({ orgId: a.orgId, actor: actorOf(req), action: 'org.updated', targetType: 'organization', targetId: a.orgId,
    ip: clientIp(req), metadata: { changes: body } });
  res.json({ organization: orgDto(o) });
});

// ---------- Audit log ----------

export const auditRouter = Router();
auditRouter.get('/', requireAdmin('admin'), async (req, res) => {
  const q = z.object({
    action: z.string().max(80).optional(),
    actorType: z.enum(['user', 'device', 'system']).optional(),
    targetId: z.string().uuid().optional(),
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const where = ['org_id = $1'];
  const params: unknown[] = [req.admin!.orgId];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (q.action) add(`action LIKE ?`, `${q.action.replace(/[%_]/g, '')}%`);
  if (q.actorType) add('actor_type = ?', q.actorType);
  if (q.targetId) add('target_id = ?', q.targetId);
  if (q.before) add('id < ?', q.before);
  params.push(q.limit + 1);
  const rows = await db().query(`SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`, params);
  const page = rows.slice(0, q.limit);
  res.json({ logs: page.map(auditDto), nextBefore: rows.length > q.limit ? String(page[page.length - 1]!.id) : null });
});

// ---------- Permission catalog (public) ----------

export const catalogRouter = Router();
catalogRouter.get('/catalog', (_req, res) => res.json({ permissions: PERMISSION_CATALOG }));
