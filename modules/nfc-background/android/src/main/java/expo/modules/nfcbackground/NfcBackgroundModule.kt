package expo.modules.nfcbackground

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NfcBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NfcBackground")

    // Synchronous persistence lets the UI confirm a mapping only after a cold scan can read it.
    Function("saveConfig") { configJson: String ->
      configStore().save(configJson)
    }

    Function("clearConfig") {
      configStore().clear()
    }

    // Shared with the cold NFC dispatcher so "Open App" accepts the same installed names.
    Function("openApplication") { value: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("The application launcher is not available yet")
      NfcApplicationLauncher(context).openApplication(value)
    }
  }

  private fun configStore(): NfcConfigStore {
    val context = appContext.reactContext
      ?: throw IllegalStateException("The NFC configuration store is not available yet")
    return NfcConfigStore(context)
  }
}
