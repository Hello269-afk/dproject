# MDM Platform: API and Real-time Protocol (v1)

This is the contract between the API (`apps/api`), the admin dashboard (`apps/web`) and the
device apps (`apps/android`, later `apps/ios`). Change it here first, then in code.

- Base URL: `PUBLIC_API_URL` (dev: `http://<lan-ip>:4000`). All REST lives under `/api`.
- JSON everywhere. Timestamps are ISO-8601 strings (UTC). IDs are UUID strings.
- Errors: HTTP status + `{ "error": { "code": "string_code", "message": "Human readable" } }`.
- Field names are camelCase in JSON.

---

## 1. Authentication models

### 1.1 Admin (dashboard users)
- `POST /api/auth/login` returns a short-lived **access token** (JWT, 15 min) in the body and sets
  a rotating **refresh token** as an `httpOnly`, `SameSite=Strict` cookie named `mdm_rt`
  (path `/api/auth`). `Secure` is set when `NODE_ENV=production`.
- The web app keeps the access token in memory only and sends `Authorization: Bearer <token>`.
- On 401 `token_expired`, call `POST /api/auth/refresh` (cookie sent automatically, use
  `credentials: "include"`), which rotates the refresh token. Reuse of a rotated refresh token
  revokes the whole token family (theft detection).

### 1.2 Device
- Enrollment yields `deviceId` + `deviceSecret` (shown once, store in Android Keystore-backed
  EncryptedSharedPreferences / iOS Keychain).
- `POST /api/device/token` exchanges them for a **device access token** (JWT, 60 min). Sent as
  `Authorization: Bearer <token>` to `/api/device/*`.
- Revoked or suspended devices get `403 device_revoked` / `403 device_suspended`.

### 1.3 WebSocket tickets
WebSocket connections never carry long-lived credentials in the URL.
- Admin: `POST /api/ws-ticket` → `{ ticket }`. Device: `POST /api/device/ws-ticket` → `{ ticket }`.
- Connect to `ws(s)://<api-host>/ws?ticket=<ticket>`. Tickets are single-use and expire in 30 s.

### 1.4 Roles (admin RBAC)
| Role | Can |
|---|---|
| `owner` | Everything, incl. organisation settings and managing admins |
| `admin` | Devices (suspend/revoke/remove), enrollments, users (not owners), audit log |
| `operator` | View devices, create enrollments, screen sharing, messages, check-ins |
| `viewer` | Read-only devices, telemetry, sessions |
| `member` | A device user. Cannot sign in to the dashboard. Devices are assigned to members (or any user). |

---

## 2. Shared enums

**DeviceStatus** (computed `displayStatus` on device objects):
`pending_enrollment`, `awaiting_user_approval`, `authenticating`, `authenticated`, `connected`,
`disconnected`, `permission_required`, `revoked`, `suspended`

Stored `lifecycleStatus`: `authenticated` | `suspended` | `revoked`. `displayStatus` derives from
lifecycle + live presence + required-permission state:
- revoked → `revoked`; suspended → `suspended`
- online and any *required* permission not `granted` → `permission_required`
- online → `connected`
- never connected since enrollment → `authenticated`; otherwise `disconnected`

**EnrollmentStatus**: `generated`, `scanned`, `app_opened`, `permissions_approved`,
`authenticated`, `connected`, `expired`, `revoked`

**PermissionStatus**: `not_requested`, `awaiting_approval`, `granted`, `denied`,
`restricted_by_os`, `revoked`, `not_supported`

**PermissionKey**: `screen_capture`, `camera`, `microphone`, `location`, `notifications`,
`accessibility`, `device_admin`, `files`, `usage_access`, `background`

`screen_capture` on Android/iOS is **per-session consent**: the OS shows its own dialog every time a
session starts. Its stored status means "the user allows the organisation to *ask*" (`granted`) or
"the user opted out of screen-share requests" (`denied`). Neither means the screen is being captured.

**ScreenSessionStatus**: `awaiting_consent`, `connecting`, `active`, `ended`, `rejected`,
`expired`, `failed`

**Platform**: `android` | `ios`

