import type { NextFunction, Request, Response } from 'express';
import { HttpError, forbidden } from '../lib/errors.js';
import { verify, type AdminClaims, type DeviceClaims } from '../lib/jwt.js';
import { db } from '../state.js';

export const ROLE_RANK: Record<string, number> = { member: 0, viewer: 1, operator: 2, admin: 3, owner: 4 };
export type Role = 'owner' | 'admin' | 'operator' | 'viewer';

export type AdminCtx = { id: string; orgId: string; role: string; name: string; email: string };
export type DeviceCtx = { id: string; orgId: string; name: string; lifecycleStatus: string };

declare global {
  namespace Express {
    interface Request {
      admin?: AdminCtx;
      device?: DeviceCtx;
    }
  }
}

const bearer = (req: Request) => {
  const h = req.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

export const hasRole = (role: string, min: Role) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK[min]!;

/** Authenticates an admin and enforces a minimum role. Role and status are read from the DB on
 *  every request, so demotions and disabled accounts take effect without waiting for token expiry. */
export function requireAdmin(min: Role = 'viewer') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const claims = await verify<AdminClaims>(token, 'admin');
    const [u] = await db().query(`SELECT id, org_id, role, name, email, status FROM users WHERE id = $1`, [claims.sub]);
    if (!u || u.status !== 'active' || u.org_id !== claims.org || u.role === 'member') {
      throw new HttpError(401, 'invalid_token', 'Account is not active');
    }
    if (!hasRole(u.role, min)) throw forbidden(`This action requires the ${min} role or higher`);
    req.admin = { id: u.id, orgId: u.org_id, role: u.role, name: u.name, email: u.email };
    next();
  };
}

/** Authenticates an enrolled device. Rejects revoked/suspended devices and tokens minted from a rotated secret. */
export function requireDevice(opts: { allowSuspended?: boolean } = {}) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'unauthenticated', 'Device token required');
    const claims = await verify<DeviceClaims>(token, 'device');
    const [d] = await db().query(
      `SELECT id, org_id, name, lifecycle_status, secret_version FROM devices WHERE id = $1`, [claims.sub]);
    if (!d || d.org_id !== claims.org || d.secret_version !== claims.sv) {
      throw new HttpError(401, 'invalid_token', 'Device credential is no longer valid');
    }
    if (d.lifecycle_status === 'revoked') throw new HttpError(403, 'device_revoked', 'This device has been unenrolled');
    if (d.lifecycle_status === 'suspended' && !opts.allowSuspended) {
      throw new HttpError(403, 'device_suspended', 'This device is suspended by your organisation');
    }
    req.device = { id: d.id, orgId: d.org_id, name: d.name, lifecycleStatus: d.lifecycle_status };
    next();
  };
}

export const clientIp = (req: Request) => req.ip ?? null;
