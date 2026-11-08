package com.mdmplatform.agent.ui.enroll

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.core.PermissionStatus
import com.mdmplatform.agent.ui.components.InfoRow
import com.mdmplatform.agent.ui.components.ProgressChecklist
import com.mdmplatform.agent.ui.components.SectionCard
import com.mdmplatform.agent.ui.components.StepProgress
import com.mdmplatform.agent.ui.components.formatDateTime
import com.mdmplatform.agent.ui.permissions.PermissionRow
import com.mdmplatform.agent.ui.permissions.rememberPermissionRequester

private val STEPS = listOf("Verify enrollment", "Review organisation", "Review permissions", "Authenticate")

@Composable
fun EnrollmentFlow(vm: EnrollmentViewModel, onFinished: () -> Unit) {
    val ui by vm.ui.collectAsState()
    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().navigationBarsPadding().imePadding()
    ) {
        val stepIndex = when (ui.step) {
            EnrollStep.ENTRY, EnrollStep.INSPECTING -> 0
            EnrollStep.REVIEW -> 1
            EnrollStep.PERMISSIONS -> 2
            EnrollStep.COMPLETING -> 3
            EnrollStep.SUCCESS -> 4
        }
        if (ui.step != EnrollStep.SUCCESS) {
            StepProgress(STEPS, stepIndex, Modifier.padding(horizontal = 24.dp, vertical = 16.dp))
        }
        AnimatedContent(targetState = ui.step, label = "enroll") { step ->
            when (step) {
                EnrollStep.ENTRY -> EntryScreen(vm, ui)
                EnrollStep.INSPECTING -> BusyScreen("Verifying enrollment…", ui.apiBase)
                EnrollStep.REVIEW -> ReviewScreen(vm, ui)
                EnrollStep.PERMISSIONS -> PermissionsReviewScreen(vm, ui)
                EnrollStep.COMPLETING -> CompletingScreen(ui)
                EnrollStep.SUCCESS -> SuccessScreen(ui, onFinished)
            }
        }
    }
}

@Composable
private fun ErrorBanner(text: String?, onDismiss: () -> Unit) {
    if (text == null) return
    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ErrorOutline, null, tint = MaterialTheme.colorScheme.onErrorContainer)
            Spacer(Modifier.width(10.dp))
            Text(text, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onDismiss) { Text("OK") }
        }
    }
    Spacer(Modifier.height(16.dp))
}

