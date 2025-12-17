package com.relay.client

import com.facebook.jni.HybridData
import com.facebook.react.ReactPackage
import com.facebook.react.ReactPackageTurboModuleManagerDelegate
import com.facebook.react.bridge.ReactApplicationContext

/**
 * App-specific TurboModule manager delegate.
 * When used, it simply wraps the default delegate behavior and relies on
 * the packages provided via MainApplication#getPackages.
 */
class RelayTurboModuleManagerDelegate(
  context: ReactApplicationContext,
  packages: List<ReactPackage>
) : ReactPackageTurboModuleManagerDelegate(context, packages) {

  override fun initHybrid(): HybridData {
    throw UnsupportedOperationException(
      "RelayTurboModuleManagerDelegate.initHybrid() must not be called"
    )
  }

  class Builder : ReactPackageTurboModuleManagerDelegate.Builder() {
    override fun build(
      context: ReactApplicationContext,
      packages: List<ReactPackage>
    ): ReactPackageTurboModuleManagerDelegate {
      return RelayTurboModuleManagerDelegate(context, packages)
    }
  }
}
