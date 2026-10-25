package expo.modules.nfcbackground

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NfcTriggerServiceTest {
  @Test
  @Config(sdk = [24, 28, 35])
  @Suppress("DEPRECATION") // Verify notification priority on the supported pre-channel API.
  fun requestStaysForegroundUntilHttpCompletesThenRemovesNotification() {
    val release = CountDownLatch(1)
    LocalTriggerServer(releaseResponse = release).use { server ->
      val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
      val service = controller.get()
      try {
        assertEquals(Service.START_NOT_STICKY, service.onStartCommand(request(server.url), 0, 1))

        val foreground = shadowOf(service)
        val notification = foreground.lastForegroundNotification
        assertNotNull("The trigger must have foreground network access while HTTP is pending", notification)
        assertFalse(foreground.isForegroundStopped)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          assertEquals(ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, service.foregroundServiceType)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val manager = application().getSystemService(NotificationManager::class.java)
          assertEquals(NotificationManager.IMPORTANCE_LOW, manager.getNotificationChannel(notification.channelId).importance)
        } else {
          assertEquals(Notification.PRIORITY_LOW, notification.priority)
        }
        assertTrue(server.awaitRequest())
        assertFalse(foreground.isStoppedBySelf)

        release.countDown()
        awaitStopped(service)

        assertTrue(foreground.isForegroundStopped)
        assertTrue(foreground.notificationShouldRemoved)
        assertNull(shadowOf(application()).nextStartedActivity)
      } finally {
        release.countDown()
        controller.destroy()
      }
    }
  }

  @Test
  @Config(shadows = [StartIdAwareServiceShadow::class])
  fun finishingEarlierRequestKeepsForegroundAccessForQueuedRequest() {
    val firstRelease = CountDownLatch(1)
    val secondRelease = CountDownLatch(1)
    LocalTriggerServer(releaseResponse = firstRelease).use { first ->
      LocalTriggerServer(releaseResponse = secondRelease).use { second ->
        val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
        val service = controller.get()
        val foreground = shadowOf(service) as StartIdAwareServiceShadow
        try {
          foreground.latestStartId = 1
          service.onStartCommand(request(first.url), 0, 1)
          assertTrue(first.awaitRequest())
          foreground.latestStartId = 2
          service.onStartCommand(request(second.url), 0, 2)
          firstRelease.countDown()
          assertTrue(second.awaitRequest())
          shadowOf(Looper.getMainLooper()).idle()

          assertNotNull(foreground.lastForegroundNotification)
          assertFalse("An earlier request must not remove the queued request's notification", foreground.isForegroundStopped)
          assertFalse(foreground.isStoppedBySelf)

          secondRelease.countDown()
          awaitStopped(service)
          assertTrue(foreground.isForegroundStopped)
          assertTrue(foreground.notificationShouldRemoved)
        } finally {
          firstRelease.countDown()
          secondRelease.countDown()
          controller.destroy()
        }
      }
    }
  }

  @Test
  fun requestRunsOffMainThreadAndServiceStopsAfterCompletion() {
    val release = CountDownLatch(1)
    LocalTriggerServer(releaseResponse = release).use { server ->
      val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
      val service = controller.get()
      try {
        val started = System.nanoTime()
        val result = service.onStartCommand(request(server.url), 0, 1)

        assertTrue("Service start blocked on HTTP", System.nanoTime() - started < TimeUnit.SECONDS.toNanos(2))
        assertEquals(Service.START_NOT_STICKY, result)
        assertTrue(server.awaitRequest())
        assertFalse(shadowOf(service).isStoppedBySelf)
        release.countDown()
        awaitStopped(service)
        assertNull(shadowOf(application()).nextStartedActivity)
      } finally {
        controller.destroy()
      }
    }
  }

  @Test
  fun httpFailureShowsTriggerErrorWithoutOpeningBrowser() {
    LocalTriggerServer("HTTP/1.1 500 Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").use { server ->
      val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
      val service = controller.get()
      try {
        service.onStartCommand(request(server.url), 0, 1)
        awaitStopped(service)

        assertTrue(ShadowToast.getTextOfLatestToast().toString().contains("trigger"))
        assertTrue(ShadowToast.getTextOfLatestToast().toString().contains("Whatsapp"))
        assertNull(shadowOf(application()).nextStartedActivity)
      } finally {
        controller.destroy()
      }
    }
  }

  @Test
  fun nullRestartIntentDoesNotRepeatTrigger() {
    val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
    val service = controller.get()
    try {
      assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 2))
      assertTrue(shadowOf(service).isStoppedBySelf)
      assertNull(shadowOf(application()).nextStartedActivity)
    } finally {
      controller.destroy()
    }
  }

  @Test
  fun applicationRedirectNeverLaunchesAnActivity() {
    val response = "HTTP/1.1 302 Found\r\nLocation: whatsapp://send\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    LocalTriggerServer(response).use { server ->
      val controller = Robolectric.buildService(NfcTriggerService::class.java).create()
      val service = controller.get()
      try {
        service.onStartCommand(request(server.url), 0, 1)
        awaitStopped(service)

        assertTrue(server.awaitRequest())
        assertNull(shadowOf(application()).nextStartedActivity)
      } finally {
        controller.destroy()
      }
    }
  }

  private fun application(): Application = RuntimeEnvironment.getApplication()

  private fun request(url: String): Intent =
    Intent(application(), NfcTriggerService::class.java)
      .putExtra("url", url)
      .putExtra("displayName", "Whatsapp")

  private fun awaitStopped(service: NfcTriggerService) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
    while (!shadowOf(service).isStoppedBySelf && System.nanoTime() < deadline) {
      shadowOf(Looper.getMainLooper()).idle()
      Thread.sleep(5)
    }
    assertTrue("Trigger service did not finish", shadowOf(service).isStoppedBySelf)
  }
}

/** Model Android's start-ID check, which Robolectric's base Service shadow omits. */
@Implements(Service::class)
class StartIdAwareServiceShadow : ShadowService() {
  var latestStartId = 0

  @Implementation
  override fun stopSelfResult(startId: Int): Boolean =
    startId == latestStartId && super.stopSelfResult(startId)
}
