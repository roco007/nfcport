package expo.modules.nfcbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.widget.Toast
import java.util.concurrent.Executors

/** Keeps network access while a user-initiated NFC request finishes under Battery Saver. */
class NfcTriggerService : Service() {
  private val requests = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val url = intent?.getStringExtra(URL_EXTRA)
    if (url == null) {
      stopSelfResult(startId)
      return START_NOT_STICKY
    }
    val label = intent?.getStringExtra(NAME_EXTRA)?.takeIf { it.isNotBlank() } ?: url
    // Promotion must precede HTTP: the dispatcher is already leaving the screen,
    // and an ordinary background service loses network access under Battery Saver.
    promoteToForeground()
    Log.i(LOG_TAG, "Trigger $startId queued in foreground")
    requests.execute {
      val started = SystemClock.elapsedRealtime()
      Log.i(LOG_TAG, "Trigger $startId started")
      val failure = try {
        NfcHttpTrigger().request(url)
        Log.i(LOG_TAG, "Trigger $startId succeeded in ${SystemClock.elapsedRealtime() - started} ms")
        null
      } catch (error: Exception) {
        // URLs can contain credentials or private query values. Log only timing
        // and error class, never the endpoint or an exception's URL-bearing text.
        Log.w(LOG_TAG, "Trigger $startId failed in ${SystemClock.elapsedRealtime() - started} ms (${error.javaClass.simpleName})")
        "Could not trigger $label. Check the endpoint and your network connection."
      }
      main.post {
        failure?.let { Toast.makeText(applicationContext, it, Toast.LENGTH_LONG).show() }
        // An earlier request must not stop a service that has received another scan.
        if (stopSelfResult(startId)) stopForeground(STOP_FOREGROUND_REMOVE)
      }
    }
    // Trigger endpoints can have side effects. Never replay a request after process death.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    requests.shutdownNow()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  @Suppress("DEPRECATION") // Priority remains necessary on supported Android 7 devices.
  private fun promoteToForeground() {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "NFC actions", NotificationManager.IMPORTANCE_LOW)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    val notification = builder
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Running NFC action")
      .setContentText("Contacting your linked device")
      .setCategory(Notification.CATEGORY_SERVICE)
      .setPriority(Notification.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  companion object {
    private const val LOG_TAG = "NfcTrigger"
    private const val CHANNEL_ID = "nfc_trigger_requests"
    private const val NOTIFICATION_ID = 1
    private const val URL_EXTRA = "url"
    private const val NAME_EXTRA = "displayName"

    internal fun requestIntent(context: Context, action: NfcAction): Intent =
      Intent(context, NfcTriggerService::class.java)
        .putExtra(URL_EXTRA, action.value)
        .putExtra(NAME_EXTRA, action.displayName)
  }
}
