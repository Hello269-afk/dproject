# MDM Agent (Android)

Native Android device agent for the MDM platform. Kotlin, Jetpack Compose (Material 3), OkHttp
WebSocket, WebRTC screen sharing. Contract: [`docs/PROTOCOL.md`](../../docs/PROTOCOL.md).

- applicationId / namespace: `com.mdmplatform.agent`
- App label: `@string/app_name` ("MDM Agent") in `app/src/main/res/values/strings.xml`. Rebrand there.
- minSdk 26, target/compile 34, AGP 8.2, Kotlin 1.9.22, Compose compiler 1.5.10, Java 17, Gradle 8.7.

## Build

```bash
cd apps/android
echo "sdk.dir=/path/to/android-sdk" > local.properties   # gitignored
JAVA_HOME=/path/to/jdk-17 ./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

The SDK needs `platforms;android-34` and `build-tools;34.0.0`. CI (`.github/workflows/android.yml`
at the repo root) builds on every push to `main` touching `apps/android/**`, uploads the APK as an
artifact and publishes it to the `latest` GitHub release:
`https://github.com/<owner>/<repo>/releases/download/latest/mdm-agent.apk`. Point the web
enrollment page's APK download (`appDownloadUrl`) and the server's `APP_DOWNLOAD_URL` at that URL.
With the signing secrets set (see [Signing](#signing-and-the-signature-checksum)) it is a signed
release build; without them it is a debug build (also published as `mdm-agent-debug.apk` for old links).
`versionCode` comes from `-Pmdm.versionCode` (CI passes the run number) so installs upgrade in place.

### Dev servers and cleartext

- **debug** builds allow `http://` / `ws://` to any host (`src/debug/res/xml/network_security_config.xml`),
  so a dev API on `http://10.0.2.2:4000` (emulator) or `http://192.168.x.x:4000` (LAN) works.
  Private LAN ranges can't be expressed as domain rules, hence the debug-only global allowance.
- **release** builds are HTTPS/WSS only (`src/main/res/xml/network_security_config.xml`), and the
  manual server field rejects `http://` (`BuildConfig.ALLOW_CLEARTEXT = false`).

## Enrollment entry points

| Entry | Format | API base URL comes from |
|---|---|---|
| Custom scheme | `mdm://enroll?token=<token>&api=<urlencoded API URL>` | `api` query param |
| App Link | `https://<appLinkHost>/enroll/<token>` (optionally `?api=...`) | `api` param, else the link origin |
| QR code | Either of the above (normally `enrollmentUrl`) | same as the link |
| Manual | Server URL + pairing code `XXXX-XXXX` | what the user types |

The resolved base URL is persisted after a successful `inspect`. QR scanning uses the Google code
scanner (`play-services-code-scanner`): it runs inside Play services and the app never gets the
CAMERA permission for it. Devices without Play services use the pairing code.

### Configuring the App Link host

The `https` intent filter host is a manifest placeholder fed by the Gradle property
`mdm.appLinkHost` (default `mdm.example.com` in `gradle.properties`, also exposed as
`BuildConfig.APP_LINK_HOST`):

```bash
./gradlew assembleRelease -Pmdm.appLinkHost=enroll.yourcompany.com
```

In CI set the repository variable `MDM_APP_LINK_HOST`. For the link to open the app without a
chooser, serve `https://<host>/.well-known/assetlinks.json` from the web app with the signing
certificate SHA-256 of the APK (`keytool -printcert -jarfile app-debug.apk`):

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.mdmplatform.agent",
               "sha256_cert_fingerprints": ["AB:CD:..."] } }]
```

Note: the QR/`enrollmentUrl` points at the **web** origin. If the API lives on a different origin
(typical in dev: web `:5173`, API `:4000`), either add `?api=<API URL>` to the link, proxy `/api`
from the web origin, or use the `mdm://` app link / manual entry.

## Architecture

```
MdmApp / AppContainer      manual DI, process-wide state (AgentState StateFlows)
core/                      models, Keystore-encrypted credentials, prefs, notifications
net/ApiClient              REST + device token (refresh 2 min before expiry, retry once on 401,
                           403 device_revoked -> wipe, device_suspended -> suspended state)
agent/AgentService         FG service, type dataSync: owns the WebSocket, watches battery/network/
                           orientation for telemetry
agent/AgentConnection      ticket -> /ws, exponential backoff (1 s .. 60 s + jitter), fresh ticket each
                           time, app ping every 25 s, close 4003 / 4008 handling
agent/BootReceiver         restarts the agent after reboot / app update (only if enrolled)
telemetry/                 Telemetry from real OS sources; unavailable fields are null
permissions/               PermissionManager (one place for every key), DeviceAdminReceiver
                           (also provisioning-complete: saves mdm_token / mdm_api)
control/                   RemoteControlService (AccessibilityService: gestures, global actions,
                           text, "Remote control active" overlay), ControlInput parsing
management/                DeviceManager (management mode, capabilities, device.state, policy
                           enforcement, compliance), CommandExecutor (lock/reboot/wipe/apply_policy)
screen/                    ScreenShareController (consent + WebRTC answerer), ProjectionCapturer,
                           ScreenCaptureService (FG service, type mediaProjection)
ui/                        Compose screens: Authentication flow, Home, Permissions, Assist, Security,
                           ConsentActivity, AccessibilityDisclosureActivity, provisioning activities
                           (GET_PROVISIONING_MODE, ADMIN_POLICY_COMPLIANCE)
```

### Screen sharing sequence (device side)

1. `screen.request` -> high-importance heads-up notification (full-screen intent where allowed) and
   the in-app consent screen (admin name/email, purpose, countdown, Approve/Reject).
2. Reject -> `screen.consent rejected`.
3. Approve -> `MediaProjectionManager.createScreenCaptureIntent()`. Cancelled -> `os_denied`.
4. OK -> `ScreenCaptureService` calls `startForeground(type=mediaProjection)` -> `ProjectionCapturer`
   calls `getMediaProjection()` and creates the VirtualDisplay -> capture runs -> **then**
   `screen.consent approved` and `screen.meta`.
5. `rtc.offer` -> new `PeerConnection` (old one disposed) with the session's `iceServers` -> add the
   screen track -> answer -> trickle `rtc.ice`. A re-offer reuses the running capture (no new prompt).
6. Persistent "Sharing your screen" notification with **Stop sharing**, plus the red in-app banner.
   Stop (either), `MediaProjection.Callback.onStop` -> capture stops and `screen.stopped` is sent
   (`user_stopped` / `os_stopped`). `screen.cancel` stops immediately.
7. Rotation -> `VirtualDisplay.resize()` + `screen.meta`. 15 fps, long edge <= 1280 px, <= 2.5 Mbps.

`ProjectionCapturer` is a port of `org.webrtc.ScreenCapturerAndroid` (used by the prototype). The
stock class re-creates the VirtualDisplay on `changeCaptureFormat`, which Android 14 forbids for a
single MediaProjection, so rotation would crash; the port resizes instead.

## Permissions

Every grant goes through the official Android flow. Nothing is granted at install time; statuses are
re-read from the OS on every resume and on device-admin callbacks, and reported over WS
`permissions` (REST `/api/device/permissions` fallback when the socket is down).

| Key | Android mechanism | Check | Request / manage |
|---|---|---|---|
| `screen_capture` | Per-session MediaProjection consent | In-app opt-in (allow the org to *ask*) | Toggle in app; OS dialog every session |
| `camera` | `CAMERA` runtime | `checkSelfPermission`; `DevicePolicyManager.getCameraDisabled` -> `restricted_by_os`; no camera -> `not_supported` | Runtime dialog / app settings |
| `microphone` | `RECORD_AUDIO` runtime | `checkSelfPermission`; no mic -> `not_supported` | Runtime dialog / app settings |
| `location` | `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` (foreground only) | either granted; `UserManager.DISALLOW_SHARE_LOCATION` -> `restricted_by_os` | Runtime dialog / app settings |
| `notifications` | `POST_NOTIFICATIONS` (33+), else channel settings | `NotificationManagerCompat.areNotificationsEnabled()` | Runtime dialog (33+) / app notification settings |
| `accessibility` | `RemoteControlService` (AccessibilityService), remote control | `granted` only when enabled in `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` **and** currently bound | In-app disclosure ("I agree") -> `Settings.ACTION_ACCESSIBILITY_SETTINGS`; the user switches it on |
| `device_admin` | `DeviceAdminReceiver` (force-lock, wipe-data, limit-password, disable-camera) | `isAdminActive` (or device owner) | `ACTION_ADD_DEVICE_ADMIN`; manage in Security settings |
| `files` | `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO` (33+), `READ_EXTERNAL_STORAGE` (<33) | `checkSelfPermission` | Runtime dialog / app settings |
| `usage_access` | `PACKAGE_USAGE_STATS` app-op | `AppOpsManager` `OPSTR_GET_USAGE_STATS` | `Settings.ACTION_USAGE_ACCESS_SETTINGS` |
| `background` | Battery-optimisation exemption | `PowerManager.isIgnoringBatteryOptimizations` | `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` / `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` |

Status rules:
- `not_requested`: not granted and the prompt/settings page was never shown.
- `denied`: not granted after the user saw it (or opted out of screen requests). A runtime permission
  that Android will no longer prompt for (denied twice / "Don't ask again", detected via
  `shouldShowRequestPermissionRationale` after the result) is still `denied` on the wire; the app
  marks it **Blocked** and Grant opens app settings.
- `revoked`: was `granted` earlier and the user later turned it off.
- `restricted_by_os`: only when policy, not the user, blocks it (camera disabled by device policy,
  location sharing disallowed by a user restriction such as a work profile or parental controls).
- `not_supported`: hardware missing. It never blocks enrollment even if marked required (it cannot be
  granted on this device).
- `accessibility` switched on but not bound (service crashed / not started yet) reports `denied` with a
  note; switching it off after it was on reports `revoked`.
- Skipping the screen-sharing question during enrollment records `screen_capture = denied`.

## Telemetry

Sent on connect, every 60 s, on `checkin.request`, and on significant change (battery >= 1 %,
charging, default-network callbacks, orientation), coalesced to at most one every ~5 s.
Sources: `BatteryManager` sticky intent, `ConnectivityManager`/`NetworkCapabilities`,
`LinkProperties` (first non-loopback IPv4, else IPv6), `TelephonyManager.networkOperatorName`,
`StatFs(/data)`, `ActivityManager.MemoryInfo`, display real metrics. Wi-Fi SSID and the last known
location (`LocationManager.getLastKnownLocation`, no active location requests) only when a location
permission is granted. Anything unavailable is `null`.

## Credentials

`deviceId` / `deviceSecret` live in `EncryptedSharedPreferences` (AES-256-GCM, master key in the
Android Keystore). Backups and device-transfer are disabled for all app data. They are wiped on
`device.revoked`, on any 403 `device_revoked`, and on user unenroll (which also deactivates the
device admin). Rotation (`/api/device/credentials/rotate`) replaces the stored secret.

## Android platform limitations

- **MediaProjection is per-session.** Android shows its own consent dialog every time; an app cannot
  pre-authorise or skip it. On Android 14+ the consent token is single-use and allows exactly one
  VirtualDisplay, the `mediaProjection` foreground service must already be running when
  `getMediaProjection()` is called, and the user can end sharing from the system status-bar chip
  (reported as `os_stopped`).
- **Remote control needs the user, every time.** The AccessibilityService can only be switched on by
  the user in Settings (a device owner cannot enable it silently, and this app never tries), and each
  session needs "Share screen and allow control" on the consent screen.
- **Device owner needs Android Enterprise provisioning** from a factory-reset phone (QR, see below).
  `ACTION_ADD_DEVICE_ADMIN` only gives a legacy device admin; since Android 10 a legacy admin can still
  lock (`force-lock`) and wipe (`wipe-data`) but password/camera policies throw, so they are only
  enforced as device owner.
- **Full-screen intents on Android 14+** are restricted to calling/alarm apps by default. If the user
  or Play has revoked `USE_FULL_SCREEN_INTENT`, the request arrives as a normal heads-up notification.
  If notifications are off entirely, requests only show inside the app.
- **Play Store policy.** Accessibility must meet the AccessibilityService policy (prominent disclosure
  is implemented in `AccessibilityDisclosureActivity`; `isAccessibilityTool=false` is declared honestly); `PACKAGE_USAGE_STATS` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` are restricted
  and need a declared, user-facing justification (enterprise device management is an accepted use
  case for the exemption, but expect review). `QUERY_ALL_PACKAGES` is deliberately not used.
  Sideloaded or managed-Play distribution avoids most of this.
- **OEM background killers** (Xiaomi, Huawei, Samsung, OnePlus, Oppo/Vivo) may stop the agent
  despite the foreground service. Granting `background` (battery exemption) helps; some OEMs also need
  "autostart" enabled manually. See dontkillmyapp.com.
- **Android 15+** limits `dataSync` foreground services to 6 h/day and forbids starting them from
  `BOOT_COMPLETED`. The app targets 34 today; moving to target 35 needs a different service type
  (e.g. `connectedDevice` / `specialUse`) or WorkManager-based reconnects.
- **Wi-Fi SSID** needs a location permission and location services switched on; otherwise null.

## Remote control (PROTOCOL.md §9)

Three independent yeses: the admin asks (`screen.request.control`), the user picks **Share screen and
allow control** on the consent screen (or **Share screen only**), and the user has switched on the
AccessibilityService in system Settings (`accessibility` = `granted`).

Setup on the phone (once):
1. Permissions tab -> Remote control -> **Grant**, or **Set up remote control** on a consent card.
2. Read the disclosure (what it can do, when it is used, what it never does) and tap **I agree, open
   Settings**. Nothing is enabled by the app.
3. Settings > Accessibility > (Installed / Downloaded apps) > **MDM Agent remote control** > On.
4. Back in the app the row shows Granted; the device reports capability `remote_control`.

During a session:
- `screen.consent` carries `controlGranted` (true only if requested, chosen by the user and the
  service is bound when capture starts).
- `control.input` is performed only if it is for the current session, control was granted for it,
  it has not been revoked, and the service is connected. Otherwise it is dropped. Inputs are never
  logged.
- Mapping: normalised `x,y` x the **current real display size** (`getRealMetrics`, which already
  reflects rotation). Tap = 50 ms gesture, long press = 700 ms, swipe = line path with
  `durationMs` (clamped 50..3000). `global` -> `performGlobalAction` (back, home, recents,
  notifications, quick settings). `text` (<= 500 chars) -> focused input node (`FOCUS_INPUT`):
  `ACTION_SET_TEXT` with the existing text + new text (hint text ignored), cursor moved to the end;
  clipboard + `ACTION_PASTE` only if SET_TEXT fails or the field is a password (its text is unreadable).
- Indicators while control is active: an always-on-top red bar "Remote control active by <admin>"
  with **Stop control** (accessibility overlay, no extra permission), a separate notification with
  the same text plus **Stop control** / **Stop sharing**, the sharing notification switches to the
  control text, and the in-app red banner shows **Stop control** and **Stop**.
- **Stop control** keeps view-only sharing and sends `control.revoked`. Server `control.revoked` turns
  control off locally. Switching the service off mid-session also revokes control.

### Samsung and other OEMs: "Restricted setting" (Android 13+)

Android 13+ blocks accessibility for apps installed **outside an app store** (sideloaded APKs, the
GitHub download): the switch is greyed out and tapping it shows "Restricted setting". The user must
allow it once:

1. Settings > Apps > **MDM Agent** (or App info from the disclosure screen's **Open App info**).
2. Tap **⋮** (top right) > **Allow restricted settings**, confirm with the PIN / fingerprint.
3. Go back to Settings > Accessibility and switch **MDM Agent remote control** on.

Notes: the ⋮ entry only appears after the user has tried to enable the service once. Samsung One UI
lists it under Accessibility > **Installed apps**; Xiaomi/MIUI under **Downloaded apps**. Installs
through managed Google Play, or via device-owner provisioning, are not restricted. Some OEM battery
managers unbind accessibility services of killed apps; granting `background` helps.

## Company-owned devices: Android Enterprise QR provisioning (PROTOCOL.md §8)

Prerequisites on the server: `APP_DOWNLOAD_URL` (an https URL of the **release-signed** APK, e.g. the
`latest` release asset `mdm-agent.apk`) and `APP_SIGNATURE_CHECKSUM` (from
`scripts/signature-checksum.sh`). The APK must be signed with the same key as the checksum, and the
API must be reachable over https (release builds refuse cleartext).

1. Dashboard: create an enrollment with ownership **Company**. It shows the provisioning QR
   (`androidProvisioning.qrPayload`).
2. Factory-reset the phone (Settings > System > Reset, or recovery). It must be on the very first
   welcome screen, not set up.
3. **Tap the welcome screen 6 times** in the same spot. The QR setup starts (older Android versions
   first download a QR reader; connect to Wi-Fi when asked).
4. Scan the QR. Android downloads the APK, checks the checksum, installs it and makes it **device owner**.
5. Android 12+: the setup wizard calls `GET_PROVISIONING_MODE` (we answer fully managed) and then
   `ADMIN_POLICY_COMPLIANCE` (a "This phone is company-owned" screen -> **Continue setup**).
   Android 8-11: `onProfileProvisioningComplete` + `PROVISIONING_SUCCESSFUL` open the app.
6. The admin extras `mdm_token` / `mdm_api` are saved (token in the encrypted store). When the app
   opens, it goes straight into the normal enrollment (`inspect` -> organisation review -> permissions
   -> `complete`); the user still sees the organisation and every permission. A "Finish setting up"
   notification points there too.

Fully managed devices cannot be unenrolled from the app (the Security screen explains that IT removes
company-owned devices). If the server revokes one, credentials are wiped but the app stays device owner,
ready for a new enrollment; releasing it means a factory reset. Personal devices keep self-unenroll.

## Commands (PROTOCOL.md §10)

`command` -> `command.result`. Idempotent: results are persisted per `commandId` (last 200, kept across
re-enrollment) and a redelivered command is answered from that record, never executed twice.

| Action | Needs | Implementation |
|---|---|---|
| `lock` | device owner, or device admin with `force-lock` | `lockNow()` |
| `reboot` | device owner | result sent + socket flushed (<= 2 s), then `reboot(admin)` |
| `wipe` | company-owned; device owner, or device admin with `wipe-data` | result `succeeded` sent + flushed (<= 2 s), credentials erased, then `wipeDevice(0)` (device owner, API 34+) or `wipeData(0)` |
| `apply_policy` | device owner on a non-personal device | see below; `unsupported` otherwise |
| anything else | | `unsupported` |

`device.state { managementMode, capabilities }` is sent on connect and whenever it changes (admin
enabled/disabled, provisioning, accessibility bound/unbound, ownership from `hello`).

## Policy and compliance (PROTOCOL.md §11)

Policy arrives in `hello.policy`, `policy.updated` (personal devices) and `apply_policy` (company).
Enforced only when the app is device owner and the server did not mark the device personal:
`setRequiredPasswordComplexity` (API 31+; below: `setPasswordQuality` SOMETHING / NUMERIC_COMPLEX(4) /
ALPHANUMERIC(6)), `setMaximumTimeToLock`, `setCameraDisabled`, user restrictions
`DISALLOW_DEBUGGING_FEATURES` and `DISALLOW_FACTORY_RESET`.

`compliance` is sent after `hello`, after every policy, every 6 h while connected, and on demand
(Home > Compliance > Check now): `passcodeSufficient` (null unless the device admin is active;
`isActivePasswordSufficient()` / `getPasswordComplexity()` vs the requirement), `encrypted`
(`getStorageEncryptionStatus()`), `securityPatch`, `issues` (plain English, including a security patch
older than `minAndroidPatchAgeDays` and anything that could not be enforced), `enforced`, `policyVersion`.

## Signing and the signature checksum

Device-owner provisioning pins the signing certificate, and upgrades need the same key, so all builds
use one stable keystore. `app/build.gradle` reads, environment first, then `keystore.properties`
(gitignored): `MDM_KEYSTORE_PATH`, `MDM_KEYSTORE_PASSWORD`, `MDM_KEY_ALIAS`, `MDM_KEY_PASSWORD`. When
present, **both debug and release** are signed with it; otherwise debug uses the default debug key and
release is unsigned (a warning is printed).

Local dev keystore (already generated here, gitignored, RSA 2048, 30 years):

```bash
$JAVA_HOME/bin/keytool -genkeypair -keystore keystore/mdm-dev.jks -storetype PKCS12 -alias mdm \
  -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=MDM Agent Dev, O=MDM Platform"
# keystore.properties
MDM_KEYSTORE_PATH=keystore/mdm-dev.jks
MDM_KEYSTORE_PASSWORD=...
MDM_KEY_ALIAS=mdm
MDM_KEY_PASSWORD=...
```

Checksum for the server's `APP_SIGNATURE_CHECKSUM` (base64url, no padding, SHA-256 of the certificate):

```bash
scripts/signature-checksum.sh                      # from the keystore
scripts/signature-checksum.sh path/to/mdm-agent.apk # from a signed APK (apksigner)
```

CI: add repository secrets `MDM_KEYSTORE_BASE64` (`base64 -i keystore/release.jks | pbcopy`),
`MDM_KEYSTORE_PASSWORD`, `MDM_KEY_ALIAS`, `MDM_KEY_PASSWORD`. The workflow then builds a signed
`assembleRelease`, prints the checksum in the job summary and publishes `mdm-agent.apk`. Use a
dedicated production keystore for CI (not the dev one), back it up: losing it means existing
devices cannot be upgraded and the provisioning QR must change.
