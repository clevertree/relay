# React Native Native Module Integration

This document describes the native module architecture for the Relay RN client.

## Overview

The React Native app uses **TurboModules** with native Rust implementations for both hook transpilation and themed styling:

- **HookTranspiler (RustTranspiler)**: Transpiles TypeScript/JSX hooks to JavaScript
- **ThemedStyler**: Renders CSS and React Native styles from theme definitions

Both modules are implemented in Rust and exposed to JavaScript via platform-specific bridges:
- **Android**: Kotlin modules using JNI
- **iOS**: Swift/Objective-C modules using C FFI

## Architecture

### TypeScript Layer

TurboModule specs define the contract:
- `src/specs/NativeHookTranspiler.ts`
- `src/specs/NativeThemedStyler.ts`

Bridge initializers register global hooks:
- `src/nativeRustTranspiler.ts` → `globalThis.__hook_transpile_jsx`
- `src/nativeThemedStyler.ts` → `globalThis.__themedStylerRenderCss`, `__themedStylerGetRn`

### Android Layer

**Kotlin Modules** (extend generated spec base classes):
- `android/app/src/main/java/com/relay/client/RustTranspilerModule.kt`
- `android/app/src/main/java/com/relay/client/ThemedStylerModule.kt`

**Rust JNI** (expose native functions):
- `crates/hook-transpiler/src/android_jni.rs`
- `crates/themed-styler/src/android_jni.rs`

**Build Process**:
```bash
./scripts/rn-prepare-hook-transpiler.sh  # Builds .so for all Android ABIs
./scripts/rn-prepare-themed-styler.sh
```

### iOS Layer

**Swift Modules** (call Rust via C FFI, codegen-wired for TurboModules via `FBReactNativeSpec`):
- `ios/RustTranspiler.swift` + `ios/RustTranspiler.m`
- `ios/ThemedStyler.swift` + `ios/ThemedStyler.m`

**Rust FFI** (C-compatible exports):
- `crates/hook-transpiler/src/ios_ffi.rs`
- `crates/themed-styler/src/ios_ffi.rs`

**Build Process**:
```bash
./scripts/ios-prepare-hook-transpiler.sh  # Builds universal .a for iOS
./scripts/ios-prepare-themed-styler.sh
```

## Building Native Libraries

### All Platforms
```bash
./scripts/build-rn-native.sh
```

### Android Only
```bash
./scripts/rn-prepare-hook-transpiler.sh
./scripts/rn-prepare-themed-styler.sh
```

### iOS Only (macOS required)
```bash
./scripts/ios-prepare-hook-transpiler.sh
./scripts/ios-prepare-themed-styler.sh
```

## Module APIs

### HookTranspiler

**Methods**:
- `transpile(code: string, filename: string): Promise<string>` - Transpile TS/JSX to JS
- `getVersion(): string` - Get transpiler version
- `initialize(): Promise<void>` - Initialize module

**Global Hook**:
```typescript
globalThis.__hook_transpile_jsx = async (code: string, filename: string) => string
globalThis.__hook_transpiler_version = string
```

### ThemedStyler

**Methods**:
- `renderCss(usageJson: string, themesJson: string): string` - Generate CSS
- `getRnStyles(selector: string, classesJson: string, themesJson: string): string` - Get RN styles
- `getDefaultState(): string` - Get embedded default theme state
- `getVersion(): string` - Get styler version

**Global Hooks**:
```typescript
globalThis.__themedStylerRenderCss = (usage, themes) => string
globalThis.__themedStylerGetRn = (selector, classes, themes) => Record<string, any>
globalThis.__themedStyler_version = string
```

## Development Workflow

1. **Modify Rust code** in `crates/hook-transpiler` or `crates/themed-styler`
2. **Rebuild native libraries**: `./scripts/build-rn-native.sh`
3. **Rebuild RN app**: `pnpm --filter client-react-native android` or `ios`

## Adding New Native Methods

1. Update TypeScript spec in `src/specs/Native*.ts`
2. Update platform implementations:
   - Android: Add method to Kotlin module + Rust JNI
   - iOS: Add method to Swift module + Rust FFI
3. Rebuild native libraries
4. Regenerate codegen: RN will auto-generate on next build

## Troubleshooting

**Module not found**: Ensure codegen ran (`rm -rf android/app/build && ./gradlew assembleDebug`)

**JNI/FFI errors**: Verify Rust libraries are in correct locations:
- Android: `android/app/src/main/jniLibs/{abi}/lib*.so`
- iOS: `ios/Frameworks/lib*.a`

**Version mismatch**: Rebuild native libs after Rust changes

## References

- [React Native TurboModules](https://reactnative.dev/docs/the-new-architecture/pillars-turbomodules)
- [React Native Codegen](https://reactnative.dev/docs/the-new-architecture/pillars-codegen)
- [JNI Documentation](https://docs.oracle.com/javase/8/docs/technotes/guides/jni/)
