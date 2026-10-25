package expo.modules.nfcbackground

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** A real loopback HTTP endpoint; tests never contact a configured LAN device. */
internal class LocalTriggerServer(
  private val response: String = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  private val releaseResponse: CountDownLatch? = null
) : AutoCloseable {
  private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
  private val received = CountDownLatch(1)
  private val activeSocket = AtomicReference<Socket?>()
  val requestLine = AtomicReference<String?>()
  val url: String = "http://127.0.0.1:${server.localPort}/open/Whatsapp?source=nfc"
  private val worker = thread(isDaemon = true, name = "trigger-test-server") {
    try {
      server.accept().use { socket ->
        activeSocket.set(socket)
        val reader = socket.getInputStream().bufferedReader()
        requestLine.set(reader.readLine())
        while (!reader.readLine().isNullOrEmpty()) Unit
        received.countDown()
        releaseResponse?.await(5, TimeUnit.SECONDS)
        socket.getOutputStream().write(response.toByteArray(Charsets.US_ASCII))
        socket.getOutputStream().flush()
      }
    } catch (_: Exception) {
      // A timeout intentionally disconnects before the response can be written.
    }
  }

  fun awaitRequest(): Boolean = received.await(3, TimeUnit.SECONDS)

  override fun close() {
    releaseResponse?.countDown()
    activeSocket.get()?.close()
    server.close()
    worker.join(1_000)
  }
}
