package com.mdmplatform.agent.ui.assist

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.automirrored.outlined.ScreenShare
import androidx.compose.material.icons.outlined.StopCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.SharingSession
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.core.ScreenRequest
import com.mdmplatform.agent.ui.control.AccessibilityDisclosureActivity
import com.mdmplatform.agent.ui.components.Pill
import com.mdmplatform.agent.ui.components.ScreenHeader
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.components.StatusDot
import com.mdmplatform.agent.ui.components.relativeTime
import com.mdmplatform.agent.ui.theme.LocalStatusColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Launches the OS MediaProjection dialog for a session (only after the user tapped an approve button).
 * The second argument is the user's control choice for this session ("Share screen and allow control").
 */
@Composable
fun rememberScreenConsentLauncher(): (String, Boolean) -> Unit {
    val c = MdmApp.container(LocalContext.current)
    var pendingSession by rememberSaveable { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val sid = pendingSession ?: return@rememberLauncherForActivityResult
        pendingSession = null
        c.screen.onOsResult(sid, r.resultCode, r.data)
    }
    return remember(launcher) {
        { sid: String, allowControl: Boolean ->
            pendingSession = sid
            c.screen.onApproveTapped(sid, allowControl)
            launcher.launch(c.screen.createOsConsentIntent())
        }
    }
}

/**
 * The in-app consent card: who is asking, why, what happens next, Approve / Reject.
 * When the admin asked for control: "Share screen only" or "Share screen and allow control"
 * (the latter needs the accessibility service switched on by the user first).
 */
