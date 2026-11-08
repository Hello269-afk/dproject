// The organisation-facing description of every capability the agent may request.
// This is what the device user sees before granting anything, so it must be honest about
// what each permission lets the organisation do and how the OS gates it.

export const PERMISSION_KEYS = [
  'screen_capture', 'camera', 'microphone', 'location', 'notifications',
  'accessibility', 'device_admin', 'files', 'usage_access', 'background',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_STATUSES = [
  'not_requested', 'awaiting_approval', 'granted', 'denied', 'restricted_by_os', 'revoked', 'not_supported',
] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

type PlatformSupport = { supported: boolean; mechanism: string; userApproval: boolean; notes: string };
export type PermissionDefinition = {
  key: PermissionKey;
  name: string;
  description: string;
  why: string;
  android: PlatformSupport;
  ios: PlatformSupport;
  manageInstructions: { android: string; ios: string };
};

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  {
    key: 'screen_capture',
    name: 'Screen sharing',
    description: 'Lets an authorised support agent ask to view your screen live.',
    why: 'So IT support can see exactly what you see when helping you fix a problem.',
    android: {
      supported: true, mechanism: 'MediaProjection', userApproval: true,
      notes: 'Android shows its own "Start recording or casting?" dialog for every session. Nothing is captured until you approve both the request in the app and the system dialog. A notification stays visible while sharing.',
    },
    ios: {
      supported: true, mechanism: 'ReplayKit Broadcast Upload Extension', userApproval: true,
      notes: 'You start the broadcast yourself from the system picker. iOS shows a red status indicator while broadcasting. (iOS companion app ships in Phase 2.)',
    },
    manageInstructions: {
      android: 'In the agent app open Permissions and switch off "Allow screen-sharing requests", or tap Stop sharing in the notification at any time.',
      ios: 'Tap the red status bar indicator and choose Stop Broadcast.',
    },
  },
  {
    key: 'camera',
    name: 'Camera',
    description: 'Access to the device camera, only during a support session you approve.',
    why: 'Lets support see a physical issue (for example a damaged port or a label) with your consent.',
    android: { supported: true, mechanism: 'CAMERA runtime permission', userApproval: true, notes: 'Android shows a green indicator whenever the camera is in use.' },
    ios: { supported: true, mechanism: 'NSCameraUsageDescription / AVCaptureDevice', userApproval: true, notes: 'iOS shows a green indicator whenever the camera is in use.' },
    manageInstructions: { android: 'Settings › Apps › MDM Agent › Permissions › Camera.', ios: 'Settings › Privacy & Security › Camera.' },
  },
  {
    key: 'microphone',
    name: 'Microphone',
    description: 'Access to the microphone, only during a support session you approve.',
    why: 'Enables voice during remote assistance.',
    android: { supported: true, mechanism: 'RECORD_AUDIO runtime permission', userApproval: true, notes: 'Android shows an indicator whenever the microphone is in use.' },
    ios: { supported: true, mechanism: 'NSMicrophoneUsageDescription', userApproval: true, notes: 'iOS shows an orange indicator whenever the microphone is in use.' },
    manageInstructions: { android: 'Settings › Apps › MDM Agent › Permissions › Microphone.', ios: 'Settings › Privacy & Security › Microphone.' },
  },
  {
    key: 'location',
    name: 'Location',
    description: 'The device\'s last known location, reported while the agent is running.',
    why: 'Helps locate a lost or stolen company device.',
    android: { supported: true, mechanism: 'ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION', userApproval: true, notes: 'Foreground location only. Background location is not requested. Also required by Android to read the Wi-Fi network name.' },
    ios: { supported: true, mechanism: 'Core Location (When In Use)', userApproval: true, notes: 'When-in-use only.' },
    manageInstructions: { android: 'Settings › Location › App location permissions › MDM Agent.', ios: 'Settings › Privacy & Security › Location Services.' },
  },
  {
    key: 'notifications',
    name: 'Notifications',
    description: 'Lets the agent alert you to support requests and messages.',
    why: 'Screen-share requests and support messages must reach you even when the app is closed.',
    android: { supported: true, mechanism: 'POST_NOTIFICATIONS (Android 13+)', userApproval: true, notes: 'On Android 12 and below notifications are on by default but can be switched off.' },
    ios: { supported: true, mechanism: 'UNUserNotificationCenter', userApproval: true, notes: '' },
    manageInstructions: { android: 'Settings › Apps › MDM Agent › Notifications.', ios: 'Settings › Notifications › MDM Agent.' },
  },
  {
    key: 'accessibility',
    name: 'Remote control (accessibility service)',
    description: 'Lets a support agent tap, swipe and type on your device during a screen-sharing session you approve.',
    why: 'Hands-on troubleshooting without needing the phone in the office.',
    android: { supported: true, mechanism: 'AccessibilityService', userApproval: true, notes: 'You switch it on yourself in Settings › Accessibility. Even then, control only happens during a session where you tap "Allow control", with a visible "Remote control active" notice and a Stop button. Some phones require "Allow restricted settings" in App info first.' },
    ios: { supported: false, mechanism: 'Not available', userApproval: false, notes: 'iOS does not allow third-party apps to control the device.' },
    manageInstructions: { android: 'Settings › Accessibility › Installed apps.', ios: 'Not applicable.' },
  },
  {
    key: 'device_admin',
    name: 'Device administrator',
    description: 'Lets the organisation lock the device remotely and, on company-owned devices, enforce the screen-lock policy and erase it if lost.',
    why: 'Protects company data if the device is lost or stolen.',
    android: { supported: true, mechanism: 'DevicePolicyManager (device admin)', userApproval: true, notes: 'Full device-owner control needs Android Enterprise provisioning at setup (factory reset + QR). Legacy device admin is limited and deprecated for most policies.' },
    ios: { supported: false, mechanism: 'MDM profile (Apple Business Manager)', userApproval: true, notes: 'iOS management uses an Apple MDM profile and push certificate, not an app permission.' },
    manageInstructions: { android: 'Settings › Security › Device admin apps › MDM Agent.', ios: 'Settings › General › VPN & Device Management.' },
  },
  {
    key: 'files',
    name: 'Photos and files',
    description: 'Read access to photos, videos and shared files.',
    why: 'Lets you send screenshots or logs to support.',
    android: { supported: true, mechanism: 'READ_MEDIA_IMAGES/VIDEO (13+) or READ_EXTERNAL_STORAGE', userApproval: true, notes: 'The agent does not upload files unless you choose to send them.' },
    ios: { supported: true, mechanism: 'PHPicker (per-item, no permission)', userApproval: true, notes: 'You pick each item. No library-wide access.' },
    manageInstructions: { android: 'Settings › Apps › MDM Agent › Permissions › Photos and videos.', ios: 'Settings › Privacy & Security › Photos.' },
  },
  {
    key: 'usage_access',
    name: 'Usage access',
    description: 'Which apps were used and when (no content).',
    why: 'Helps diagnose battery drain and app problems.',
    android: { supported: true, mechanism: 'PACKAGE_USAGE_STATS (Settings toggle)', userApproval: true, notes: 'Granted in system settings, not a dialog.' },
    ios: { supported: false, mechanism: 'Not available', userApproval: false, notes: 'iOS does not expose app usage to third-party apps.' },
    manageInstructions: { android: 'Settings › Apps › Special app access › Usage access › MDM Agent.', ios: 'Not applicable.' },
  },
  {
    key: 'background',
    name: 'Run in background',
    description: 'Exempts the agent from battery optimisation so it stays connected.',
    why: 'Keeps the device online so support requests and check-ins arrive reliably.',
    android: { supported: true, mechanism: 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', userApproval: true, notes: 'Some manufacturers (Samsung, Xiaomi, Huawei) have extra battery managers that may still stop the app.' },
    ios: { supported: false, mechanism: 'Not available', userApproval: false, notes: 'iOS controls background execution. Push notifications are used instead.' },
    manageInstructions: { android: 'Settings › Apps › MDM Agent › Battery › Unrestricted.', ios: 'Not applicable.' },
  },
];

export const catalogFor = (keys: string[]) => PERMISSION_CATALOG.filter((p) => keys.includes(p.key));
