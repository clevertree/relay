package com.relay.client

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class APKInstallerPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return when (name) {
      APKInstallerModule.NAME -> APKInstallerModule(reactContext)
      else -> null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        APKInstallerModule.NAME to ReactModuleInfo(
          name = APKInstallerModule.NAME,
          className = APKInstallerModule::class.java.name,
          canOverrideExistingModule = false,
          needsEagerInit = false,
          isTurboModule = true
        )
      )
    }
  }

  companion object {
    const val NAME = "APKInstaller"
  }
}
