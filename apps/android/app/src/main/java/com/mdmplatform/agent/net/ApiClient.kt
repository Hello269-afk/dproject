package com.mdmplatform.agent.net

import com.mdmplatform.agent.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** HTTP error from the API, parsed from `{ error: { code, message } }` (PROTOCOL.md intro). */
class ApiException(val httpStatus: Int, val code: String, message: String) : IOException(message)

object ApiUrls {
    /**
     * Normalises a user/link supplied server URL to the API origin (no trailing slash, no /api).
     * Release builds refuse plain http.
     */
    fun normalise(raw: String): String {
        var s = raw.trim()
        if (s.isEmpty()) throw IllegalArgumentException("Enter your server address.")
        if (!s.contains("://")) s = "https://$s"
        val uri = java.net.URI(s)
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") throw IllegalArgumentException("Server address must start with https://")
        if (scheme == "http" && !BuildConfig.ALLOW_CLEARTEXT) {
            throw IllegalArgumentException("This build only connects over HTTPS.")
        }
        if (uri.host.isNullOrBlank()) throw IllegalArgumentException("That server address is not valid.")
        val port = if (uri.port > 0) ":${uri.port}" else ""
        var path = (uri.rawPath ?: "").trimEnd('/')
        if (path.endsWith("/api")) path = path.removeSuffix("/api")
        return "$scheme://${uri.host}$port$path"
    }

    fun wsUrl(apiBase: String, ticket: String): String {
        val base = when {
            apiBase.startsWith("https://") -> "wss://" + apiBase.removePrefix("https://")
            apiBase.startsWith("http://") -> "ws://" + apiBase.removePrefix("http://")
            else -> apiBase
        }
        return "$base/ws?ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8")
    }
}

/**
 * Thin JSON-over-OkHttp client for the device endpoints in PROTOCOL.md §5.
 * [credentialsProvider] and the callbacks are wired by [com.mdmplatform.agent.AppContainer].
 */
class ApiClient(
    private val baseUrlProvider: () -> String?,
    private val credentialsProvider: () -> com.mdmplatform.agent.core.DeviceCredentials?,
    private val onDeviceRevoked: (String) -> Unit,
    private val onDeviceSuspended: (String) -> Unit,
) {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    /** For the WebSocket: no read timeout (the server pings every 20 s, we ping every 25 s). */
    val wsHttp: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    private val json = "application/json; charset=utf-8".toMediaType()

    // ---- token management (POST /api/device/token) ----
    private val tokenMutex = Mutex()
    @Volatile private var accessToken: String? = null
    @Volatile var accessTokenExpiresAtMs: Long = 0L
        private set

    fun invalidateToken() {
        accessToken = null
        accessTokenExpiresAtMs = 0
    }

    /** Returns a valid device access token, refreshing it 2 minutes before expiry. */
    suspend fun token(force: Boolean = false): String = tokenMutex.withLock {
        val now = System.currentTimeMillis()
        val cached = accessToken
        if (!force && cached != null && accessTokenExpiresAtMs - 120_000 > now) return cached
        val creds = credentialsProvider() ?: throw ApiException(401, "not_enrolled", "This device is not enrolled.")
        val res = try {
            request("POST", "/api/device/token", JSONObject().put("deviceId", creds.deviceId).put("deviceSecret", creds.deviceSecret), null)
        } catch (e: ApiException) {
            handleLifecycleError(e)
            throw e
        }
        val t = res?.optString("accessToken").orEmpty()
        if (t.isEmpty()) throw ApiException(500, "bad_response", "Server returned no access token.")
        val expiresIn = res!!.optLong("expiresIn", 3600)
        accessToken = t
        accessTokenExpiresAtMs = System.currentTimeMillis() + expiresIn * 1000
        t
    }

    private fun handleLifecycleError(e: ApiException) {
        if (e.httpStatus != 403) return
        when (e.code) {
            "device_revoked" -> onDeviceRevoked(e.message ?: "device_revoked")
            "device_suspended" -> onDeviceSuspended(e.message ?: "device_suspended")
        }
    }

    /** Unauthenticated call (enrollment endpoints). */
    suspend fun post(path: String, body: JSONObject, baseUrl: String? = null): JSONObject? =
        request("POST", path, body, null, baseUrl)

    /** Device-authenticated call. Retries once with a fresh token on 401. */
    suspend fun authed(method: String, path: String, body: JSONObject? = null): JSONObject? {
        var t = token()
        return try {
            request(method, path, body, t)
        } catch (e: ApiException) {
            if (e.httpStatus == 401) {
                invalidateToken()
                t = token(force = true)
                try { request(method, path, body, t) } catch (e2: ApiException) { handleLifecycleError(e2); throw e2 }
            } else {
                handleLifecycleError(e)
                throw e
            }
        }
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject?,
        bearer: String?,
        baseUrl: String? = null,
    ): JSONObject? = withContext(Dispatchers.IO) {
        val base = baseUrl ?: baseUrlProvider() ?: throw ApiException(0, "no_server", "No server configured.")
        val rb = Request.Builder().url(base + path).header("Accept", "application/json")
        if (bearer != null) rb.header("Authorization", "Bearer $bearer")
        when (method) {
            "GET" -> rb.get()
            else -> rb.method(method, (body ?: JSONObject()).toString().toRequestBody(json))
        }
        http.newCall(rb.build()).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                var code = "http_${resp.code}"
                var msg = "Server error (${resp.code})."
                try {
                    val err = JSONObject(text).optJSONObject("error")
                    if (err != null) {
                        code = err.optString("code", code)
                        msg = err.optString("message", msg)
                    }
                } catch (_: Exception) { /* non-JSON error body */ }
                throw ApiException(resp.code, code, msg)
            }
            if (text.isBlank()) null
            else try { JSONObject(text) } catch (_: Exception) {
                throw ApiException(resp.code, "bad_response", "The server returned an unexpected response. Check the server address.")
            }
        }
    }
}
