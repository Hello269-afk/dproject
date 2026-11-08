import { SignJWT, jwtVerify, errors } from 'jose';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const key = new TextEncoder().encode(config.jwtSecret);
const ISS = 'mdm-api';

export type AdminClaims = { sub: string; org: string; role: string; aud: 'admin' };
export type DeviceClaims = { sub: string; org: string; aud: 'device'; sv: number };

export async function signAdmin(c: Omit<AdminClaims, 'aud'>): Promise<string> {
  return new SignJWT({ org: c.org, role: c.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub).setIssuer(ISS).setAudience('admin')
    .setIssuedAt().setExpirationTime(`${config.adminAccessTtlSec}s`)
    .sign(key);
}

// `sv` (secret version) ties a device token to the credential it was minted from, so rotating
// or revoking the secret invalidates outstanding tokens immediately.
export async function signDevice(c: Omit<DeviceClaims, 'aud'>): Promise<string> {
  return new SignJWT({ org: c.org, sv: c.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub).setIssuer(ISS).setAudience('device')
    .setIssuedAt().setExpirationTime(`${config.deviceAccessTtlSec}s`)
    .sign(key);
}

export async function verify<T>(token: string, aud: 'admin' | 'device'): Promise<T> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISS, audience: aud, algorithms: ['HS256'] });
    return payload as T;
  } catch (e) {
    if (e instanceof errors.JWTExpired) throw new HttpError(401, 'token_expired', 'Access token expired');
    throw new HttpError(401, 'invalid_token', 'Invalid access token');
  }
}
