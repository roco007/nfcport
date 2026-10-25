package expo.modules.nfcbackground

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URISyntaxException
import java.net.URL
import java.util.Locale

/** Performs a request only; redirects stay inside the HTTP client. */
internal class NfcHttpTrigger(
  private val connectTimeoutMs: Int = 10_000,
  private val readTimeoutMs: Int = 10_000
) {
  fun request(value: String) {
    val connection = parseUrl(value).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "GET"
      connection.connectTimeout = connectTimeoutMs
      connection.readTimeout = readTimeoutMs
      connection.useCaches = false
      connection.instanceFollowRedirects = true
      val status = connection.responseCode
      if (status !in 200..299) throw IOException("Trigger returned HTTP $status")
    } finally {
      connection.disconnect()
    }
  }

  companion object {
    fun parseUrl(value: String): URL {
      val uri = try {
        URI(value.trim())
      } catch (error: URISyntaxException) {
        throw IllegalArgumentException("Trigger actions require an HTTP or HTTPS URL.", error)
      }
      require(
        uri.scheme?.lowercase(Locale.ROOT) in setOf("http", "https") &&
          !uri.host.isNullOrBlank() && (uri.port == -1 || uri.port in 0..65535)
      ) { "Trigger actions require an HTTP or HTTPS URL." }
      return uri.toURL()
    }
  }
}
