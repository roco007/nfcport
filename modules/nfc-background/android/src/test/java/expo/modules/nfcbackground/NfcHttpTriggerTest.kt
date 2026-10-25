package expo.modules.nfcbackground

import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class NfcHttpTriggerTest {
  @Test
  fun sendsGetToConfiguredEndpoint() {
    LocalTriggerServer().use { server ->
      NfcHttpTrigger().request(server.url)

      assertTrue(server.awaitRequest())
      assertEquals("GET /open/Whatsapp?source=nfc HTTP/1.1", server.requestLine.get())
    }
  }

  @Test
  fun followsHttpRedirectsInsideTheHttpClient() {
    LocalTriggerServer().use { destination ->
      val response = "HTTP/1.1 302 Found\r\nLocation: ${destination.url}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      LocalTriggerServer(response).use { origin ->
        NfcHttpTrigger().request(origin.url)

        assertTrue(origin.awaitRequest())
        assertTrue(destination.awaitRequest())
      }
    }
  }

  @Test
  fun failedHttpResponseIsReported() {
    LocalTriggerServer("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").use { server ->
      assertThrows(IOException::class.java) { NfcHttpTrigger().request(server.url) }

      assertTrue(server.awaitRequest())
    }
  }

  @Test
  fun nonHttpValuesAreRejectedWithoutSendingARequest() {
    for (url in listOf("whatsapp://send", "file:///tmp/action", "https://", "not a URL")) {
      assertThrows(IllegalArgumentException::class.java) { NfcHttpTrigger().request(url) }
    }
  }

  @Test
  fun stalledEndpointTimesOut() {
    LocalTriggerServer(releaseResponse = CountDownLatch(1)).use { server ->
      assertThrows(SocketTimeoutException::class.java) {
        NfcHttpTrigger(readTimeoutMs = 100).request(server.url)
      }

      assertTrue(server.awaitRequest())
    }
  }
}