---

## 3. Object shapes

```ts
Organization { id, name, slug, supportEmail: string|null, supportPhone: string|null, createdAt }

User { id, orgId, email, name, role, status: "active"|"disabled", createdAt, lastLoginAt: string|null }

Enrollment {
  id, orgId, status: EnrollmentStatus,
  assignedUser: { id, name, email } | null,
  deviceNameHint: string|null,
  requestedPermissions: PermissionKey[],
  requiredPermissions: PermissionKey[],      // subset of requested; device is "permission_required" if any not granted
  expiresAt, createdAt, createdBy: { id, name },
  scannedAt, appOpenedAt, permissionsApprovedAt, authenticatedAt, connectedAt, revokedAt, // nullable strings
  deviceId: string|null
}

Telemetry {                                  // every field nullable = "unavailable"
  batteryPct: number|null, charging: boolean|null,
  networkType: "wifi"|"cellular"|"ethernet"|"none"|"other"|null,
  wifiSsid: string|null,                     // only if OS permits (needs location on Android)
  carrier: string|null, ipAddress: string|null,
  storageTotalBytes: number|null, storageFreeBytes: number|null,
  memoryTotalBytes: number|null, memoryAvailBytes: number|null,
  screenWidth: number|null, screenHeight: number|null,
  orientation: "portrait"|"landscape"|null,
  location: { lat: number, lng: number, accuracyM: number|null, at: string } | null,
  reportedAt: string                          // device clock, ISO
}

DevicePermission {
  key: PermissionKey, status: PermissionStatus,
  required: boolean,                          // from the enrollment's requiredPermissions
  updatedAt: string
}

Device {
  id, orgId, name, platform, manufacturer, model, osVersion, appVersion,
  installationId, lifecycleStatus, displayStatus, online: boolean,
  assignedUser: { id, name, email } | null,
  metadata: Record<string,string>,
  lastSeenAt: string|null, enrolledAt, suspendedAt: string|null, revokedAt: string|null,
  telemetry: Telemetry | null,                // latest; null = never reported
  permissions: DevicePermission[],
  activeScreenSessionId: string|null
}

ScreenSession {
  id, orgId, deviceId, deviceName,
  requestedBy: { id, name, email },
  purpose: string, status: ScreenSessionStatus,
  requestedAt, consentedAt, startedAt, endedAt, expiresAt,   // nullable strings except requestedAt/expiresAt
  endReason: string|null                      // "admin_stopped","user_stopped","device_disconnected","admin_disconnected","consent_timeout","max_duration","rejected","os_denied","device_revoked","error"
}

AuditLog { id, orgId, actorType: "user"|"device"|"system", actorId: string|null, actorName: string|null,
           action: string, targetType: string|null, targetId: string|null, ip: string|null,
           metadata: object, createdAt }

SupportMessage { id, deviceId, direction: "to_device"|"from_device", senderName: string|null, body, createdAt, readAt: string|null }

PermissionDefinition {
  key, name, description, why,
  android: { supported: boolean, mechanism: string, userApproval: boolean, notes: string },
  ios:     { supported: boolean, mechanism: string, userApproval: boolean, notes: string },
  manageInstructions: { android: string, ios: string }
}
```

---

## 4. Admin REST endpoints (Bearer admin token unless "public")

