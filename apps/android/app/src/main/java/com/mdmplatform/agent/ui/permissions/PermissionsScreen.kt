package com.mdmplatform.agent.ui.permissions

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.ui.components.ScreenHeader
import com.mdmplatform.agent.ui.components.SectionCard

@Composable
fun PermissionsScreen(modifier: Modifier = Modifier) {
    val c = MdmApp.container(LocalContext.current)
    val states by c.permissions.states.collectAsState()
    val requester = rememberPermissionRequester()
    val required = c.prefs.requiredPermissions.toSet()
    val stored = c.prefs.permissionDefinitions
    val keys = c.prefs.requestedPermissions.ifEmpty { PermissionKey.entries }
    val defs = keys.map { k -> stored.firstOrNull { it.key == k } ?: fallbackDefinition(k) }
        .sortedByDescending { it.key in required }

    Column(modifier.padding(horizontal = 20.dp)) {
        ScreenHeader(
            "Permissions",
            "What your organisation requested and the live status Android reports. Changes are sent to your organisation automatically.",
        )
        SectionCard {
            defs.forEachIndexed { i, def ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                PermissionRow(def, states[def.key], def.key in required, requester, showUpdated = true)
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Screen sharing always asks for your approval and Android's confirmation each time, even when allowed here. " +
                "Remote control (accessibility) only works during a session in which you choose \"Share screen and allow control\", " +
                "and you can stop it at any time.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(24.dp))
    }
}
