# Platform Limitations (read this before promising features to a client)

## Android
| Capability | Reality |
|---|---|
| Screen sharing | MediaProjection. **The OS asks the user every session** ("Start recording or casting?"). There's no way around this for a normal app, and that's intentional. On Android 14+ each consent token works for one capture only. A persistent notification shows while capturing. |
| Remote touch / control | Implemented via an AccessibilityService. The user must switch it on in Settings once (Android 13+ sideloaded apps first need App info › ⋮ › "Allow restricted settings"), then allow control per session. Device owner **cannot** turn it on silently. Secure screens (banking apps, lock-screen PIN) block capture and some gestures by design. Not Play-Store friendly; distribute privately. |
| Device owner / full MDM policy | Implemented via Android Enterprise QR provisioning, which requires a **factory reset**. Phones already in use stay "device admin" (lock only). The APK signing key must never change: the QR embeds its checksum, and a new key breaks upgrades and provisioning. Back up the production keystore. |
| Installed applications | Android 11+ restricts package visibility. Listing all apps needs `QUERY_ALL_PACKAGES` (Play policy restricted) or device owner. Phase 2. |
| Background reliability | Battery optimisation exemption is requested, but OEM battery managers (Samsung, Xiaomi, Huawei, OnePlus) may still stop the agent. Users may need to whitelist it manually. Long term, add FCM push for wake-ups. |
| Wi-Fi SSID | Android hides it unless location permission is granted and location services are on. Otherwise it's reported as unavailable. |
| IP address | The device's local interface address. The public IP is what the server sees and is in the audit log. |
| Distribution | Phase 1 ships as a sideloaded APK from GitHub Releases. For the Play Store, prepare the Data Safety form and justify foreground service types (`mediaProjection`, `dataSync`) and the battery exemption. |

## iOS (Phase 2, not built yet)
| Capability | Reality |
|---|---|
| Screen sharing | ReplayKit **Broadcast Upload Extension**. The user starts the broadcast from the system picker. Apps can't start it silently. The extension has a ~50 MB memory cap, so frames must be encoded efficiently (WebRTC in the extension is feasible but tight). |
| Remote control | **Not possible** on iOS for third-party apps. |
| Device management | Real iOS MDM uses Apple's MDM protocol: an enrollment profile, an APNs MDM push certificate (Apple Business Manager / Apple Developer Enterprise), and ideally supervised devices. That's a separate server component, not an app feature. |
| Telemetry | Battery level/state, model and OS are available. Storage is approximate. IP is available. No usage access. Location only with permission. |
| Background | No persistent background socket. Wake-ups need APNs push. |
| Build requirements | Xcode on a Mac, a paid Apple Developer account, App Groups and broadcast extension entitlements. |

## WebRTC
- STUN-only works on most home and office Wi-Fi. **Mobile carrier networks and symmetric NATs need a TURN server.** Without one, some sessions will fail at "Connecting". Run coturn and set `TURN_URLS` + `TURN_SHARED_SECRET`.
- Browsers: current Chrome, Edge, Firefox and Safari can all view streams.

## Web dashboard
- Requires a modern evergreen browser. The live screen only appears while a consented session is active. There's no screenshot fallback.
