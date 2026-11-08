package com.mdmplatform.agent.permissions

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle
import android.util.Log
import androidx.core.content.IntentCompat
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.Notifications
import com.mdmplatform.agent.net.ApiUrls

/**
 * Device admin receiver, and the admin component of a fully managed (device owner) device.
 *
 * Policies (res/xml/device_admin.xml): force-lock, wipe-data, limit-password, disable-camera.
 * As a plain device admin, activation is only ever requested through ACTION_ADD_DEVICE_ADMIN and the
 * user can deactivate it in Settings at any time. Device owner comes only from Android Enterprise
 * provisioning on a factory-reset phone (QR code, PROTOCOL.md §8).
 */
class MdmDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) = report(context)
    override fun onDisabled(context: Context, intent: Intent) = report(context)

    /** Android Enterprise provisioning finished: keep the enrollment token from the QR admin extras. */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        Log.i(TAG, "provisioning complete")
        val extras = IntentCompat.getParcelableExtra(
            intent, DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, PersistableBundle::class.java
        )
        saveProvisioningExtras(context, extras)
        Notifications.showFinishSetup(context)
        report(context)
    }

    private fun report(context: Context) {
        MdmApp.container(context).onManagementChanged()
    }

    companion object {
        private const val TAG = "MdmAdmin"
        const val EXTRA_TOKEN = "mdm_token"
        const val EXTRA_API = "mdm_api"

        /**
         * Persists `mdm_token` (encrypted credential store) and `mdm_api` (server URL) from the
         * provisioning admin extras so the app opens straight into enrollment with that token.
         * Called from every provisioning entry point; the first one to see the extras wins.
         */
        fun saveProvisioningExtras(context: Context, extras: PersistableBundle?) {
            if (extras == null) return
            val c = MdmApp.container(context)
            if (c.isEnrolled()) return
            val token = extras.getString(EXTRA_TOKEN)?.trim()?.takeIf { it.isNotEmpty() }
            val api = extras.getString(EXTRA_API)?.let { runCatching { ApiUrls.normalise(it) }.getOrNull() }
            if (token == null || api == null) {
                Log.w(TAG, "provisioning extras missing mdm_token or a valid mdm_api")
                return
            }
            c.prefs.apiBaseUrl = api
            c.credentials.provisioningToken = token
        }
    }
}
