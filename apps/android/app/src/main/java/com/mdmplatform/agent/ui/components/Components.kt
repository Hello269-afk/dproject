package com.mdmplatform.agent.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.outlined.ScreenShare
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.ui.theme.LocalStatusColors

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    icon: ImageVector? = null,
    trailing: @Composable (RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(20.dp)) {
            if (title != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (icon != null) {
                        Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                    }
                    Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    trailing?.invoke(this)
                }
                Spacer(Modifier.height(14.dp))
            }
            content()
        }
    }
}

@Composable
fun InfoRow(label: String, value: String?, mono: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(0.42f),
        )
        Text(
            value ?: "Unavailable",
            style = if (mono) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace) else MaterialTheme.typography.bodyMedium,
            color = if (value == null) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(0.58f),
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Small coloured dot; pulses when [live]. */
@Composable
fun StatusDot(color: Color, live: Boolean, size: Int = 10) {
    val t = rememberInfiniteTransition(label = "dot")
    val pulse by t.animateFloat(1f, 2.2f, infiniteRepeatable(tween(1200), RepeatMode.Restart), label = "pulse")
    val fade by t.animateFloat(0.5f, 0f, infiniteRepeatable(tween(1200), RepeatMode.Restart), label = "fade")
    Box(Modifier.size((size * 2.4).dp), contentAlignment = Alignment.Center) {
        if (live) Box(Modifier.size(size.dp).scale(pulse).alpha(fade).background(color, CircleShape))
        Box(Modifier.size(size.dp).background(color, CircleShape))
    }
}

@Composable
fun Pill(text: String, fg: Color, bg: Color, modifier: Modifier = Modifier) {
    Surface(color = bg, shape = RoundedCornerShape(50), modifier = modifier) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            maxLines = 1,
        )
    }
}

@Composable
fun PermissionStatusChip(status: PermissionStatus, blocked: Boolean = false) {
    val s = LocalStatusColors.current
    val (label, fg, bg) = when (status) {
        PermissionStatus.GRANTED -> Triple("Granted", s.success, s.successContainer)
        PermissionStatus.DENIED -> Triple(if (blocked) "Blocked" else "Denied", s.danger, s.dangerContainer)
        PermissionStatus.REVOKED -> Triple("Turned off", s.danger, s.dangerContainer)
        PermissionStatus.RESTRICTED_BY_OS -> Triple("Restricted", s.warning, s.warningContainer)
        PermissionStatus.NOT_SUPPORTED -> Triple("Not supported", s.neutral, s.neutralContainer)
        PermissionStatus.AWAITING_APPROVAL -> Triple("Awaiting", s.warning, s.warningContainer)
        PermissionStatus.NOT_REQUESTED -> Triple("Not granted", s.warning, s.warningContainer)
    }
    Pill(label.uppercase(), fg, bg)
}

@Composable
fun RequiredBadge() {
    Pill("REQUIRED", MaterialTheme.colorScheme.onPrimaryContainer, MaterialTheme.colorScheme.primaryContainer)
}

/** Red "Sharing your screen" / "Remote control active" banner with Stop control and Stop. */
@Composable
fun SharingBanner(
    requester: String,
    viewerConnected: Boolean,
    controlActive: Boolean = false,
    onStopControl: () -> Unit = {},
    onStop: () -> Unit,
) {
    Surface(color = Color(0xFFC62828), contentColor = Color.White) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusDot(Color.White, live = true, size = 8)
            Spacer(Modifier.width(6.dp))
            Icon(Icons.AutoMirrored.Outlined.ScreenShare, null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    if (controlActive) "Remote control active by $requester" else "Sharing your screen",
                    style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        controlActive -> "They can tap, swipe and type"
                        viewerConnected -> "$requester is viewing"
                        else -> "Connecting to $requester…"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            if (controlActive) {
                androidx.compose.material3.OutlinedButton(
                    onClick = onStopControl,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    border = androidx.compose.foundation.BorderStroke(1.dp, Color.White),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                ) { Text("Stop control") }
                Spacer(Modifier.width(6.dp))
            }
            Button(
                onClick = onStop,
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFFC62828)),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 6.dp),
            ) { Text("Stop") }
        }
    }
}

/** Horizontal step indicator for the authentication flow. */
@Composable
fun StepProgress(steps: List<String>, current: Int, modifier: Modifier = Modifier) {
    Column(modifier) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            steps.forEachIndexed { i, _ ->
                val color = when {
                    i < current -> MaterialTheme.colorScheme.primary
                    i == current -> MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)
                    else -> MaterialTheme.colorScheme.outlineVariant
                }
                Box(Modifier.weight(1f).height(4.dp).background(color, RoundedCornerShape(2.dp)))
            }
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "STEP ${minOf(current + 1, steps.size)} OF ${steps.size}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(8.dp))
            Text(steps.getOrElse(current) { steps.last() }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Vertical checklist used while authenticating. */
@Composable
fun ProgressChecklist(items: List<String>, doneCount: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items.forEachIndexed { i, label ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                    when {
                        i < doneCount -> Box(
                            Modifier.size(22.dp).background(LocalStatusColors.current.success, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(14.dp)) }
                        i == doneCount -> androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else -> Box(Modifier.size(10.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape))
                    }
                }
                Spacer(Modifier.width(14.dp))
                Text(
                    label,
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (i <= doneCount) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null) {
    Column(Modifier.padding(top = 8.dp, bottom = 16.dp)) {
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (subtitle != null) {
            Spacer(Modifier.height(4.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

fun relativeTime(iso: String?): String {
    val ms = com.mdmplatform.agent.core.parseIsoMillis(iso) ?: return "Never"
    val d = (System.currentTimeMillis() - ms) / 1000
    return when {
        d < 10 -> "Just now"
        d < 60 -> "${d}s ago"
        d < 3600 -> "${d / 60} min ago"
        d < 86400 -> "${d / 3600} h ago"
        else -> java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(ms))
    }
}

fun formatDateTime(iso: String?): String {
    val ms = com.mdmplatform.agent.core.parseIsoMillis(iso) ?: return "Unknown"
    return java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(ms))
}
