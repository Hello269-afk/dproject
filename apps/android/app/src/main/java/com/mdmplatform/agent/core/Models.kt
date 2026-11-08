package com.mdmplatform.agent.core

import org.json.JSONArray
import org.json.JSONObject

/** PROTOCOL.md §2 PermissionKey. */
enum class PermissionKey(val wire: String) {
    SCREEN_CAPTURE("screen_capture"),
    CAMERA("camera"),
    MICROPHONE("microphone"),
    LOCATION("location"),
    NOTIFICATIONS("notifications"),
    ACCESSIBILITY("accessibility"),
    DEVICE_ADMIN("device_admin"),
    FILES("files"),
    USAGE_ACCESS("usage_access"),
    BACKGROUND("background");

    companion object {
        fun fromWire(s: String?): PermissionKey? = entries.firstOrNull { it.wire == s }
    }
}

/** PROTOCOL.md §2 PermissionStatus. */
enum class PermissionStatus(val wire: String) {
    NOT_REQUESTED("not_requested"),
    AWAITING_APPROVAL("awaiting_approval"),
    GRANTED("granted"),
    DENIED("denied"),
    RESTRICTED_BY_OS("restricted_by_os"),
    REVOKED("revoked"),
    NOT_SUPPORTED("not_supported");
}

/** PROTOCOL.md §3 PermissionDefinition (Android part only is used by this app). */
data class PermissionDefinition(
    val key: PermissionKey,
    val name: String,
    val description: String,
    val why: String,
    val androidSupported: Boolean,
    val androidMechanism: String,
    val androidNotes: String,
    val manageInstructions: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("key", key.wire)
        .put("name", name)
        .put("description", description)
        .put("why", why)
        .put(
            "android", JSONObject()
                .put("supported", androidSupported)
                .put("mechanism", androidMechanism)
                .put("notes", androidNotes)
        )
        .put("manageInstructions", JSONObject().put("android", manageInstructions))

    companion object {
        fun fromJson(o: JSONObject): PermissionDefinition? {
            val key = PermissionKey.fromWire(o.optString("key")) ?: return null
            val android = o.optJSONObject("android")
            return PermissionDefinition(
                key = key,
                name = o.optStringOrNull("name") ?: key.wire,
                description = o.optStringOrNull("description") ?: "",
                why = o.optStringOrNull("why") ?: "",
                androidSupported = android?.optBoolean("supported", true) ?: true,
                androidMechanism = android?.optStringOrNull("mechanism") ?: "",
                androidNotes = android?.optStringOrNull("notes") ?: "",
                manageInstructions = o.optJSONObject("manageInstructions")?.optStringOrNull("android") ?: "",
            )
        }

        fun listFromJson(arr: JSONArray?): List<PermissionDefinition> =
            (0 until (arr?.length() ?: 0)).mapNotNull { i -> arr?.optJSONObject(i)?.let(::fromJson) }
    }
}

data class OrgInfo(
    val name: String,
    val supportEmail: String?,
    val supportPhone: String?,
)

/** PROTOCOL.md §3 SupportMessage. */
data class SupportMessage(
    val id: String,
    val direction: String,
    val senderName: String?,
    val body: String,
    val createdAt: String,
) {
    val fromDevice get() = direction == "from_device"

    companion object {
        fun fromJson(o: JSONObject) = SupportMessage(
            id = o.optString("id"),
            direction = o.optString("direction"),
            senderName = o.optStringOrNull("senderName"),
            body = o.optString("body"),
            createdAt = o.optString("createdAt"),
        )
    }
}

/** Parsed RTCIceServer from `screen.request.iceServers`. */
data class IceServerSpec(val urls: List<String>, val username: String?, val credential: String?) {
    companion object {
        fun listFromJson(arr: JSONArray?): List<IceServerSpec> {
            if (arr == null) return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val urls = when (val u = o.opt("urls")) {
                    is JSONArray -> (0 until u.length()).map { u.optString(it) }
                    is String -> listOf(u)
                    else -> emptyList()
                }.filter { it.isNotBlank() }
                if (urls.isEmpty()) null
                else IceServerSpec(urls, o.optStringOrNull("username"), o.optStringOrNull("credential"))
            }
        }
    }
}

/** `screen.request` payload. */
data class ScreenRequest(
    val sessionId: String,
    val requesterName: String,
    val requesterEmail: String,
    val purpose: String,
    val expiresAt: String,
    val iceServers: List<IceServerSpec>,
    /** PROTOCOL.md §9: the admin also asks to control the device (the user may still approve view-only). */
    val control: Boolean = false,
    val receivedAtMs: Long = System.currentTimeMillis(),
) {
    /**
     * Local deadline. Uses the server's expiresAt unless the device clock is clearly skewed
     * (deadline in the past or more than 5 min away), then falls back to the 60 s consent window.
     */
    val expiresAtMs: Long get() {
        val server = parseIsoMillis(expiresAt)
        return if (server != null && server > receivedAtMs + 5_000 && server < receivedAtMs + 300_000) server
        else receivedAtMs + 60_000
    }

    companion object {
        fun fromJson(o: JSONObject): ScreenRequest? {
            val sid = o.optStringOrNull("sessionId") ?: return null
            val by = o.optJSONObject("requestedBy")
            return ScreenRequest(
                sessionId = sid,
                requesterName = by?.optStringOrNull("name") ?: "An administrator",
                requesterEmail = by?.optStringOrNull("email") ?: "",
                purpose = o.optStringOrNull("purpose") ?: "",
                expiresAt = o.optStringOrNull("expiresAt") ?: "",
                iceServers = IceServerSpec.listFromJson(o.optJSONArray("iceServers")),
                control = o.optBoolean("control", false),
            )
        }
    }
}

fun JSONObject.optStringOrNull(name: String): String? =
    if (!has(name) || isNull(name)) null else optString(name).takeIf { it.isNotEmpty() }

fun nowIso(): String = java.time.Instant.now().toString()

fun parseIsoMillis(s: String?): Long? = try {
    if (s.isNullOrBlank()) null else java.time.Instant.parse(s).toEpochMilli()
} catch (_: Exception) {
    try { java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli() } catch (_: Exception) { null }
}