| Method & path | Role | Body / query → Response |
|---|---|---|
| `GET /api/auth/setup-status` | public | → `{ needsSetup: boolean }` |
| `POST /api/auth/setup` | public, only when no users exist | `{ orgName, name, email, password }` → `{ accessToken, user, organization }` |
| `POST /api/auth/login` | public | `{ email, password }` → `{ accessToken, user, organization }` |
| `POST /api/auth/refresh` | cookie | → `{ accessToken, user, organization }` |
| `POST /api/auth/logout` | cookie | → `204` |
| `GET /api/auth/me` | any | → `{ user, organization }` |
| `POST /api/ws-ticket` | any | → `{ ticket }` |
| `GET /api/overview` | viewer+ | → `{ counts: { total, authenticated, online, offline, awaitingApproval, activeScreenSessions, needsAttention, suspended, revoked }, enrollmentsByDay: [{date, count}], activityByDay: [{date, count}], platformSplit: [{platform, count}], statusSplit: [{status, count}], recentActivity: AuditLog[] }` |
| `GET /api/devices` | viewer+ | `?q=&status=&platform=` → `{ devices: Device[] }` |
| `GET /api/devices/:id` | viewer+ | → `{ device: Device }` |
| `PATCH /api/devices/:id` | operator+ | `{ name?, assignedUserId?: string|null, metadata? }` → `{ device }` |
| `POST /api/devices/:id/checkin` | operator+ | → `202 { requested: true }` (409 `device_offline` if offline) |
| `POST /api/devices/:id/suspend` | admin+ | `{ reason }` → `{ device }` |
| `POST /api/devices/:id/resume` | admin+ | → `{ device }` |
| `POST /api/devices/:id/revoke` | admin+ | `{ reason, confirm: "<device name>" }` → `{ device }` |
| `GET /api/devices/:id/activity` | viewer+ | → `{ logs: AuditLog[] }` |
| `GET /api/devices/:id/messages` | operator+ | → `{ messages: SupportMessage[] }` |
| `POST /api/devices/:id/messages` | operator+ | `{ body }` → `{ message }` |
| `GET /api/devices/:id/permission-history` | viewer+ | → `{ history: [{ key, from, to, at }] }` |
| `GET /api/enrollments` | operator+ | `?status=` → `{ enrollments: Enrollment[] }` |
| `POST /api/enrollments` | operator+ | `{ assignedUserId?, deviceNameHint?, expiresInMinutes (5..10080), requestedPermissions: PermissionKey[], requiredPermissions: PermissionKey[] }` → `{ enrollment, token, enrollmentUrl, pairingCode, appLink }` (token and pairing code are shown **once**) |
| `GET /api/enrollments/:id` | operator+ | → `{ enrollment }` |
| `POST /api/enrollments/:id/revoke` | operator+ | → `{ enrollment }` |
| `GET /api/screen-sessions` | viewer+ | `?deviceId=&status=` → `{ sessions: ScreenSession[] }` |
| `POST /api/devices/:id/screen-sessions` | operator+ | `{ purpose }` → `201 { session, iceServers }` |
| `POST /api/screen-sessions/:id/end` | operator+ (requester or admin+) | → `{ session }` |
| `GET /api/rtc/ice-servers` | operator+ | → `{ iceServers: RTCIceServer[] }` |
| `GET /api/users` | admin+ | → `{ users: User[] }` (operators get members only via `?role=member`) |
| `POST /api/users` | admin+ | `{ email, name, role, password? }` (password required unless role=member) → `{ user }` |
| `PATCH /api/users/:id` | admin+ | `{ name?, role?, status? }` → `{ user }` |
| `GET /api/organization` | any | → `{ organization }` |
| `PATCH /api/organization` | owner | `{ name?, supportEmail?, supportPhone? }` → `{ organization }` |
| `GET /api/audit-logs` | admin+ | `?action=&actorType=&targetId=&before=<id>&limit=` → `{ logs: AuditLog[], nextBefore: string|null }` |
| `GET /api/permissions/catalog` | public | → `{ permissions: PermissionDefinition[] }` |
| `GET /api/health` | public | → `{ ok: true }` |

### Enrollment link format
- `enrollmentUrl`: `${PUBLIC_WEB_URL}/enroll/<token>` (landing page in the web app; works on any phone). If `PUBLIC_WEB_URL` differs from `PUBLIC_API_URL`, `?api=<urlencoded PUBLIC_API_URL>` is appended so the app can find the API.
- `appLink`: `mdm://enroll?token=<token>&api=<urlencoded PUBLIC_API_URL>` (opens the Android app directly).
- The QR code encodes `enrollmentUrl`. The landing page offers "Open in app" (`appLink`) and the APK download.

