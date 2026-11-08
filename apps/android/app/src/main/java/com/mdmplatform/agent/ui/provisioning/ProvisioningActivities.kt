package com.mdmplatform.agent.ui.provisioning

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PersistableBundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.R
import com.mdmplatform.agent.permissions.MdmDeviceAdminReceiver
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.theme.MdmTheme

private fun Intent.adminExtras(): PersistableBundle? =
    IntentCompat.getParcelableExtra(this, DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, PersistableBundle::class.java)

/**
 * `android.app.action.GET_PROVISIONING_MODE` (Android 10+, required on 12+): the setup wizard asks which
 * mode we want. This agent only supports a fully managed, company-owned device, so it answers
 * PROVISIONING_MODE_FULLY_MANAGED_DEVICE when that mode is allowed, and cancels otherwise.
 * Protected by BIND_DEVICE_ADMIN: only the system can start it.
 */
class GetProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val extras = intent.adminExtras()
        MdmDeviceAdminReceiver.saveProvisioningExtras(this, extras)

        val allowed: List<Int>? = if (Build.VERSION.SDK_INT >= 31)
            intent.getIntegerArrayListExtra(DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES)
        else null
        if (allowed != null && allowed.isNotEmpty() && DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE !in allowed) {
            Log.w("Provisioning", "fully managed mode not allowed here (allowed=$allowed); cancelling")
            setResult(RESULT_CANCELED)
            finish()
            return
        }
        val result = Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE)
        if (extras != null) result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, extras)
        setResult(RESULT_OK, result)
        finish()
    }
}

/**
 * `android.app.action.ADMIN_POLICY_COMPLIANCE` (Android 10+, required on 12+): called by the setup wizard
 * once this app is device owner. Keeps the enrollment token from the admin extras and tells the user what
 * happens next. No policy is applied here: policies arrive from the server after enrollment.
 * The result is OK from the start, so leaving with Back never fails the setup.
 */
class PolicyComplianceActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        MdmDeviceAdminReceiver.saveProvisioningExtras(this, intent.adminExtras())
        setResult(RESULT_OK)
        MdmApp.container(this).onManagementChanged()
        setContent {
            MdmTheme {
                Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                        .statusBarsPadding().navigationBarsPadding()
                        .verticalScroll(rememberScrollState()).padding(24.dp)
                ) {
                    Text(stringResource(R.string.app_name).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(4.dp))
                    Text("This phone is company-owned", style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(16.dp))
                    SectionCard(title = "What this means", icon = Icons.Outlined.Business) {
                        Text(
                            "Your organisation set this phone up as a fully managed device. It can lock, restart or erase it, " +
                                "and enforce security settings such as screen-lock strength.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "It still cannot see your screen or control it without asking you first, every time.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "When setup finishes, open ${stringResource(R.string.app_name)} to review your organisation and the permissions it asks for.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(24.dp))
                    Button(onClick = { finish() }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Continue setup") }
                }
            }
        }
    }
}
