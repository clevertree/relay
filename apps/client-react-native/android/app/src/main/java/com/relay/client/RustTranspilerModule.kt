package com.relay.client

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.relay.client.specs.NativeHookTranspilerSpec

@ReactModule(name = "RustTranspiler")
class RustTranspilerModule(reactContext: ReactApplicationContext) : NativeHookTranspilerSpec(reactContext), TurboModule {

  companion object {
    const val NAME = "RustTranspiler"
    private var nativeLoaded = false

    init {
      nativeLoaded = try {
        System.loadLibrary("relay_hook_transpiler")
        true
      } catch (err: UnsatisfiedLinkError) {
        consoleWarn("RustTranspilerModule", "Failed to load native library", err)
        false
      }
    }

    private fun consoleWarn(tag: String, message: String, err: Throwable?) {
      err?.let { android.util.Log.w(tag, message, it) } ?: android.util.Log.w(tag, message)
    }
  }

  override fun getName(): String = NAME

  override fun transpile(code: String, filename: String, promise: Promise) {
    if (!nativeLoaded) {
      promise.reject("UNAVAILABLE", "Native Rust transpiler library not loaded")
      return
    }
    try {
      val result = nativeTranspile(code, filename)
      promise.resolve(result)
    } catch (err: Throwable) {
      promise.reject("TRANSPILER_ERROR", err.message, err)
    }
  }

  override fun getVersion(): String {
    if (!nativeLoaded) {
      return "native-unavailable"
    }
    return try {
      nativeGetVersion()
    } catch (err: Throwable) {
      "unknown"
    }
  }

  override fun initialize(promise: Promise) {
    promise.resolve(nativeLoaded)
  }

  private external fun nativeTranspile(code: String, filename: String): String
  private external fun nativeGetVersion(): String
}
