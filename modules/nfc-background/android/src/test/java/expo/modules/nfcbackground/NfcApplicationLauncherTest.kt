package expo.modules.nfcbackground

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.ResolveInfo
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NfcApplicationLauncherTest {
  private lateinit var application: Application

  @Before
  fun setUp() {
    application = RuntimeEnvironment.getApplication()
    shadowOf(application).checkActivities(true)
  }

  @Test
  @Config(sdk = [28, 33])
  fun displayNameLaunchesInstalledAppIgnoringCaseAndSurroundingWhitespace() {
    registerLauncherApplication(application, "com.whatsapp", "WhatsApp")

    assertTrue(NfcApplicationLauncher(application).openApplication("  wHaTsApP  "))

    val launched = shadowOf(application).nextStartedActivity
    assertEquals("com.whatsapp", launched.component?.packageName)
    assertEquals(Intent.ACTION_MAIN, launched.action)
    assertTrue(launched.categories.contains(Intent.CATEGORY_LAUNCHER))
    assertTrue(launched.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    assertNull(launched.data)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun packageIdSelectsOneAppWhenDisplayNamesAreDuplicated() {
    registerLauncherApplication(application, "com.first.notes", "Notes")
    registerLauncherApplication(application, "com.second.notes", "Notes")

    NfcApplicationLauncher(application).openApplication("com.second.notes")

    assertEquals("com.second.notes", shadowOf(application).nextStartedActivity.component?.packageName)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun duplicateDisplayNamesRejectWithPackageIdsInsteadOfChoosingArbitrarily() {
    registerLauncherApplication(application, "com.first.notes", "Notes")
    registerLauncherApplication(application, "com.second.notes", "Notes")

    val error = assertThrows(IllegalArgumentException::class.java) {
      NfcApplicationLauncher(application).openApplication("notes")
    }

    assertTrue(error.message.orEmpty().contains("com.first.notes"))
    assertTrue(error.message.orEmpty().contains("com.second.notes"))
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun duplicateLauncherEntriesInOnePackageStillLaunchThatApp() {
    registerLauncherApplication(application, "com.first.notes", "Notes")
    registerLauncherApplication(application, "com.first.notes", "Notes", "AliasActivity")

    NfcApplicationLauncher(application).openApplication("Notes")

    assertEquals("com.first.notes", shadowOf(application).nextStartedActivity.component?.packageName)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun applicationLabelIsAcceptedWhenTheLauncherActivityUsesAnotherLabel() {
    registerLauncherApplication(application, "com.camera", "Camera", appLabel = "Device Camera")

    NfcApplicationLauncher(application).openApplication("Device Camera")

    assertEquals("com.camera", shadowOf(application).nextStartedActivity.component?.packageName)
  }

  @Test
  fun unknownNamesAndPackageIdsDoNotOpenABrowserEvenIfItHandlesTheValue() {
    registerLauncherApplication(application, "com.whatsapp", "WhatsApp")
    for (value in listOf("Unknown App", "com.missing.app", "What")) {
      registerUriDestination(value)
      val error = assertThrows(IllegalArgumentException::class.java) {
        NfcApplicationLauncher(application).openApplication(value)
      }
      assertTrue(error.message.orEmpty().contains(value))
      assertNull(shadowOf(application).nextStartedActivity)
    }
  }

  @Test
  fun blankNamesAreRejectedWithoutLaunchingAnything() {
    assertThrows(IllegalArgumentException::class.java) {
      NfcApplicationLauncher(application).openApplication("  ")
    }
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun explicitDeepLinksRemainSupported() {
    registerUriDestination("customapp://profile")

    assertTrue(NfcApplicationLauncher(application).openApplication("customapp://profile"))

    assertEquals("customapp://profile", shadowOf(application).nextStartedActivity.dataString)
  }

  @Test
  fun explicitWebUrlsRemainSupported() {
    registerUriDestination("https://example.com/app")

    assertTrue(NfcApplicationLauncher(application).openApplication("https://example.com/app"))

    assertEquals("https://example.com/app", shadowOf(application).nextStartedActivity.dataString)
  }

  @Test
  fun installedYoutubeNameLaunchesItsPackageBeforeTryingLegacyUris() {
    registerLauncherApplication(application, "com.google.android.youtube", "YouTube")
    registerUriDestination("vnd.youtube://")
    registerUriDestination("https://www.youtube.com/")

    NfcApplicationLauncher(application).openApplication("Youtube")

    assertEquals("com.google.android.youtube", shadowOf(application).nextStartedActivity.component?.packageName)
    assertNull(shadowOf(application).nextStartedActivity)
  }

  @Test
  fun ownAppNameAndPackageCannotReopenTheDashboard() {
    registerLauncherApplication(application, application.packageName, "NFC Portfolio Launcher")

    for (value in listOf("NFC Portfolio Launcher", application.packageName)) {
      val error = assertThrows(IllegalArgumentException::class.java) {
        NfcApplicationLauncher(application).openApplication(value)
      }
      assertTrue(error.message.orEmpty().contains("back to NFC Portfolio Launcher"))
      assertNull(shadowOf(application).nextStartedActivity)
    }
  }

  private fun registerUriDestination(value: String) {
    val info = launcherResolveInfo("example.destination", "Destination", "DestinationActivity")
    info.isDefault = true
    shadowOf(application.packageManager).addResolveInfoForIntent(
      Intent(Intent.ACTION_VIEW, Uri.parse(value)), info
    )
  }
}

internal fun registerLauncherApplication(
  application: Application,
  targetPackage: String,
  label: String,
  activityName: String = "MainActivity",
  appLabel: String = label
) {
  val info = launcherResolveInfo(targetPackage, label, activityName, appLabel)
  val manager = shadowOf(application.packageManager)
  // Register a real package component and filter so explicit launches are also resolvable.
  manager.addOrUpdateActivity(info.activityInfo)
  manager.addIntentFilterForActivity(
    ComponentName(targetPackage, info.activityInfo.name),
    IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
  )
}

private fun launcherResolveInfo(
  targetPackage: String,
  label: String,
  activityName: String,
  appLabel: String = label
): ResolveInfo = ResolveInfo().apply {
  nonLocalizedLabel = label
  activityInfo = ActivityInfo().apply {
    packageName = targetPackage
    name = "$targetPackage.$activityName"
    nonLocalizedLabel = label
    exported = true
    enabled = true
    applicationInfo = ApplicationInfo().apply {
      packageName = targetPackage
      nonLocalizedLabel = appLabel
      enabled = true
    }
  }
}
