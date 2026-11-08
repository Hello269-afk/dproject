package com.mdmplatform.agent.ui.enroll

import android.app.Application
import android.net.Uri
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.mdmplatform.agent.BuildConfig
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.agent.ConnPhase
import com.mdmplatform.agent.core.DeviceCredentials
import com.mdmplatform.agent.core.OrgInfo
import com.mdmplatform.agent.core.PermissionDefinition
import com.mdmplatform.agent.core.PermissionKey
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.core.optStringOrNull
import com.mdmplatform.agent.net.ApiException
import com.mdmplatform.agent.net.ApiUrls
import com.mdmplatform.agent.ui.permissions.fallbackDefinition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

enum class EnrollStep { ENTRY, INSPECTING, REVIEW, PERMISSIONS, COMPLETING, SUCCESS }

data class InspectResult(
    val enrollmentId: String?,
    val org: OrgInfo,
    val assignedUserName: String?,
    val deviceNameHint: String?,
    val expiresAt: String?,
    val definitions: List<PermissionDefinition>,
    val required: Set<PermissionKey>,
)

data class EnrollUiState(
    val step: EnrollStep = EnrollStep.ENTRY,
    val error: String? = null,
    val serverInput: String = "",
    val codeInput: String = "",
    val apiBase: String? = null,
    val inspect: InspectResult? = null,
    val deviceName: String = "",
    /** 0 = recording review, 1 = authenticating, 2 = securing credentials, 3 = connecting, 4 = done. */
    val completingStage: Int = 0,
    val connectedAtFinish: Boolean = false,
    val revokedNotice: String? = null,
)

/** A parsed enrollment link: either a token from a link/QR, with the API origin it implies. */
data class EnrollLink(val token: String, val apiBase: String?)

/**
 * Authentication flow (PROTOCOL.md §5):
 * inspect -> permissions review -> permissions-reviewed -> complete -> store credentials -> connect.
 * The enrollment token / pairing code is held in memory only.
 */
class EnrollmentViewModel(app: Application) : AndroidViewModel(app) {
    private val c = MdmApp.container(app)
    private val _ui = MutableStateFlow(
        EnrollUiState(
            serverInput = c.prefs.apiBaseUrl.orEmpty(),
            revokedNotice = c.prefs.revokedNotice,
        )
    )
    val ui: StateFlow<EnrollUiState> = _ui.asStateFlow()

    private var token: String? = null
    private var pairingCode: String? = null

    init { resumeProvisioning() }

    /**
     * Company-owned device provisioned from a QR code (PROTOCOL.md §8): the admin extras carried the
     * enrollment token and API URL. Start the normal flow with them; the user still reviews the
     * organisation and the permissions.
     */
    fun resumeProvisioning() {
        if (c.isEnrolled() || _ui.value.step != EnrollStep.ENTRY) return
        val t = runCatching { c.credentials.provisioningToken }.getOrNull() ?: return
        val base = c.prefs.apiBaseUrl ?: return
        start(base, token = t, code = null)
    }

    private fun isProvisioningToken(t: String?) = t != null && runCatching { c.credentials.provisioningToken }.getOrNull() == t

    private fun forgetProvisioningToken() { runCatching { c.credentials.provisioningToken = null } }

    // ---------------------------------------------------------------- entry points

    fun onLink(uri: Uri) {
        val link = parseLink(uri)
        if (link == null) {
            _ui.update { it.copy(error = "That link is not a valid enrollment link.") }
            return
        }
        if (_ui.value.step == EnrollStep.COMPLETING || _ui.value.step == EnrollStep.SUCCESS) return
        val base = link.apiBase
        if (base == null) {
            token = link.token; pairingCode = null
            _ui.update { it.copy(step = EnrollStep.ENTRY, error = "The link did not include a server address. Enter it below to continue.") }
            return
        }
        start(base, token = link.token, code = null)
    }

