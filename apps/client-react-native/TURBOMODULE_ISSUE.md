# React Native TurboModules Not Registering

The native TurboModules (`RustTranspiler` and `ThemedStyler`) are being packaged correctly (native libraries load), but React Native 0.75's bridgeless TurboModule system is not discovering them at runtime.

## Issue

The modules show up in "NotFound" in the TurboModule registry, despite being:
- Properly implemented as TurboReactPackage
- Added to MainApplication packages list
- Codegen specs generated correctly
- Native libraries loading successfully

## Root Cause

In RN 0.75+ with New Architecture/Bridgeless mode, TurboModules defined **within the app module** (not as separate npm packages) require either:
1. C++ TurboModuleManagerDelegate configuration
2. Autolinking from node_modules (external package)

Our in-app modules need C++ registry hooks that aren't automatically generated for app-level modules.

## Solutions

### Option 1: Move to separate npm package (cleanest)
Create `@relay/native-modules` package in `/apps` that gets autolinked

### Option 2: Disable New Architecture (quickest)
Set `newArchEnabled=false` in `gradle.properties` until we properly configure C++ delegates

### Option 3: Manual C++ Registration (complex)
Implement `MainComponentsRegistry.cpp` with explicit module registration

## Recommended Next Step

Temporarily disable New Architecture to unblock development, then refactor modules into a proper autolinked package.

