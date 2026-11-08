package com.mdmplatform.agent.control

import org.json.JSONObject

/**
 * PROTOCOL.md §9 ControlInput. Coordinates are normalised (0..1) to the streamed frame, which is the
 * whole screen scaled, so they map 1:1 onto the real display in its current rotation.
 * Anything malformed parses to null and is dropped.
 */
sealed interface ControlInput {
    data class Tap(val x: Double, val y: Double) : ControlInput
    data class LongPress(val x: Double, val y: Double) : ControlInput
    data class Swipe(val x1: Double, val y1: Double, val x2: Double, val y2: Double, val durationMs: Long) : ControlInput
    data class Global(val action: String) : ControlInput
    data class Text(val text: String) : ControlInput

    companion object {
        val GLOBAL_ACTIONS = setOf("back", "home", "recents", "notifications", "quick_settings")
        const val MAX_TEXT = 500

        fun fromJson(o: JSONObject?): ControlInput? {
            if (o == null) return null
            fun coord(name: String): Double? {
                val v = (o.opt(name) as? Number)?.toDouble() ?: return null
                return if (v.isFinite()) v.coerceIn(0.0, 1.0) else null
            }
            return when (o.optString("kind")) {
                "tap" -> Tap(coord("x") ?: return null, coord("y") ?: return null)
                "long_press" -> LongPress(coord("x") ?: return null, coord("y") ?: return null)
                "swipe" -> Swipe(
                    coord("x1") ?: return null, coord("y1") ?: return null,
                    coord("x2") ?: return null, coord("y2") ?: return null,
                    ((o.opt("durationMs") as? Number)?.toLong() ?: 300L).coerceIn(50L, 3000L),
                )
                "global" -> o.optString("action").takeIf { it in GLOBAL_ACTIONS }?.let(::Global)
                "text" -> o.optString("text").takeIf { it.isNotEmpty() && it.length <= MAX_TEXT }?.let(::Text)
                else -> null
            }
        }
    }
}