    fun onQrScanned(raw: String) {
        val uri = try { Uri.parse(raw.trim()) } catch (_: Exception) { null }
        if (uri == null) { _ui.update { it.copy(error = "That QR code is not an enrollment code.") }; return }
        onLink(uri)
    }

    fun onServerInput(v: String) = _ui.update { it.copy(serverInput = v, error = null) }

    fun onCodeInput(v: String) {
        val clean = v.uppercase().filter { it.isLetterOrDigit() }.take(8)
        val formatted = if (clean.length > 4) clean.substring(0, 4) + "-" + clean.substring(4) else clean
        _ui.update { it.copy(codeInput = formatted, error = null) }
    }

    fun submitManual() {
        val s = _ui.value
        val base = try { ApiUrls.normalise(s.serverInput) } catch (e: IllegalArgumentException) {
            _ui.update { it.copy(error = e.message) }; return
        }
        // A token from a link that lacked the server address takes precedence over a code.
        val pendingToken = token
        if (pendingToken != null && s.codeInput.isBlank()) { start(base, pendingToken, null); return }
        if (!Regex("^[A-Z0-9]{4}-[A-Z0-9]{4}$").matches(s.codeInput)) {
            _ui.update { it.copy(error = "Enter the 8-character pairing code, like ABCD-1234.") }; return
        }
        start(base, token = null, code = s.codeInput)
    }

    fun dismissError() = _ui.update { it.copy(error = null) }

    /** Picks up a notice written while we were enrolled (revocation, unenroll). */
    fun refreshNotice() = _ui.update { it.copy(revokedNotice = c.prefs.revokedNotice, serverInput = it.serverInput.ifBlank { c.prefs.apiBaseUrl.orEmpty() }) }
    fun dismissRevokedNotice() { c.prefs.revokedNotice = null; _ui.update { it.copy(revokedNotice = null) } }

    fun reset() {
        // "This isn't my organisation" on a provisioned device: do not resume that token again.
        if (isProvisioningToken(token)) forgetProvisioningToken()
        token = null; pairingCode = null
        _ui.update { EnrollUiState(serverInput = it.serverInput) }
    }

    // ---------------------------------------------------------------- inspect

    private fun start(base: String, token: String?, code: String?) {
        this.token = token
        this.pairingCode = code
        _ui.update { it.copy(step = EnrollStep.INSPECTING, error = null, apiBase = base, serverInput = base) }
        viewModelScope.launch {
            try {
                val res = c.api.post("/api/device/enroll/inspect", credentialBody(), baseUrl = base)
                    ?: throw ApiException(500, "bad_response", "Empty response from server.")
                val org = res.optJSONObject("organization")
                val defs = PermissionDefinition.listFromJson(res.optJSONArray("requestedPermissions"))
                val required = res.optJSONArray("requiredPermissions").toKeys()
                val inspect = InspectResult(
                    enrollmentId = res.optStringOrNull("enrollmentId"),
                    org = OrgInfo(org?.optString("name").orEmpty().ifBlank { "Your organisation" }, org?.optStringOrNull("supportEmail"), org?.optStringOrNull("supportPhone")),
                    assignedUserName = res.optStringOrNull("assignedUserName"),
                    deviceNameHint = res.optStringOrNull("deviceNameHint"),
                    expiresAt = res.optStringOrNull("expiresAt"),
                    // Required keys missing from the definitions still need to be shown.
                    definitions = defs + required.filter { k -> defs.none { it.key == k } }.map(::fallbackDefinition),
                    required = required.toSet(),
                )
                c.prefs.apiBaseUrl = base
                // Fresh enrollment: forget a previous opt-in decision.
                c.prefs.screenShareOptIn = null
                c.permissions.refresh()
                _ui.update {
                    it.copy(
                        step = EnrollStep.REVIEW,
                        inspect = inspect,
                        deviceName = inspect.deviceNameHint ?: Build.MODEL,
                    )
                }
            } catch (e: Exception) {
                if (e is ApiException && e.code in TERMINAL_CODES && isProvisioningToken(token)) forgetProvisioningToken()
                _ui.update { it.copy(step = EnrollStep.ENTRY, error = describe(e, base)) }
            }
        }
    }

