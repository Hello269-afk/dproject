package com.mdmplatform.agent.agent

import com.mdmplatform.agent.core.OrgInfo
import com.mdmplatform.agent.core.ScreenRequest
import com.mdmplatform.agent.core.SupportMessage
import com.mdmplatform.agent.management.Compliance
import com.mdmplatform.agent.management.ManagementInfo
import kotlinx.coroutines.flow.MutableStateFlow

enum class ConnPhase {
    /** Not enrolled, or the agent is stopped. */
    IDLE,
    CONNECTING,
    CONNECTED,
    /** Lost the socket; waiting before the next attempt. */
    RECONNECTING,
    /** Organisation suspended this device (403 device_suspended / close 4003). */
    SUSPENDED,
    /** Another connection with this device's credentials took over (close 4008). */
    REPLACED,
}

data class ConnectionInfo(
    val phase: ConnPhase,
    val detail: String? = null,
    val sinceMs: Long = System.currentTimeMillis(),
    val nextRetryAtMs: Long? = null,
)

data class SharingSession(
    val sessionId: String,
    val requesterName: String,
    val requesterEmail: String,
    val purpose: String,
    val startedAtMs: Long,
    /** True once a peer connection to the admin is up. */
    val viewerConnected: Boolean = false,
    /** The admin asked for remote control in this session (PROTOCOL.md §9). */
    val controlRequested: Boolean = false,
    /**
     * The user approved control for THIS session and has not turned it off, and the admin has not
     * given it up. Inputs are only performed while this is true (and the AccessibilityService is bound).
     */
    val controlGranted: Boolean = false,
)

/** Process-wide observable state, written by the agent/screen layers and read by the UI. */
class AgentState {
    val enrolled = MutableStateFlow(false)
    val connection = MutableStateFlow(ConnectionInfo(ConnPhase.IDLE))
    val suspendedReason = MutableStateFlow<String?>(null)
    val org = MutableStateFlow<OrgInfo?>(null)
    val deviceName = MutableStateFlow<String?>(null)
    val assignedUserName = MutableStateFlow<String?>(null)
    val lastSyncAt = MutableStateFlow<String?>(null)
    val messages = MutableStateFlow<List<SupportMessage>>(emptyList())
    val unreadMessages = MutableStateFlow(0)
    val pendingScreenRequest = MutableStateFlow<ScreenRequest?>(null)
    val sharing = MutableStateFlow<SharingSession?>(null)
    /** Management mode, ownership and the remote actions possible right now (PROTOCOL.md §8). */
    val management = MutableStateFlow(ManagementInfo())
    /** Last compliance evaluation (PROTOCOL.md §11). */
    val compliance = MutableStateFlow<Compliance?>(null)
    /** One-shot user-facing notice, e.g. "Request expired". */
    val notice = MutableStateFlow<String?>(null)

    fun addMessage(m: SupportMessage) {
        val cur = messages.value
        if (cur.any { it.id == m.id }) return
        messages.value = (cur + m).sortedBy { it.createdAt }
    }
}
