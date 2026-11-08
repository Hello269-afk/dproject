package com.mdmplatform.agent.ui

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.AgentService
import com.mdmplatform.agent.ui.assist.AssistScreen
import com.mdmplatform.agent.ui.components.SharingBanner
import com.mdmplatform.agent.ui.enroll.EnrollStep
import com.mdmplatform.agent.ui.enroll.EnrollmentFlow
import com.mdmplatform.agent.ui.enroll.EnrollmentViewModel
import com.mdmplatform.agent.ui.home.HomeScreen
import com.mdmplatform.agent.ui.permissions.PermissionsScreen
import com.mdmplatform.agent.ui.security.SecurityScreen
import com.mdmplatform.agent.ui.theme.MdmTheme

class MainActivity : ComponentActivity() {

    private val enrollVm: EnrollmentViewModel by viewModels()
    private val container by lazy { MdmApp.container(this) }
    private val requestedTab = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        setContent { MdmTheme { Root() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent?.getStringExtra(EXTRA_TAB)?.let { requestedTab.value = it }
        if (intent?.action == ACTION_PROVISIONING_SUCCESSFUL) {
            // Android 8-11 after QR provisioning: continue with the token from the admin extras.
            if (!container.isEnrolled()) enrollVm.resumeProvisioning()
            return
        }
        val data = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        if (container.isEnrolled()) {
            Toast.makeText(this, "This device is already enrolled. Unenroll it first to use a new link.", Toast.LENGTH_LONG).show()
            return
        }
        enrollVm.onLink(data)
    }

    override fun onResume() {
        super.onResume()
        // Re-read every permission from the OS and report it (statuses must reflect reality).
        container.reportPermissions()
        if (container.isEnrolled()) {
            AgentService.start(this)
            container.connection.wakeUp()
        } else {
            // A company-owned device provisioned with an enrollment token: go straight into enrollment.
            enrollVm.resumeProvisioning()
        }
    }

    @Composable
    private fun Root() {
        val enrolled by container.state.enrolled.collectAsState()
        val enrollUi by enrollVm.ui.collectAsState()
        val inFlow = !enrolled || enrollUi.step == EnrollStep.COMPLETING || enrollUi.step == EnrollStep.SUCCESS
        LaunchedEffect(enrolled) { if (!enrolled) enrollVm.refreshNotice() }
        if (inFlow) {
            EnrollmentFlow(enrollVm, onFinished = { enrollVm.reset() })
        } else {
            MainScaffold()
        }
    }

    @Composable
    private fun MainScaffold() {
        var tab by rememberSaveable { mutableStateOf(TAB_HOME) }
        val pendingTab by requestedTab
        LaunchedEffect(pendingTab) { pendingTab?.let { tab = it; requestedTab.value = null } }

        val sharing by container.state.sharing.collectAsState()
        val pending by container.state.pendingScreenRequest.collectAsState()
        val unread by container.state.unreadMessages.collectAsState()
        val notice by container.state.notice.collectAsState()
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(notice) {
            notice?.let { snackbar.showSnackbar(it); container.state.notice.value = null }
        }
        DisposableEffect(tab) {
            container.assistTabVisible = tab == TAB_ASSIST
            if (tab == TAB_ASSIST) container.state.unreadMessages.value = 0
            onDispose { container.assistTabVisible = false }
        }

        Scaffold(
            contentWindowInsets = WindowInsets(0),
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                NavigationBar {
                    NavItem(tab, TAB_HOME, "Home", Icons.Outlined.Home, 0) { tab = it }
                    NavItem(tab, TAB_PERMISSIONS, "Permissions", Icons.Outlined.VerifiedUser, 0) { tab = it }
                    NavItem(tab, TAB_ASSIST, "Assist", Icons.Outlined.SupportAgent, (if (pending != null) 1 else 0) + unread) { tab = it }
                    NavItem(tab, TAB_SECURITY, "Security", Icons.Outlined.Lock, 0) { tab = it }
                }
            },
        ) { padding ->
            Column(Modifier.fillMaxSize().padding(padding)) {
                sharing?.let { s ->
                    Box(Modifier.statusBarsPadding()) {
                        SharingBanner(
                            s.requesterName, s.viewerConnected,
                            controlActive = s.controlGranted,
                            onStopControl = { container.screen.stopControl() },
                        ) { container.screen.stopSharing("user_stopped") }
                    }
                }
                val top = if (sharing == null) Modifier.statusBarsPadding() else Modifier
                val body = Modifier.fillMaxSize().then(top).verticalScroll(rememberScrollState())
                when (tab) {
                    TAB_PERMISSIONS -> PermissionsScreen(body)
                    TAB_ASSIST -> AssistScreen(body)
                    TAB_SECURITY -> SecurityScreen(body)
                    else -> HomeScreen(body, onOpenPermissions = { tab = TAB_PERMISSIONS }, onOpenAssist = { tab = TAB_ASSIST })
                }
            }
        }
    }

    @Composable
    private fun androidx.compose.foundation.layout.RowScope.NavItem(
        current: String, id: String, label: String,
        icon: androidx.compose.ui.graphics.vector.ImageVector, badge: Int, onSelect: (String) -> Unit,
    ) {
        NavigationBarItem(
            selected = current == id,
            onClick = { onSelect(id) },
            icon = {
                if (badge > 0) BadgedBox(badge = { Badge { Text("$badge") } }) { Icon(icon, label) }
                else Icon(icon, label)
            },
            label = { Text(label, style = MaterialTheme.typography.labelMedium) },
        )
    }

    companion object {
        const val EXTRA_TAB = "tab"
        private const val ACTION_PROVISIONING_SUCCESSFUL = "android.app.action.PROVISIONING_SUCCESSFUL"
        const val TAB_HOME = "home"
        const val TAB_PERMISSIONS = "permissions"
        const val TAB_ASSIST = "assist"
        const val TAB_SECURITY = "security"
    }
}
