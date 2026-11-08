package com.mdmplatform.agent.telemetry

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.display.DisplayManager
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.telephony.TelephonyManager
import android.util.DisplayMetrics
import android.view.Display
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.Inet4Address
import java.time.Instant

/**
 * Builds a PROTOCOL.md §3 Telemetry object from real OS sources only.
 * Any value the OS does not give us is sent as JSON null. Nothing is estimated or faked.
 */
class TelemetryCollector(private val context: Context) {

    data class Battery(val pct: Int?, val charging: Boolean?)

    fun battery(intent: Intent? = null): Battery {
        val i = intent ?: context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return Battery(null, null)
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        val pct = if (level >= 0 && scale > 0) Math.round(level * 100f / scale) else null
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = when (status) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }
        return Battery(pct, charging)
    }

    data class Screen(val width: Int, val height: Int) {
        val orientation get() = if (width > height) "landscape" else "portrait"
    }

    /** Physical display size in its current rotation. */
    fun screen(): Screen? = try {
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val m = DisplayMetrics()
        @Suppress("DEPRECATION")
        display.getRealMetrics(m)
        if (m.widthPixels > 0 && m.heightPixels > 0) Screen(m.widthPixels, m.heightPixels) else null
    } catch (_: Exception) { null }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun collect(): JSONObject {
        val o = JSONObject()
        fun put(k: String, v: Any?) { o.put(k, v ?: JSONObject.NULL) }

        val b = battery()
        put("batteryPct", b.pct)
        put("charging", b.charging)

        // Network
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val active = cm?.activeNetwork
        val caps = active?.let { cm.getNetworkCapabilities(it) }
        val networkType = when {
            cm == null -> null
            active == null || caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
        put("networkType", networkType)
        put("wifiSsid", if (networkType == "wifi") wifiSsid() else null)
        put("carrier", carrier())
        put("ipAddress", active?.let { cm.getLinkProperties(it) }?.let { lp ->
            val addrs = lp.linkAddresses.map { it.address }.filter { !it.isLoopbackAddress && !it.isLinkLocalAddress }
            (addrs.firstOrNull { it is Inet4Address } ?: addrs.firstOrNull())?.hostAddress?.substringBefore('%')
        })

        // Storage (internal /data partition)
        try {
            val st = StatFs(Environment.getDataDirectory().path)
            put("storageTotalBytes", st.totalBytes)
            put("storageFreeBytes", st.availableBytes)
        } catch (_: Exception) {
            put("storageTotalBytes", null); put("storageFreeBytes", null)
        }

        // Memory
        try {
            val am = context.getSystemService(ActivityManager::class.java)
            val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            put("memoryTotalBytes", mi.totalMem.takeIf { it > 0 })
            put("memoryAvailBytes", mi.availMem.takeIf { it > 0 })
        } catch (_: Exception) {
            put("memoryTotalBytes", null); put("memoryAvailBytes", null)
        }

        val s = screen()
        put("screenWidth", s?.width)
        put("screenHeight", s?.height)
        put("orientation", s?.orientation)

        put("location", lastLocation()?.let { loc ->
            JSONObject()
                .put("lat", loc.latitude)
                .put("lng", loc.longitude)
                .put("accuracyM", if (loc.hasAccuracy()) loc.accuracy.toDouble() else JSONObject.NULL)
                .put("at", Instant.ofEpochMilli(loc.time).toString())
        })

        o.put("reportedAt", Instant.now().toString())
        return o
    }

    /** Only with a location permission (Android redacts the SSID otherwise). */
    @SuppressLint("MissingPermission")
    private fun wifiSsid(): String? {
        if (!hasLocationPermission()) return null
        return try {
            val wm = context.applicationContext.getSystemService(WifiManager::class.java) ?: return null
            @Suppress("DEPRECATION")
            val raw = wm.connectionInfo?.ssid ?: return null
            val ssid = raw.removeSurrounding("\"")
            if (ssid.isBlank() || ssid == WifiManager.UNKNOWN_SSID.removeSurrounding("\"") || raw == WifiManager.UNKNOWN_SSID) null else ssid
        } catch (_: Exception) { null }
    }

    private fun carrier(): String? = try {
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) null
        else context.getSystemService(TelephonyManager::class.java)?.networkOperatorName?.takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }

    /** Newest last-known fix across providers. No active location request is made. */
    @SuppressLint("MissingPermission")
    private fun lastLocation(): Location? {
        if (!hasLocationPermission()) return null
        return try {
            val lm = context.getSystemService(LocationManager::class.java) ?: return null
            val providers = buildList {
                if (Build.VERSION.SDK_INT >= 31) add(LocationManager.FUSED_PROVIDER)
                add(LocationManager.GPS_PROVIDER)
                add(LocationManager.NETWORK_PROVIDER)
                add(LocationManager.PASSIVE_PROVIDER)
            }
            providers.mapNotNull { p -> try { lm.getLastKnownLocation(p) } catch (_: Exception) { null } }
                .maxByOrNull { it.time }
        } catch (_: Exception) { null }
    }
}