    fun onDeviceName(v: String) = _ui.update { it.copy(deviceName = v.take(80)) }

    fun toPermissions() {
        if (_ui.value.deviceName.isBlank()) { _ui.update { it.copy(error = "Enter a name for this device.") }; return }
        _ui.update { it.copy(step = EnrollStep.PERMISSIONS, error = null) }
    }

    fun backToReview() = _ui.update { it.copy(step = EnrollStep.REVIEW, error = null) }

    /** Required permissions that still block continuing (not_supported never blocks: it cannot be granted here). */
    fun missingRequired(): List<PermissionKey> {
        val inspect = _ui.value.inspect ?: return emptyList()
        val states = c.permissions.states.value
        return inspect.required.filter {
            val st = states[it]?.status
            st != PermissionStatus.GRANTED && st != PermissionStatus.NOT_SUPPORTED
        }
    }

    // ---------------------------------------------------------------- complete

    fun complete() {
        val inspect = _ui.value.inspect ?: return
        if (missingRequired().isNotEmpty()) {
            _ui.update { it.copy(error = "Grant the required permissions to continue.") }; return
        }
        // Skipping the screen-sharing question means "don't allow requests".
        if (inspect.definitions.any { it.key == PermissionKey.SCREEN_CAPTURE } && c.prefs.screenShareOptIn == null) {
            c.permissions.setScreenShareOptIn(false)
        }
        c.prefs.requestedPermissions = inspect.definitions.map { it.key }
        c.prefs.requiredPermissions = inspect.required.toList()
        c.permissions.refresh()
        val base = _ui.value.apiBase ?: return
        _ui.update { it.copy(step = EnrollStep.COMPLETING, completingStage = 0, error = null) }

        viewModelScope.launch {
            try {
                val perms = permissionsArray()
                c.api.post("/api/device/enroll/permissions-reviewed", credentialBody().put("permissions", perms), baseUrl = base)
                _ui.update { it.copy(completingStage = 1) }

                val device = JSONObject()
                    .put("name", _ui.value.deviceName.trim())
                    .put("platform", "android")
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("model", Build.MODEL)
                    .put("osVersion", Build.VERSION.RELEASE)
                    .put("appVersion", BuildConfig.VERSION_NAME)
                    // PROTOCOL.md §8: reported, never assumed. Ownership comes from the enrollment server-side.
                    .put("managementMode", c.management.managementMode())
                val res = c.api.post(
                    "/api/device/enroll/complete",
                    credentialBody()
                        .put("installationId", c.prefs.installationId)
                        .put("device", device)
                        .put("permissions", permissionsArray()),
                    baseUrl = base,
                ) ?: throw ApiException(500, "bad_response", "Empty response from server.")
                val deviceId = res.optStringOrNull("deviceId")
                val secret = res.optStringOrNull("deviceSecret")
                if (deviceId == null || secret == null) throw ApiException(500, "bad_response", "The server did not return device credentials.")
                _ui.update { it.copy(completingStage = 2) }

                val orgJson = res.optJSONObject("organization")
                val org = if (orgJson != null) OrgInfo(
                    orgJson.optStringOrNull("name") ?: inspect.org.name,
                    orgJson.optStringOrNull("supportEmail") ?: inspect.org.supportEmail,
                    orgJson.optStringOrNull("supportPhone") ?: inspect.org.supportPhone,
                ) else inspect.org
                c.prefs.permissionDefinitions = inspect.definitions
                c.prefs.deviceName = _ui.value.deviceName.trim()
                c.prefs.assignedUserName = inspect.assignedUserName
                c.state.deviceName.value = c.prefs.deviceName
                c.state.assignedUserName.value = inspect.assignedUserName
                if (isProvisioningToken(token)) forgetProvisioningToken()
                token = null; pairingCode = null
                c.onEnrolled(DeviceCredentials(deviceId, secret), org)
                _ui.update { it.copy(completingStage = 3, revokedNotice = null) }

                val connected = withTimeoutOrNull(15_000) {
                    c.state.connection.first { it.phase == ConnPhase.CONNECTED }
                } != null
                _ui.update { it.copy(completingStage = 4, step = EnrollStep.SUCCESS, connectedAtFinish = connected) }
            } catch (e: Exception) {
                if (e is ApiException && e.code in TERMINAL_CODES && isProvisioningToken(token)) forgetProvisioningToken()
                _ui.update { it.copy(step = EnrollStep.PERMISSIONS, error = describe(e, base)) }
            }
        }
    }

