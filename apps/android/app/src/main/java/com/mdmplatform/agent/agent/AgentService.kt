package com.mdmplatform.agent.agent

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Foreground service (type dataSync) that keeps the agent WebSocket alive and watches for
 * significant changes (battery, charging, network, orientation) to push telemetry.
 */
class AgentService : Service() {

    private val container by lazy { MdmApp.container(this) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var lastBatteryPct: Int? = null
    private var lastCharging: Boolean? = null
    private var lastOrientation: Int? = null
    private var batteryReceiver: BroadcastReceiver? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        goForeground("Connecting…")
        lastOrientation = resources.configuration.orientation
        registerBattery()
        registerNetwork()
        scope.launch {
            combine(container.state.connection, container.state.org, container.state.suspendedReason) { conn, org, susp ->
                Triple(conn, org, susp)
            }.collect { (conn, org, susp) ->
                val orgName = org?.name ?: "your organisation"
                val text = when {
                    susp != null -> "Suspended by $orgName"
                    conn.phase == ConnPhase.CONNECTED -> "Connected to $orgName"
                    conn.phase == ConnPhase.CONNECTING -> "Connecting to $orgName…"
                    conn.phase == ConnPhase.REPLACED -> "Signed in elsewhere. Open the app to reconnect."
                    else -> "Offline. Reconnecting to $orgName…"
                }
                Notifications.notifyAgent(this@AgentService, text)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!container.isEnrolled()) {
            stopSelf(); return START_NOT_STICKY
        }
        container.connection.start()
        return START_STICKY
    }

    private fun goForeground(text: String) {
        val n = Notifications.agent(this, getString(com.mdmplatform.agent.R.string.app_name), text)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, Notifications.ID_AGENT, n, type)
    }

    private fun registerBattery() {
        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val b = container.telemetry.battery(intent)
                val pctChanged = b.pct != null && lastBatteryPct != null && kotlin.math.abs(b.pct - lastBatteryPct!!) >= 1
                val chargingChanged = lastCharging != null && b.charging != lastCharging
                lastBatteryPct = b.pct
                lastCharging = b.charging
                if (pctChanged || chargingChanged) container.connection.requestTelemetry()
            }
        }
        ContextCompat.registerReceiver(this, r, IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        batteryReceiver = r
    }

    private fun registerNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                container.connection.wakeUp()
                container.connection.requestTelemetry()
            }
            override fun onLost(network: Network) = container.connection.requestTelemetry()
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = container.connection.requestTelemetry()
            override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = container.connection.requestTelemetry()
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (_: Exception) { }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (newConfig.orientation != lastOrientation) {
            lastOrientation = newConfig.orientation
            container.connection.requestTelemetry()
        }
    }

    override fun onDestroy() {
        batteryReceiver?.let { try { unregisterReceiver(it) } catch (_: Exception) {} }
        netCallback?.let { try { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, AgentService::class.java))
            } catch (e: Exception) {
                // Android 12+ may refuse a background FGS start; the app retries on next open.
                android.util.Log.w("AgentService", "could not start: ${e.message}")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AgentService::class.java))
        }
    }
}
