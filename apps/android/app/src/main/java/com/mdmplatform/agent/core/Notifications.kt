package com.mdmplatform.agent.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.mdmplatform.agent.R
import com.mdmplatform.agent.screen.ScreenCaptureService
import com.mdmplatform.agent.ui.ConsentActivity
import com.mdmplatform.agent.ui.MainActivity

object Notifications {
    const val CH_AGENT = "agent"
    const val CH_SCREEN_REQUEST = "screen_request"
    const val CH_SHARING = "sharing"
    const val CH_MESSAGES = "messages"

    const val ID_AGENT = 1
    const val ID_SHARING = 2
    const val ID_SCREEN_REQUEST = 3
    const val ID_MESSAGE = 4
    const val ID_CONTROL = 5
    const val ID_SETUP = 6

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_AGENT, ctx.getString(R.string.channel_agent), NotificationManager.IMPORTANCE_LOW).apply {
                    description = ctx.getString(R.string.channel_agent_desc)
                    setShowBadge(false)
                },
                NotificationChannel(CH_SCREEN_REQUEST, ctx.getString(R.string.channel_screen_request), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = ctx.getString(R.string.channel_screen_request_desc)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
                NotificationChannel(CH_SHARING, ctx.getString(R.string.channel_sharing), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = ctx.getString(R.string.channel_sharing_desc)
                    setSound(null, null)
                    enableVibration(false)
                },
                NotificationChannel(CH_MESSAGES, ctx.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = ctx.getString(R.string.channel_messages_desc)
                },
            )
        )
    }

    private fun openAppIntent(ctx: Context, tab: String? = null): PendingIntent =
        PendingIntent.getActivity(
            ctx, tab.hashCode(),
            Intent(ctx, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                if (tab != null) putExtra(MainActivity.EXTRA_TAB, tab)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun agent(ctx: Context, title: String, text: String): Notification =
        NotificationCompat.Builder(ctx, CH_AGENT)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openAppIntent(ctx))
            .build()

    fun notifyAgent(ctx: Context, text: String) =
        notify(ctx, ID_AGENT, agent(ctx, ctx.getString(R.string.app_name), text))

    private fun stopSharingIntent(ctx: Context): PendingIntent = PendingIntent.getService(
        ctx, 10,
        Intent(ctx, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun stopControlIntent(ctx: Context): PendingIntent = PendingIntent.getService(
        ctx, 11,
        Intent(ctx, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP_CONTROL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun sharing(ctx: Context, requesterName: String, controlActive: Boolean = false): Notification {
        val b = NotificationCompat.Builder(ctx, CH_SHARING)
            .setSmallIcon(R.drawable.ic_stat_screen)
        if (controlActive) {
            b.setContentTitle("Remote control active by $requesterName")
                .setContentText("$requesterName can see and control your screen.")
                .setStyle(NotificationCompat.BigTextStyle().bigText(
                    "$requesterName can see your screen and tap, swipe and type on it. " +
                        "Stop control keeps view-only sharing; Stop sharing ends the session."
                ))
                .addAction(0, "Stop control", stopControlIntent(ctx))
        } else {
            b.setContentTitle("Sharing your screen")
                .setContentText("$requesterName can see your screen. Tap Stop sharing to end.")
                .setStyle(NotificationCompat.BigTextStyle().bigText("$requesterName can see everything on your screen. Tap Stop sharing at any time to end the session."))
        }
        return b
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(true)
            .setColor(0xFFD32F2F.toInt())
            .setColorized(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openAppIntent(ctx, MainActivity.TAB_ASSIST))
            .addAction(0, "Stop sharing", stopSharingIntent(ctx))
            .build()
    }

    /** Re-posts the foreground sharing notification (same id) with the current control state. */
    fun updateSharing(ctx: Context, requesterName: String, controlActive: Boolean) =
        notify(ctx, ID_SHARING, sharing(ctx, requesterName, controlActive))

    /** Separate, high-visibility indicator shown for as long as remote control is active. */
    fun showControlActive(ctx: Context, requesterName: String) {
        val n = NotificationCompat.Builder(ctx, CH_SHARING)
            .setSmallIcon(R.drawable.ic_stat_screen)
            .setContentTitle("Remote control active by $requesterName")
            .setContentText("They can tap, swipe and type on this device. Tap Stop control at any time.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(true)
            .setColor(0xFFD32F2F.toInt())
            .setColorized(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(openAppIntent(ctx, MainActivity.TAB_ASSIST))
            .addAction(0, "Stop control", stopControlIntent(ctx))
            .addAction(0, "Stop sharing", stopSharingIntent(ctx))
            .build()
        notify(ctx, ID_CONTROL, n)
    }

    /** After Android Enterprise provisioning: prompt the user to open the app and finish enrollment. */
    fun showFinishSetup(ctx: Context) {
        val n = NotificationCompat.Builder(ctx, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("Finish setting up this device")
            .setContentText("Open ${ctx.getString(R.string.app_name)} to review your organisation and permissions.")
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx))
            .build()
        notify(ctx, ID_SETUP, n)
    }

    /** True when Android lets us use a full-screen intent (always below 14; user-controlled on 14+). */
    fun canUseFullScreenIntent(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 34) ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent() else true

    fun showScreenRequest(ctx: Context, req: ScreenRequest) {
        val consent = PendingIntent.getActivity(
            ctx, 20,
            ConsentActivity.intent(ctx, req.sessionId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = NotificationCompat.Builder(ctx, CH_SCREEN_REQUEST)
            .setSmallIcon(R.drawable.ic_stat_screen)
            .setContentTitle(
                if (req.control) "${req.requesterName} wants to view and control your screen"
                else "${req.requesterName} wants to view your screen"
            )
            .setContentText(req.purpose.ifBlank { "Tap to review the request" })
            .setStyle(NotificationCompat.BigTextStyle().bigText(
                buildString {
                    if (req.requesterEmail.isNotBlank()) append(req.requesterEmail).append('\n')
                    append(req.purpose.ifBlank { "No reason given." })
                    append("\nNothing is shared unless you approve.")
                }
            ))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter((req.expiresAtMs - System.currentTimeMillis()).coerceIn(5_000, 120_000))
            .setContentIntent(consent)
            .addAction(0, "Review", consent)
        // Degrade gracefully: on Android 14+ the full-screen intent may be disallowed; it is then a plain heads-up.
        if (canUseFullScreenIntent(ctx)) b.setFullScreenIntent(consent, true)
        notify(ctx, ID_SCREEN_REQUEST, b.build())
    }

    fun showMessage(ctx: Context, m: SupportMessage) {
        val n = NotificationCompat.Builder(ctx, CH_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(m.senderName ?: "IT support")
            .setContentText(m.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(m.body))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(ctx, MainActivity.TAB_ASSIST))
            .build()
        notify(ctx, ID_MESSAGE, n)
    }

    fun cancel(ctx: Context, id: Int) = NotificationManagerCompat.from(ctx).cancel(id)

    private fun notify(ctx: Context, id: Int, n: Notification) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return
        try { nm.notify(id, n) } catch (_: SecurityException) { /* POST_NOTIFICATIONS revoked */ }
    }
}
