package com.mdmplatform.agent.permissions

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.UserManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.mdmplatform.agent.control.RemoteControlService
import com.mdmplatform.agent.core.AppPrefs
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.core.nowIso
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Live OS-derived state of one permission. */
data class PermState(
    val key: PermissionKey,
    val status: PermissionStatus,
    /** Runtime permission the OS will no longer prompt for: only Settings can grant it now. */
    val blocked: Boolean,
    val updatedAt: String?,
    /** Short human note shown under the status chip (e.g. "Blocked by device policy"). */
    val note: String?,
)

/** What tapping "Grant" / "Manage" does for a key. Every branch is an official OS flow. */
sealed interface PermAction {
    /** Show the OS runtime permission dialog for these permissions. */
    data class Runtime(val permissions: Array<String>) : PermAction
    /** Open a system screen (Settings page, device admin activation, battery exemption dialog). */
    data class OpenIntent(val intent: Intent) : PermAction
    /** In-app opt-in toggle (screen_capture: "my organisation may ask to view my screen"). */
    data object OptIn : PermAction
    /** Accessibility: prominent in-app disclosure first; only after "I agree" the user is sent to Settings. */
    data object AccessibilityDisclosure : PermAction
    /** Nothing the user can do on this device. */
    data object None : PermAction
}

/**
 * Maps every [PermissionKey] to its real Android check and request mechanism.
 *
 * Status rules (all derived from the live OS state, recomputed on every resume):
 *  - granted          the OS reports the permission/access as granted right now
 *  - not_requested    not granted and we have never shown the OS prompt / settings page
 *  - denied           not granted after the user saw the prompt (or opted out of screen requests)
 *  - revoked          was granted earlier, the user later turned it off in Settings
 *  - restricted_by_os blocked by policy rather than the user: camera disabled by a device policy
 *                     (DevicePolicyManager.getCameraDisabled), location sharing disallowed by a user
 *                     restriction (UserManager.DISALLOW_SHARE_LOCATION, used by work profiles and
 *                     parental controls)
 *  - not_supported    hardware absent (no camera/microphone/location)
 * accessibility is `granted` only when the user enabled RemoteControlService in Settings AND the system
 * has it bound right now.
 * A runtime permission the user permanently denied ("Don't ask again") stays `denied` on the wire
 * and is flagged [PermState.blocked] locally so the UI sends the user to Settings instead.
 */
class PermissionManager(private val context: Context, private val prefs: AppPrefs) {

    private val _states = MutableStateFlow<Map<PermissionKey, PermState>>(emptyMap())
    val states: StateFlow<Map<PermissionKey, PermState>> = _states.asStateFlow()

    val adminComponent = ComponentName(context, MdmDeviceAdminReceiver::class.java)

    private val dpm get() = context.getSystemService(DevicePolicyManager::class.java)
    private val pm get() = context.packageManager

    init { refresh() }

    /** Recomputes every key from the OS. Returns true if any status changed. */
    @Synchronized
    fun refresh(): Boolean {
        val now = nowIso()
        var changed = false
        val map = PermissionKey.entries.associateWith { key ->
            val (raw, note) = compute(key)
            val previous = prefs.lastStatus(key)
            val status = applyRevoked(key, raw, previous)
            if (previous != status.wire) {
                prefs.setStatus(key, status.wire, now)
                changed = true
            }
            val blocked = status != PermissionStatus.GRANTED && runtimePermissions(key).isNotEmpty() && prefs.isBlocked(key)
            PermState(key, status, blocked, prefs.statusUpdatedAt(key) ?: now, note)
        }
        _states.value = map
        return changed
    }

    fun status(key: PermissionKey): PermissionStatus = _states.value[key]?.status ?: compute(key).first

    /** `[{key, status}]` for the keys this enrollment requested (all keys if unknown). */
    fun reportable(): List<Pair<PermissionKey, PermissionStatus>> {
        refresh()
        val keys = prefs.requestedPermissions.ifEmpty { PermissionKey.entries }
        return keys.map { it to status(it) }
    }

    private fun applyRevoked(key: PermissionKey, raw: PermissionStatus, previous: String?): PermissionStatus {
        if (key == PermissionKey.SCREEN_CAPTURE) return raw
        val wasGranted = previous == PermissionStatus.GRANTED.wire || previous == PermissionStatus.REVOKED.wire
        return if (wasGranted && (raw == PermissionStatus.DENIED || raw == PermissionStatus.NOT_REQUESTED)) PermissionStatus.REVOKED else raw
    }

