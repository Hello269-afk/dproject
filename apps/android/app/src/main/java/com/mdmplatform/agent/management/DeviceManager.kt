package com.mdmplatform.agent.management

import android.app.admin.DeviceAdminInfo
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.UserManager
import android.util.Log
import com.mdmplatform.agent.AppContainer
import com.mdmplatform.agent.control.RemoteControlService
import com.mdmplatform.agent.core.nowIso
import com.mdmplatform.agent.management.ManagementInfo.Companion.CAP_APPLY_POLICY
import com.mdmplatform.agent.management.ManagementInfo.Companion.CAP_LOCK
import com.mdmplatform.agent.management.ManagementInfo.Companion.CAP_REBOOT
import com.mdmplatform.agent.management.ManagementInfo.Companion.CAP_REMOTE_CONTROL
import com.mdmplatform.agent.management.ManagementInfo.Companion.CAP_WIPE
import com.mdmplatform.agent.permissions.MdmDeviceAdminReceiver
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Management mode, capabilities, policy enforcement and compliance (PROTOCOL.md §8, §11).
 *
 * Everything is read from the OS, never assumed:
 *  - managementMode: device_owner when isDeviceOwnerApp(), device_admin when only isAdminActive(), else none.
 *  - capabilities: the remote actions this device can actually perform right now.
 * Policies are enforced only on a company-owned, fully managed (device owner) device. Personal devices
 * never get anything applied; they only evaluate and report compliance.
 */
class DeviceManager(private val context: Context, private val c: AppContainer) {

    val admin = ComponentName(context, MdmDeviceAdminReceiver::class.java)
    private val dpm get() = context.getSystemService(DevicePolicyManager::class.java)
    @Volatile private var lastSentState: String? = null

    fun isDeviceOwner(): Boolean = try { dpm.isDeviceOwnerApp(context.packageName) } catch (_: Exception) { false }
    fun isAdminActive(): Boolean = try { dpm.isAdminActive(admin) } catch (_: Exception) { false }

    /** True when our admin is active and the user granted it [policy] (declared in res/xml/device_admin.xml). */
    fun hasAdminPolicy(policy: Int): Boolean =
        isAdminActive() && try { dpm.hasGrantedPolicy(admin, policy) } catch (_: SecurityException) { false }

    fun managementMode(): String = when {
        isDeviceOwner() -> ManagementInfo.MODE_DEVICE_OWNER
        isAdminActive() -> ManagementInfo.MODE_DEVICE_ADMIN
        else -> ManagementInfo.MODE_NONE
    }

    private val personal get() = c.prefs.ownership == "personal"

    fun capabilities(): List<String> {
        val owner = isDeviceOwner()
        return buildList {
            if (owner || hasAdminPolicy(DeviceAdminInfo.USES_POLICY_FORCE_LOCK)) add(CAP_LOCK)
            if (owner) add(CAP_REBOOT) // DevicePolicyManager.reboot: device owner, API 24+ (minSdk is 26)
            // Wipe: device owner, or a device admin with the wipe-data policy. Never offered on a device the
            // server marked personal (the server also refuses it, PROTOCOL.md §10).
            if (!personal && (owner || hasAdminPolicy(DeviceAdminInfo.USES_POLICY_WIPE_DATA))) add(CAP_WIPE)
            if (RemoteControlService.isBound) add(CAP_REMOTE_CONTROL)
            if (owner) add(CAP_APPLY_POLICY)
        }
    }

    fun refresh(): ManagementInfo {
        val info = ManagementInfo(managementMode(), c.prefs.ownership, capabilities())
        c.state.management.value = info
        return info
    }

    /** `device.state` on connect ([force]) and whenever the mode or capabilities change. */
    fun reportState(force: Boolean = false) {
        val info = refresh()
        val payload = JSONObject().put("managementMode", info.mode).put("capabilities", JSONArray(info.capabilities))
        val key = payload.toString()
        if (!force && key == lastSentState) return
        if (c.connection.send("device.state", payload)) lastSentState = key
    }

    fun onDisconnected() { lastSentState = null }

    // ------------------------------------------------------------------ policy

    fun currentPolicy(): Policy? = c.prefs.policyJson?.let { runCatching { Policy.fromJson(JSONObject(it)) }.getOrNull() }

    /** Enforcement only on a fully managed device the server did not mark personal. */
    fun canEnforce(): Boolean = isDeviceOwner() && !personal

    sealed interface PolicyOutcome {
        data object Applied : PolicyOutcome
        data class Failed(val error: String) : PolicyOutcome
        data object NotEnforced : PolicyOutcome
        data object Invalid : PolicyOutcome
    }

    /**
     * hello.policy, policy.updated and the apply_policy command: store the policy, enforce it when this is
     * a company-owned device owner, then evaluate and send compliance.
     */
    @Synchronized
    fun handlePolicy(json: JSONObject?): PolicyOutcome {
        val policy = Policy.fromJson(json)
        if (policy == null) { sendCompliance(); return PolicyOutcome.Invalid }
        c.prefs.policyJson = json.toString()
        val outcome = if (canEnforce()) apply(policy) else PolicyOutcome.NotEnforced
        sendCompliance()
        return outcome
    }

