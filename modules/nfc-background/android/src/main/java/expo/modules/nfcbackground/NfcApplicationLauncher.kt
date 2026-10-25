package expo.modules.nfcbackground

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/** Shares installed-app resolution between a foreground JS action and a cold NFC scan. */
internal class NfcApplicationLauncher(private val context: Context) {
  fun openApplication(value: String): Boolean {
    val requested = value.trim()
    if (requested.isEmpty()) {
      throw NfcApplicationLaunchException("Enter an installed app name or Android package ID.")
    }

    // Existing explicit links still work. A plain app name must never become a browser intent.
    if (URI_SCHEME.containsMatchIn(requested)) return openUri(requested)

    val manager = context.packageManager
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    @Suppress("DEPRECATION")
    val launchers = manager.queryIntentActivities(launcherIntent, 0).filter { result ->
      result.activityInfo?.let { it.exported && it.enabled && it.applicationInfo.enabled } == true
    }
    val packageMatches = launchers.filter {
      it.activityInfo.packageName == requested
    }
    val matches = if (packageMatches.isNotEmpty()) packageMatches else launchers.filter {
      it.loadLabel(manager).toString().trim().equals(requested, ignoreCase = true) ||
        it.activityInfo.applicationInfo.loadLabel(manager).toString().trim().equals(requested, ignoreCase = true)
    }
    val packages = matches.map { it.activityInfo.packageName }.distinct().sorted()

    if (packages.size > 1) {
      throw NfcApplicationLaunchException(
        "Multiple installed apps are named \"$requested\". Use an Android package ID: ${packages.joinToString(", ")}."
      )
    }
    val targetPackage = packages.singleOrNull()
    if (targetPackage == null) {
      // Preserve the original YouTube action for older mappings and devices without its launcher.
      if (requested.equals("youtube", ignoreCase = true)) return openLegacyYoutube()
      throw NfcApplicationLaunchException(
        "No installed app named \"$requested\" was found. Use its exact launcher name or Android package ID."
      )
    }
    rejectOwnPackage(targetPackage)
    val destination = manager.getLaunchIntentForPackage(targetPackage)
      ?: throw NfcApplicationLaunchException("$requested has no available launcher activity.")
    destination.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(destination)
    return true
  }

  fun openUri(value: String): Boolean {
    val destination = Intent(Intent.ACTION_VIEW, Uri.parse(value)).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    // Own-package queries remain visible on Android 11+. Do not reenter the dashboard or dispatcher.
    val selfTarget = Intent(destination).setPackage(context.packageName)
    @Suppress("DEPRECATION")
    if (context.packageManager.queryIntentActivities(selfTarget, PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()) {
      throw NfcApplicationLaunchException(SELF_TARGET_MESSAGE)
    }
    context.startActivity(destination)
    return true
  }

  private fun openLegacyYoutube(): Boolean = try {
    openUri("vnd.youtube://")
  } catch (_: ActivityNotFoundException) {
    openUri("https://www.youtube.com/")
  } catch (_: SecurityException) {
    openUri("https://www.youtube.com/")
  }

  private fun rejectOwnPackage(targetPackage: String) {
    if (targetPackage == context.packageName) throw NfcApplicationLaunchException(SELF_TARGET_MESSAGE)
  }

  private companion object {
    val URI_SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")
    const val SELF_TARGET_MESSAGE =
      "An action points back to NFC Portfolio Launcher. Edit this tag's actions."
  }
}

internal class NfcApplicationLaunchException(message: String) : IllegalArgumentException(message)