### Public enrollment endpoints (rate limited, no auth)
| Method & path | Body → Response |
|---|---|
| `POST /api/public/enroll/scan` | `{ token }` → `{ organization: { name }, expiresAt, requestedPermissions: PermissionDefinition[], requiredPermissions: PermissionKey[], appDownloadUrl: string|null, appLink }`. Marks `scanned` (first time). |

---

## 5. Device REST endpoints

| Method & path | Auth | Body → Response |
|---|---|---|
| `POST /api/device/enroll/inspect` | none (token or code) | `{ token? , pairingCode? }` → `{ enrollmentId, organization: { name, supportEmail, supportPhone }, assignedUserName, deviceNameHint, expiresAt, requestedPermissions: PermissionDefinition[], requiredPermissions: PermissionKey[] }`. Marks `app_opened`. 404 `enrollment_not_found`, 410 `enrollment_expired`/`enrollment_revoked`/`enrollment_used`. |
| `POST /api/device/enroll/permissions-reviewed` | none | `{ token?, pairingCode?, permissions: [{ key, status }] }` → `{ ok: true }`. Marks `permissions_approved`. |
| `POST /api/device/enroll/complete` | none | `{ token?, pairingCode?, installationId, device: { name, platform, manufacturer, model, osVersion, appVersion }, permissions: [{ key, status }] }` → `{ deviceId, deviceSecret, organization }`. Single-use. Marks `authenticated`. 422 `required_permissions_missing` if any required permission is not `granted`. Re-enrolling the same `installationId` revokes its previous registration. |
| `POST /api/device/token` | none | `{ deviceId, deviceSecret }` → `{ accessToken, expiresIn, lifecycleStatus }`. Suspended devices get a token so the app can show its state; every other device endpoint and the WebSocket refuse them. |
| `POST /api/device/ws-ticket` | device | → `{ ticket }` |
| `GET /api/device/me` | device | → `{ device: Device, organization }` |
| `POST /api/device/credentials/rotate` | device | → `{ deviceSecret }` (old secret stops working immediately) |
| `POST /api/device/telemetry` | device | `Telemetry` → `204` (REST fallback; WS preferred) |
| `POST /api/device/permissions` | device | `{ permissions: [{ key, status }] }` → `204` |
| `GET /api/device/messages` | device | → `{ messages: SupportMessage[] }` |
| `POST /api/device/messages` | device | `{ body }` → `{ message }` |
| `POST /api/device/unenroll` | device | → `204`. User-initiated unenroll. Device becomes `revoked` with reason `user_unenrolled`. |

Rate limits: enrollment endpoints 30/min/IP, login 10/min/IP, token 30/min/IP.

---

## 6. WebSocket protocol (`/ws?ticket=...`)

Every frame is a JSON object with a `type`. The server closes with code `4001` (bad ticket),
`4003` (revoked/suspended/account changed), `4008` (replaced by a newer connection from the same device) or
`4029` (frame rate limit exceeded; reconnect with backoff). Payload fields sit flat next to `type`.
Either side may send `{ "type": "ping" }`; the other replies `{ "type": "pong" }`. The server also
uses WS-level pings every 20 s and drops dead sockets after 45 s.

### 6.1 Server → admin (broadcast to every admin socket of the org, viewer+)
| type | payload |
|---|---|
| `hello` | `{ user }` |
| `device.updated` | `{ device: Device }`: any change (presence, lifecycle, rename, permissions) |
| `device.telemetry` | `{ deviceId, telemetry: Telemetry, lastSeenAt }` |
| `enrollment.updated` | `{ enrollment: Enrollment }` |
| `screen.session.updated` | `{ session: ScreenSession }` |
| `message.created` | `{ message: SupportMessage }` |
| `audit.created` | `{ log: AuditLog }` |

### 6.2 Server → admin (only to the requesting admin's sockets, for a session)
| type | payload |
|---|---|
| `rtc.answer` | `{ sessionId, sdp }` |
| `rtc.ice` | `{ sessionId, candidate: { candidate, sdpMid, sdpMLineIndex } }` |
| `screen.meta` | `{ sessionId, orientation, width, height }`: device rotated |