    private fun permissionsArray(): JSONArray {
        val keys = _ui.value.inspect?.definitions?.map { it.key } ?: emptyList()
        c.permissions.refresh()
        return JSONArray(keys.map { JSONObject().put("key", it.wire).put("status", c.permissions.status(it).wire) })
    }

    private fun credentialBody(): JSONObject = JSONObject().apply {
        token?.let { put("token", it) }
        pairingCode?.let { put("pairingCode", it) }
    }

    private fun JSONArray?.toKeys(): List<PermissionKey> =
        (0 until (this?.length() ?: 0)).mapNotNull { PermissionKey.fromWire(this!!.optString(it)) }

    private fun describe(e: Exception, base: String): String = when {
        e is ApiException && e.code == "enrollment_not_found" -> "This enrollment link or code was not found. Check it and try again."
        e is ApiException && e.code == "enrollment_expired" -> "This enrollment has expired. Ask your IT team for a new one."
        e is ApiException && e.code == "enrollment_revoked" -> "This enrollment was cancelled by your organisation."
        e is ApiException && e.code == "enrollment_used" -> "This enrollment has already been used on another device."
        e is ApiException && e.httpStatus == 429 -> "Too many attempts. Wait a minute and try again."
        e is ApiException && e.httpStatus > 0 -> e.message ?: "Server error."
        e is java.net.UnknownHostException -> "Could not find the server at $base."
        e is javax.net.ssl.SSLException -> "Secure connection to $base failed."
        e is java.io.IOException -> "Could not reach $base. Check your connection and the server address."
        else -> e.message ?: "Something went wrong."
    }

    companion object {
        private val TERMINAL_CODES = setOf("enrollment_not_found", "enrollment_expired", "enrollment_revoked", "enrollment_used")

        /**
         * Accepts:
         *  - mdm://enroll?token=...&api=<urlencoded api base>
         *  - https://<host>/enroll/<token>[?api=...]  (API origin defaults to the link origin)
         */
        fun parseLink(uri: Uri): EnrollLink? {
            val scheme = uri.scheme?.lowercase() ?: return null
            if (scheme == "mdm") {
                if (uri.host != "enroll") return null
                val t = uri.getQueryParameter("token")?.takeIf { it.isNotBlank() } ?: return null
                val api = uri.getQueryParameter("api")?.let { runCatching { ApiUrls.normalise(it) }.getOrNull() }
                return EnrollLink(t, api)
            }
            if (scheme != "https" && scheme != "http") return null
            val segs = uri.pathSegments
            val i = segs.indexOf("enroll")
            if (i < 0 || i + 1 >= segs.size) return null
            val t = segs[i + 1].takeIf { it.isNotBlank() } ?: return null
            val apiParam = uri.getQueryParameter("api")
            val origin = "$scheme://${uri.host}${if (uri.port > 0) ":${uri.port}" else ""}"
            val api = runCatching { ApiUrls.normalise(apiParam ?: origin) }.getOrNull()
            return EnrollLink(t, api)
        }
    }
}
