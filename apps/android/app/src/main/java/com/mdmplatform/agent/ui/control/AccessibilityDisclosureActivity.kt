package com.mdmplatform.agent.ui.control

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.theme.LocalStatusColors
import com.mdmplatform.agent.ui.theme.MdmTheme

/**
 * Prominent disclosure (Google Play AccessibilityService policy style) shown BEFORE the user is sent to
 * Settings > Accessibility. Nothing is enabled here: the user must switch the service on themselves.
 * "I agree" records the consent and opens Settings; "Not now" changes nothing.
 */
class AccessibilityDisclosureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val c = MdmApp.container(this)
        val org = c.state.org.value?.name ?: "your organisation"
        setContent {
            MdmTheme {
                Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                        .statusBarsPadding().navigationBarsPadding()
                ) {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp)) {
                        Text("ACCESSIBILITY DISCLOSURE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        Spacer(Modifier.height(4.dp))
                        Text("Allow remote control?", style = MaterialTheme.typography.headlineMedium)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "This app uses Android's Accessibility Service API so that $org's IT support can help you by " +
                                "tapping, swiping and typing on your screen during a support session.",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Spacer(Modifier.height(16.dp))
                        SectionCard(title = "What it can do", icon = Icons.Outlined.TouchApp) {
                            Line(true, "Perform taps, long presses and swipes where the support person points")
                            Line(true, "Press Back, Home, Recents and open the notification or quick-settings shade")
                            Line(true, "Type text into the text field that currently has focus")
                            Line(true, "Read which on-screen field has focus, only to type into it")
                        }
                        Spacer(Modifier.height(12.dp))
                        SectionCard(title = "When it is used", icon = Icons.Outlined.Info) {
                            Line(true, "Only during a screen-sharing session you approve, and only if you choose \"Share screen and allow control\" for that session")
                            Line(true, "A red \"Remote control active\" bar and notification are shown the whole time, with Stop control")
                            Line(false, "Never on its own, never in the background, never without a session you approved")
                            Line(false, "It does not collect, store or send what is on your screen, your typing, or accessibility events")
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "On the next screen, find \"${applicationInfo.loadLabel(packageManager)}\" (it may be under \"Installed apps\" or " +
                                "\"Downloaded apps\") and switch it on. You can switch it off there at any time; screen sharing keeps working without it.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (Build.VERSION.SDK_INT >= 33) {
                            Spacer(Modifier.height(12.dp))
                            Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("Switch greyed out (\"Restricted setting\")?", style = MaterialTheme.typography.titleSmall)
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        "Android blocks accessibility for apps installed outside an app store until you allow it. " +
                                            "Open App info, tap ⋮ (top right), then \"Allow restricted settings\", confirm, and come back here.",
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    TextButton(onClick = { openAppInfo() }) { Text("Open App info") }
                                }
                            }
                        }
                    }
                    Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp)) {
                            Button(onClick = { agree() }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("I agree, open Settings") }
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(onClick = { finish() }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Not now") }
                        }
                    }
                }
            }
        }
    }

    private fun agree() {
        val c = MdmApp.container(this)
        c.prefs.accessibilityDisclosureAccepted = true
        c.permissions.markRequested(PermissionKey.ACCESSIBILITY)
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Open Settings > Accessibility to switch on remote control.", Toast.LENGTH_LONG).show()
        }
        finish()
    }

    private fun openAppInfo() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        } catch (_: Exception) {
            Toast.makeText(this, "Open Settings > Apps > ${applicationInfo.loadLabel(packageManager)}.", Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        fun intent(ctx: Context): Intent = Intent(ctx, AccessibilityDisclosureActivity::class.java)
    }
}

@Composable
private fun Line(positive: Boolean, text: String) {
    val s = LocalStatusColors.current
    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
        Icon(
            if (positive) Icons.Outlined.Check else Icons.Outlined.Close, null,
            tint = if (positive) s.success else s.danger, modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
