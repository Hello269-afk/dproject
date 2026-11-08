package com.mdmplatform.agent.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.mdmplatform.agent.MdmApp
import com.mdmplatform.agent.R
import com.mdmplatform.agent.ui.assist.ConsentCard
import com.mdmplatform.agent.ui.assist.rememberScreenConsentLauncher
import com.mdmplatform.agent.ui.theme.MdmTheme

/**
 * Full-screen consent for a screen-sharing request, opened from the heads-up notification.
 * Approve -> Android's MediaProjection dialog -> capture -> `screen.consent approved`.
 * The activity closes itself when the request is answered, withdrawn or expires.
 */
class ConsentActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val c = MdmApp.container(this)
        setContent {
            MdmTheme {
                val pending by c.state.pendingScreenRequest.collectAsState()
                val sharing by c.state.sharing.collectAsState()
                val org by c.state.org.collectAsState()
                val launch = rememberScreenConsentLauncher()
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
                val req = pending?.takeIf { sessionId == null || it.sessionId == sessionId }

                // Close once there is nothing left to decide (answered, withdrawn, expired) or sharing started.
                LaunchedEffect(req == null, sharing) {
                    if (req == null || sharing != null) finish()
                }

                Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                        .statusBarsPadding().navigationBarsPadding()
                        .verticalScroll(rememberScrollState()).padding(20.dp)
                ) {
                    Text(stringResource(R.string.app_name).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(4.dp))
                    Text(if (req?.control == true) "Allow screen sharing and control?" else "Allow screen sharing?", style = MaterialTheme.typography.headlineMedium)
                    Spacer(Modifier.height(20.dp))
                    if (req != null) {
                        ConsentCard(
                            req, org?.name,
                            onApprove = { allowControl -> launch(req.sessionId, allowControl) },
                            onReject = { c.screen.reject(req.sessionId); finish() },
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // The user may come back from switching on remote control in Settings.
        MdmApp.container(this).reportPermissions()
    }

    companion object {
        const val EXTRA_SESSION_ID = "sessionId"
        fun intent(ctx: Context, sessionId: String): Intent =
            Intent(ctx, ConsentActivity::class.java)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}
