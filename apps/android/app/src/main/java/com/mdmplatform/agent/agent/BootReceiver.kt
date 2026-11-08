package com.mdmplatform.agent.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.mdmplatform.agent.MdmApp

/** Restarts the agent connection after reboot or app update, only if the device is enrolled. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (MdmApp.container(context).isEnrolled()) AgentService.start(context)
    }
}
