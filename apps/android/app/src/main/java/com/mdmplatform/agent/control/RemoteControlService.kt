package com.mdmplatform.agent.control

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.SharingSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Remote control (PROTOCOL.md §9). Only the user can enable this, in system Settings > Accessibility;
 * nothing in this app (device owner or not) turns it on.
 *
 * It does nothing on its own. It performs an input only when [com.mdmplatform.agent.screen.ScreenShareController]
 * hands one over, which happens only for the current screen session, after the user approved control for
 * that session, while control is not revoked. It never reads, stores or sends accessibility events or
 * screen content; window content is only queried to find the focused text field for typed text.
 *
 * While control is active it also draws a "Remote control active" bar over every app (an accessibility
 * overlay, no extra permission) with a one-tap Stop control.
 */
class RemoteControlService : AccessibilityService() {

    private val container by lazy { MdmApp.container(this) }
    private val main = Handler(Looper.getMainLooper())
    private var scope: CoroutineScope? = null
    private var overlay: View? = null
    private var overlayLabel: TextView? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "accessibility service connected")
        val s = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).also { scope = it }
        s.launch {
            container.state.sharing
                .map { it?.takeIf { session -> session.controlGranted } }
                .distinctUntilChanged()
                .collect { updateOverlay(it) }
        }
        container.onAccessibilityChanged()
    }

    override fun onUnbind(intent: Intent?): Boolean {
        tearDown()
        container.onAccessibilityChanged()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        tearDown()
        super.onDestroy()
    }

    private fun tearDown() {
        if (instance === this) instance = null
        scope?.cancel(); scope = null
        updateOverlay(null)
    }

    /** Events are never read: the config subscribes to the minimum and this ignores them. */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    // ------------------------------------------------------------------ inputs

    /** Performs one input. The caller has already checked session, consent and revocation. */
    fun perform(input: ControlInput) = main.post {
        val ok = try {
            when (input) {
                is ControlInput.Tap -> gesture(point(input.x, input.y), TAP_MS)
                is ControlInput.LongPress -> gesture(point(input.x, input.y), LONG_PRESS_MS)
                is ControlInput.Swipe -> {
                    val (x1, y1) = toPixels(input.x1, input.y1)
                    val (x2, y2) = toPixels(input.x2, input.y2)
                    gesture(Path().apply { moveTo(x1, y1); lineTo(x2, y2) }, input.durationMs)
                }
                is ControlInput.Global -> performGlobalAction(
                    when (input.action) {
                        "back" -> GLOBAL_ACTION_BACK
                        "home" -> GLOBAL_ACTION_HOME
                        "recents" -> GLOBAL_ACTION_RECENTS
                        "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                        else -> GLOBAL_ACTION_QUICK_SETTINGS
                    }
                )
                is ControlInput.Text -> typeText(input.text)
            }
        } catch (e: Exception) {
            Log.w(TAG, "input failed", e); false
        }
        if (!ok) Log.d(TAG, "input not performed: ${input.javaClass.simpleName}")
    }

    private fun point(x: Double, y: Double): Path {
        val (px, py) = toPixels(x, y)
        return Path().apply { moveTo(px, py) }
    }

    /**
     * Normalised -> real pixels using the CURRENT real display size, which already reflects the
     * current rotation (the stream is the full screen, scaled, in the same orientation).
     */
    private fun toPixels(x: Double, y: Double): Pair<Float, Float> {
        val m = DisplayMetrics()
        val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        @Suppress("DEPRECATION")
        display.getRealMetrics(m)
        val w = m.widthPixels.coerceAtLeast(1)
        val h = m.heightPixels.coerceAtLeast(1)
        return (x * (w - 1)).toFloat().coerceIn(0f, (w - 1).toFloat()) to (y * (h - 1)).toFloat().coerceIn(0f, (h - 1).toFloat())
    }

    private fun gesture(path: Path, durationMs: Long): Boolean {
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        return dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    /**
     * Appends [text] to the focused editable field with ACTION_SET_TEXT. Falls back to clipboard +
     * ACTION_PASTE only if SET_TEXT fails (or for password fields, whose current text cannot be read).
     */
    private fun typeText(text: String): Boolean {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return false
        if (!node.isEditable) return false
        if (!node.isPassword) {
            val existing = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
            val combined = existing + text
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, combined)
            }
            if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                node.performAction(
                    AccessibilityNodeInfo.ACTION_SET_SELECTION,
                    Bundle().apply {
                        putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, combined.length)
                        putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, combined.length)
                    },
                )
                return true
            }
        }
        val clip = ClipData.newPlainText("Remote input", text)
        if (Build.VERSION.SDK_INT >= 33) {
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        }
        getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
    }

    // ------------------------------------------------------------------ indicator

    private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).roundToInt()

    private fun updateOverlay(session: SharingSession?) {
        val wm = getSystemService(WindowManager::class.java)
        if (session == null) {
            overlay?.let { runCatching { wm.removeView(it) } }
            overlay = null; overlayLabel = null
            return
        }
        val text = "Remote control active by ${session.requesterName}"
        overlayLabel?.let { it.text = text; return }
        val label = TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(dp(14), dp(8), dp(10), dp(8))
            maxLines = 1
        }
        val stop = TextView(this).apply {
            this.text = "Stop control"
            setTextColor(Color.rgb(0xC6, 0x28, 0x28))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(dp(12), dp(6), dp(12), dp(6))
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(16).toFloat() }
            isClickable = true
            contentDescription = "Stop remote control"
            setOnClickListener { container.screen.stopControl() }
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(2), dp(4), dp(8), dp(4))
            background = GradientDrawable().apply { setColor(Color.argb(0xF0, 0xC6, 0x28, 0x28)); cornerRadius = dp(24).toFloat() }
            addView(label)
            addView(stop)
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(40) // below the status bar
        }
        try {
            wm.addView(bar, lp)
            overlay = bar; overlayLabel = label
        } catch (e: Exception) {
            Log.w(TAG, "could not show control indicator", e)
        }
    }

    companion object {
        private const val TAG = "RemoteControl"
        const val TAP_MS = 50L
        const val LONG_PRESS_MS = 700L

        /** Set while the system has this service bound (enabled by the user AND running). Cleared on unbind/destroy. */
        @SuppressLint("StaticFieldLeak")
        @Volatile var instance: RemoteControlService? = null
            private set

        val isBound: Boolean get() = instance != null

        /** The user switched the service on in Settings (it may not be bound yet). */
        fun isEnabledInSettings(context: Context): Boolean {
            val flat = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
                ?: return false
            val me = ComponentName(context, RemoteControlService::class.java)
            return flat.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }
}
