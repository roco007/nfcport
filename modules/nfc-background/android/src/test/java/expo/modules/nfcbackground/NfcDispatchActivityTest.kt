package expo.modules.nfcbackground

import android.app.Application
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast
import org.robolectric.util.ReflectionHelpers
import org.robolectric.util.ReflectionHelpers.ClassParameter

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NfcDispatchActivityTest {
  private lateinit var application: Application

  @Before
  fun resetCache() {
    application = RuntimeEnvironment.getApplication()
    NfcConfigStore(application).clear()
    shadowOf(application).checkActivities(true)
  }

  @Test
  fun coldScanReadsPersistedConfigAndLaunchesAllActionsInOrder() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"},
      {"actionType":"open_application","val":"customapp://profile"}]""")
    registerDestination("https://portfolio.example/")
    registerDestination("customapp://profile")

    val activity = dispatch(nfcIntent())

    // Robolectric exposes started activities as a stack, so the last launch is popped first.
    assertEquals("customapp://profile", shadowOf(application).nextStartedActivity.dataString)
    assertEquals("https://portfolio.example/", shadowOf(application).nextStartedActivity.dataString)
    assertNull(shadowOf(application).nextStartedActivity)
    assertTrue(activity.isFinishing)
  }

  @Test
  fun triggerStartsBackgroundRequestWithoutOpeningAnyActivity() {
    cache("""[{"actionType":"trigger","val":"http://127.0.0.1:3001/open/Whatsapp","displayName":"Whatsapp"}]""")

    val activity = dispatch(nfcIntent())

    val request = shadowOf(application).nextStartedService
    assertEquals(NfcTriggerService::class.java.name, request.component?.className)
    assertEquals("http://127.0.0.1:3001/open/Whatsapp", request.getStringExtra("url"))
    assertEquals("Whatsapp", request.getStringExtra("displayName"))
    assertNull(shadowOf(application).nextStartedActivity)
    assertNull(shadowOf(application).nextStartedService)
    assertTrue(activity.isFinishing)
  }

  @Test
  fun triggerDoesNotDelayLaterApplicationActions() {
    cache("""[{"actionType":"trigger","val":"http://127.0.0.1:3001/action"},
      {"actionType":"open_application","val":"customapp://profile"}]""")
    registerDestination("customapp://profile")

    dispatch(nfcIntent())

    assertNotNull(shadowOf(application).nextStartedService)
    assertEquals("customapp://profile", shadowOf(application).nextStartedActivity.dataString)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun savedActivityStateDoesNotSendTriggerTwice() {
    cache("""[{"actionType":"trigger","val":"http://127.0.0.1:3001/action"}]""")
    val controller = Robolectric.buildActivity(NfcDispatchActivity::class.java, nfcIntent())
      .create().start().resume()
    assertNotNull(shadowOf(application).nextStartedService)
    val state = Bundle()
    controller.pause().saveInstanceState(state).stop().destroy()

    val restored = Robolectric.buildActivity(NfcDispatchActivity::class.java, nfcIntent())
      .create(state).start().resume().get()

    assertTrue(restored.isFinishing)
    assertNull(shadowOf(application).nextStartedService)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun youtubeUsesAndroidSchemeAndFallsBackToWebsiteIfAppIsAbsent() {
    cache("""[{"actionType":"open_application","val":" Youtube "}]""")
    registerDestination("https://www.youtube.com/")

    dispatch(nfcIntent())

    assertEquals("https://www.youtube.com/", shadowOf(application).nextStartedActivity.dataString)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun installedYoutubeOpensItsAppWithoutWebsiteFallback() {
    cache("""[{"actionType":"open_application","val":"Youtube"}]""")
    registerDestination("vnd.youtube://")
    registerDestination("https://www.youtube.com/")

    dispatch(nfcIntent())

    assertEquals("vnd.youtube://", shadowOf(application).nextStartedActivity.dataString)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun coldScanLaunchesAnInstalledApplicationByDisplayName() {
    cache("""[{"actionType":"open_application","val":"  wHaTsApP  "}]""")
    registerLauncherApplication(application, "com.whatsapp", "WhatsApp")

    val activity = dispatch(nfcIntent())

    assertEquals("com.whatsapp", shadowOf(application).nextStartedActivity.component?.packageName)
    assertNull(shadowOf(application).nextStartedActivity)
    assertTrue(activity.isFinishing)
  }

  @Test
  fun ambiguousApplicationNameShowsPackageIdsAndContinuesLaterActions() {
    cache("""[{"actionType":"open_application","val":"Notes"},
      {"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerLauncherApplication(application, "com.first.notes", "Notes")
    registerLauncherApplication(application, "com.second.notes", "Notes")
    registerDestination("https://portfolio.example/")

    dispatch(nfcIntent())

    assertEquals("https://portfolio.example/", shadowOf(application).nextStartedActivity.dataString)
    assertNull(shadowOf(application).nextStartedActivity)
    val message = ShadowToast.getTextOfLatestToast().toString()
    assertTrue(message.contains("com.first.notes"))
    assertTrue(message.contains("com.second.notes"))
  }

  @Test
  fun failedActionDoesNotPreventLaterActions() {
    cache("""[{"actionType":"open_application","val":"missingapp://profile"},
      {"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerDestination("https://portfolio.example/")

    val activity = dispatch(nfcIntent())

    assertEquals("https://portfolio.example/", shadowOf(application).nextStartedActivity.dataString)
    assertNotNull(ShadowToast.getTextOfLatestToast())
    assertTrue(activity.isFinishing)
  }

  @Test
  fun missingCacheFinishesWithoutOpeningAnyScreen() {
    val activity = dispatch(nfcIntent())

    assertTrue(activity.isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
    assertNotNull(ShadowToast.getTextOfLatestToast())
  }

  @Test
  fun unknownTagFinishesWithoutOpeningAnyScreen() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"}]""")

    val activity = dispatch(nfcIntent(byteArrayOf(0x01, 0x02)))

    assertTrue(activity.isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun emptyActionsAreValidAndFinishWithoutOpeningAnyScreen() {
    cache("[]")

    assertTrue(dispatch(nfcIntent()).isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun arbitraryViewIntentCannotRunConfiguredActionsEvenWithTagExtra() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerDestination("https://portfolio.example/")

    assertTrue(dispatch(nfcIntent().setAction(Intent.ACTION_VIEW)).isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun extraIdAloneCannotRunConfiguredActions() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerDestination("https://portfolio.example/")
    val intent = Intent(NfcAdapter.ACTION_TAG_DISCOVERED)
      .putExtra(NfcAdapter.EXTRA_ID, byteArrayOf(0x04, 0xa1.toByte(), 0x0b))

    assertTrue(dispatch(intent).isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  @Config(sdk = [33])
  fun typedTagExtraOnAndroid13RoutesByActualTagId() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerDestination("https://portfolio.example/")

    dispatch(nfcIntent().putExtra(NfcAdapter.EXTRA_ID, byteArrayOf(0x00)))

    assertEquals("https://portfolio.example/", shadowOf(application).nextStartedActivity.dataString)
  }

  @Test
  fun selfTargetIsRejectedInsteadOfOpeningLauncher() {
    cache("""[{"actionType":"open_application","val":"manus-test://home"}]""")
    registerDestination("manus-test://home", application.packageName)

    assertTrue(dispatch(nfcIntent()).isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun savedActivityStateDoesNotDispatchSameScanAgain() {
    cache("""[{"actionType":"open_url","val":"https://portfolio.example/"}]""")
    registerDestination("https://portfolio.example/")
    val controller = Robolectric.buildActivity(NfcDispatchActivity::class.java, nfcIntent())
      .create().start().resume()
    assertNotNull(shadowOf(application).nextStartedActivity)
    val state = Bundle()
    controller.pause().saveInstanceState(state).stop().destroy()

    val restored = Robolectric.buildActivity(NfcDispatchActivity::class.java, nfcIntent())
      .create(state).start().resume().get()

    assertTrue(restored.isFinishing)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  private fun cache(actions: String) {
    NfcConfigStore(application).save("""{"04:a1-0b":{"name":"Portfolio","actions":$actions}}""")
  }

  private fun dispatch(intent: Intent): NfcDispatchActivity =
    Robolectric.buildActivity(NfcDispatchActivity::class.java, intent)
      .create().start().resume().get()

  private fun nfcIntent(id: ByteArray = byteArrayOf(0x04, 0xa1.toByte(), 0x0b)): Intent {
    val tag = ReflectionHelpers.callStaticMethod<Tag>(
      Tag::class.java,
      "createMockTag",
      ClassParameter.from(ByteArray::class.java, id),
      ClassParameter.from(IntArray::class.java, intArrayOf(1)),
      ClassParameter.from(Array<Bundle>::class.java, arrayOf(Bundle()))
    )
    return Intent(NfcAdapter.ACTION_TECH_DISCOVERED).putExtra(NfcAdapter.EXTRA_TAG, tag)
  }

  private fun registerDestination(uri: String, targetPackage: String = "example.destination") {
    val info = ResolveInfo().apply {
      isDefault = true
      activityInfo = ActivityInfo().apply {
        packageName = targetPackage
        name = "$targetPackage.DestinationActivity"
        exported = true
        enabled = true
        applicationInfo = ApplicationInfo().apply {
          packageName = targetPackage
          enabled = true
        }
      }
    }
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
    shadowOf(application.packageManager).addResolveInfoForIntent(intent, info)
    if (targetPackage == application.packageName) {
      shadowOf(application.packageManager).addResolveInfoForIntent(
        Intent(intent).setPackage(targetPackage), info
      )
    }
  }
}
