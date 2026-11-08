package com.mdmplatform.agent

import android.app.Application
import android.content.Context
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.mdmplatform.agent.agent.AgentConnection
import com.mdmplatform.agent.agent.AgentService
import com.mdmplatform.agent.agent.AgentState
import com.mdmplatform.agent.agent.ConnPhase
import com.mdmplatform.agent.agent.ConnectionInfo
import com.mdmplatform.agent.core.AppPrefs
import com.mdmplatform.agent.core.CredentialStore
import com.mdmplatform.agent.core.DeviceCredentials
import com.mdmplatform.agent.core.Notifications
import com.mdmplatform.agent.core.OrgInfo
import com.mdmplatform.agent.core.SupportMessage
import com.mdmplatform.agent.core.nowIso
import com.mdmplatform.agent.management.CommandExecutor
import com.mdmplatform.agent.management.DeviceManager
import com.mdmplatform.agent.net.ApiClient
import com.mdmplatform.agent.permissions.PermissionManager
import com.mdmplatform.agent.screen.ScreenShareController
import com.mdmplatform.agent.telemetry.TelemetryCollector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MdmApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        Notifications.createChannels(this)
    }

    companion object {
        fun container(context: Context): AppContainer = (context.applicationContext as MdmApp).container
    }
}

/** Manual dependency container; one instance per process. */
class AppContainer(private val app: Application) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val prefs = AppPrefs(app)
    val credentials = CredentialStore(app)
    val state = AgentState()
    val telemetry = TelemetryCollector(app)
    val permissions = PermissionManager(app, prefs)
    val api = ApiClient(
        baseUrlProvider = { prefs.apiBaseUrl },
        credentialsProvider = { credentials.get() },
        onDeviceRevoked = { handleRevoked(it) },
        onDeviceSuspended = { handleSuspended(it) },
    )
    val connection = AgentConnection(this)
    val screen = ScreenShareController(app, this)
    val management = DeviceManager(app, this)
    val commands = CommandExecutor(app, this)

    init {
        val enrolled = isEnrolled()
        state.enrolled.value = enrolled
        if (enrolled) {
            prefs.orgName?.let { state.org.value = OrgInfo(it, prefs.supportEmail, prefs.supportPhone) }
            state.deviceName.value = prefs.deviceName
            state.assignedUserName.value = prefs.assignedUserName
            state.lastSyncAt.value = prefs.lastSyncAt
        }
        management.refresh()
        state.compliance.value = runCatching { management.computeCompliance() }.getOrNull()
    }

    fun isEnrolled(): Boolean = try { credentials.get() != null } catch (e: Exception) {
        // Keystore corruption (e.g. restored from another device): treat as not enrolled.
        Log.e("AppContainer", "credential store unreadable", e); false
    }

    fun isAppInForeground(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    fun launchDelayed(ms: Long, block: suspend () -> Unit): Job = appScope.launch { delay(ms); block() }

    // ---------------------------------------------------------------- enrollment lifecycle

    fun onEnrolled(creds: DeviceCredentials, org: OrgInfo) {
        credentials.save(creds)
        prefs.enrolledAt = nowIso()
        prefs.revokedNotice = null
        saveOrg(org)
        state.suspendedReason.value = null
        state.enrolled.value = true
        AgentService.start(app)
    }

    fun saveOrg(org: OrgInfo) {
        prefs.orgName = org.name
        prefs.supportEmail = org.supportEmail
        prefs.supportPhone = org.supportPhone
        state.org.value = org
    }

    fun markSynced() {
        val now = nowIso()
        prefs.lastSyncAt = now
        state.lastSyncAt.value = now
    }

    /** Server revoked us (device.revoked, 403 device_revoked): wipe credentials, return to enrollment. */
    fun handleRevoked(reason: String?) {
        if (!state.enrolled.value && !isEnrolled()) return
        val org = state.org.value?.name ?: "Your organisation"
        wipeLocal("$org removed this device from management.${reason?.let { " Reason: $it" } ?: ""}")
    }

    fun handleSuspended(reason: String?) {
        state.suspendedReason.value = reason ?: "Suspended by your organisation"
        screen.stopAll()
    }

    /** Wipes credentials and enrollment state and stops all background work. */
    fun wipeLocal(notice: String?) {
        screen.stopAll()
        connection.stop()
        AgentService.stop(app)
        try { credentials.wipe() } catch (_: Exception) {}
        api.invalidateToken()
        // A fully managed (device owner) device stays managed by this app: only IT can release it
        // (factory reset). Re-enrolling it needs a new enrollment. A plain device admin is deactivated.
        if (!management.isDeviceOwner()) permissions.deactivateDeviceAdmin()
        prefs.clearEnrollment()
        prefs.revokedNotice = notice
        state.enrolled.value = false
        state.org.value = null
        state.suspendedReason.value = null
        state.messages.value = emptyList()
        state.unreadMessages.value = 0
        state.lastSyncAt.value = null
        state.connection.value = ConnectionInfo(ConnPhase.IDLE)
        Notifications.cancel(app, Notifications.ID_AGENT)
        Notifications.cancel(app, Notifications.ID_MESSAGE)
        Notifications.cancel(app, Notifications.ID_CONTROL)
        state.compliance.value = null
        permissions.refresh()
        management.refresh()
    }

    /**
     * Remote wipe accepted (result already sent): stop everything and erase local credentials before the
     * factory reset, so nothing usable survives if the reset is interrupted.
     */
    fun prepareForRemoteWipe() {
        screen.stopAll()
        connection.stop()
        try { credentials.wipeAll() } catch (_: Exception) {}
        api.invalidateToken()
        prefs.clearEnrollment()
        prefs.revokedNotice = "This device was erased by your organisation."
        state.enrolled.value = false
    }

    // ---------------------------------------------------------------- permissions

    fun permissionsPayload(): JSONObject = JSONObject().put(
        "permissions",
        JSONArray(permissions.reportable().map { (k, s) -> JSONObject().put("key", k.wire).put("status", s.wire) })
    )

    /** Called on every resume and on OS callbacks: re-reads the OS and reports to the server. */
    fun reportPermissions() {
        if (!isEnrolled()) { permissions.refresh(); management.refresh(); return }
        permissions.refresh()
        management.reportState()
        if (connection.sendPermissions()) return
        // Socket down: REST fallback.
        appScope.launch {
            try { api.authed("POST", "/api/device/permissions", permissionsPayload()) } catch (_: Exception) {}
        }
    }

    fun reportPermissionsIfChanged() {
        if (permissions.refresh() && isEnrolled()) reportPermissions()
        else if (isEnrolled()) management.reportState() else management.refresh()
    }

    /** RemoteControlService bound or unbound: report the permission and capabilities; end control if lost. */
    fun onAccessibilityChanged() {
        if (!com.mdmplatform.agent.control.RemoteControlService.isBound) screen.onAccessibilityLost()
        reportPermissionsIfChanged()
    }

    /** Device admin enabled/disabled or provisioning finished: mode and capabilities may have changed. */
    fun onManagementChanged() {
        reportPermissionsIfChanged()
        management.reportState()
        if (isEnrolled()) management.sendCompliance()
    }

    // ---------------------------------------------------------------- messages

    suspend fun refreshMessages() {
        if (!isEnrolled()) return
        try {
            val res = api.authed("GET", "/api/device/messages") ?: return
            val arr = res.optJSONArray("messages") ?: return
            state.messages.value = (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(SupportMessage::fromJson) }
                .sortedBy { it.createdAt }
        } catch (e: Exception) {
            Log.w("AppContainer", "messages: ${e.message}")
        }
    }

    suspend fun sendMessage(body: String): SupportMessage? {
        val res = api.authed("POST", "/api/device/messages", JSONObject().put("body", body)) ?: return null
        return res.optJSONObject("message")?.let(SupportMessage::fromJson)?.also { state.addMessage(it) }
    }

    @Volatile var assistTabVisible = false

    fun onIncomingMessage(m: SupportMessage) {
        state.addMessage(m)
        if (!(assistTabVisible && isAppInForeground())) {
            state.unreadMessages.value = state.unreadMessages.value + 1
            if (!m.fromDevice) Notifications.showMessage(app, m)
        }
    }
}
