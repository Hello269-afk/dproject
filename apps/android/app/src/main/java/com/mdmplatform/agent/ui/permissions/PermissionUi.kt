package com.mdmplatform.agent.ui.permissions

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Insights
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.automirrored.outlined.ScreenShare
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.PermissionDefinition
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.permissions.PermAction
import com.mdmplatform.agent.permissions.PermState
import com.mdmplatform.agent.ui.control.AccessibilityDisclosureActivity
import com.mdmplatform.agent.ui.components.PermissionStatusChip
import com.mdmplatform.agent.ui.components.RequiredBadge
import com.mdmplatform.agent.ui.components.relativeTime

fun PermissionKey.icon(): ImageVector = when (this) {
    PermissionKey.SCREEN_CAPTURE -> Icons.AutoMirrored.Outlined.ScreenShare
    PermissionKey.CAMERA -> Icons.Outlined.CameraAlt
    PermissionKey.MICROPHONE -> Icons.Outlined.Mic
    PermissionKey.LOCATION -> Icons.Outlined.LocationOn
    PermissionKey.NOTIFICATIONS -> Icons.Outlined.Notifications
    PermissionKey.ACCESSIBILITY -> Icons.Outlined.TouchApp
    PermissionKey.DEVICE_ADMIN -> Icons.Outlined.AdminPanelSettings
    PermissionKey.FILES -> Icons.Outlined.Folder
    PermissionKey.USAGE_ACCESS -> Icons.Outlined.Insights
    PermissionKey.BACKGROUND -> Icons.Outlined.BatteryChargingFull
}

/** Fallback copy when the server catalog has no definition for a key. */
fun fallbackDefinition(key: PermissionKey): PermissionDefinition {
    val (name, desc) = when (key) {
        PermissionKey.SCREEN_CAPTURE -> "Screen sharing" to "Lets your organisation ask to view your screen. You approve every session."
        PermissionKey.CAMERA -> "Camera" to "Access to the device camera."
        PermissionKey.MICROPHONE -> "Microphone" to "Access to the device microphone."
        PermissionKey.LOCATION -> "Location" to "Approximate or precise location while the app is in use."
        PermissionKey.NOTIFICATIONS -> "Notifications" to "Alerts for support messages and screen-sharing requests."
        PermissionKey.ACCESSIBILITY -> "Remote control (accessibility)" to
            "Lets IT support tap, swipe and type on your screen, only during a screen-sharing session in which you allow control."
        PermissionKey.DEVICE_ADMIN -> "Device admin" to "Marks this device as managed."
        PermissionKey.FILES -> "Photos and videos" to "Read access to media files."
        PermissionKey.USAGE_ACCESS -> "Usage access" to "Which apps are used and for how long."
        PermissionKey.BACKGROUND -> "Run in background" to "Keeps the connection alive when battery optimisation would pause it."
    }
    return PermissionDefinition(key, name, desc, "", true, "", "", "")
}

