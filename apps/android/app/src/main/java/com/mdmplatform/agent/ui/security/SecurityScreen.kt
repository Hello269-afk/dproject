package com.mdmplatform.agent.ui.security

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
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DevicesOther
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.ConnPhase
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.core.nowIso
import com.mdmplatform.agent.management.ManagementInfo
import com.mdmplatform.agent.ui.components.InfoRow
import com.mdmplatform.agent.ui.components.ScreenHeader
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.components.formatDateTime
import com.mdmplatform.agent.ui.components.relativeTime
import com.mdmplatform.agent.ui.theme.LocalStatusColors
import kotlinx.coroutines.launch

@Composable
fun SecurityScreen(modifier: Modifier = Modifier) {
    val c = MdmApp.container(LocalContext.current)
    val org by c.state.org.collectAsState()
    val conn by c.state.connection.collectAsState()
    val sharing by c.state.sharing.collectAsState()
    val suspended by c.state.suspendedReason.collectAsState()
    val mgmt by c.state.management.collectAsState()
    val perms by c.permissions.states.collectAsState()
    val scope = rememberCoroutineScope()
    var confirmRotate by remember { mutableStateOf(false) }
    var confirmUnenroll by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var unenrollFailed by remember { mutableStateOf(false) }
    val deviceId = remember(conn) { runCatching { c.credentials.get()?.deviceId }.getOrNull() }

    Column(modifier.padding(horizontal = 20.dp)) {
        ScreenHeader("Security & privacy", "How this device is registered and what your organisation can see.")

        SectionCard(title = "Registration", icon = Icons.Outlined.Business) {
            InfoRow("Organisation", org?.name)
            InfoRow("Server", c.prefs.apiBaseUrl, mono = true)
            InfoRow("Device ID", deviceId, mono = true)
            InfoRow("Installation ID", c.prefs.installationId, mono = true)
            InfoRow("Enrolled", formatDateTime(c.prefs.enrolledAt))
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Authentication", icon = Icons.Outlined.Key) {
            val authState = when {
                suspended != null -> "Suspended by organisation"
                conn.phase == ConnPhase.CONNECTED -> "Authenticated"
                else -> "Enrolled, not currently connected"
            }
            InfoRow("State", authState)
            InfoRow("Credential storage", "Android Keystore (encrypted)")
            InfoRow("Access token", if (c.api.accessTokenExpiresAtMs > System.currentTimeMillis())
                "Valid until ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(c.api.accessTokenExpiresAtMs))}"
            else "Not issued")
            InfoRow("Credentials rotated", c.prefs.credentialsRotatedAt?.let { relativeTime(it) } ?: "Never")
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { confirmRotate = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Rotate credentials") }
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Active sessions", icon = Icons.Outlined.DevicesOther) {
            InfoRow("Management connection", if (conn.phase == ConnPhase.CONNECTED) "Connected since ${relativeTime(java.time.Instant.ofEpochMilli(conn.sinceMs).toString())}" else "Not connected")
            InfoRow("Screen sharing", sharing?.let { "Active with ${it.requesterName}" } ?: "None")
            InfoRow("Remote control", sharing?.takeIf { it.controlGranted }?.let { "Active by ${it.requesterName}" } ?: "Off")
            sharing?.let {
                Spacer(Modifier.height(8.dp))
                if (it.controlGranted) {
                    OutlinedButton(onClick = { c.screen.stopControl() }, modifier = Modifier.fillMaxWidth()) { Text("Stop control") }
                }
                Button(
                    onClick = { c.screen.stopSharing("user_stopped") },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Stop sharing") }
            }
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "What ${org?.name ?: "your organisation"} can see", icon = Icons.Outlined.PrivacyTip) {
            PrivacyLine(true, "Device name, manufacturer, model, Android and app version")
            PrivacyLine(true, "Battery level and charging, storage and memory totals, screen size and orientation")
            PrivacyLine(true, "Network type, mobile carrier name and the device's IP address")
            PrivacyLine(true, "Wi-Fi network name and last known location, only if you granted Location")
            PrivacyLine(true, "Which permissions are granted, and support messages you send")
            PrivacyLine(true, "Your screen, only during a session you approve each time, until you stop it")
            PrivacyLine(true, "Security status: screen-lock strength, encryption and security patch level")
            Spacer(Modifier.height(10.dp))
            Text("CANNOT SEE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(6.dp))
            PrivacyLine(false, "Your screen without your approval, or after you tap Stop sharing")
            PrivacyLine(false, "Your messages, email, photos, files, browsing history or passwords")
            PrivacyLine(false, "Your camera or microphone: this app never records them")
        }
        Spacer(Modifier.height(16.dp))

        // Driven by what this device can actually do right now (DeviceManager.capabilities()).
        val caps = mgmt.capabilities.toSet()
        val canAsk = perms[PermissionKey.SCREEN_CAPTURE]?.status == PermissionStatus.GRANTED
        SectionCard(title = "What ${org?.name ?: "your organisation"} can do", icon = Icons.Outlined.AdminPanelSettings) {
            PrivacyLine(canAsk, if (canAsk) "Ask to view your screen. You approve every session" else "Ask to view your screen (you opted out of requests)")
            PrivacyLine(
                ManagementInfo.CAP_REMOTE_CONTROL in caps,
                if (ManagementInfo.CAP_REMOTE_CONTROL in caps) "Control your screen (tap, swipe, type), only in a session where you choose to allow control"
                else "Control your screen: remote control is switched off in Accessibility settings",
            )
            PrivacyLine(ManagementInfo.CAP_LOCK in caps, if (ManagementInfo.CAP_LOCK in caps) "Lock the screen remotely, for example if the phone is lost" else "Lock the screen remotely")
            PrivacyLine(ManagementInfo.CAP_REBOOT in caps, "Restart the device")
            PrivacyLine(
                ManagementInfo.CAP_WIPE in caps,
                if (ManagementInfo.CAP_WIPE in caps) "Erase the device (factory reset). Company-owned devices only" else "Erase the device or your data",
            )
            PrivacyLine(
                ManagementInfo.CAP_APPLY_POLICY in caps,
                if (ManagementInfo.CAP_APPLY_POLICY in caps) "Enforce screen-lock strength, lock timeout, camera, USB debugging and factory-reset rules"
                else "Change your security settings (they are only checked and reported)",
            )
            PrivacyLine(false, "Install or remove apps, or read your personal data")
        }
        Spacer(Modifier.height(16.dp))

        if (mgmt.fullyManaged) SectionCard(title = "Unenroll", icon = Icons.Outlined.Lock) {
            Text(
                "This is a company-owned, fully managed device, so it cannot be removed from this app. " +
                    "Company-owned devices are removed by your IT team (they release or factory-reset the device). " +
                    "Contact ${org?.supportEmail ?: org?.name ?: "your IT team"} if you need it removed.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else SectionCard(title = "Unenroll", icon = Icons.Outlined.Lock) {
            Text(
                "Removes this device from ${org?.name ?: "your organisation"}, deletes its credentials from this phone and stops all reporting.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { confirmUnenroll = true },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Unenroll this device") }
            if (unenrollFailed) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Could not reach the server. You can remove the credentials from this phone only; your organisation will still list the device until it is revoked there.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error,
                )
                TextButton(onClick = { c.wipeLocal("Removed from this device. Ask your IT team to revoke it on the server.") }) {
                    Text("Remove from this phone only")
                }
            }
        }
        message?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(24.dp))
    }

    if (confirmRotate) {
        AlertDialog(
            onDismissRequest = { confirmRotate = false },
            title = { Text("Rotate credentials?") },
            text = { Text("A new device secret is issued and the old one stops working immediately.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmRotate = false; busy = true; message = null
                    scope.launch {
                        try {
                            val res = c.api.authed("POST", "/api/device/credentials/rotate")
                            val secret = res?.optString("deviceSecret").orEmpty()
                            if (secret.isEmpty()) throw IllegalStateException("No secret returned")
                            c.credentials.updateSecret(secret)
                            c.prefs.credentialsRotatedAt = nowIso()
                            message = "Credentials rotated."
                        } catch (e: Exception) {
                            message = "Rotation failed: ${e.message}"
                        } finally { busy = false }
                    }
                }) { Text("Rotate") }
            },
            dismissButton = { TextButton(onClick = { confirmRotate = false }) { Text("Cancel") } },
        )
    }

    if (confirmUnenroll) {
        AlertDialog(
            onDismissRequest = { confirmUnenroll = false },
            title = { Text("Unenroll this device?") },
            text = { Text("${org?.name ?: "Your organisation"} will no longer manage this device. You will need a new enrollment link to join again.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmUnenroll = false; busy = true; message = null; unenrollFailed = false
                    scope.launch {
                        try {
                            c.screen.stopAll()
                            c.api.authed("POST", "/api/device/unenroll")
                            c.wipeLocal("This device was unenrolled.")
                        } catch (e: com.mdmplatform.agent.net.ApiException) {
                            if (e.code == "device_revoked") c.wipeLocal("This device was unenrolled.")
                            else { unenrollFailed = true; message = "Unenroll failed: ${e.message}" }
                        } catch (e: Exception) {
                            unenrollFailed = true; message = "Unenroll failed: ${e.message}"
                        } finally { busy = false }
                    }
                }) { Text("Unenroll", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmUnenroll = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PrivacyLine(can: Boolean, text: String) {
    val s = LocalStatusColors.current
    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Icon(
            if (can) Icons.Outlined.Check else Icons.Outlined.Close, null,
            tint = if (can) s.success else s.danger, modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
