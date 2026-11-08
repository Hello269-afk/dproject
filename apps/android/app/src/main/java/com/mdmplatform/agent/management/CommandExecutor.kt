package com.mdmplatform.agent.management

import android.app.admin.DeviceAdminInfo
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.util.Log
import com.mdmplatform.agent.AppContainer
import com.mdmplatform.agent.core.optStringOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/**
 * Remote commands (PROTOCOL.md §10): `command` -> perform -> `command.result`.
 *
 * Idempotent per commandId: the result of every handled command is persisted, and a redelivered
 * command is answered from that record without being executed again. Commands run one at a time.
 * Reboot and wipe end the process, so their `succeeded` result is recorded and sent (and the socket
 * given up to 2 s to flush) BEFORE the action.
 */
class CommandExecutor(private val context: Context, private val c: AppContainer) {

    private val mutex = Mutex()
    private val dpm get() = context.getSystemService(DevicePolicyManager::class.java)
    private val dm get() = c.management

    fun onCommand(m: JSONObject) {
        val id = m.optStringOrNull("commandId") ?: return
        val action = m.optString("action")
        val params = m.optJSONObject("params") ?: JSONObject()
        c.appScope.launch(Dispatchers.IO) {
            mutex.withLock {
                try { execute(id, action, params) } catch (e: Exception) {
                    Log.e(TAG, "command $action failed", e)
                    finish(id, FAILED, e.message ?: e.javaClass.simpleName)
                }
            }
        }
    }

    private suspend fun execute(id: String, action: String, params: JSONObject) {
        completed(id)?.let { (status, error) ->
            Log.i(TAG, "command $id ($action) already handled: $status; not executing again")
            sendResult(id, status, error)
            return
        }
        when (action) {
            "lock" -> {
                if (!dm.isDeviceOwner() && !dm.hasAdminPolicy(DeviceAdminInfo.USES_POLICY_FORCE_LOCK)) {
                    return finish(id, UNSUPPORTED, "Lock needs the device admin (with screen lock) or a fully managed device")
                }
                dpm.lockNow()
                finish(id, SUCCEEDED)
            }

            "reboot" -> {
                if (!dm.isDeviceOwner()) return finish(id, UNSUPPORTED, "Reboot is only possible on a fully managed (device owner) device")
                finish(id, SUCCEEDED)
                c.connection.awaitFlush(FLUSH_MS)
                try { dpm.reboot(dm.admin) } catch (e: Exception) {
                    // e.g. IllegalStateException during an ongoing call. Correct the record.
                    finish(id, FAILED, "Reboot refused by Android: ${e.message ?: e.javaClass.simpleName}")
                }
            }

            "wipe" -> {
                if (c.prefs.ownership == "personal") return finish(id, UNSUPPORTED, "Wipe is only allowed on company-owned devices")
                val owner = dm.isDeviceOwner()
                if (!owner && !dm.hasAdminPolicy(DeviceAdminInfo.USES_POLICY_WIPE_DATA)) {
                    return finish(id, UNSUPPORTED, "Wipe needs a fully managed device or the device admin with erase permission")
                }
                // Report first: after the wipe there is no app left to answer.
                finish(id, SUCCEEDED)
                c.connection.awaitFlush(FLUSH_MS)
                c.prepareForRemoteWipe()
                try {
                    if (owner && Build.VERSION.SDK_INT >= 34) dpm.wipeDevice(0) else dpm.wipeData(0)
                } catch (e: Exception) {
                    // Credentials are already gone, so this can no longer be reported to the server.
                    Log.e(TAG, "wipe failed after reporting success", e)
                    c.state.notice.value = "Your organisation asked to erase this device, but Android refused: ${e.message}"
                }
            }

            "apply_policy" -> when (val r = dm.handlePolicy(params)) {
                DeviceManager.PolicyOutcome.Applied -> finish(id, SUCCEEDED)
                is DeviceManager.PolicyOutcome.Failed -> finish(id, FAILED, r.error)
                DeviceManager.PolicyOutcome.NotEnforced -> finish(
                    id, UNSUPPORTED,
                    if (c.prefs.ownership == "personal") "Policies are never enforced on personal devices; compliance is reported only"
                    else "Not a fully managed (device owner) device; compliance is reported only",
                )
                DeviceManager.PolicyOutcome.Invalid -> finish(id, FAILED, "Invalid policy")
            }

            else -> finish(id, UNSUPPORTED, "Unknown action '$action'")
        }
    }

    private fun finish(id: String, status: String, error: String? = null) {
        record(id, status, error)
        sendResult(id, status, error)
    }

    private fun sendResult(id: String, status: String, error: String?) {
        val payload = JSONObject().put("commandId", id).put("status", status)
        if (error != null) payload.put("error", error)
        if (!c.connection.send("command.result", payload)) {
            // Socket down: the server returns the command to pending after 10 min and redelivers it;
            // the persisted record then answers without executing again.
            Log.w(TAG, "command.result for $id not sent (offline)")
        }
    }

    // ------------------------------------------------------------------ persisted results

    @Synchronized
    private fun completed(id: String): Pair<String, String?>? {
        val o = load().optJSONObject(id) ?: return null
        return o.optString("status") to o.optStringOrNull("error")
    }

    @Synchronized
    private fun record(id: String, status: String, error: String?) {
        val all = load()
        all.remove(id)
        all.put(id, JSONObject().put("status", status).put("error", error ?: JSONObject.NULL))
        // Keep the most recent entries (JSONObject keeps insertion order on Android).
        val keys = all.keys().asSequence().toList()
        if (keys.size > MAX_RECORDS) keys.take(keys.size - MAX_RECORDS).forEach { all.remove(it) }
        c.prefs.completedCommands = all.toString()
    }

    private fun load(): JSONObject = try { JSONObject(c.prefs.completedCommands ?: "{}") } catch (_: Exception) { JSONObject() }

    private companion object {
        const val TAG = "Commands"
        const val SUCCEEDED = "succeeded"
        const val FAILED = "failed"
        const val UNSUPPORTED = "unsupported"
        const val FLUSH_MS = 2_000L
        const val MAX_RECORDS = 200
    }
}
