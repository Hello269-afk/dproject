package com.mdmplatform.agent.core

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import java.util.UUID

data class DeviceCredentials(val deviceId: String, val deviceSecret: String)

/**
 * Device credentials in Keystore-backed EncryptedSharedPreferences (AES-256-GCM values,
 * AES-256-SIV keys, master key in the Android Keystore). Never backed up (see
 * data_extraction_rules.xml and allowBackup=false).
 */
class CredentialStore(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            "mdm_secure_credentials",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun get(): DeviceCredentials? {
        val id = prefs.getString(KEY_ID, null) ?: return null
        val secret = prefs.getString(KEY_SECRET, null) ?: return null
        return DeviceCredentials(id, secret)
    }

    fun save(creds: DeviceCredentials) {
        prefs.edit().putString(KEY_ID, creds.deviceId).putString(KEY_SECRET, creds.deviceSecret).commit()
    }

    fun updateSecret(secret: String) {
        prefs.edit().putString(KEY_SECRET, secret).commit()
    }

    fun wipe() {
        // Keeps a pending provisioning token: it belongs to the next enrollment, not this one.
        val pending = provisioningToken
        prefs.edit().clear().apply { if (pending != null) putString(KEY_PROVISIONING_TOKEN, pending) }.commit()
    }

    /**
     * Enrollment token handed over by Android Enterprise provisioning (admin extras `mdm_token`).
     * Single use: cleared once enrollment completes or the server rejects it for good.
     */
    var provisioningToken: String?
        get() = prefs.getString(KEY_PROVISIONING_TOKEN, null)
        set(v) {
            val e = prefs.edit()
            if (v == null) e.remove(KEY_PROVISIONING_TOKEN) else e.putString(KEY_PROVISIONING_TOKEN, v)
            e.commit()
        }

    /** Erases everything, including a pending provisioning token (remote wipe). */
    fun wipeAll() {
        prefs.edit().clear().commit()
    }

    private companion object {
        const val KEY_ID = "deviceId"
        const val KEY_SECRET = "deviceSecret"
        const val KEY_PROVISIONING_TOKEN = "provisioningToken"
    }
}

