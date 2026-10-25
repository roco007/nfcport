package expo.modules.nfcbackground

import android.app.Application
import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NfcConfigStoreTest {
  private lateinit var application: Application

  @Before
  fun resetCache() {
    application = RuntimeEnvironment.getApplication()
    NfcConfigStore(application).clear()
  }

  @Test
  fun newStoreCanReadCommittedConfigAndNormalizeSerial() {
    NfcConfigStore(application).save(
      """{"04:a1-0b":{"name":"Portfolio","actions":[{"actionType":"open_url","val":"https://example.com/"}]}}"""
    )

    val tag = NfcConfigStore(application).load()?.find("04A10B")

    assertEquals("Portfolio", tag?.name)
    assertEquals("https://example.com/", tag?.actions?.single()?.value)
  }

  @Test
  fun clearRemovesConfigForFutureColdScans() {
    val store = NfcConfigStore(application)
    store.save("""{"04a10b":{"name":"Portfolio","actions":[]}}""")

    store.clear()

    assertNull(NfcConfigStore(application).load())
  }

  @Test
  fun malformedReplacementDoesNotDestroyLastValidConfig() {
    val store = NfcConfigStore(application)
    store.save("""{"04a10b":{"name":"Portfolio","actions":[]}}""")

    assertThrows(IllegalArgumentException::class.java) {
      store.save("""{"04a10b":{"name":"Invalid","actions":[{"actionType":"open_url","val":12}]}}""")
    }

    assertEquals("Portfolio", store.load()?.find("04A10B")?.name)
  }

  @Test
  fun triggerUrlsArePersistedForClosedAppScans() {
    NfcConfigStore(application).save(
      """{"04a10b":{"name":"Remote","actions":[{"actionType":"trigger","val":"http://192.168.0.105:3001/open/Whatsapp","displayName":"Whatsapp"}]}}"""
    )

    val action = NfcConfigStore(application).load()?.find("04A10B")?.actions?.single()

    assertEquals("trigger", action?.type)
    assertEquals("http://192.168.0.105:3001/open/Whatsapp", action?.value)
  }

  @Test
  fun invalidTriggerUrlsDoNotReplaceSavedActions() {
    val store = NfcConfigStore(application)
    store.save("""{"04a10b":{"name":"Before","actions":[]}}""")

    for (value in listOf("whatsapp://send", "file:///tmp/action", "https://", "not a URL")) {
      assertThrows(IllegalArgumentException::class.java) {
        store.save("""{"04a10b":{"name":"Invalid","actions":[{"actionType":"trigger","val":"$value"}]}}""")
      }
      assertEquals("Before", store.load()?.find("04A10B")?.name)
    }
  }

  @Test
  fun failedCommitKeepsPreviousConfigAndAllowsRetry() {
    val before = """{"04a10b":{"name":"Before","actions":[]}}"""
    val after = """{"04a10b":{"name":"After","actions":[]}}"""
    NfcConfigStore(application).save(before)
    val context = FailNextCommitContext(application)
    val store = NfcConfigStore(context)

    assertThrows(IllegalStateException::class.java) { store.save(after) }
    assertEquals("Before", store.load()?.find("04A10B")?.name)
    store.save(after)
    assertEquals("After", NfcConfigStore(application).load()?.find("04A10B")?.name)
  }

  @Test
  fun failedClearKeepsPreviousConfig() {
    NfcConfigStore(application).save("""{"04a10b":{"name":"Portfolio","actions":[]}}""")
    val store = NfcConfigStore(FailNextCommitContext(application))

    assertThrows(IllegalStateException::class.java) { store.clear() }

    assertEquals("Portfolio", store.load()?.find("04A10B")?.name)
  }

  // Model SharedPreferences' memory update before commit reports disk failure.
  private class FailNextCommitContext(base: Context) : ContextWrapper(base) {
    private var shouldFail = true

    override fun getApplicationContext(): Context = this

    override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
      val actual = super.getSharedPreferences(name, mode)
      return object : SharedPreferences by actual {
        override fun edit(): SharedPreferences.Editor {
          val editor = actual.edit()
          return object : SharedPreferences.Editor by editor {
            override fun putString(key: String, value: String?): SharedPreferences.Editor {
              editor.putString(key, value)
              return this
            }

            override fun remove(key: String): SharedPreferences.Editor {
              editor.remove(key)
              return this
            }

            override fun commit(): Boolean {
              editor.commit()
              if (!shouldFail) return true
              shouldFail = false
              return false
            }
          }
        }
      }
    }
  }
}