### 6.3 Admin → server
| type | payload |
|---|---|
| `rtc.offer` | `{ sessionId, sdp }` (session must be `connecting` or `active`; sender must be the requester) |
| `rtc.ice` | `{ sessionId, candidate }` |
| `screen.connected` | `{ sessionId }`: admin's `RTCPeerConnection` reached `connected`; server marks `active` |
| `screen.stats` | `{ sessionId, bitrateKbps, fps, width, height }`: optional, rebroadcast as part of nothing; logged only |

### 6.4 Server → device
| type | payload |
|---|---|
| `hello` | `{ device: Device, organization }` |
| `screen.request` | `{ sessionId, requestedBy: { name, email }, purpose, expiresAt, iceServers }` |
| `screen.cancel` | `{ sessionId, reason }`: stop capture immediately |
| `rtc.offer` | `{ sessionId, sdp }` |
| `rtc.ice` | `{ sessionId, candidate }` |
| `checkin.request` | `{}`: send telemetry + permissions now |
| `message` | `{ message: SupportMessage }` |
| `device.suspended` | `{ reason }`: server closes 4003 after sending |
| `device.revoked` | `{ reason }`: wipe local credentials, then server closes 4003 |

### 6.5 Device → server
| type | payload |
|---|---|
| `telemetry` | `Telemetry` |
| `permissions` | `{ permissions: [{ key, status }] }` |
| `screen.consent` | `{ sessionId, decision: "approved" \| "rejected" \| "os_denied" }`: send `approved` only **after** the OS MediaProjection/ReplayKit dialog succeeded and capture has started |
| `screen.stopped` | `{ sessionId, reason: "user_stopped" \| "os_stopped" \| "error" }`: valid in any live state, including `awaiting_consent` (e.g. capture failed to start after OS approval) |
| `screen.meta` | `{ sessionId, orientation, width, height }` |
| `rtc.answer` | `{ sessionId, sdp }` |
| `rtc.ice` | `{ sessionId, candidate }` |

---

## 7. Screen-sharing sequence

```
Admin UI                API/WS server                      Device app                    OS
   | POST /devices/:id/screen-sessions                         |                          |
   |---------------------->| verify role, org, device online,  |                          |
   |                       | lifecycle=authenticated, consent   |                          |
   |                       | permission != denied               |                          |
   |<-- 201 session (awaiting_consent, expires in 60 s)         |                          |
   |                       |-- screen.request ---------------->| heads-up notification +  |
   |                       |                                   | consent screen (who, why)|
   |                       |                                   |-- user taps Approve ---->|
   |                       |                                   |   MediaProjection dialog |
   |                       |                                   |<-- user taps Start now --|
   |                       |                                   | start FG service+capture |
   |                       |<-- screen.consent approved -------|                          |
   |<-- screen.session.updated (connecting)                    |                          |
   |-- rtc.offer (recvonly video) -->|-- rtc.offer ----------->| answer with screen track |
   |<-- rtc.answer ---------|<-- rtc.answer --------------------|                          |
   |<====== ICE both ways (relayed) ===========================>|                          |
   |== DTLS-SRTP media, peer-to-peer or via TURN =============== |                          |
   |-- screen.connected --->| status=active, startedAt          |                          |
   |  ... live ...          |                                   | persistent notification  |
   | Stop (POST /end) ----->|-- screen.cancel ----------------->| stop capture             |
   |                       |              OR                   |<-- user taps Stop -------|
   |                       |<-- screen.stopped user_stopped ---|                          |
   |<-- screen.session.updated (ended, endReason)              |                          |
```

Rules enforced by the server:
- At most one non-terminal session per device.
- `awaiting_consent` expires after 60 s → `expired` (`consent_timeout`), `screen.cancel` sent.
- Max session length `SCREEN_SESSION_MAX_MINUTES` (default 30) → `ended` (`max_duration`).
- Device socket closes during a session → 30 s grace for reconnect, else `ended` (`device_disconnected`).
- All requester admin sockets close → 30 s grace, else `ended` (`admin_disconnected`).
- Reconnect: the admin sends a fresh `rtc.offer` for the same `sessionId`; the device tears down its
  old `PeerConnection` and answers using the **same** running capture (no second OS prompt).
