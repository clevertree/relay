package com.relay.client

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Combined TurboReactPackage for all Relay native modules.
 * Registers both RustTranspiler and ThemedStyler TurboModules.
 */
class RelayTurboModulePackage : TurboReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return when (name) {
      RustTranspilerModule.NAME -> RustTranspilerModule(reactContext)
      ThemedStylerModule.NAME -> ThemedStylerModule(reactContext)
      else -> null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        RustTranspilerModule.NAME to ReactModuleInfo(
          RustTranspilerModule.NAME,
          RustTranspilerModule::class.java.name,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true   // isTurboModule
        ),
        ThemedStylerModule.NAME to ReactModuleInfo(
          ThemedStylerModule.NAME,
          ThemedStylerModule::class.java.name,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true   // isTurboModule
        )
      )
    }
  }
}
