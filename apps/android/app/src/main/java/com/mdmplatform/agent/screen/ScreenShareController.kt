package com.mdmplatform.agent.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.mdmplatform.agent.AppContainer
import com.mdmplatform.agent.agent.SharingSession
import com.mdmplatform.agent.control.ControlInput
import com.mdmplatform.agent.control.RemoteControlService
import com.mdmplatform.agent.core.IceServerSpec
import com.mdmplatform.agent.core.Notifications
import com.mdmplatform.agent.core.ScreenRequest
import com.mdmplatform.agent.core.optStringOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.updateAndGet
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Screen-sharing state machine (PROTOCOL.md §7). The device is always the WebRTC answerer.
 *
 * Consent order is enforced here:
 *   screen.request -> heads-up + in-app consent (Approve/Reject) -> OS MediaProjection dialog
 *   -> FG service (type mediaProjection) in foreground -> capture started -> screen.consent approved.
 *
 * All WebRTC work runs on one thread ([rtc]) so peer connections are never touched concurrently.
 */
class ScreenShareController(private val appContext: Context, private val c: AppContainer) {

    private val rtc = Executors.newSingleThreadExecutor { r -> Thread(r, "mdm-rtc") }

    // WebRTC plumbing, created on first use and kept for the process lifetime.
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null

    // Per sharing session.
    private var request: ScreenRequest? = null
    private var capturer: ProjectionCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null
    private var peer: PeerConnection? = null
    private var remoteDescriptionSet = false
    private val pendingRemoteIce = mutableListOf<IceCandidate>()
    @Volatile private var stopping = false
    private var lastDims: Pair<Int, Int>? = null
    /** What the user chose on the consent screen for the pending request: sessionId -> allow control. */
    @Volatile private var controlChoice: Pair<String, Boolean>? = null

    private val state get() = c.state

    // ------------------------------------------------------------------ requests & consent

    fun onRequest(req: ScreenRequest) {
        if (state.suspendedReason.value != null) {
            sendConsent(req.sessionId, "rejected"); return
        }
        if (c.prefs.screenShareOptIn == false) {
            // User opted out of screen-share requests. The server should not ask; decline if it does.
            sendConsent(req.sessionId, "rejected"); return
        }
        if (state.sharing.value != null) {
            Log.w(TAG, "screen.request while already sharing; ignoring ${req.sessionId}")
            return
        }
        state.pendingScreenRequest.value = req
        Notifications.showScreenRequest(appContext, req)
        if (c.isAppInForeground()) {
            try {
                appContext.startActivity(com.mdmplatform.agent.ui.ConsentActivity.intent(appContext, req.sessionId))
            } catch (e: Exception) { Log.w(TAG, "could not open consent screen", e) }
        }
        // Local expiry in case screen.cancel never arrives (e.g. socket dropped).
        c.launchDelayed(max(1_000L, req.expiresAtMs - System.currentTimeMillis() + 2_000)) {
            if (state.pendingScreenRequest.value?.sessionId == req.sessionId) {
                state.pendingScreenRequest.value = null
                Notifications.cancel(appContext, Notifications.ID_SCREEN_REQUEST)
                state.notice.value = "The screen-sharing request from ${req.requesterName} expired."
            }
        }
    }

    fun pendingRequest(sessionId: String?): ScreenRequest? =
        state.pendingScreenRequest.value?.takeIf { sessionId == null || it.sessionId == sessionId }

    fun reject(sessionId: String) {
        if (state.pendingScreenRequest.value?.sessionId != sessionId) return
        state.pendingScreenRequest.value = null
        Notifications.cancel(appContext, Notifications.ID_SCREEN_REQUEST)
        sendConsent(sessionId, "rejected")
    }

    /**
     * The user tapped one of the approve buttons. Remembered until the OS dialog returns.
     * [allowControl] is only honoured if the admin asked for control.
     */
    fun onApproveTapped(sessionId: String, allowControl: Boolean) {
        controlChoice = sessionId to allowControl
    }

    /** The OS consent intent. Launch it only after the user tapped Approve in our consent UI. */
    fun createOsConsentIntent(): Intent =
        appContext.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent()

    /** Result of the OS MediaProjection dialog. */
    fun onOsResult(sessionId: String, resultCode: Int, data: Intent?) {
        val req = state.pendingScreenRequest.value
        if (req == null || req.sessionId != sessionId) {
            state.notice.value = "That request is no longer active."
            return
        }
        Notifications.cancel(appContext, Notifications.ID_SCREEN_REQUEST)
        if (resultCode != Activity.RESULT_OK || data == null) {
            state.pendingScreenRequest.value = null
            controlChoice = null
            sendConsent(sessionId, "os_denied")
            return
        }
        request = req
        // Start the mediaProjection foreground service; it calls beginCapture() once it is in the foreground.
        ContextCompat.startForegroundService(
            appContext,
            Intent(appContext, ScreenCaptureService::class.java)
                .setAction(ScreenCaptureService.ACTION_START)
                .putExtra(ScreenCaptureService.EXTRA_SESSION_ID, sessionId)
                .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
        )
    }

