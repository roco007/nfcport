package expo.modules.nfcbackground

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import android.widget.Toast
import java.util.Locale

/** Receives the OS NFC handoff without mounting MainActivity, React, or the dashboard. */
class NfcDispatchActivity : Activity() {
  private var handled = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handled = savedInstanceState?.getBoolean(HANDLED_KEY) ?: false
  }

  override fun onResume() {
    super.onResume()
    // The activity must be resumed before starting destinations. Do this synchronously:
    // deferred work after finish() would lose the foreground activity launch allowance.
    if (!handled) {
      handled = true
      try {
        dispatch(intent)
      } catch (_: Exception) {
        notifyUser("Saved NFC actions could not be read. Open the app to reload them.")
      }
    }
    finish()
    @Suppress("DEPRECATION")
    overridePendingTransition(0, 0)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handled = false
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putBoolean(HANDLED_KEY, handled)
    super.onSaveInstanceState(outState)
  }

  private fun dispatch(scan: Intent?) {
    if (scan == null || scan.action !in NFC_ACTIONS) return
    val serial = serialFrom(scan) ?: run {
      notifyUser("This NFC scan could not be read. Try tapping again.")
      return
    }
    val config = NfcConfigStore(this).load() ?: run {
      notifyUser("Open NFC Portfolio Launcher once to load your tag actions.")
      return
    }
    val tag = config.find(serial) ?: run {
      notifyUser("No saved actions for NFC tag $serial.")
      return
    }
    if (tag.actions.isEmpty()) {
      notifyUser("No actions saved for ${tag.name}.")
      return
    }

    var firstFailure: String? = null
    var failureCount = 0
    for (action in tag.actions) {
      try {
        launch(action)
      } catch (error: Exception) {
        failureCount += 1
        if (firstFailure == null) {
          firstFailure = when (error) {
            is NfcApplicationLaunchException -> error.message
            is ActivityNotFoundException -> "No app can open ${action.displayName ?: action.value}."
            else -> if (action.type == "trigger") {
              "Could not trigger ${action.displayName ?: action.value}."
            } else {
              "Could not open ${action.displayName ?: action.value}."
            }
          }
        }
      }
    }
    firstFailure?.let { message ->
      notifyUser(if (failureCount == 1) message else "$failureCount actions could not be run. $message")
    }
  }

  private fun launch(action: NfcAction) {
    if (action.type == "trigger") {
      // Start while resumed, before returning to the previous screen. Foreground
      // service status keeps Battery Saver from blocking the pending HTTP request.
      val request = NfcTriggerService.requestIntent(this, action)
      checkNotNull(
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(request)
        else startService(request)
      )
      return
    }

    val launcher = NfcApplicationLauncher(this)
    if (action.type == "open_application") {
      launcher.openApplication(action.value)
    } else {
      launcher.openUri(action.value)
    }
  }

  private fun serialFrom(scan: Intent): String? {
    val tag = try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        scan.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
      } else {
        @Suppress("DEPRECATION")
        (scan.getParcelableExtra<Parcelable>(NfcAdapter.EXTRA_TAG) as? Tag)
      }
    } catch (_: RuntimeException) {
      null
    }
    // EXTRA_ID is optional and can be arbitrary. Only use the required Tag object's ID.
    val id = tag?.id?.takeIf { it.isNotEmpty() } ?: return null
    return id.joinToString("") {
      (it.toInt() and 0xff).toString(16).padStart(2, '0').uppercase(Locale.ROOT)
    }
  }

  private fun notifyUser(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
  }

  private companion object {
    const val HANDLED_KEY = "nfc_scan_handled"
    val NFC_ACTIONS = setOf(
      NfcAdapter.ACTION_NDEF_DISCOVERED,
      NfcAdapter.ACTION_TECH_DISCOVERED,
      NfcAdapter.ACTION_TAG_DISCOVERED
    )
  }
}