- Suspending or revoking a device ends its session (`device_revoked`).
- Every transition is written to the audit log.

---

# Phase 2 additions (v2): remote control, company-owned devices, commands, policy

Everything above still applies. New fields are additive; old clients ignore them.

## 8. Ownership and management mode

- `Enrollment.ownership`: `"company"` | `"personal"` (create body field, default `"personal"`).
- `Device.ownership`: copied from the enrollment.
- `Device.managementMode`: `"device_owner"` | `"device_admin"` | `"none"`. Reported by the agent, never assumed:
  `device_owner` when `DevicePolicyManager.isDeviceOwnerApp()`, `device_admin` when only `isAdminActive()`, else `none`.
- `Device.compliance`: `Compliance | null` (see §11).
- `Device.capabilities`: `string[]` reported by the agent: the remote actions it can actually perform right now
  (subset of `lock`, `reboot`, `wipe`, `remote_control`, `apply_policy`).

### Company-owned (fully managed) Android provisioning
`POST /api/enrollments` with `ownership: "company"` additionally returns:
```
androidProvisioning: { qrPayload: string, instructions: string } | null,
androidProvisioningUnavailableReason: string | null
```
`qrPayload` is the JSON string to encode in the QR code that is scanned on a **factory-reset** phone
(tap the welcome screen 6 times). It is null unless the server has `APP_DOWNLOAD_URL` and
`APP_SIGNATURE_CHECKSUM` configured. Shape:
```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.mdmplatform.agent/.permissions.MdmDeviceAdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "<APP_DOWNLOAD_URL>",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "<APP_SIGNATURE_CHECKSUM>",
  "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": { "mdm_token": "<token>", "mdm_api": "<PUBLIC_API_URL>" }
}
```
The agent reads `mdm_token`/`mdm_api` from the admin extras after provisioning and runs the normal enrollment
(`inspect` → permissions → `complete`). The user still sees the organisation, the permissions and why.

`POST /api/device/enroll/complete` `device` object gains optional `managementMode` and `ownership` is
taken from the enrollment (the device cannot upgrade itself to company-owned).

## 9. Remote control (Android)

Remote control is part of a screen session and needs **three** independent yeses:
1. The admin asks for it: `POST /api/devices/:id/screen-sessions` body gains `control: boolean` (default false).
   Requires the device to report the `accessibility` permission as `granted`, else 409 `permission_required`.
2. The user approves it on the consent screen (they may approve view-only).
3. The OS-level AccessibilityService is enabled on the device (`accessibility` permission = `granted`).

`ScreenSession` gains: `controlRequested: boolean`, `controlGranted: boolean`, `inputCount: number`.

`screen.request` (server → device) gains `control: boolean`.
`screen.consent` (device → server) gains `controlGranted: boolean` (only meaningful with `approved`;
ignored/forced false if control was not requested).

New messages:

| Direction | type | payload |
|---|---|---|
| admin → server | `control.input` | `{ sessionId, input: ControlInput }` |
| server → device | `control.input` | `{ sessionId, input: ControlInput }` |
| device → server | `control.revoked` | `{ sessionId }`: user turned control off (session continues view-only) |
| server → device | `control.revoked` | `{ sessionId }`: admin no longer controlling (e.g. session ending) |

```ts
ControlInput =
  | { kind: "tap", x: number, y: number }                  // x,y normalised 0..1 of the streamed frame
  | { kind: "long_press", x: number, y: number }
  | { kind: "swipe", x1: number, y1: number, x2: number, y2: number, durationMs: number } // 50..3000
  | { kind: "global", action: "back" | "home" | "recents" | "notifications" | "quick_settings" }
  | { kind: "text", text: string }                         // ≤ 500 chars, typed into the focused field
```
`inputCount` is broadcast via `screen.session.updated` every 10 inputs and at the end. The server relays `control.input` only when: the sender is the requesting admin, the session is `active`,
and `controlGranted` is true. It counts inputs (`inputCount`) and audits `screen.control_granted`,
`screen.control_revoked`, and the total count when the session ends. Inputs are not logged individually
(they can contain typed text). The device must also re-check that the session is its current one and
control is still on before performing any input, and show a persistent "Remote control active" indicator.

