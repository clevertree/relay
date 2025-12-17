package com.relay.client

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.relay.client.specs.NativeThemedStylerSpec

@ReactModule(name = "ThemedStyler")
class ThemedStylerModule(reactContext: ReactApplicationContext) : NativeThemedStylerSpec(reactContext), TurboModule {

  companion object {
    const val NAME = "ThemedStyler"
    private var nativeLoaded = false

    init {
      nativeLoaded = try {
        System.loadLibrary("themed_styler")
        true
      } catch (err: UnsatisfiedLinkError) {
        consoleWarn("ThemedStylerModule", "Failed to load native library", err)
        false
      }
    }

    private fun consoleWarn(tag: String, message: String, err: Throwable?) {
      err?.let { android.util.Log.w(tag, message, it) } ?: android.util.Log.w(tag, message)
    }
  }

  override fun getName(): String = NAME

  override fun renderCss(usageSnapshotJson: String, themesJson: String): String {
    if (!nativeLoaded) return ""
    return try {
      nativeRenderCss(usageSnapshotJson, themesJson)
    } catch (err: Throwable) {
      consoleWarn("ThemedStylerModule", "renderCss failed", err)
      ""
    }
  }

  override fun getRnStyles(selector: String, classesJson: String, themesJson: String): String {
    if (!nativeLoaded) return "{}"
    return try {
      nativeGetRnStyles(selector, classesJson, themesJson)
    } catch (err: Throwable) {
      consoleWarn("ThemedStylerModule", "getRnStyles failed", err)
      "{}"
    }
  }

  override fun getDefaultState(): String {
    if (!nativeLoaded) return "{}"
    return try {
      nativeGetDefaultState()
    } catch (err: Throwable) {
      consoleWarn("ThemedStylerModule", "getDefaultState failed", err)
      "{}"
    }
  }

  override fun getVersion(): String {
    if (!nativeLoaded) return "unknown"
    return try {
      nativeGetVersion()
    } catch (err: Throwable) {
      consoleWarn("ThemedStylerModule", "getVersion failed", err)
      "unknown"
    }
  }

  private external fun nativeRenderCss(usageJson: String, themesJson: String): String
  private external fun nativeGetRnStyles(selector: String, classesJson: String, themesJson: String): String
  private external fun nativeGetDefaultState(): String
  private external fun nativeGetVersion(): String
}
