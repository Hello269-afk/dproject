package com.mdmplatform.agent.management

import com.mdmplatform.agent.core.optStringOrNull
import org.json.JSONArray
import org.json.JSONObject

/** PROTOCOL.md §11 Policy (one per organisation). */
data class Policy(
    val version: Int,
    /** "none" | "low" | "medium" | "high" (DevicePolicyManager password complexity). */
    val passcode: String,
    val maxScreenLockTimeoutSec: Int?,
    val disableCamera: Boolean,
    val disallowUsbDebugging: Boolean,
    val disallowFactoryResetByUser: Boolean,
    /** Compliance check only: the security patch must not be older than this many days. */
    val minAndroidPatchAgeDays: Int?,
) {
    companion object {
        val PASSCODE_LEVELS = listOf("none", "low", "medium", "high")

        fun fromJson(o: JSONObject?): Policy? {
            if (o == null || !o.has("version")) return null
            return Policy(
                version = o.optInt("version", 0),
                passcode = o.optStringOrNull("passcode")?.takeIf { it in PASSCODE_LEVELS } ?: "none",
                maxScreenLockTimeoutSec = o.optIntOrNull("maxScreenLockTimeoutSec")?.takeIf { it > 0 },
                disableCamera = o.optBoolean("disableCamera", false),
                disallowUsbDebugging = o.optBoolean("disallowUsbDebugging", false),
                disallowFactoryResetByUser = o.optBoolean("disallowFactoryResetByUser", false),
                minAndroidPatchAgeDays = o.optIntOrNull("minAndroidPatchAgeDays")?.takeIf { it > 0 },
            )
        }

        private fun JSONObject.optIntOrNull(name: String): Int? =
            if (!has(name) || isNull(name)) null else (opt(name) as? Number)?.toInt()
    }
}

/** PROTOCOL.md §11 Compliance, as sent in the device -> server `compliance` frame. */
data class Compliance(
    val policyVersion: Int?,
    val enforced: Boolean,
    val passcodeSufficient: Boolean?,
    val encrypted: Boolean?,
    val securityPatch: String?,
    val issues: List<String>,
    val checkedAt: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("policyVersion", policyVersion ?: JSONObject.NULL)
        .put("enforced", enforced)
        .put("passcodeSufficient", passcodeSufficient ?: JSONObject.NULL)
        .put("encrypted", encrypted ?: JSONObject.NULL)
        .put("securityPatch", securityPatch ?: JSONObject.NULL)
        .put("issues", JSONArray(issues))
        .put("checkedAt", checkedAt)
}

/** Management mode, ownership and the remote actions this device can perform right now (PROTOCOL.md §8). */
data class ManagementInfo(
    /** "device_owner" | "device_admin" | "none". */
    val mode: String = MODE_NONE,
    /** "company" | "personal" | null when the server has not said. */
    val ownership: String? = null,
    /** Subset of lock, reboot, wipe, remote_control, apply_policy. */
    val capabilities: List<String> = emptyList(),
) {
    val fullyManaged get() = mode == MODE_DEVICE_OWNER
    val companyOwned get() = ownership == "company" || fullyManaged

    companion object {
        const val MODE_DEVICE_OWNER = "device_owner"
        const val MODE_DEVICE_ADMIN = "device_admin"
        const val MODE_NONE = "none"

        const val CAP_LOCK = "lock"
        const val CAP_REBOOT = "reboot"
        const val CAP_WIPE = "wipe"
        const val CAP_REMOTE_CONTROL = "remote_control"
        const val CAP_APPLY_POLICY = "apply_policy"
    }
}
