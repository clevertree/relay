# Android Build Setup

This document describes how to build and run the Relay Client React Native app on Android.

## Prerequisites

1. **Node.js** >= 20 and pnpm
2. **Java Development Kit (JDK)** 17+ 
3. **Android SDK** (API level 31+)
4. **Android NDK** r26 or later
5. **Rust** toolchain with Android targets:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
   ```
6. **cargo-ndk** for building Rust libraries:
   ```bash
   cargo install cargo-ndk
   ```

## Environment Setup

Set these environment variables:

```bash
# Android SDK
export ANDROID_HOME=/path/to/android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/r26
export PATH=$ANDROID_HOME/tools:$PATH

# Rust (for cross-compilation)
export RUST_BACKTRACE=1
export RUST_LOG=info
```

## Building the App

### Step 1: Build Rust Core Library

From `apps/client-react-native/rust`:

```bash
# Test build for host
cargo build --release

# Build for Android targets (cargo-ndk will do this automatically via Gradle)
# Or manually:
cargo ndk -t aarch64-linux-android -t armv7-linux-androideabi -t x86_64-linux-android build --release
```

### Step 2: Generate C Header

```bash
cd apps/client-react-native/rust
cbindgen --output include/relay_core.h
```

### Step 3: Install Dependencies

```bash
cd apps/client-react-native
pnpm install
```

### Step 4: Build APK

```bash
# Development APK
pnpm android

# Or manually with gradle:
cd android
./gradlew assembleDebug

# Release APK
./gradlew assembleRelease
```

### Step 5: Install and Run

```bash
# On emulator
adb install build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.relay.client/.MainActivity

# With metro:
pnpm start

# In another terminal:
pnpm android
```

## Troubleshooting

### Rust library not loading

If you see "Failed to load relay_client_rn_core", ensure:
1. Native library is built for the correct ABI
2. `.so` files are in the correct jniLibs directory structure:
   ```
   android/app/src/main/jniLibs/
   ├── arm64-v8a/
   │   └── librelay_client_rn_core.so
   ├── armeabi-v7a/
   │   └── librelay_client_rn_core.so
   └── x86_64/
       └── librelay_client_rn_core.so
   ```

### Gradle build fails

1. Ensure `ANDROID_HOME` and `ANDROID_NDK_HOME` are set correctly
2. Run `./gradlew clean` to clear build cache
3. Check that cargo-ndk is installed: `cargo ndk --version`

### Metro/JS errors

Run `pnpm install` again to ensure all dependencies are present.

## Development Workflow

1. Update Rust code in `rust/src/`
2. Run `cargo build --release` to verify compilation
3. Update Android Kotlin in `android/app/src/main/java/`
4. Run `pnpm android` to rebuild and deploy

## CI/CD

GitHub Actions will handle multi-target builds automatically (see `.github/workflows/android.yml`).

## Architecture

- **Rust core** (`rust/src/lib.rs`): C ABI functions for probing, OPTIONS, and file operations
- **JNI wrapper** (`rust/jni/mod.rs`): JNI bindings to expose Rust APIs to Java
- **Kotlin module** (`android/app/src/main/java/com/relay/client/RelayCoreModule.kt`): React Native native module
- **Type definitions** (`native/RelayCoreModule.ts`): TypeScript bridge surface for JS