    /** Called by [ScreenCaptureService] after startForeground(type=mediaProjection). */
    fun beginCapture(sessionId: String, resultData: Intent, onFailed: () -> Unit) = rtc.execute {
        val req = request?.takeIf { it.sessionId == sessionId }
        if (req == null || state.pendingScreenRequest.value?.sessionId != sessionId) {
            Log.w(TAG, "beginCapture for stale session $sessionId")
            onFailed(); return@execute
        }
        try {
            stopping = false
            val f = ensureFactory()
            val helper = SurfaceTextureHelper.create("ScreenCaptureThread", eglBase!!.eglBaseContext)
            val source = f.createVideoSource(/* isScreencast = */ true)
            val cap = ProjectionCapturer(resultData, object : MediaProjection.Callback() {
                override fun onStop() {
                    // Ended by the OS or the system "Stop sharing" chip, not by us.
                    if (!stopping) stopSharing("os_stopped")
                }
            })
            cap.initialize(helper, appContext, source.capturerObserver)
            val (w, h) = captureDims()
            cap.startCapture(w, h, FPS)
            surfaceHelper = helper
            videoSource = source
            capturer = cap
            videoTrack = f.createVideoTrack("screen0", source)
            lastDims = w to h

            // Control needs all three yeses: the admin asked, the user chose "allow control" for THIS
            // session, and the OS accessibility service is enabled and bound right now.
            val userAllowed = controlChoice?.takeIf { it.first == sessionId }?.second == true
            controlChoice = null
            val controlGranted = req.control && userAllowed && RemoteControlService.isBound

            state.pendingScreenRequest.value = null
            val session = SharingSession(
                sessionId = sessionId,
                requesterName = req.requesterName,
                requesterEmail = req.requesterEmail,
                purpose = req.purpose,
                startedAtMs = System.currentTimeMillis(),
                controlRequested = req.control,
                controlGranted = controlGranted,
            )
            state.sharing.value = session
            // Only now, with capture running, tell the server the user approved.
            sendConsent(sessionId, "approved", controlGranted)
            sendMeta(sessionId, w, h)
            updateIndicators(session)
        } catch (e: Exception) {
            Log.e(TAG, "capture failed", e)
            releaseCapture()
            state.pendingScreenRequest.value = null
            c.connection.send("screen.stopped", JSONObject().put("sessionId", sessionId).put("reason", "error"))
            state.notice.value = "Screen sharing could not start: ${e.message ?: "unknown error"}"
            onFailed()
        }
    }

    // ------------------------------------------------------------------ signalling

    fun onOffer(sessionId: String, sdp: String) = rtc.execute {
        val session = state.sharing.value
        val track = videoTrack
        if (session == null || session.sessionId != sessionId || track == null) {
            Log.w(TAG, "rtc.offer for inactive session $sessionId"); return@execute
        }
        // Re-offer (admin reconnect): tear down the old PeerConnection, reuse the running capture.
        closePeer()
        val pc = buildPeer(sessionId) ?: return@execute
        peer = pc
        val sender = pc.addTrack(track, listOf("screen"))
        try {
            val params = sender.parameters
            params.encodings.forEach {
                it.maxBitrateBps = MAX_BITRATE_BPS
                it.maxFramerate = FPS
            }
            sender.parameters = params
        } catch (e: Exception) { Log.w(TAG, "could not cap bitrate", e) }

        pc.setRemoteDescription(object : SdpAdapter("setRemote") {
            override fun onSetSuccess() = rtc.execute(fun() {
                if (peer !== pc) return
                remoteDescriptionSet = true
                pendingRemoteIce.forEach { pc.addIceCandidate(it) }
                pendingRemoteIce.clear()
                pc.createAnswer(object : SdpAdapter("createAnswer") {
                    override fun onCreateSuccess(sdp: SessionDescription) = rtc.execute(fun() {
                        if (peer !== pc) return
                        pc.setLocalDescription(object : SdpAdapter("setLocal") {
                            override fun onSetSuccess() {
                                c.connection.send("rtc.answer", JSONObject().put("sessionId", sessionId).put("sdp", sdp.description))
                            }
                        }, sdp)
                    })
                }, MediaConstraints())
            })
        }, SessionDescription(SessionDescription.Type.OFFER, sdp))
    }

