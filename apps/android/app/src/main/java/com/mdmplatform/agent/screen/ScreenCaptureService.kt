package com.mdmplatform.agent.screen

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.IntentCompat
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.Notifications

/**
 * Foreground service of type mediaProjection. Runs only while the user is sharing their screen,
 * and shows the persistent "Sharing your screen" notification with a Stop sharing action.
 *
 * Android 14: startForeground(type=MEDIA_PROJECTION) happens here BEFORE the capturer calls
 * MediaProjectionManager.getMediaProjection(), as the platform requires.
 */
class ScreenCaptureService : Service() {

    private val container by lazy { MdmApp.container(this) }
    private var displayListener: DisplayManager.DisplayListener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
                val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
                val req = container.screen.pendingRequest(sessionId)
                // Always enter the foreground first (startForegroundService contract), even if we then bail out.
                goForeground(req?.requesterName ?: "Your organisation")
                if (sessionId == null || data == null || req == null) {
                    stopSelf(); return START_NOT_STICKY
                }
                registerDisplayListener()
                container.screen.beginCapture(sessionId, data) { stopSelf() }
            }
            ACTION_STOP_CONTROL -> {
                // Keeps view-only sharing running. If nothing is being shared there is nothing to do.
                container.screen.stopControl()
                if (container.state.sharing.value == null) stopSelf()
            }
            ACTION_STOP -> {
                if (container.state.sharing.value != null) container.screen.stopSharing("user_stopped")
                else stopSelf()
            }
            else -> {
                // Restarted without a consent token (e.g. process recreated): nothing to capture.
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun goForeground(requesterName: String) {
        val n = Notifications.sharing(this, requesterName)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
        ServiceCompat.startForeground(this, Notifications.ID_SHARING, n, type)
    }

    private fun registerDisplayListener() {
        if (displayListener != null) return
        val dm = getSystemService(DisplayManager::class.java)
        val l = object : DisplayManager.DisplayListener {
            override fun onDisplayChanged(displayId: Int) {
                if (displayId == android.view.Display.DEFAULT_DISPLAY) container.screen.onDisplayChanged()
            }
            override fun onDisplayAdded(displayId: Int) = Unit
            override fun onDisplayRemoved(displayId: Int) = Unit
        }
        dm.registerDisplayListener(l, Handler(Looper.getMainLooper()))
        displayListener = l
    }

    override fun onDestroy() {
        displayListener?.let { getSystemService(DisplayManager::class.java).unregisterDisplayListener(it) }
        displayListener = null
        // If the system tore the service down while sharing, stop capture and tell the server.
        if (container.state.sharing.value != null) {
            Log.w(TAG, "service destroyed while sharing")
            container.screen.stopSharing("os_stopped")
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ScreenCaptureService"
        const val ACTION_START = "com.mdmplatform.agent.screen.START"
        const val ACTION_STOP = "com.mdmplatform.agent.screen.STOP"
        const val ACTION_STOP_CONTROL = "com.mdmplatform.agent.screen.STOP_CONTROL"
        const val EXTRA_SESSION_ID = "sessionId"
        const val EXTRA_RESULT_DATA = "resultData"
    }
}