@Composable
fun ConsentCard(req: ScreenRequest, orgName: String?, onApprove: (allowControl: Boolean) -> Unit, onReject: () -> Unit) {
    val context = LocalContext.current
    val c = MdmApp.container(context)
    val perms by c.permissions.states.collectAsState()
    val controlReady = perms[PermissionKey.ACCESSIBILITY]?.status == PermissionStatus.GRANTED
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(req.sessionId) { while (true) { now = System.currentTimeMillis(); delay(500) } }
    val total = (req.expiresAtMs - req.receivedAtMs).coerceAtLeast(1)
    val left = (req.expiresAtMs - now).coerceAtLeast(0)
    SectionCard(title = if (req.control) "Screen sharing and control request" else "Screen-sharing request", icon = Icons.AutoMirrored.Outlined.ScreenShare) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.primaryContainer) {
                Icon(Icons.Outlined.Person, null, modifier = Modifier.padding(10.dp).size(24.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text(req.requesterName, style = MaterialTheme.typography.titleMedium)
                if (req.requesterEmail.isNotBlank()) Text(req.requesterEmail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (orgName != null) Text(orgName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text("PURPOSE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(4.dp))
        Text(req.purpose.ifBlank { "No reason given." }, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(16.dp))
        if (req.control) {
            Pill("CONTROL REQUESTED", LocalStatusColors.current.warning, LocalStatusColors.current.warningContainer)
            Spacer(Modifier.height(8.dp))
        }
        Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
            Text(
                if (req.control)
                    "${req.requesterName} also asks to control your device (tap, swipe and type). You choose: share your screen " +
                        "view-only, or share and allow control. Android then asks you to confirm. You can stop control or sharing " +
                        "at any time. Nothing is shared if you reject."
                else
                    "If you approve, Android will ask you to confirm. ${req.requesterName} will then see everything on your screen " +
                        "(view only, no control) until you tap Stop sharing. Nothing is shared if you reject.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(12.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        LinearProgressIndicator(progress = { left.toFloat() / total }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(4.dp))
        Text("Expires in ${left / 1000}s", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(16.dp))
        if (req.control) {
            Button(
                onClick = { onApprove(true) },
                enabled = left > 0 && controlReady,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("Share screen and allow control") }
            if (!controlReady) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "To allow control, first switch on remote control in Android's Accessibility settings.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = {
                    context.startActivity(AccessibilityDisclosureActivity.intent(context).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                }) { Text("Set up remote control") }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onReject, modifier = Modifier.weight(1f).height(48.dp)) { Text("Reject") }
                OutlinedButton(onClick = { onApprove(false) }, enabled = left > 0, modifier = Modifier.weight(1f).height(48.dp)) { Text("Share screen only") }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onReject, modifier = Modifier.weight(1f).height(48.dp)) { Text("Reject") }
                Button(onClick = { onApprove(false) }, enabled = left > 0, modifier = Modifier.weight(1f).height(48.dp)) { Text("Approve") }
            }
        }
    }
}

@Composable
fun ActiveSharingCard(s: SharingSession, onStop: () -> Unit, onStopControl: () -> Unit) {
    val danger = LocalStatusColors.current.danger
    SectionCard(
        title = if (s.controlGranted) "Remote control active" else "Sharing your screen",
        icon = Icons.AutoMirrored.Outlined.ScreenShare, trailing = { StatusDot(danger, live = true) },
    ) {
        Text("${s.requesterName}${if (s.requesterEmail.isNotBlank()) " (${s.requesterEmail})" else ""}", style = MaterialTheme.typography.titleSmall)
        if (s.purpose.isNotBlank()) Text(s.purpose, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Pill(
            if (s.viewerConnected) "VIEWING NOW" else "WAITING FOR VIEWER",
            LocalStatusColors.current.danger, LocalStatusColors.current.dangerContainer,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            when {
                s.controlGranted -> "${s.requesterName} can see your screen and tap, swipe and type on it. Stop control keeps view-only sharing."
                s.controlRequested -> "View only. You did not allow control, or it was stopped."
                else -> "View only. ${s.requesterName} cannot control your device."
            },
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        if (s.controlGranted) {
            OutlinedButton(onClick = onStopControl, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Stop control") }
            Spacer(Modifier.height(8.dp))
        }
        Button(
            onClick = onStop,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828), contentColor = Color.White),
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            Icon(Icons.Outlined.StopCircle, null)
            Spacer(Modifier.width(8.dp))
            Text("Stop sharing")
        }
    }
}

@Composable
fun AssistScreen(modifier: Modifier = Modifier) {
    val c = MdmApp.container(LocalContext.current)
    val pending by c.state.pendingScreenRequest.collectAsState()
    val sharing by c.state.sharing.collectAsState()
    val messages by c.state.messages.collectAsState()
    val org by c.state.org.collectAsState()
    val suspended by c.state.suspendedReason.collectAsState()
    val launchConsent = rememberScreenConsentLauncher()
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sendError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        c.state.unreadMessages.value = 0
        c.refreshMessages()
    }

    Column(modifier.padding(horizontal = 20.dp)) {
        ScreenHeader("Remote assistance", "Screen sharing and messages with ${org?.name ?: "your IT team"}")

        when {
            sharing != null -> ActiveSharingCard(sharing!!, onStop = { c.screen.stopSharing("user_stopped") }, onStopControl = { c.screen.stopControl() })
            pending != null -> ConsentCard(
                pending!!, org?.name,
                onApprove = { allowControl -> launchConsent(pending!!.sessionId, allowControl) },
                onReject = { c.screen.reject(pending!!.sessionId) },
            )
            else -> SectionCard(title = "Screen sharing", icon = Icons.AutoMirrored.Outlined.ScreenShare) {
                Text(
                    if (suspended != null) "Screen sharing is unavailable while this device is suspended."
                    else "No active requests. When your IT team asks to view your screen you will get a notification and can approve or reject it here.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Support messages", icon = Icons.AutoMirrored.Outlined.Chat) {
            if (messages.isEmpty()) {
                Text("No messages yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                messages.forEach { m ->
                    val mine = m.fromDevice
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                        Surface(
                            color = if (mine) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh,
                            contentColor = if (mine) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier.widthIn(max = 300.dp),
                        ) {
                            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                if (!mine) Text(m.senderName ?: "IT support", style = MaterialTheme.typography.labelMedium)
                                Text(m.body, style = MaterialTheme.typography.bodyMedium)
                                Text(relativeTime(m.createdAt), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            sendError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(6.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(2000) },
                    placeholder = { Text("Reply to IT support") },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(
                    enabled = draft.isNotBlank() && !sending,
                    onClick = {
                        val body = draft.trim()
                        sending = true; sendError = null
                        scope.launch {
                            try { c.sendMessage(body); draft = "" } catch (e: Exception) {
                                sendError = "Message not sent: ${e.message}"
                            } finally { sending = false }
                        }
                    },
                ) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}