private fun Context.findActivity(): Activity? {
    var c = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/**
 * Runs the official OS flow for a permission key: runtime dialog, Settings page, device-admin
 * activation or the battery-exemption dialog. Statuses are re-read from the OS afterwards.
 */
class PermissionRequester internal constructor(
    private val context: Context,
    private val launchRuntime: (PermissionKey, Array<String>) -> Unit,
    private val launchIntent: (Intent) -> Unit,
) {
    private val container get() = MdmApp.container(context)

    fun grant(key: PermissionKey) {
        val pm = container.permissions
        when (val a = pm.grantAction(key)) {
            is PermAction.Runtime -> { pm.markRequested(key); launchRuntime(key, a.permissions) }
            is PermAction.OpenIntent -> { pm.markRequested(key); launchIntent(a.intent) }
            PermAction.OptIn -> { pm.setScreenShareOptIn(true); container.reportPermissions() }
            // Prominent disclosure first; it marks the key requested and opens Settings only after "I agree".
            PermAction.AccessibilityDisclosure -> launchIntent(AccessibilityDisclosureActivity.intent(context))
            PermAction.None -> Unit
        }
    }

    fun manage(key: PermissionKey) {
        val pm = container.permissions
        if (key == PermissionKey.SCREEN_CAPTURE) {
            pm.setScreenShareOptIn(pm.status(key) != PermissionStatus.GRANTED)
            container.reportPermissions()
            return
        }
        pm.manageIntent(key)?.let(launchIntent)
    }

    fun optOut(key: PermissionKey) {
        if (key == PermissionKey.SCREEN_CAPTURE) {
            container.permissions.setScreenShareOptIn(false)
            container.reportPermissions()
        }
    }
}

@Composable
fun rememberPermissionRequester(): PermissionRequester {
    val context = LocalContext.current
    var pendingKey by remember { mutableStateOf<PermissionKey?>(null) }
    val runtime = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val key = pendingKey ?: return@rememberLauncherForActivityResult
        val activity = context.findActivity()
        val c = MdmApp.container(context)
        if (activity != null) c.permissions.onRuntimeResult(activity, key, result) else c.permissions.refresh()
        c.reportPermissions()
    }
    val settings = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        MdmApp.container(context).reportPermissions()
    }
    return remember(context) {
        PermissionRequester(
            context,
            launchRuntime = { key, perms -> pendingKey = key; runtime.launch(perms) },
            launchIntent = { intent ->
                try { settings.launch(intent) } catch (_: ActivityNotFoundException) {
                    try {
                        settings.launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${context.packageName}")))
                    } catch (_: Exception) {
                        Toast.makeText(context, "Open Settings to change this permission.", Toast.LENGTH_LONG).show()
                    }
                }
            },
        )
    }
}

/** One permission: icon, name, status chip, description, why, Grant/Manage. */
@Composable
fun PermissionRow(
    def: PermissionDefinition,
    state: PermState?,
    required: Boolean,
    requester: PermissionRequester,
    showUpdated: Boolean = false,
    reviewMode: Boolean = false,
) {
    val status = state?.status ?: PermissionStatus.NOT_REQUESTED
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(def.key.icon(), null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.padding(8.dp).size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(def.name, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PermissionStatusChip(status, state?.blocked == true)
                    if (required) RequiredBadge()
                }
            }
        }
        if (def.description.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            Text(def.description, style = MaterialTheme.typography.bodyMedium)
        }
        if (def.why.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text("Why: ${def.why}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val note = state?.note ?: def.androidNotes.takeIf { it.isNotBlank() && status == PermissionStatus.NOT_SUPPORTED }
        if (!note.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
        if (state?.blocked == true) {
            Spacer(Modifier.height(4.dp))
            Text(
                "Android will not ask again. Grant opens Settings, where you can allow it.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
            )
        }
        if (showUpdated && state?.updatedAt != null) {
            Spacer(Modifier.height(4.dp))
            Text("Updated ${relativeTime(state.updatedAt)}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                status == PermissionStatus.NOT_SUPPORTED || status == PermissionStatus.RESTRICTED_BY_OS -> Unit
                status == PermissionStatus.GRANTED -> {
                    if (def.key == PermissionKey.SCREEN_CAPTURE) {
                        OutlinedButton(onClick = { requester.optOut(def.key) }) { Text("Opt out") }
                    } else if (!reviewMode) {
                        OutlinedButton(onClick = { requester.manage(def.key) }) { Text("Manage") }
                    }
                }
                else -> {
                    FilledTonalButton(onClick = { requester.grant(def.key) }) {
                        Text(if (def.key == PermissionKey.SCREEN_CAPTURE) "Allow requests" else "Grant")
                    }
                    if (def.key == PermissionKey.SCREEN_CAPTURE && reviewMode && status == PermissionStatus.NOT_REQUESTED && !required) {
                        TextButton(onClick = { requester.optOut(def.key) }) { Text("Don't allow") }
                    }
                }
            }
        }
    }
}