    private fun compute(key: PermissionKey): Pair<PermissionStatus, String?> = when (key) {
        PermissionKey.SCREEN_CAPTURE -> when (prefs.screenShareOptIn) {
            null -> PermissionStatus.NOT_REQUESTED to null
            true -> PermissionStatus.GRANTED to "Android asks you every time a session starts"
            false -> PermissionStatus.DENIED to "You opted out of screen-sharing requests"
        }

        PermissionKey.CAMERA -> when {
            !pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) -> PermissionStatus.NOT_SUPPORTED to "No camera on this device"
            dpm.getCameraDisabled(null) -> PermissionStatus.RESTRICTED_BY_OS to "Camera disabled by a device policy"
            else -> runtimeStatus(key) to null
        }

        PermissionKey.MICROPHONE -> if (!pm.hasSystemFeature(PackageManager.FEATURE_MICROPHONE))
            PermissionStatus.NOT_SUPPORTED to "No microphone on this device"
        else runtimeStatus(key) to null

        PermissionKey.LOCATION -> {
            val um = context.getSystemService(UserManager::class.java)
            when {
                !pm.hasSystemFeature(PackageManager.FEATURE_LOCATION) -> PermissionStatus.NOT_SUPPORTED to "No location hardware"
                um.hasUserRestriction(UserManager.DISALLOW_SHARE_LOCATION) -> PermissionStatus.RESTRICTED_BY_OS to "Location sharing is restricted on this device"
                else -> {
                    val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
                    val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
                    when {
                        fine -> PermissionStatus.GRANTED to "Precise, while the app is in use"
                        coarse -> PermissionStatus.GRANTED to "Approximate only"
                        prefs.wasRequested(key) -> PermissionStatus.DENIED to null
                        else -> PermissionStatus.NOT_REQUESTED to null
                    }
                }
            }
        }

        PermissionKey.NOTIFICATIONS -> {
            val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
            when {
                enabled -> PermissionStatus.GRANTED to null
                prefs.wasRequested(key) || Build.VERSION.SDK_INT < 33 -> PermissionStatus.DENIED to "Turned off in system settings"
                else -> PermissionStatus.NOT_REQUESTED to null
            }
        }

        PermissionKey.ACCESSIBILITY -> {
            val enabled = RemoteControlService.isEnabledInSettings(context)
            when {
                enabled && RemoteControlService.isBound -> PermissionStatus.GRANTED to "On. Control still needs your approval in every session"
                enabled -> PermissionStatus.DENIED to "Switched on but not running. Turn it off and on again in Settings"
                prefs.wasRequested(key) -> PermissionStatus.DENIED to null
                else -> PermissionStatus.NOT_REQUESTED to null
            }
        }

        PermissionKey.DEVICE_ADMIN -> when {
            dpm.isDeviceOwnerApp(context.packageName) -> PermissionStatus.GRANTED to "Fully managed by your organisation (device owner)"
            dpm.isAdminActive(adminComponent) -> PermissionStatus.GRANTED to "Active. Lets your organisation lock this device"
            prefs.wasRequested(key) -> PermissionStatus.DENIED to null
            else -> PermissionStatus.NOT_REQUESTED to null
        }

        PermissionKey.FILES -> runtimeStatus(key) to null

        PermissionKey.USAGE_ACCESS -> when {
            hasUsageAccess() -> PermissionStatus.GRANTED to null
            prefs.wasRequested(key) -> PermissionStatus.DENIED to null
            else -> PermissionStatus.NOT_REQUESTED to null
        }