    private fun apply(p: Policy): PolicyOutcome {
        val errors = mutableListOf<String>()
        fun step(what: String, block: () -> Unit) {
            try { block() } catch (e: Exception) {
                Log.w(TAG, "policy step '$what' failed", e)
                errors += "Could not enforce $what: ${e.message ?: e.javaClass.simpleName}"
            }
        }
        val d = dpm
        step("screen lock strength") {
            if (Build.VERSION.SDK_INT >= 31) {
                d.requiredPasswordComplexity = complexityFor(p.passcode)
            } else {
                setLegacyPasswordQuality(p.passcode)
            }
        }
        step("screen lock timeout") { d.setMaximumTimeToLock(admin, (p.maxScreenLockTimeoutSec ?: 0) * 1000L) }
        step("camera policy") { d.setCameraDisabled(admin, p.disableCamera) }
        step("USB debugging restriction") { restriction(UserManager.DISALLOW_DEBUGGING_FEATURES, p.disallowUsbDebugging) }
        // Company devices only: canEnforce() already excludes devices the server marked personal.
        step("factory reset restriction") { restriction(UserManager.DISALLOW_FACTORY_RESET, p.disallowFactoryResetByUser) }

        c.prefs.appliedPolicyVersion = p.version
        c.prefs.policyApplyErrors = errors
        c.permissions.refresh() // camera may now be restricted_by_os
        return if (errors.isEmpty()) PolicyOutcome.Applied else PolicyOutcome.Failed(errors.joinToString("; "))
    }

    /** Below API 31: the closest password-quality equivalent of the complexity level. */
    @Suppress("DEPRECATION")
    private fun setLegacyPasswordQuality(level: String) {
        val (quality, minLength) = when (level) {
            "low" -> DevicePolicyManager.PASSWORD_QUALITY_SOMETHING to 0
            "medium" -> DevicePolicyManager.PASSWORD_QUALITY_NUMERIC_COMPLEX to 4
            "high" -> DevicePolicyManager.PASSWORD_QUALITY_ALPHANUMERIC to 6
            else -> DevicePolicyManager.PASSWORD_QUALITY_UNSPECIFIED to 0
        }
        dpm.setPasswordQuality(admin, quality)
        dpm.setPasswordMinimumLength(admin, minLength)
    }

    private fun restriction(key: String, on: Boolean) {
        if (on) dpm.addUserRestriction(admin, key) else dpm.clearUserRestriction(admin, key)
    }

    private fun complexityFor(level: String): Int = when (level) {
        "low" -> DevicePolicyManager.PASSWORD_COMPLEXITY_LOW
        "medium" -> DevicePolicyManager.PASSWORD_COMPLEXITY_MEDIUM
        "high" -> DevicePolicyManager.PASSWORD_COMPLEXITY_HIGH
        else -> DevicePolicyManager.PASSWORD_COMPLEXITY_NONE
    }

    // ------------------------------------------------------------------ compliance

    fun computeCompliance(): Compliance {
        val policy = currentPolicy()
        val enforceable = canEnforce()
        val applyErrors = if (enforceable) c.prefs.policyApplyErrors else emptyList()
        val enforced = enforceable && policy != null && c.prefs.appliedPolicyVersion == policy.version && applyErrors.isEmpty()

        val passcodeSufficient: Boolean? = when {
            !isAdminActive() || policy == null -> null
            policy.passcode == "none" -> true
            Build.VERSION.SDK_INT >= 31 && enforced -> complexityAtLeast(policy.passcode)
            enforced -> try { dpm.isActivePasswordSufficient } catch (_: Exception) { null }
            // Not enforced (personal / legacy admin): compare the live complexity with the requirement.
            Build.VERSION.SDK_INT >= 29 -> complexityAtLeast(policy.passcode)
            else -> null // cannot be measured without enforcing a requirement first
        }

        val encrypted: Boolean? = try {
            when (dpm.storageEncryptionStatus) {
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE,
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_PER_USER,
                DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY -> true
                DevicePolicyManager.ENCRYPTION_STATUS_INACTIVE,
                DevicePolicyManager.ENCRYPTION_STATUS_UNSUPPORTED -> false
                else -> null
            }
        } catch (_: Exception) { null }

        val patch = Build.VERSION.SECURITY_PATCH?.takeIf { it.isNotBlank() }
        val issues = mutableListOf<String>()
        if (passcodeSufficient == false) issues += "Screen lock is weaker than required"
        if (encrypted == false) issues += "Device storage is not encrypted"
        policy?.minAndroidPatchAgeDays?.let { maxDays ->
            val date = patch?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            if (date == null) {
                issues += "Security patch level is unknown"
            } else {
                val age = ChronoUnit.DAYS.between(date, LocalDate.now())
                if (age > maxDays) issues += "Security patch ($patch) is $age days old; the limit is $maxDays days"
            }
        }
        issues += applyErrors

        return Compliance(
            policyVersion = if (enforceable) c.prefs.appliedPolicyVersion.takeIf { it >= 0 } else policy?.version,
            enforced = enforced,
            passcodeSufficient = passcodeSufficient,
            encrypted = encrypted,
            securityPatch = patch,
            issues = issues,
            checkedAt = nowIso(),
        )
    }

    private fun complexityAtLeast(level: String): Boolean? {
        if (Build.VERSION.SDK_INT < 29) return null
        return try { dpm.passwordComplexity >= complexityFor(level) } catch (_: Exception) { null }
    }

    /** Evaluates compliance, publishes it to the UI and sends it if connected. */
    fun sendCompliance() {
        val comp = computeCompliance()
        c.state.compliance.value = comp
        c.connection.send("compliance", comp.toJson())
    }

    private companion object { const val TAG = "DeviceManager" }
}
