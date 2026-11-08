# MDM Platform

Consent-first mobile device management: enroll a phone by QR code, have the device user explicitly
grant each permission, monitor live device health, and start screen sharing **only after the user
approves it on the device and the OS confirms it**.

```
apps/api       Node 20+ / TypeScript / Express 5 / ws / Postgres (PGlite embedded for dev)
apps/web       React 19 / Vite / Tailwind 4 admin dashboard + public /enroll/:token page
apps/android   Kotlin / Jetpack Compose agent: enrollment, permissions, telemetry, MediaProjection + WebRTC
docs/          PROTOCOL.md (API + WebSocket contract), SECURITY.md, PLATFORM-LIMITATIONS.md
```

## Status

| Area | State | Verified by |
|---|---|---|
| Admin auth (rotating refresh tokens, RBAC: owner/admin/operator/viewer) | Done | API e2e tests |
| Organisation isolation | Done | API e2e tests |
| Enrollment: link, QR, one-time pairing code, expiry, revoke, live progress | Done | API e2e + browser test |
| Device auth, credential rotation, suspend, revoke, self-unenroll | Done | API e2e tests |
| Permission management with history | Done | API e2e tests |
| Real-time monitoring over WebSockets | Done | API e2e + browser test |
| Consent-gated WebRTC screen sharing (signalling, expiry, reconnect grace) | Done | API e2e + browser test with a simulated WebRTC device |
| Support messages, check-ins, audit log | Done | API e2e tests |
| Remote control (Android): consented, server-enforced, audited | Done | API tests + browser test (click → exact normalised tap on device) |
| Company-owned setup (Android Enterprise QR, device owner) | Done | API tests (payload); **needs a factory-reset phone to prove** |
| Queued commands: lock, reboot, wipe (typed confirm + password re-entry) | Done | API tests + browser test (lock) |
| Security policy + compliance, non-compliant alerts | Done | API tests |
| Android agent (all of the above) | Built and signed (`assembleDebug`/`assembleRelease` pass, 0 lint errors) | **Not yet run on a physical device** |
| iOS, app inventory, camera/mic sessions, SSO/MFA | Next | iOS needs Apple Business Manager + Apple MDM certificate |

## Quick start (local)

```bash
npm run install:all
cp apps/api/.env.example apps/api/.env      # dev defaults work as-is
npm run dev:api                             # http://<lan-ip>:4000, PGlite data in apps/api/data/
npm run dev:web                             # http://localhost:5173 (proxies /api and /ws)
```
1. Open http://localhost:5173 and complete first-run setup (creates your organisation and owner account).
2. **Enrollment → Enroll device**: choose permissions, then generate.
3. On the phone, scan the QR code. The landing page offers "Open in the MDM app" and the APK download.
   Phones must reach the API, so use the LAN IP the API prints (same Wi-Fi), or set `PUBLIC_API_URL`/`PUBLIC_WEB_URL`.
4. In the app: review and grant permissions, then enroll. The dashboard stepper moves to **Connected**.
5. Open the device and click **Start screen sharing**. The phone shows who is asking and why. The user taps Approve, then Android's "Start now". The live screen appears in the dashboard.

### Android app
```bash
cd apps/android
JAVA_HOME=/path/to/jdk-17 ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```
CI (`.github/workflows/android.yml`) builds on every push to `main` and publishes the APK to the `latest`
GitHub release. Point `APP_DOWNLOAD_URL` at it. See `apps/android/README.md` for App Links and permissions.

## Production

```bash
npm run build && NODE_ENV=production npm start   # API serves the built dashboard on the same origin
```
Required: `JWT_SECRET`, `PAIRING_PEPPER`, `PUBLIC_API_URL`, `DATABASE_URL` (Postgres 14+), TLS at the
proxy (`TRUST_PROXY=1`), and a **TURN server** (coturn: `TURN_URLS` + `TURN_SHARED_SECRET`). Without TURN,
screen sharing fails on many mobile networks. Migrations run automatically at boot (`npm --prefix apps/api run migrate` to run them alone).
Run a **single API instance** until the real-time layer moves to Redis (see `docs/SECURITY.md`).

## Testing

```bash
npm test     # 28 API end-to-end tests: real HTTP + WebSockets + in-memory Postgres
```
They cover setup, refresh-token theft detection, single-use WS tickets, enrollment steps and single-use
tokens, required-permission enforcement, telemetry (incl. discarding location without consent), RBAC,
the full consented screen-share signalling flow, user rejection and stop, opt-out blocking, cross-org
isolation, suspend/resume/revoke with token invalidation, and audit trail completeness.

**Manual device test checklist** (needs a physical Android 8+ phone; emulators can't use MediaProjection reliably):
- [ ] Enroll by QR, by pairing code, and by `mdm://` link
- [ ] Deny an optional permission, then grant it later from the app. The dashboard updates live.
- [ ] Screen share: approve, rotate the phone, stop from the notification, then stop from the dashboard
- [ ] Reject a request, and let one time out (60 s)
- [ ] Airplane mode mid-session. The session ends after 30 s.
- [ ] Suspend, resume and revoke from the dashboard. The app reflects each state; revoke wipes credentials.
- [ ] Reboot the phone. The agent reconnects.
- [ ] Remote control: enable it in the app (disclosure → Settings; on Samsung/Android 13+ "Allow restricted settings" first), start a session with control, then tap, swipe, Back/Home and type text
- [ ] Factory reset a test phone, tap the welcome screen 6×, scan the company QR. The app installs as device owner and enrolls.
- [ ] Lock it from the dashboard. Set a passcode policy and check it's enforced. Wipe a **test** phone.