        PermissionKey.BACKGROUND -> {
            val power = context.getSystemService(PowerManager::class.java)
            when {
                power.isIgnoringBatteryOptimizations(context.packageName) -> PermissionStatus.GRANTED to "Not restricted by battery optimisation"
                prefs.wasRequested(key) -> PermissionStatus.DENIED to "Battery optimisation may pause the connection"
                else -> PermissionStatus.NOT_REQUESTED to null
            }
        }
    }

    private fun runtimeStatus(key: PermissionKey): PermissionStatus {
        val perms = runtimePermissions(key)
        return when {
            perms.isNotEmpty() && perms.all(::granted) -> PermissionStatus.GRANTED
            prefs.wasRequested(key) -> PermissionStatus.DENIED
            else -> PermissionStatus.NOT_REQUESTED
        }
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    private fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        }
        return if (mode == AppOpsManager.MODE_DEFAULT) {
            context.checkCallingOrSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
        } else mode == AppOpsManager.MODE_ALLOWED
    }

    /** Android runtime permissions behind a key on this API level (empty if not a runtime permission). */
    fun runtimePermissions(key: PermissionKey): Array<String> = when (key) {
        PermissionKey.CAMERA -> arrayOf(Manifest.permission.CAMERA)
        PermissionKey.MICROPHONE -> arrayOf(Manifest.permission.RECORD_AUDIO)
        PermissionKey.LOCATION -> arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        PermissionKey.NOTIFICATIONS -> if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
        PermissionKey.FILES -> if (Build.VERSION.SDK_INT >= 33)
            arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        else -> emptyArray()
    }

    /** Action for the Grant button (status not granted). */
    fun grantAction(key: PermissionKey): PermAction {
        val st = _states.value[key]
        if (st?.status == PermissionStatus.NOT_SUPPORTED || st?.status == PermissionStatus.RESTRICTED_BY_OS) return PermAction.None
        return when (key) {
            PermissionKey.SCREEN_CAPTURE -> PermAction.OptIn
            PermissionKey.ACCESSIBILITY -> PermAction.AccessibilityDisclosure
            PermissionKey.DEVICE_ADMIN -> PermAction.OpenIntent(
                Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
                    .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, adminComponent)
                    .putExtra(
                        DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                        "Marks this device as managed by your organisation and lets it lock the screen remotely " +
                            "(for example if the phone is lost). Android lists every power this app declares. " +
                            "On a personal device this app never erases data or changes your screen-lock or camera settings."
                    )
            )
            PermissionKey.USAGE_ACCESS -> PermAction.OpenIntent(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
            PermissionKey.BACKGROUND -> PermAction.OpenIntent(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
            )
            PermissionKey.NOTIFICATIONS ->
                if (Build.VERSION.SDK_INT >= 33 && st?.blocked != true && !prefs.wasRequested(key))
                    PermAction.Runtime(runtimePermissions(key))
                else PermAction.OpenIntent(notificationSettings())
            else -> if (st?.blocked == true) PermAction.OpenIntent(appDetails()) else PermAction.Runtime(runtimePermissions(key))
        }
    }

    /** Action for the Manage button (already granted, or user wants to change it): the matching system screen. */
    fun manageIntent(key: PermissionKey): Intent? = when (key) {
        PermissionKey.SCREEN_CAPTURE -> null
        PermissionKey.ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        PermissionKey.NOTIFICATIONS -> notificationSettings()
        PermissionKey.USAGE_ACCESS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        PermissionKey.BACKGROUND -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        PermissionKey.DEVICE_ADMIN -> Intent(Settings.ACTION_SECURITY_SETTINGS)
        else -> appDetails()
    }

    private fun appDetails() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

    private fun notificationSettings() = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    /** Call before launching the OS prompt / settings page for [key]. */
    fun markRequested(key: PermissionKey) = prefs.markRequested(key)

    /**
     * Call with the result of a runtime request. A permission that is still denied and for which
     * the OS will not show a rationale anymore is treated as permanently denied ("blocked").
     */
    fun onRuntimeResult(activity: Activity, key: PermissionKey, result: Map<String, Boolean>) {
        prefs.markRequested(key)
        val perms = runtimePermissions(key)
        val anyGranted = result.values.any { it } || perms.any(::granted)
        val blocked = !anyGranted && perms.none { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
        prefs.setBlocked(key, blocked)
        refresh()
    }

    fun setScreenShareOptIn(allow: Boolean) {
        prefs.screenShareOptIn = allow
        refresh()
    }

    /** Deactivate our own device admin (used on unenroll). */
    fun deactivateDeviceAdmin() {
        try {
            if (dpm.isAdminActive(adminComponent) && !dpm.isDeviceOwnerApp(context.packageName)) dpm.removeActiveAdmin(adminComponent)
        } catch (_: SecurityException) {}
    }
}
