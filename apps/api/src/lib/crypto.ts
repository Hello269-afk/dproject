import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  // Always do the work so timing doesn't reveal whether the account exists.
  const [, saltB64, keyB64] = (stored ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const expected = Buffer.from(keyB64 ?? '', 'base64');
  const key = await scryptAsync(pw, Buffer.from(saltB64 ?? '', 'base64'), 64, SCRYPT);
  return stored != null && expected.length === key.length && timingSafeEqual(expected, key);
}

// Crockford-style alphabet without 0/O/1/I/L/U, so codes survive being read aloud.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function pairingCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalisePairingCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, '');
export const hashPairingCode = (c: string) =>
  createHmac('sha256', config.pairingPepper).update(normalisePairingCode(c)).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
