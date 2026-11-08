import os from 'node:os';

function lanIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return 'localhost';
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT ?? 4000);
const defaultOrigin = `http://${lanIp()}:${port}`;

function required(name: string, devDefault: string): string {
  const v = env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devDefault;
}

export const config = {
  isProd,
  port,
  // Where phones reach the API, and where the enrollment landing page lives.
  publicApiUrl: (env.PUBLIC_API_URL ?? defaultOrigin).replace(/\/$/, ''),
  publicWebUrl: (env.PUBLIC_WEB_URL ?? env.PUBLIC_API_URL ?? defaultOrigin).replace(/\/$/, ''),
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  // postgres://... uses node-postgres. Anything else is an embedded PGlite data directory.
  databaseUrl: env.DATABASE_URL ?? '',
  pgliteDir: env.PGLITE_DIR ?? './data/pglite',
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me-0123456789'),
  // Pepper mixed into pairing-code hashes so a DB leak alone can't brute-force short codes.
  pairingPepper: required('PAIRING_PEPPER', 'dev-only-pairing-pepper'),
  adminAccessTtlSec: 15 * 60,
  refreshTtlDays: 14,
  deviceAccessTtlSec: 60 * 60,
  wsTicketTtlMs: 30_000,
  consentTimeoutSec: 60,
  screenSessionMaxMinutes: Number(env.SCREEN_SESSION_MAX_MINUTES ?? 30),
  reconnectGraceMs: 30_000,
  appDownloadUrl: env.APP_DOWNLOAD_URL || null,
  // base64url SHA-256 of the APK signing certificate; required for Android Enterprise QR provisioning.
  appSignatureChecksum: env.APP_SIGNATURE_CHECKSUM || null,
  androidAdminComponent: env.ANDROID_ADMIN_COMPONENT ?? 'com.mdmplatform.agent/.permissions.MdmDeviceAdminReceiver',
  stunUrls: (env.STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').filter(Boolean),
  turn: {
    urls: (env.TURN_URLS ?? '').split(',').filter(Boolean),
    // Either a static username/credential, or a coturn `static-auth-secret` for ephemeral credentials.
    username: env.TURN_USERNAME ?? '',
    credential: env.TURN_CREDENTIAL ?? '',
    sharedSecret: env.TURN_SHARED_SECRET ?? '',
  },
  webDistDir: env.WEB_DIST_DIR ?? '',
  trustProxy: env.TRUST_PROXY ?? (isProd ? '1' : ''),
};