    fun onRemoteIce(sessionId: String, cand: JSONObject) = rtc.execute {
        if (state.sharing.value?.sessionId != sessionId) return@execute
        val candidate = cand.optStringOrNull("candidate") ?: return@execute
        val ice = IceCandidate(cand.optStringOrNull("sdpMid") ?: "", cand.optInt("sdpMLineIndex", 0), candidate)
        val pc = peer
        if (pc == null || !remoteDescriptionSet) pendingRemoteIce.add(ice) else pc.addIceCandidate(ice)
    }

    private fun buildPeer(sessionId: String): PeerConnection? {
        val ice = (request?.iceServers ?: emptyList()).map(::toIceServer)
        val cfg = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        remoteDescriptionSet = false
        return ensureFactory().createPeerConnection(cfg, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                c.connection.send(
                    "rtc.ice", JSONObject().put("sessionId", sessionId).put(
                        "candidate", JSONObject()
                            .put("candidate", candidate.sdp)
                            .put("sdpMid", candidate.sdpMid ?: JSONObject.NULL)
                            .put("sdpMLineIndex", candidate.sdpMLineIndex)
                    )
                )
            }
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
                Log.d(TAG, "peer state $newState")
                val connected = newState == PeerConnection.PeerConnectionState.CONNECTED
                state.sharing.update { s -> if (s?.sessionId == sessionId) s.copy(viewerConnected = connected) else s }
            }
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) = Unit
            override fun onSignalingChange(s: PeerConnection.SignalingState?) = Unit
            override fun onIceConnectionReceivingChange(b: Boolean) = Unit
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) = Unit
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>?) = Unit
            override fun onAddStream(s: MediaStream?) = Unit
            override fun onRemoveStream(s: MediaStream?) = Unit
            override fun onDataChannel(d: DataChannel?) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(r: RtpReceiver?, streams: Array<out MediaStream>?) = Unit
        })
    }

    private fun toIceServer(s: IceServerSpec): PeerConnection.IceServer {
        val b = PeerConnection.IceServer.builder(s.urls)
        if (s.username != null) b.setUsername(s.username)
        if (s.credential != null) b.setPassword(s.credential)
        return b.createIceServer()
    }

    // ------------------------------------------------------------------ rotation

    /** Display rotated: resize the virtual display and tell the admin the new geometry. */
    fun onDisplayChanged() = rtc.execute {
        val session = state.sharing.value ?: return@execute
        val cap = capturer ?: return@execute
        val dims = captureDims()
        if (dims == lastDims) return@execute
        lastDims = dims
        try { cap.changeCaptureFormat(dims.first, dims.second, FPS) } catch (e: Exception) { Log.w(TAG, "resize failed", e) }
        sendMeta(session.sessionId, dims.first, dims.second)
    }

    /** Current screen size scaled so the long edge is at most [MAX_EDGE] px (even numbers for the encoder). */
    private fun captureDims(): Pair<Int, Int> {
        val s = c.telemetry.screen() ?: return 720 to 1280
        val scale = minOf(1.0, MAX_EDGE.toDouble() / max(s.width, s.height))
        fun even(v: Double) = (v.roundToInt() / 2) * 2
        return even(s.width * scale) to even(s.height * scale)
    }

    private fun sendMeta(sessionId: String, w: Int, h: Int) {
        c.connection.send(
            "screen.meta", JSONObject()
                .put("sessionId", sessionId)
                .put("orientation", if (w > h) "landscape" else "portrait")
                .put("width", w)
                .put("height", h)
        )
    }

    // ------------------------------------------------------------------ stopping

    /** Server sent screen.cancel: drop a pending request or stop capture immediately. */
    fun onCancel(sessionId: String, reason: String?) {
        if (state.pendingScreenRequest.value?.sessionId == sessionId) {
            state.pendingScreenRequest.value = null
            Notifications.cancel(appContext, Notifications.ID_SCREEN_REQUEST)
            state.notice.value = when (reason) {
                "consent_timeout" -> "The screen-sharing request expired."
                else -> "The screen-sharing request was withdrawn."
            }
        }
        if (state.sharing.value?.sessionId == sessionId) {
            stopInternal(sendReason = null)
            state.notice.value = "Screen sharing ended by your organisation."
        }
    }

    /** User tapped Stop (banner or notification) or the OS ended the projection. */
    fun stopSharing(reason: String) = stopInternal(sendReason = reason)

    /** Suspension, revocation or unenroll: drop everything without further messages. */
    fun stopAll() {
        if (state.pendingScreenRequest.value != null) {
            state.pendingScreenRequest.value = null
            Notifications.cancel(appContext, Notifications.ID_SCREEN_REQUEST)
        }
        stopInternal(sendReason = null)
    }

    private fun stopInternal(sendReason: String?) {
        val session = state.sharing.value
        stopping = true
        // Clear UI state first so the banner disappears immediately (this also ends control: inputs need a session).
        state.sharing.value = null
        controlChoice = null
        updateIndicators(null)
        if (session != null && sendReason != null) {
            c.connection.send("screen.stopped", JSONObject().put("sessionId", session.sessionId).put("reason", sendReason))
        }
        rtc.execute {
            closePeer()
            releaseCapture()
            request = null
        }
        appContext.stopService(Intent(appContext, ScreenCaptureService::class.java))
    }

    private fun closePeer() {
        try { peer?.dispose() } catch (e: Exception) { Log.w(TAG, "peer dispose", e) }
        peer = null
        remoteDescriptionSet = false
        pendingRemoteIce.clear()
    }

    private fun releaseCapture() {
        stopping = true
        try { capturer?.stopCapture() } catch (e: Exception) { Log.w(TAG, "stopCapture", e) }
        capturer?.dispose(); capturer = null
        videoTrack?.dispose(); videoTrack = null
        videoSource?.dispose(); videoSource = null
        surfaceHelper?.dispose(); surfaceHelper = null
        lastDims = null
    }

    private fun ensureFactory(): PeerConnectionFactory {
        factory?.let { return it }
        val egl = EglBase.create().also { eglBase = it }
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        return PeerConnectionFactory.builder()
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .createPeerConnectionFactory()
            .also { factory = it }
    }

    private fun sendConsent(sessionId: String, decision: String, controlGranted: Boolean = false) {
        c.connection.send(
            "screen.consent",
            JSONObject().put("sessionId", sessionId).put("decision", decision).put("controlGranted", controlGranted),
        )
    }

    // ------------------------------------------------------------------ remote control (§9)

    /**
     * `control.input`. Performed only if ALL hold: it is for the current session, the user granted control
     * for that session, control has not been revoked (by the user or the admin), and the AccessibilityService
     * is connected. Otherwise the input is dropped silently. Inputs are never logged (they may contain text).
     */
    fun onControlInput(sessionId: String, input: JSONObject?) {
        val session = state.sharing.value
        if (session == null || session.sessionId != sessionId || !session.controlGranted) return
        val service = RemoteControlService.instance ?: return
        val parsed = ControlInput.fromJson(input) ?: return
        service.perform(parsed)
    }

    /** Server `control.revoked`: the admin is no longer controlling. Sharing continues view-only. */
    fun onControlRevoked(sessionId: String) {
        var before: SharingSession? = null
        val updated = state.sharing.updateAndGet { s ->
            before = s
            if (s != null && s.sessionId == sessionId && s.controlGranted) s.copy(controlGranted = false) else s
        }
        val session = before ?: return
        if (session.sessionId != sessionId || !session.controlGranted) return
        updateIndicators(updated)
        state.notice.value = "${session.requesterName} is no longer controlling your device. Screen sharing continues."
    }

    /** User tapped Stop control (banner, notification or overlay): keep sharing view-only, tell the server. */
    fun stopControl() {
        var before: SharingSession? = null
        val updated = state.sharing.updateAndGet { s ->
            before = s
            if (s != null && s.controlGranted) s.copy(controlGranted = false) else s
        }
        val session = before ?: return
        if (!session.controlGranted) return
        c.connection.send("control.revoked", JSONObject().put("sessionId", session.sessionId))
        updateIndicators(updated)
    }

    /** The accessibility service was turned off or unbound: control cannot continue. */
    fun onAccessibilityLost() {
        if (state.sharing.value?.controlGranted == true) {
            stopControl()
            state.notice.value = "Remote control stopped because the accessibility service was turned off."
        }
    }

    /** Sharing notification text + the dedicated "Remote control active" notification. */
    private fun updateIndicators(session: SharingSession?) {
        if (session == null) { Notifications.cancel(appContext, Notifications.ID_CONTROL); return }
        Notifications.updateSharing(appContext, session.requesterName, session.controlGranted)
        if (session.controlGranted) Notifications.showControlActive(appContext, session.requesterName)
        else Notifications.cancel(appContext, Notifications.ID_CONTROL)
    }

    private open class SdpAdapter(private val op: String) : SdpObserver {
        override fun onCreateSuccess(sdp: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String?) { Log.e(TAG, "$op failed: $error") }
        override fun onSetFailure(error: String?) { Log.e(TAG, "$op failed: $error") }
    }

    companion object {
        private const val TAG = "ScreenShare"
        const val FPS = 15
        const val MAX_EDGE = 1280
        const val MAX_BITRATE_BPS = 2_500_000
    }
}