@Composable
private fun EntryScreen(vm: EnrollmentViewModel, ui: EnrollUiState) {
    val context = LocalContext.current
    var scanError by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
        Spacer(Modifier.height(8.dp))
        Box(
            Modifier.size(64.dp).background(
                Brush.linearGradient(listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.tertiary)), CircleShape
            ),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Outlined.Shield, null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(32.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Enroll this device", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "Connect this device to your organisation. You will see exactly what is requested before anything is shared.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        ui.revokedNotice?.let {
            Surface(color = MaterialTheme.colorScheme.surfaceContainerHigh, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Info, null)
                    Spacer(Modifier.width(10.dp))
                    Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = vm::dismissRevokedNotice) { Text("Dismiss") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        ErrorBanner(ui.error ?: scanError) { vm.dismissError(); scanError = null }

        Button(
            onClick = {
                scanError = null
                val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                GmsBarcodeScanning.getClient(context, options).startScan()
                    .addOnSuccessListener { code -> code.rawValue?.let(vm::onQrScanned) }
                    .addOnFailureListener { e ->
                        scanError = "The QR scanner is unavailable (${e.message ?: "Google Play services required"}). Use the pairing code instead."
                    }
            },
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Icon(Icons.Outlined.QrCodeScanner, null)
            Spacer(Modifier.width(10.dp))
            Text("Scan enrollment QR code")
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Scanning runs in Google Play services. This app does not get camera access.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline,
        )

        Spacer(Modifier.height(28.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            Text("  or enter a pairing code  ", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
            HorizontalDivider(Modifier.weight(1f))
        }
        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = ui.serverInput,
            onValueChange = vm::onServerInput,
            label = { Text("Server address") },
            placeholder = { Text("https://mdm.yourcompany.com") },
            leadingIcon = { Icon(Icons.Outlined.Link, null) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = ui.codeInput,
            onValueChange = vm::onCodeInput,
            label = { Text("Pairing code") },
            placeholder = { Text("XXXX-XXXX") },
            singleLine = true,
            textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace, letterSpacing = 3.sp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Go),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(16.dp))
        OutlinedButton(onClick = vm::submitManual, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Continue") }
        Spacer(Modifier.height(24.dp))
        Text(
            "You can also open the enrollment link your IT team sent you on this device.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun BusyScreen(text: String, sub: String?) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        Spacer(Modifier.height(20.dp))
        Text(text, style = MaterialTheme.typography.titleMedium)
        if (sub != null) {
            Spacer(Modifier.height(6.dp))
            Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun ReviewScreen(vm: EnrollmentViewModel, ui: EnrollUiState) {
    val inspect = ui.inspect ?: return
    BackHandler { vm.reset() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
        Text("Join ${inspect.org.name}?", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text(
            "Check these details match what your IT team told you.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(20.dp))
        ErrorBanner(ui.error, vm::dismissError)
        SectionCard(title = "Organisation", icon = Icons.Outlined.Business) {
            InfoRow("Name", inspect.org.name)
            InfoRow("Support email", inspect.org.supportEmail ?: "Not provided")
            InfoRow("Support phone", inspect.org.supportPhone ?: "Not provided")
            InfoRow("Assigned to", inspect.assignedUserName ?: "Not assigned")
            InfoRow("Link expires", formatDateTime(inspect.expiresAt))
            InfoRow("Server", ui.apiBase)
        }
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = ui.deviceName,
            onValueChange = vm::onDeviceName,
            label = { Text("Device name") },
            supportingText = { Text("How this device appears to your IT team") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(20.dp))
        Button(onClick = vm::toPermissions, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Review permissions") }
        TextButton(onClick = vm::reset, modifier = Modifier.fillMaxWidth()) { Text("This isn't my organisation") }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun PermissionsReviewScreen(vm: EnrollmentViewModel, ui: EnrollUiState) {
    val inspect = ui.inspect ?: return
    val c = MdmApp.container(LocalContext.current)
    val states by c.permissions.states.collectAsState()
    val requester = rememberPermissionRequester()
    BackHandler { vm.backToReview() }
    val missing = inspect.required.filter {
        val st = states[it]?.status
        st != PermissionStatus.GRANTED && st != PermissionStatus.NOT_SUPPORTED
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = vm::backToReview) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
                Text("Permissions", style = MaterialTheme.typography.headlineMedium)
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "${inspect.org.name} requests the following. Each one opens Android's own prompt or settings page. " +
                    "Required items must be granted to enroll; you can skip the rest.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            ErrorBanner(ui.error, vm::dismissError)
            SectionCard {
                val sorted = inspect.definitions.sortedByDescending { it.key in inspect.required }
                sorted.forEachIndexed { i, def ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    PermissionRow(def, states[def.key], def.key in inspect.required, requester, reviewMode = true)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
        Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp)) {
                Text(
                    if (missing.isEmpty()) "All required permissions granted."
                    else "${missing.size} required permission${if (missing.size == 1) "" else "s"} still needed.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (missing.isEmpty()) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error,
                )
                Spacer(Modifier.height(10.dp))
                Button(onClick = vm::complete, enabled = missing.isEmpty(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text("Enroll device")
                }
            }
        }
    }
}

@Composable
private fun CompletingScreen(ui: EnrollUiState) {
    BackHandler { /* cannot cancel mid-authentication */ }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Authenticating", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(6.dp))
        Text("Keep the app open. This takes a few seconds.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(32.dp))
        ProgressChecklist(
            listOf("Recording your permission choices", "Authenticating with ${ui.inspect?.org?.name ?: "server"}", "Securing device credentials", "Connecting"),
            ui.completingStage,
        )
    }
}

@Composable
private fun SuccessScreen(ui: EnrollUiState, onFinished: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.CheckCircle, null, tint = com.mdmplatform.agent.ui.theme.LocalStatusColors.current.success, modifier = Modifier.size(88.dp))
        Spacer(Modifier.height(20.dp))
        Text("Enrolled", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "This device is now managed by ${ui.inspect?.org?.name ?: "your organisation"}." +
                if (ui.connectedAtFinish) " It is connected." else " It will connect in the background.",
            textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))
        Button(onClick = onFinished, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Go to dashboard") }
    }
}
