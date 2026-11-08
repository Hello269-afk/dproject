package com.mdmplatform.agent.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.view.Surface
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.ThreadUtils
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import org.webrtc.VideoSink

/**
 * MediaProjection -> WebRTC capturer. A port of org.webrtc.ScreenCapturerAndroid (as used by the
 * prototype) with one change required for Android 14+: the stock capturer's changeCaptureFormat()
 * releases and recreates the VirtualDisplay, and Android 14 only allows one createVirtualDisplay()
 * per MediaProjection (it throws SecurityException on the second call). Here rotation/size
 * changes call VirtualDisplay.resize() instead, so the single-use consent token stays valid.
 */
class ProjectionCapturer(
    private val permissionResultData: Intent,
    private val callback: MediaProjection.Callback,
) : VideoCapturer, VideoSink {

    private var width = 0
    private var height = 0
    private var dpi = 160
    private var virtualDisplay: VirtualDisplay? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var capturerObserver: CapturerObserver? = null
    private var mediaProjection: MediaProjection? = null
    private var projectionManager: MediaProjectionManager? = null
    private var disposed = false

    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        check(!disposed) { "capturer disposed" }
        surfaceTextureHelper = helper
        capturerObserver = observer
        projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        dpi = context.resources.displayMetrics.densityDpi
    }

    /**
     * Must be called while a foreground service of type mediaProjection is already in the
     * foreground (Android 14 requirement for getMediaProjection()).
     */
    @Synchronized
    override fun startCapture(width: Int, height: Int, framerate: Int) {
        check(!disposed) { "capturer disposed" }
        this.width = width
        this.height = height
        val mp = projectionManager!!.getMediaProjection(Activity.RESULT_OK, permissionResultData)
            ?: throw IllegalStateException("MediaProjection unavailable (consent token already used or revoked)")
        mediaProjection = mp
        // Android 14: the callback must be registered before createVirtualDisplay().
        mp.registerCallback(callback, surfaceTextureHelper!!.handler)
        createVirtualDisplay()
        capturerObserver!!.onCapturerStarted(true)
        surfaceTextureHelper!!.startListening(this)
    }

    private fun createVirtualDisplay() {
        val helper = surfaceTextureHelper!!
        helper.setTextureSize(width, height)
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "MdmScreenCapture", width, height, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            Surface(helper.surfaceTexture), null, null,
        )
    }

    @Synchronized
    override fun stopCapture() {
        if (disposed) return
        val helper = surfaceTextureHelper ?: return
        ThreadUtils.invokeAtFrontUninterruptibly(helper.handler, Runnable {
            helper.stopListening()
            capturerObserver?.onCapturerStopped()
            virtualDisplay?.release()
            virtualDisplay = null
            mediaProjection?.let {
                it.unregisterCallback(callback)
                it.stop()
            }
            mediaProjection = null
        })
    }

    /** Rotation / resolution change without creating a second VirtualDisplay. */
    @Synchronized
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        if (disposed) return
        this.width = width
        this.height = height
        val helper = surfaceTextureHelper ?: return
        val vd = virtualDisplay ?: return
        ThreadUtils.invokeAtFrontUninterruptibly(helper.handler, Runnable {
            helper.setTextureSize(width, height)
            vd.resize(width, height, dpi)
        })
    }

    @Synchronized
    override fun dispose() {
        disposed = true
    }

    override fun isScreencast(): Boolean = true

    override fun onFrame(frame: VideoFrame) {
        capturerObserver?.onFrameCaptured(frame)
    }
}
