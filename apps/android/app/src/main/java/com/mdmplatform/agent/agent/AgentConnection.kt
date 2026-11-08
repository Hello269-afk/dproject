package com.mdmplatform.agent.agent

import android.util.Log
import com.mdmplatform.agent.AppContainer
import com.mdmplatform.agent.core.OrgInfo
import com.mdmplatform.agent.core.ScreenRequest
import com.mdmplatform.agent.core.SupportMessage
import com.mdmplatform.agent.core.optStringOrNull
import com.mdmplatform.agent.net.ApiException
import com.mdmplatform.agent.net.ApiUrls
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import kotlin.coroutines.coroutineContext
import kotlin.random.Random

/**
 * Device WebSocket (PROTOCOL.md §6): device token -> single-use ticket -> /ws?ticket=...
 * Reconnects with exponential backoff and a fresh ticket every time. Sends an app-level ping
 * every 25 s. Handles close codes 4001 (bad ticket), 4003 (revoked/suspended), 4008 (replaced).
 */
class AgentConnection(private val c: AppContainer) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loopJob: Job? = null
    @Volatile private var socket: WebSocket? = null
    @Volatile private var open = false
    @Volatile private var lastInboundAt = 0L
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val telemetryRequests = Channel<Unit>(Channel.CONFLATED)

    val isOpen get() = open
    private val state get() = c.state

    @Synchronized
    fun start() {
        if (loopJob?.isActive == true) { wakeUp(); return }
        loopJob = scope.launch { loop() }
    }

    @Synchronized
    fun stop() {
        loopJob?.cancel()
        loopJob = null
        open = false
        socket?.close(1000, "agent_stopped")
        socket = null
        state.connection.value = ConnectionInfo(ConnPhase.IDLE)
    }

    /** Skip the current backoff wait (network came back, app opened, user tapped Retry). */
    fun wakeUp() { wake.trySend(Unit) }

    fun send(type: String, payload: JSONObject = JSONObject()): Boolean {
        val ws = socket
        if (!open || ws == null) return false
        return ws.send(payload.put("type", type).toString())
    }

    /** Coalesced telemetry send (significant change). At most one every 5 s. */
    fun requestTelemetry() { telemetryRequests.trySend(Unit) }

    fun sendTelemetryNow(): Boolean {
        val ok = send("telemetry", c.telemetry.collect())
        if (ok) c.markSynced()
        return ok
    }

    fun sendPermissions(): Boolean = send("permissions", c.permissionsPayload())

    /**
     * Waits until OkHttp has handed every queued frame to the OS socket (or [timeoutMs] passed), then a
     * short grace period. Used before reboot/wipe so `command.result` leaves the device first.
     */
    suspend fun awaitFlush(timeoutMs: Long) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val ws = socket ?: return
            if (ws.queueSize() == 0L) break
            delay(50)
        }
        delay(minOf(300L, (deadline - System.currentTimeMillis()).coerceAtLeast(0)))
    }

    // ------------------------------------------------------------------ loop

    private sealed interface Outcome {
        data object Closed : Outcome
        data object Revoked : Outcome
        data class Suspended(val reason: String?) : Outcome
        data object Replaced : Outcome
        data class Failed(val reason: String) : Outcome
    }

    private suspend fun loop() {
        var failures = 0
        var replaced = 0
        while (coroutineContext.isActive) {
            if (!c.isEnrolled()) { state.connection.value = ConnectionInfo(ConnPhase.IDLE); return }
            val outcome = try {
                connectOnce()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                when {
                    e.httpStatus == 403 && e.code == "device_revoked" -> Outcome.Revoked
                    e.httpStatus == 403 && e.code == "device_suspended" -> Outcome.Suspended(e.message)
                    else -> Outcome.Failed(e.message ?: e.code)
                }
            } catch (e: Exception) {
                Outcome.Failed(e.message ?: e.javaClass.simpleName)
            }
            if (outcome !is Outcome.Replaced) replaced = 0
            val waitMs: Long? = when (outcome) {
                Outcome.Revoked -> return // AppContainer.handleRevoked wiped credentials and stops us
                is Outcome.Suspended -> {
                    c.handleSuspended(outcome.reason)
                    state.connection.value = ConnectionInfo(ConnPhase.SUSPENDED, outcome.reason, nextRetryAtMs = System.currentTimeMillis() + SUSPENDED_RETRY_MS)
                    SUSPENDED_RETRY_MS
                }
                Outcome.Replaced -> {
                    replaced++
                    if (replaced >= 3) {
                        state.connection.value = ConnectionInfo(ConnPhase.REPLACED, "This device signed in from another connection.")
                        null // wait for a manual retry
                    } else 30_000L
                }
                Outcome.Closed -> { failures = 0; 1_000L }
                is Outcome.Failed -> {
                    failures++
                    val base = minOf(MAX_BACKOFF_MS, 1_000L shl minOf(failures - 1, 6))
                    base + Random.nextLong(0, base / 2 + 1)
                }
            }
            if (outcome is Outcome.Failed || outcome is Outcome.Closed) {
                state.connection.value = ConnectionInfo(
                    ConnPhase.RECONNECTING,
                    (outcome as? Outcome.Failed)?.reason,
                    nextRetryAtMs = System.currentTimeMillis() + (waitMs ?: 0),
                )
            }
            // Drain stale wake-ups, then wait for the backoff or an explicit wake.
            wake.tryReceive()
            if (waitMs == null) wake.receive() else withTimeoutOrNull(waitMs) { wake.receive() }
        }
    }

    private suspend fun connectOnce(): Outcome {
        state.connection.value = ConnectionInfo(ConnPhase.CONNECTING)
        val base = c.prefs.apiBaseUrl ?: return Outcome.Failed("No server configured")
        val ticket = c.api.authed("POST", "/api/device/ws-ticket")?.optString("ticket").orEmpty()
        if (ticket.isEmpty()) return Outcome.Failed("No ticket")

        val closed = CompletableDeferred<Int>()
        val sessionScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val ws = c.api.wsHttp.newWebSocket(
            Request.Builder().url(ApiUrls.wsUrl(base, ticket)).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    open = true
                    lastInboundAt = System.currentTimeMillis()
                    state.connection.value = ConnectionInfo(ConnPhase.CONNECTED)
                    onConnected(sessionScope)
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    lastInboundAt = System.currentTimeMillis()
                    val msg = try { JSONObject(text) } catch (_: Exception) { return }
                    try { handle(msg) } catch (e: Exception) { Log.e(TAG, "handler failed for ${msg.optString("type")}", e) }
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    open = false
                    webSocket.close(code, null)
                    closed.complete(code)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    open = false
                    closed.complete(code)
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    open = false
                    Log.w(TAG, "socket failure: ${t.message}")
                    closed.complete(-1)
                }
            }
        )
        socket = ws
        val code = try {
            closed.await()
        } finally {
            open = false
            c.management.onDisconnected()
            sessionScope.coroutineContext[Job]?.cancel()
            if (socket === ws) socket = null
            ws.cancel()
        }
        Log.i(TAG, "socket closed with $code")
        return when (code) {
            4003 -> {
                // Revoked or suspended: the token endpoint tells us which (and triggers the wipe if revoked).
                c.api.invalidateToken()
                try {
                    c.api.token(force = true)
                    Outcome.Failed("Connection refused by server")
                } catch (e: ApiException) {
                    when (e.code) {
                        "device_revoked" -> Outcome.Revoked
                        "device_suspended" -> Outcome.Suspended(state.suspendedReason.value ?: e.message)
                        else -> Outcome.Failed(e.message ?: e.code)
                    }
                }
            }
            4008 -> Outcome.Replaced
            4001 -> Outcome.Failed("Ticket rejected")
            1000, 1001 -> Outcome.Closed
            else -> Outcome.Failed(if (code == -1) "Network error" else "Closed ($code)")
        }
    }

    private fun onConnected(s: CoroutineScope) {
        // Initial report. Compliance follows `hello` (which carries the policy).
        sendTelemetryNow()
        sendPermissions()
        c.management.reportState(force = true)
        s.launch { c.refreshMessages() }

        // Compliance every 6 h while connected (PROTOCOL.md §11).
        s.launch {
            while (isActive) {
                delay(COMPLIANCE_MS)
                c.management.sendCompliance()
            }
        }

        // App-level ping every 25 s; drop the socket if nothing arrived for 70 s.
        s.launch {
            while (isActive) {
                delay(PING_MS)
                send("ping")
                if (System.currentTimeMillis() - lastInboundAt > DEAD_MS) {
                    Log.w(TAG, "no traffic for ${DEAD_MS}ms, reconnecting")
                    socket?.cancel()
                }
                // Refresh the device access token ahead of expiry so REST calls never stall.
                if (c.api.accessTokenExpiresAtMs - System.currentTimeMillis() < 5 * 60_000) {
                    try { c.api.token() } catch (_: Exception) {}
                }
            }
        }
        // Periodic telemetry every 60 s.
        s.launch {
            while (isActive) {
                delay(TELEMETRY_MS)
                sendTelemetryNow()
            }
        }
        // Change-triggered telemetry, coalesced.
        s.launch {
            while (isActive) {
                telemetryRequests.receive()
                delay(2_000)
                sendTelemetryNow()
                delay(3_000)
            }
        }
    }

    // ------------------------------------------------------------------ server -> device

    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "pong" -> Unit
            "ping" -> send("pong")
            "hello" -> {
                m.optJSONObject("organization")?.let { o ->
                    c.saveOrg(OrgInfo(o.optString("name"), o.optStringOrNull("supportEmail"), o.optStringOrNull("supportPhone")))
                }
                m.optJSONObject("device")?.let { d ->
                    d.optStringOrNull("name")?.let { c.prefs.deviceName = it; state.deviceName.value = it }
                    val assigned = d.optJSONObject("assignedUser")?.optStringOrNull("name")
                    c.prefs.assignedUserName = assigned
                    state.assignedUserName.value = assigned
                    if (d.optString("lifecycleStatus") == "authenticated") state.suspendedReason.value = null
                    d.optStringOrNull("ownership")?.let { c.prefs.ownership = it }
                }
                c.markSynced()
                // Ownership may change capabilities (wipe is never offered on personal devices).
                c.management.reportState()
                // Store / enforce the org policy (company device owner only), then send compliance.
                c.management.handlePolicy(m.optJSONObject("policy"))
            }
            "policy.updated" -> c.management.handlePolicy(m.optJSONObject("policy"))
            "command" -> c.commands.onCommand(m)
            "control.input" -> m.optStringOrNull("sessionId")?.let { c.screen.onControlInput(it, m.optJSONObject("input")) }
            "control.revoked" -> m.optStringOrNull("sessionId")?.let { c.screen.onControlRevoked(it) }
            "screen.request" -> ScreenRequest.fromJson(m)?.let { c.screen.onRequest(it) }
            "screen.cancel" -> m.optStringOrNull("sessionId")?.let { c.screen.onCancel(it, m.optStringOrNull("reason")) }
            "rtc.offer" -> {
                val sid = m.optStringOrNull("sessionId"); val sdp = m.optStringOrNull("sdp")
                if (sid != null && sdp != null) c.screen.onOffer(sid, sdp)
            }
            "rtc.ice" -> {
                val sid = m.optStringOrNull("sessionId"); val cand = m.optJSONObject("candidate")
                if (sid != null && cand != null) c.screen.onRemoteIce(sid, cand)
            }
            "checkin.request" -> {
                c.permissions.refresh()
                sendTelemetryNow()
                sendPermissions()
            }
            "message" -> m.optJSONObject("message")?.let { c.onIncomingMessage(SupportMessage.fromJson(it)) }
            "device.suspended" -> c.handleSuspended(m.optStringOrNull("reason"))
            "device.revoked" -> c.handleRevoked(m.optStringOrNull("reason"))
            else -> Log.d(TAG, "ignored frame ${m.optString("type")}")
        }
    }

    companion object {
        private const val TAG = "AgentConnection"
        const val PING_MS = 25_000L
        const val DEAD_MS = 70_000L
        const val TELEMETRY_MS = 60_000L
        const val COMPLIANCE_MS = 6 * 60 * 60_000L
        const val MAX_BACKOFF_MS = 60_000L
        const val SUSPENDED_RETRY_MS = 5 * 60_000L
    }
}