## 10. Remote commands (lock, reboot, wipe, policy)

Commands are **queued**: a lost phone is often offline, so commands wait and are delivered when it reconnects.

`DeviceCommand { id, deviceId, action, status, requestedBy: {id,name}, reason, createdAt, sentAt, completedAt, error }`
- `action`: `lock` | `reboot` | `wipe` | `apply_policy`
- `status`: `pending` (queued, device offline) → `sent` → `succeeded` | `failed` | `unsupported`; or `cancelled` | `expired` (7 days)

| Method & path | Role | Body → Response |
|---|---|---|
| `GET /api/devices/:id/commands` | viewer+ | → `{ commands: DeviceCommand[] }` |
| `POST /api/devices/:id/commands` | see below | `{ action, reason, confirm?, password? }` → `201 { command }` |
| `POST /api/commands/:id/cancel` | admin+ | → `{ command }` (only while `pending`/`sent`) |

Role & step-up rules: `lock` operator+; `reboot` admin+; `wipe` admin+ **and** `confirm` must equal the device
name **and** `password` must be the admin's current password (step-up re-authentication; 401 `reauth_failed`).
`wipe` requires `ownership = company`. The server rejects actions not in the device's last reported
`capabilities` with 409 `not_supported` (except while offline, where it queues and the device may answer `unsupported`).

WS:
| Direction | type | payload |
|---|---|---|
| server → device | `command` | `{ commandId, action, params: object }` (`apply_policy` params = `Policy`) |
| device → server | `command.result` | `{ commandId, status: "succeeded" \| "failed" \| "unsupported", error?: string }` |
| server → admin | `command.updated` | `{ command: DeviceCommand }` |

On every device connect the server sends all `pending` commands for that device (oldest first) and marks them `sent`.
A `sent` command with no result for 10 minutes returns to `pending` (redelivered on next connect).
Wipe is never auto-retried after the device reports `succeeded`. Revoking a device cancels its pending commands.

## 11. Security policy and compliance

One policy per organisation (Phase 2 scope).

```ts
Policy {
  version: number,                       // increments on every change
  passcode: "none" | "low" | "medium" | "high",   // maps to DevicePolicyManager password complexity
  maxScreenLockTimeoutSec: number | null,          // null = not enforced
  disableCamera: boolean,
  disallowUsbDebugging: boolean,
  disallowFactoryResetByUser: boolean,             // company devices only
  minAndroidPatchAgeDays: number | null,           // compliance check only (not enforced)
  updatedAt: string, updatedBy: { id, name } | null
}

Compliance {
  policyVersion: number | null,          // policy version the device last applied
  enforced: boolean,                     // true only when device_owner applied it
  passcodeSufficient: boolean | null,
  encrypted: boolean | null,
  securityPatch: string | null,          // Build.VERSION.SECURITY_PATCH, e.g. "2026-10-05"
  issues: string[],                      // human readable, e.g. "Screen lock is weaker than required"
  checkedAt: string
}
```
| Method & path | Role | Body → Response |
|---|---|---|
| `GET /api/policy` | viewer+ | → `{ policy }` |
| `PUT /api/policy` | admin+ | Policy fields (no version) → `{ policy, queuedToDevices }`; queues `apply_policy` to every company device |

Device → server WS: `compliance` `Compliance` (on connect, after applying a policy, and every 6 h).
Device → server WS: `device.state` `{ managementMode, capabilities: string[] }` (on connect and on change).
Server → device `hello` gains `policy: Policy`. Server → **personal** device `policy.updated` `{ policy }` when the policy changes
(company devices get an `apply_policy` command instead). Personal devices apply nothing; they report compliance only.

`displayStatus` gains `non_compliant` (online, lifecycle authenticated, required permissions OK, `compliance.issues` non-empty);
precedence: revoked > suspended > permission_required > non_compliant > connected.
Overview `counts` gains `nonCompliant` and `pendingCommands`.
