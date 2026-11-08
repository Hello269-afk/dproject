package com.mdmplatform.agent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Indigo = Color(0xFF2F4BDB)
private val IndigoDark = Color(0xFFB9C3FF)

private val LightColors = lightColorScheme(
    primary = Indigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDDE1FF),
    onPrimaryContainer = Color(0xFF001257),
    secondary = Color(0xFF0E7C70),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFC9F0E9),
    onSecondaryContainer = Color(0xFF00201C),
    tertiary = Color(0xFF7A4FBF),
    background = Color(0xFFF6F7FB),
    onBackground = Color(0xFF181B26),
    surface = Color(0xFFF6F7FB),
    onSurface = Color(0xFF181B26),
    surfaceVariant = Color(0xFFE3E5F0),
    onSurfaceVariant = Color(0xFF4A4E5E),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFEFF1F8),
    surfaceContainerHigh = Color(0xFFE9EBF4),
    outline = Color(0xFF777B8C),
    outlineVariant = Color(0xFFD5D8E5),
    error = Color(0xFFC62828),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val DarkColors = darkColorScheme(
    primary = IndigoDark,
    onPrimary = Color(0xFF00218C),
    primaryContainer = Color(0xFF1C35B8),
    onPrimaryContainer = Color(0xFFDDE1FF),
    secondary = Color(0xFF7FD8CB),
    onSecondary = Color(0xFF003731),
    secondaryContainer = Color(0xFF005048),
    onSecondaryContainer = Color(0xFFC9F0E9),
    tertiary = Color(0xFFD6BBFF),
    background = Color(0xFF0F1222),
    onBackground = Color(0xFFE3E4EE),
    surface = Color(0xFF0F1222),
    onSurface = Color(0xFFE3E4EE),
    surfaceVariant = Color(0xFF2B2F42),
    onSurfaceVariant = Color(0xFFC3C6D6),
    surfaceContainerLowest = Color(0xFF0B0D1A),
    surfaceContainerLow = Color(0xFF171A2C),
    surfaceContainer = Color(0xFF1B1F33),
    surfaceContainerHigh = Color(0xFF23273C),
    outline = Color(0xFF8D90A0),
    outlineVariant = Color(0xFF3A3E52),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

/** Semantic status colours used by chips and dots. */
@Immutable
data class StatusColors(
    val success: Color,
    val successContainer: Color,
    val warning: Color,
    val warningContainer: Color,
    val danger: Color,
    val dangerContainer: Color,
    val neutral: Color,
    val neutralContainer: Color,
)

private val LightStatus = StatusColors(
    success = Color(0xFF1B7F3B), successContainer = Color(0xFFD7F5DF),
    warning = Color(0xFF9A5B00), warningContainer = Color(0xFFFFE8C2),
    danger = Color(0xFFC62828), dangerContainer = Color(0xFFFFDAD6),
    neutral = Color(0xFF5A5E70), neutralContainer = Color(0xFFE6E8F0),
)
private val DarkStatus = StatusColors(
    success = Color(0xFF7EDB98), successContainer = Color(0xFF14391F),
    warning = Color(0xFFFFC870), warningContainer = Color(0xFF3F2B00),
    danger = Color(0xFFFFB4AB), dangerContainer = Color(0xFF5C1111),
    neutral = Color(0xFFC3C6D6), neutralContainer = Color(0xFF2B2F42),
)

val LocalStatusColors = staticCompositionLocalOf { LightStatus }

private val AppTypography = Typography().let { t ->
    t.copy(
        headlineMedium = t.headlineMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.25).sp),
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = t.labelLarge.copy(fontWeight = FontWeight.SemiBold),
        labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
    )
}

private val AppShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
)

@Composable
fun MdmTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(LocalStatusColors provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            typography = AppTypography,
            shapes = AppShapes,
            content = content,
        )
    }
}
