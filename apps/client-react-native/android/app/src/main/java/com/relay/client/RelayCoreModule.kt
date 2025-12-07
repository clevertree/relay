package com.relay.client

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.module.annotations.ReactModule
import java.net.URL

@ReactModule(name = "RelayCore")
class RelayCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "RelayCore"

  @ReactMethod
  fun getMasterPeerList(promise: Promise) {
    try {
      // Read from environment variable set during build or at runtime
      val peerListStr = System.getenv("RELAY_MASTER_PEER_LIST")
        ?: BuildConfig.DEBUG_PEER_LIST  // Fallback to build config default
      
      val peers = peerListStr
        .split(";")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { parseUrl(it) }
      
      if (peers.isNotEmpty()) {
        promise.resolve(peers)
      } else {
        // Final fallback for development
        promise.resolve(listOf("10.0.2.2:8080"))  // Android emulator default
      }
    } catch (e: Exception) {
      promise.reject("ERROR", "Failed to get master peer list: ${e.message}")
    }
  }

  /**
   * Parse a full URL (scheme://host:port) and extract host:port format
   */
  private fun parseUrl(fullUrl: String): String {
    return try {
      val url = URL(fullUrl.let { if (it.startsWith("http")) it else "http://$it" })
      val port = if (url.port != -1) ":${url.port}" else ""
      "${url.host}$port"
    } catch (e: Exception) {
      // Return as-is if parsing fails (might already be host:port)
      fullUrl
    }
  }

  @ReactMethod
  fun probePeer(peerId: String, promise: Promise) {
    try {
      // Placeholder: would call Rust native code via JNI
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  @ReactMethod
  fun fetchOptions(promise: Promise) {
    try {
      // Placeholder: would fetch from Rust native code
      promise.resolve(mapOf("options" to listOf<String>()))
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  @ReactMethod
  fun getFile(fileHash: String, promise: Promise) {
    try {
      // Placeholder: would get file from Rust native code
      promise.resolve(mapOf("success" to false))
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  @ReactMethod
  fun startPeersProbe(promise: Promise) {
    try {
      // Placeholder: would start probe in Rust
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  @ReactMethod
  fun stopPeersProbe(promise: Promise) {
    try {
      // Placeholder: would stop probe in Rust
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }
}
