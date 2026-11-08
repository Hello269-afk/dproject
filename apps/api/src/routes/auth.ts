import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import type { Queryable } from '../db/index.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { HttpError, conflict } from '../lib/errors.js';
import { signAdmin } from '../lib/jwt.js';
import { clientIp, requireAdmin } from '../middleware/auth.js';
import { hub } from '../realtime/hub.js';
import { audit } from '../services/audit.js';
import { orgDto, userDto } from '../services/serialize.js';
import { db } from '../state.js';

export const authRouter = Router();

const COOKIE = 'mdm_rt';
const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: config.isProd,
  path: '/api/auth',
  maxAge: config.refreshTtlDays * 86_400_000,
});

export const password = z.string().min(10, 'Password must be at least 10 characters').max(200);

async function issueSession(req: Request, res: Response, user: any, familyId: string = randomUUID(), q: Queryable = db()) {
  const refresh = randomToken(32);
  await q.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(days => $4), $5, $6)`,
    [user.id, familyId, sha256(refresh), config.refreshTtlDays, clientIp(req), (req.get('user-agent') ?? '').slice(0, 300)],
  );
  res.cookie(COOKIE, refresh, cookieOpts());
  const [org] = await q.query(`SELECT * FROM organizations WHERE id = $1`, [user.org_id]);
  return {
    accessToken: await signAdmin({ sub: user.id, org: user.org_id, role: user.role }),
    user: userDto(user),
    organization: orgDto(org),
  };
}

authRouter.get('/setup-status', async (_req, res) => {
  const [{ n }] = (await db().query(`SELECT count(*)::int AS n FROM users WHERE role <> 'member'`)) as [{ n: number }];
  res.json({ needsSetup: n === 0 });
});

// First-run bootstrap: creates the organisation and its owner. Disabled once any admin exists.
authRouter.post('/setup', async (req, res) => {
  const [{ n: existing }] = (await db().query(`SELECT count(*)::int AS n FROM users WHERE role <> 'member'`)) as [{ n: number }];
  if (existing > 0) throw conflict('already_setup', 'This server is already set up. Sign in instead.');
  const body = z.object({
    orgName: z.string().trim().min(2).max(120),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    password,
  }).parse(req.body);

  const hash = await hashPassword(body.password);
  const out = await db().tx(async (q) => {
    const [{ n }] = (await q.query(`SELECT count(*)::int AS n FROM users WHERE role <> 'member'`)) as [{ n: number }];
    if (n > 0) throw conflict('already_setup', 'This server is already set up. Sign in instead.');
    const slug = body.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'org';
    const [org] = await q.query(`INSERT INTO organizations (name, slug, support_email) VALUES ($1, $2, $3) RETURNING *`,
      [body.orgName, slug, body.email]);
    const [user] = await q.query(
      `INSERT INTO users (org_id, email, name, password_hash, role, last_login_at) VALUES ($1,$2,$3,$4,'owner', now()) RETURNING *`,
      [org.id, body.email, body.name, hash]);
    return issueSession(req, res, user, undefined, q);
  });
  await audit({ orgId: out.organization.id, actor: { type: 'user', id: out.user.id, name: out.user.name },
    action: 'org.created', targetType: 'organization', targetId: out.organization.id, ip: clientIp(req) });
  res.status(201).json(out);
});

authRouter.post('/login', async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string().max(200) }).parse(req.body);
  const [user] = await db().query(`SELECT * FROM users WHERE lower(email) = $1`, [body.email]);
  const ok = await verifyPassword(body.password, user?.password_hash ?? null);
  if (!user || !ok || user.status !== 'active' || user.role === 'member') {
    if (user) {
      await audit({ orgId: user.org_id, actor: { type: 'system' }, action: 'auth.login_failed',
        targetType: 'user', targetId: user.id, ip: clientIp(req) });
    }
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  await db().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  const out = await issueSession(req, res, user);
  await audit({ orgId: user.org_id, actor: { type: 'user', id: user.id, name: user.name },
    action: 'auth.login', targetType: 'user', targetId: user.id, ip: clientIp(req) });
  res.json(out);
});

// Rotating refresh: each refresh token works once. Presenting an already-rotated token means it
// was copied, so the whole family (this login on every device) is revoked.
authRouter.post('/refresh', async (req, res) => {
  const token: string | undefined = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'no_session', 'Not signed in');
  const [rt] = await db().query(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [sha256(token)]);
  if (!rt || rt.revoked_at || new Date(rt.expires_at).getTime() < Date.now()) {
    res.clearCookie(COOKIE, { path: '/api/auth' });
    throw new HttpError(401, 'no_session', 'Session expired. Please sign in again.');
  }
  if (rt.rotated_at) {
    await db().query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [rt.family_id]);
    const [u] = await db().query(`SELECT org_id FROM users WHERE id = $1`, [rt.user_id]);
    if (u) await audit({ orgId: u.org_id, actor: { type: 'system' }, action: 'auth.refresh_reuse_detected',
      targetType: 'user', targetId: rt.user_id, ip: clientIp(req) });
    res.clearCookie(COOKIE, { path: '/api/auth' });
    throw new HttpError(401, 'no_session', 'Session was revoked for your security. Please sign in again.');
  }
  const [user] = await db().query(`SELECT * FROM users WHERE id = $1`, [rt.user_id]);
  if (!user || user.status !== 'active' || user.role === 'member') throw new HttpError(401, 'no_session', 'Account is not active');
  await db().query(`UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1`, [rt.id]);
  res.json(await issueSession(req, res, user, rt.family_id));
});

authRouter.post('/logout', async (req, res) => {
  const token: string | undefined = req.cookies?.[COOKIE];
  if (token) {
    const [rt] = await db().query(`SELECT family_id FROM refresh_tokens WHERE token_hash = $1`, [sha256(token)]);
    if (rt) await db().query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [rt.family_id]);
  }
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.status(204).end();
});

authRouter.get('/me', requireAdmin(), async (req, res) => {
  const [user] = await db().query(`SELECT * FROM users WHERE id = $1`, [req.admin!.id]);
  const [org] = await db().query(`SELECT * FROM organizations WHERE id = $1`, [req.admin!.orgId]);
  res.json({ user: userDto(user), organization: orgDto(org) });
});

export const wsTicketRouter = Router();
wsTicketRouter.post('/', requireAdmin(), (req, res) => {
  const a = req.admin!;
  res.json({ ticket: hub.issueTicket({ kind: 'admin', userId: a.id, orgId: a.orgId, role: a.role, name: a.name }) });
});