/** Non-secret app state. */
class AppPrefs(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("mdm_app", Context.MODE_PRIVATE)

    /** Stable per-install identifier, generated once. Survives unenroll so the server can correlate re-enrollments. */
    val installationId: String
        get() = p.getString("installationId", null) ?: UUID.randomUUID().toString().also {
            p.edit().putString("installationId", it).apply()
        }

    var apiBaseUrl: String?
        get() = p.getString("apiBaseUrl", null)
        set(v) = p.edit().putString("apiBaseUrl", v).apply()

    var orgName: String?
        get() = p.getString("orgName", null)
        set(v) = p.edit().putString("orgName", v).apply()
    var supportEmail: String?
        get() = p.getString("supportEmail", null)
        set(v) = p.edit().putString("supportEmail", v).apply()
    var supportPhone: String?
        get() = p.getString("supportPhone", null)
        set(v) = p.edit().putString("supportPhone", v).apply()
    var assignedUserName: String?
        get() = p.getString("assignedUserName", null)
        set(v) = p.edit().putString("assignedUserName", v).apply()
    var deviceName: String?
        get() = p.getString("deviceName", null)
        set(v) = p.edit().putString("deviceName", v).apply()
    var enrolledAt: String?
        get() = p.getString("enrolledAt", null)
        set(v) = p.edit().putString("enrolledAt", v).apply()
    var lastSyncAt: String?
        get() = p.getString("lastSyncAt", null)
        set(v) = p.edit().putString("lastSyncAt", v).apply()
    var credentialsRotatedAt: String?
        get() = p.getString("credentialsRotatedAt", null)
        set(v) = p.edit().putString("credentialsRotatedAt", v).apply()

    /** Server-reported ownership (PROTOCOL.md §8): "company" | "personal" | null (unknown / older server). */
    var ownership: String?
        get() = p.getString("ownership", null)
        set(v) = p.edit().putString("ownership", v).apply()

    /** Last organisation policy received (hello.policy, policy.updated, apply_policy), raw JSON. */
    var policyJson: String?
        get() = p.getString("policyJson", null)
        set(v) = p.edit().putString("policyJson", v).apply()

    /** Policy version this device last enforced as device owner (-1 = never). */
    var appliedPolicyVersion: Int
        get() = p.getInt("appliedPolicyVersion", -1)
        set(v) = p.edit().putInt("appliedPolicyVersion", v).apply()

    /** Problems from the last policy application, shown as compliance issues. */
    var policyApplyErrors: List<String>
        get() = p.getString("policyApplyErrors", "")!!.split('\n').filter { it.isNotBlank() }
        set(v) = p.edit().putString("policyApplyErrors", v.joinToString("\n")).apply()

    /**
     * Results of commands this device already handled, keyed by commandId, oldest first (JSON object).
     * Makes commands idempotent: a redelivered lock or wipe is answered from here, not executed again.
     */
    var completedCommands: String?
        get() = p.getString("completedCommands", null)
        set(v) = p.edit().putString("completedCommands", v).apply()

    /** The user agreed to the in-app accessibility disclosure (shown before sending them to Settings). */
    var accessibilityDisclosureAccepted: Boolean
        get() = p.getBoolean("accessibilityDisclosureAccepted", false)
        set(v) = p.edit().putBoolean("accessibilityDisclosureAccepted", v).apply()

    /** Shown once on the enrollment screen after the org removed this device. */
    var revokedNotice: String?
        get() = p.getString("revokedNotice", null)
        set(v) = p.edit().putString("revokedNotice", v).apply()

    var requestedPermissions: List<PermissionKey>
        get() = keyList("requestedPermissions")
        set(v) = putKeyList("requestedPermissions", v)
    var requiredPermissions: List<PermissionKey>
        get() = keyList("requiredPermissions")
        set(v) = putKeyList("requiredPermissions", v)

    var permissionDefinitions: List<PermissionDefinition>
        get() = try {
            PermissionDefinition.listFromJson(JSONArray(p.getString("permissionDefinitions", "[]")))
        } catch (_: Exception) { emptyList() }
        set(v) = p.edit().putString("permissionDefinitions", JSONArray(v.map { it.toJson() }).toString()).apply()

    /** screen_capture opt-in: null = never answered, true = org may ask, false = opted out. */
    var screenShareOptIn: Boolean?
        get() = if (p.contains("screenShareOptIn")) p.getBoolean("screenShareOptIn", false) else null
        set(v) {
            if (v == null) p.edit().remove("screenShareOptIn").apply()
            else p.edit().putBoolean("screenShareOptIn", v).apply()
        }

    /** Whether we have ever shown the OS dialog / settings page for a key (distinguishes not_requested from denied). */
    fun wasRequested(key: PermissionKey) = p.getBoolean("requested_${key.wire}", false)
    fun markRequested(key: PermissionKey) = p.edit().putBoolean("requested_${key.wire}", true).apply()

    /** User chose "don't ask again" (or denied twice) for a runtime permission. Recomputed on every request result. */
    fun isBlocked(key: PermissionKey) = p.getBoolean("blocked_${key.wire}", false)
    fun setBlocked(key: PermissionKey, blocked: Boolean) = p.edit().putBoolean("blocked_${key.wire}", blocked).apply()

    fun lastStatus(key: PermissionKey): String? = p.getString("status_${key.wire}", null)
    fun statusUpdatedAt(key: PermissionKey): String? = p.getString("statusAt_${key.wire}", null)
    fun setStatus(key: PermissionKey, status: String, at: String) =
        p.edit().putString("status_${key.wire}", status).putString("statusAt_${key.wire}", at).apply()

    /** Clears enrollment-scoped state. Keeps installationId and the last server URL (for convenience). */
    fun clearEnrollment() {
        val keep = mapOf(
            "installationId" to p.getString("installationId", null),
            "apiBaseUrl" to p.getString("apiBaseUrl", null),
            "revokedNotice" to p.getString("revokedNotice", null),
            // Command ids survive re-enrollment so a redelivered command is never executed twice.
            "completedCommands" to p.getString("completedCommands", null),
        )
        val e = p.edit().clear()
        keep.forEach { (k, v) -> if (v != null) e.putString(k, v) }
        e.commit()
    }

    private fun keyList(name: String): List<PermissionKey> =
        p.getString(name, "")!!.split(',').mapNotNull { PermissionKey.fromWire(it) }

    private fun putKeyList(name: String, v: List<PermissionKey>) =
        p.edit().putString(name, v.joinToString(",") { it.wire }).apply()
}
