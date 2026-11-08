# Security and Authorisation

The core principle: **the organisation can only see what the device user has knowingly allowed, and
every remote action is authorised, scoped to one organisation, and logged.**

## Every remote operation is checked
Before the server relays anything to a device it checks:

| # | Check | Where |
|---|---|---|
| 1 | Admin is authenticated (valid JWT, account active, role read fresh from DB) | `middleware/auth.ts` `requireAdmin` |
| 2 | Admin's role permits the action (RBAC) | `requireAdmin(minRole)` per route |
| 3 | Device belongs to the admin's organisation (cross-org IDs return 404, not 403) | `scopedDevice()` in `routes/devices.ts` |
| 4 | Device lifecycle is `authenticated` (not suspended/revoked) | `services/screen.ts` `requestSession`, check-in |
| 5 | Required permission state (`screen_capture` = `granted`) | `requestSession` |
| 6 | User consent: no signalling reaches the device until the device reports `screen.consent: approved`, which the app sends only after the OS capture dialog succeeds | `realtime/ws.ts` drops `rtc.*` while `awaiting_consent` |
| 7 | Only the admin who requested a session can signal on it | `realtime/ws.ts` `requestedBy` check |

All seven are covered by `apps/api/test/e2e.test.ts`.

## Authentication
- **Admins.** Passwords hashed with scrypt (N=16384) with constant-time verify, including a dummy hash for unknown emails. Access JWT (HS256, 15 min) is held in memory only. Refresh token is an `httpOnly`, `SameSite=Strict`, `Secure` (prod) cookie scoped to `/api/auth`, **rotated on every use**. Re-presenting a rotated token revokes the whole login family and is audit-logged (`auth.refresh_reuse_detected`). Disabling a user or changing their role revokes their refresh tokens and drops their live sockets immediately.
- **Devices.** Enrollment issues a 256-bit secret, stored only as SHA-256. Device JWTs (60 min) carry a secret version (`sv`), so rotating credentials or revoking the device kills outstanding tokens instantly.
- **WebSockets.** Never authenticated by a long-lived credential in the URL. Clients exchange their bearer token for a single-use ticket that expires in 30 s.

## Enrollment tokens
- Link token: 256-bit random, stored as SHA-256, shown to the admin once.
- Pairing code: 8 characters from a 30-symbol unambiguous alphabet (~39 bits), stored as HMAC-SHA256 with a server pepper (`PAIRING_PEPPER`), so a database leak alone can't brute-force codes. Rate limited to 30/min/IP.
- Both expire (5 min to 7 days, admin's choice), can be revoked, and are **single-use**: `complete` locks the row in a transaction so concurrent attempts can't both enroll.
- A device isn't marked authenticated until the backend has verified the token, required permissions and registration.

## Organisation isolation
Every query is filtered by the `org_id` taken from the verified token, never from the request. WebSocket broadcasts are keyed by org. The test suite asserts that a second org can't read, act on or receive events for another org's devices.

## Transport
- HTTPS/WSS in production (terminate TLS at your proxy and set `TRUST_PROXY`). The Android release build refuses cleartext.
- Screen media is WebRTC, **DTLS-SRTP encrypted end to end** between the phone and the admin's browser. The server only relays signalling (SDP/ICE) and never sees media. TURN relays forward encrypted packets they can't decrypt.
- Helmet sets CSP, `frame-ancestors 'none'`, HSTS (prod), nosniff and related headers. CORS is allow-list only.

## Rate limiting and abuse controls
Login/setup 10/min/IP, enrollment and device token 30/min/IP, general API 600/min/IP. WebSocket frames capped at 256 KB and 400 frames per 10 s per socket. All inputs validated with zod.

## Privacy controls
- Location is dropped server-side unless the device's `location` permission is `granted`.
- Telemetry the OS won't provide is stored and shown as unavailable, never estimated.
- The device user can opt out of screen-share requests (ends any live session), stop sharing at any time, and unenroll the device themselves.
- Sessions: 60 s to consent, 30 min maximum (configurable), ended automatically if either side disconnects for more than 30 s.

## Audit trail
Append-only `audit_logs` with actor (user/device/system), action, target, IP and metadata. It covers logins, failed logins, token-reuse detection, every enrollment step, device connect/disconnect, permission changes (also kept in `permission_history`), every screen-session transition, messages, check-ins, renames, suspension, revocation, credential rotation, and user and org changes. Streamed live to admins (`audit.created`) and readable only by `admin`+.

## Known gaps before production
- **Single instance.** The socket registry, WS tickets and live-session timers are in memory. To scale out, move them to Redis (pub/sub + TTL keys) and use sticky sessions for `/ws`.
- **No MFA/SSO yet.** Add TOTP or SAML/OIDC before exposing the dashboard publicly.
- **No email delivery.** Users are created by admins with an initial password; there's no invite or reset email.
- `JWT_SECRET` is a symmetric HS256 key. Rotate it by deploying a new value, which signs everyone out.
- Rate limits are per-process memory. Use a Redis store when running more than one instance.
