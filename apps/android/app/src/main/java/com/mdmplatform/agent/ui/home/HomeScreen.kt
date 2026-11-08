package com.mdmplatform.agent.ui.home

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.automirrored.outlined.ScreenShare
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.BuildConfig
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.ConnPhase
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.management.ManagementInfo
import com.mdmplatform.agent.ui.components.InfoRow
import com.mdmplatform.agent.ui.components.Pill
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.components.StatusDot
import com.mdmplatform.agent.ui.components.relativeTime
import com.mdmplatform.agent.ui.theme.LocalStatusColors
import kotlinx.coroutines.delay

@Composable
fun HomeScreen(modifier: Modifier = Modifier, onOpenPermissions: () -> Unit, onOpenAssist: () -> Unit) {
    val context = LocalContext.current
    val c = MdmApp.container(context)
    val org by c.state.org.collectAsState()
    val conn by c.state.connection.collectAsState()
    val suspended by c.state.suspendedReason.collectAsState()
    val lastSync by c.state.lastSyncAt.collectAsState()
    val deviceName by c.state.deviceName.collectAsState()
    val assigned by c.state.assignedUserName.collectAsState()
    val perms by c.permissions.states.collectAsState()
    val pending by c.state.pendingScreenRequest.collectAsState()
    val mgmt by c.state.management.collectAsState()
    val compliance by c.state.compliance.collectAsState()
    val status = LocalStatusColors.current

    // Re-render relative times.
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(15_000); tick++ } }

    Column(modifier.padding(horizontal = 20.dp)) {
        // Header
        Column(Modifier.padding(top = 8.dp, bottom = 16.dp)) {
            Text("MANAGED BY", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
            Text(org?.name ?: "Your organisation", style = MaterialTheme.typography.headlineMedium)
        }

        if (suspended != null) {
            Surface(color = status.warningContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Block, null, tint = status.warning)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Device suspended", style = MaterialTheme.typography.titleSmall, color = status.warning)
                        Text(
                            "${org?.name ?: "Your organisation"} suspended this device. Screen sharing is unavailable. Contact support if this is unexpected.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        pending?.let { req ->
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.large, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.AutoMirrored.Outlined.ScreenShare, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        "${req.requesterName} wants to view your screen",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.weight(1f),
                    )
                    Button(onClick = onOpenAssist) { Text("Review") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }

        // Status
        SectionCard(title = "Status", icon = Icons.Outlined.VerifiedUser) {
            val (dotColor, label, live) = when {
                suspended != null -> Triple(status.warning, "Suspended", false)
                conn.phase == ConnPhase.CONNECTED -> Triple(status.success, "Connected", true)
                conn.phase == ConnPhase.CONNECTING -> Triple(status.warning, "Connecting…", true)
                conn.phase == ConnPhase.REPLACED -> Triple(status.danger, "Signed in elsewhere", false)
                conn.phase == ConnPhase.IDLE -> Triple(status.neutral, "Not connected", false)
                else -> Triple(status.danger, "Offline, retrying", false)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusDot(dotColor, live)
                Spacer(Modifier.width(6.dp))
                Text(label, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Pill("ENROLLED", status.success, status.successContainer)
            }
            if (conn.detail != null && conn.phase != ConnPhase.CONNECTED) {
                Text(conn.detail!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Spacer(Modifier.height(8.dp))
            key(tick) { InfoRow("Last sync", relativeTime(lastSync)) }
            if (conn.phase != ConnPhase.CONNECTED && conn.phase != ConnPhase.CONNECTING) {
                TextButton(onClick = { c.connection.start(); c.connection.wakeUp() }) {
                    Icon(Icons.Outlined.Wifi, null); Spacer(Modifier.width(6.dp)); Text("Reconnect now")
                }
            }
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Ownership", icon = Icons.Outlined.Business) {
            InfoRow(
                "Owned by",
                when {
                    mgmt.companyOwned -> "Your organisation (company-owned)"
                    mgmt.ownership == "personal" -> "You (personal device)"
                    else -> "Not specified"
                },
            )
            InfoRow(
                "Management",
                when (mgmt.mode) {
                    ManagementInfo.MODE_DEVICE_OWNER -> "Fully managed (device owner)"
                    ManagementInfo.MODE_DEVICE_ADMIN -> "Device admin"
                    else -> "App only"
                },
            )
            Spacer(Modifier.height(6.dp))
            Text(
                when (mgmt.mode) {
                    ManagementInfo.MODE_DEVICE_OWNER ->
                        "${org?.name ?: "Your organisation"} set this phone up and manages it. It can lock, restart or erase it and enforce security settings. Screen viewing and control still need your approval every time."
                    ManagementInfo.MODE_DEVICE_ADMIN ->
                        "You activated the device admin. ${org?.name ?: "Your organisation"} can lock the screen remotely. Security settings are checked and reported, not enforced."
                    else ->
                        "${org?.name ?: "Your organisation"} cannot change settings on this device. Security settings are checked and reported only."
                },
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(
            title = "Compliance", icon = Icons.Outlined.Policy,
            trailing = {
                compliance?.let { comp ->
                    if (comp.issues.isEmpty()) Pill("COMPLIANT", status.success, status.successContainer)
                    else Pill("${comp.issues.size} ISSUE${if (comp.issues.size == 1) "" else "S"}", status.danger, status.dangerContainer)
                }
            },
        ) {
            val comp = compliance
            if (comp == null) {
                Text("Not checked yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            } else {
                comp.issues.forEach { issue ->
                    Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
                        Icon(Icons.Outlined.ErrorOutline, null, tint = status.danger, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(issue, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (comp.issues.isNotEmpty()) Spacer(Modifier.height(8.dp))
                InfoRow("Screen lock", when (comp.passcodeSufficient) { true -> "Meets the requirement"; false -> "Weaker than required"; null -> "Not checked" })
                InfoRow("Encryption", when (comp.encrypted) { true -> "Encrypted"; false -> "Not encrypted"; null -> "Unknown" })
                InfoRow("Security patch", comp.securityPatch)
                InfoRow(
                    "Policy",
                    when {
                        comp.policyVersion == null -> "No policy received"
                        comp.enforced -> "Version ${comp.policyVersion}, enforced"
                        else -> "Version ${comp.policyVersion}, reported only"
                    },
                )
                key(tick) { InfoRow("Checked", relativeTime(comp.checkedAt)) }
            }
            TextButton(onClick = { c.management.sendCompliance() }) { Text("Check now") }
        }
        Spacer(Modifier.height(16.dp))

        // Permission overview
        val requested = c.prefs.requestedPermissions.ifEmpty { PermissionKey.entries }
        val required = c.prefs.requiredPermissions.toSet()
        val granted = requested.count { perms[it]?.status == PermissionStatus.GRANTED }
        val unsupported = requested.count { perms[it]?.status == PermissionStatus.NOT_SUPPORTED }
        val attention = requested.size - granted - unsupported
        val requiredMissing = required.count { val s = perms[it]?.status; s != PermissionStatus.GRANTED && s != PermissionStatus.NOT_SUPPORTED }
        SectionCard(title = "Permissions", icon = Icons.Outlined.VerifiedUser) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                CountTile("Granted", granted, status.success, Modifier.weight(1f))
                CountTile("Need attention", attention, if (attention > 0) status.warning else status.neutral, Modifier.weight(1f))
                CountTile("Unsupported", unsupported, status.neutral, Modifier.weight(1f))
            }
            if (requiredMissing > 0) {
                Spacer(Modifier.height(12.dp))
                Text(
                    "$requiredMissing required permission${if (requiredMissing == 1) " is" else "s are"} not granted. Your organisation sees this device as needing attention.",
                    style = MaterialTheme.typography.bodySmall, color = status.danger,
                )
            }
            if (attention > 0) {
                Spacer(Modifier.height(12.dp))
                FilledTonalButton(onClick = onOpenPermissions, modifier = Modifier.fillMaxWidth()) { Text("Fix permissions") }
            }
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "This device", icon = Icons.Outlined.PhoneAndroid) {
            InfoRow("Name", deviceName)
            InfoRow("Model", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
            InfoRow("Android", "${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
            InfoRow("App version", BuildConfig.VERSION_NAME)
            InfoRow("Assigned to", assigned ?: "Not assigned")
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Support", icon = Icons.Outlined.SupportAgent) {
            val email = org?.supportEmail
            val phone = org?.supportPhone
            if (email == null && phone == null) {
                Text("Your organisation has not published support contact details.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            }
            email?.let {
                TextButton(onClick = {
                    runCatching { context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$it"))) }
                }) { Icon(Icons.Outlined.Email, null); Spacer(Modifier.width(8.dp)); Text(it) }
            }
            phone?.let {
                TextButton(onClick = {
                    runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$it"))) }
                }) { Icon(Icons.Outlined.Phone, null); Spacer(Modifier.width(8.dp)); Text(it) }
            }
            TextButton(onClick = onOpenAssist) { Text("Message IT support") }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun key(k: Any, content: @Composable () -> Unit) = androidx.compose.runtime.key(k) { content() }

@Composable
private fun CountTile(label: String, count: Int, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium, modifier = modifier) {
        Column(Modifier.padding(12.dp)) {
            Text("$count", style = MaterialTheme.typography.headlineSmall, color = color)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
