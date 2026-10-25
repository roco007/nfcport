package expo.modules.nfcbackground

import android.content.Context
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.Locale

internal data class NfcAction(val type: String, val value: String, val displayName: String?)
internal data class NfcTagConfig(val serial: String, val name: String, val actions: List<NfcAction>)

internal class NfcConfig(private val tags: List<NfcTagConfig>) {
  fun find(serial: String): NfcTagConfig? {
    val normalized = normalizeSerial(serial)
    return if (normalized.isEmpty()) null else tags.firstOrNull {
      normalizeSerial(it.serial) == normalized
    }
  }

  companion object {
    private val nonHex = Regex("[^0-9a-fA-F]")

    private fun normalizeSerial(serial: String): String =
      serial.replace(nonHex, "").uppercase(Locale.ROOT)

    // The JS bridge passes parseNfcConfig output: named tags, canonical actionType fields.
    // Keep its schema here: custom application URIs and empty action arrays are valid.
    fun parse(configJson: String): NfcConfig {
      try {
        val root = JSONObject(configJson)
        val tags = root.keys().asSequence().map { serial ->
          val tag = root.opt(serial) as? JSONObject
            ?: throw IllegalArgumentException("Tag configuration for $serial must be an object")
          val name = tag.opt("name") as? String
            ?: throw IllegalArgumentException("Tag name for $serial must be a non-empty string")
          require(name.isNotBlank()) { "Tag name for $serial must be a non-empty string" }
          val rawActions = tag.opt("actions") as? JSONArray
            ?: throw IllegalArgumentException("Actions for $serial must be an array")
          val actions = (0 until rawActions.length()).map { index ->
            val action = rawActions.opt(index) as? JSONObject
              ?: throw IllegalArgumentException("Invalid action for $serial")
            val type = action.opt("actionType") as? String
              ?: throw IllegalArgumentException("Invalid action for $serial")
            val value = action.opt("val") as? String
              ?: throw IllegalArgumentException("Invalid action for $serial")
            require((type == "open_url" || type == "open_application" || type == "trigger") && value.isNotBlank()) {
              "Invalid action for $serial"
            }
            if (type == "trigger") NfcHttpTrigger.parseUrl(value)
            NfcAction(
              type,
              value,
              (action.opt("displayName") as? String)?.trim()?.takeIf { it.isNotEmpty() }
            )
          }
          NfcTagConfig(serial, name.trim(), actions)
        }.toList()
        return NfcConfig(tags)
      } catch (error: JSONException) {
        throw IllegalArgumentException("Invalid NFC configuration JSON", error)
      }
    }
  }
}

internal class NfcConfigStore(context: Context) {
  private val preferences = context.applicationContext.getSharedPreferences(
    "nfc_background_config", Context.MODE_PRIVATE
  )

  fun save(configJson: String): Boolean {
    val previous = preferences.getString(CONFIG_KEY, null)
    if (previous == configJson) return true
    NfcConfig.parse(configJson)
    if (!preferences.edit().putString(CONFIG_KEY, configJson).commit()) {
      // commit() updates memory before its disk result. Restore it so a retry cannot
      // mistake an unsuccessful disk write for an already persisted configuration.
      preferences.edit().putString(CONFIG_KEY, previous).commit()
      throw IllegalStateException("The NFC configuration could not be saved for background scans")
    }
    return true
  }

  fun clear(): Boolean {
    val previous = preferences.getString(CONFIG_KEY, null) ?: return true
    if (!preferences.edit().remove(CONFIG_KEY).commit()) {
      preferences.edit().putString(CONFIG_KEY, previous).commit()
      throw IllegalStateException("The saved NFC configuration could not be cleared")
    }
    return true
  }

  fun load(): NfcConfig? = preferences.getString(CONFIG_KEY, null)?.let(NfcConfig::parse)

  private companion object {
    const val CONFIG_KEY = "config_json"
  }
}
