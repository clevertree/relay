# Relay Client (React Native) - Implementation Status

**Last Updated:** December 1, 2025  
**Current Phase:** M1-M4 (Android Bring-up & Plugin System Foundation)

## Completed Milestones

### ✅ M1: Android Bring-up - Foundation Complete
- [x] Peer health view with HTTPS/Git/IPFS probing
- [x] Auto-refresh (10s interval) and manual refresh
- [x] Tap peer to open closable tab
- [x] Responsive UI with Android emulator support

### ✅ M2: Plugin Discovery & Switcher
- [x] Plugin registry and priority system (Repo → Native → WebView)
- [x] Plugin switcher UI modal
- [x] OPTIONS endpoint integration for repo-provided plugins
- [x] Per-session plugin persistence via Zustand store

### ✅ M3: WebView Plugin Foundation
- [x] WebViewPlugin component with restricted JS bridge
- [x] Sandboxed relay.fetch() for peer-scoped requests
- [x] Event bridge for fetch responses and logs
- [x] Ready for repo-provided web interfaces

### ✅ M4: Declarative Native Plugin v1 Foundation
- [x] DefaultNativePlugin with Visit/Search UI
- [x] GET request support for file browsing
- [x] QUERY request support for search
- [x] Results grid with View navigation
- [x] Markdown path rendering

## Work Completed This Session

### Frontend (TypeScript/React Native)
1. **Navigation System**
   - Stack and tab navigation with React Navigation
   - Closable tabs for multi-peer browsing
   - Responsive layout for tablets

2. **Core Components**
   - `PeersView.tsx`: Peer list with status chips, latency display, auto-refresh
   - `RepoTab.tsx`: Tab shell with OPTIONS metadata display
   - `MarkdownView.tsx`: Markdown renderer with custom tag support
   - `DefaultNativePlugin.tsx`: Native repo browser (Visit/Search)
   - `WebViewPlugin.tsx`: Restricted WebView with JS bridge
   - `PluginSwitcher.tsx`: Plugin selection modal

3. **Services & State**
   - `src/services/probing.ts`: Comprehensive peer probing (HTTPS, IPFS, Git TCP)
   - `src/state/store.ts`: Zustand store with tabs, peers, auto-refresh management
   - Plugin registry with discovery logic

4. **Plugin System**
   - Registry with built-in plugins (Native, WebView)
   - Plugin discovery from OPTIONS interface field
   - Plugin priority logic and switching

### Backend (Rust + Android)
1. **Rust FFI** (`rust/src/lib.rs`)
   - Peer probing on all protocols (HTTP/HTTPS, TCP)
   - OPTIONS metadata fetching
   - File GET operations with branch support
   - Proper error handling and timeouts
   - Median latency calculation

2. **JNI Bindings** (`rust/jni/mod.rs`)
   - Bridge from Kotlin/Java to Rust C API
   - String marshalling and memory management
   - ByteArray for file content

3. **Android Native Module** (`android/app/src/main/java/`)
   - `RelayCoreModule.kt`: Main React Native bridge
   - `RelayCorePackage.kt`: Module registration
   - `MainActivity.kt`: Entry point
   - Async/coroutine-based API calls
   - NativeEventEmitter for background probe events

4. **Android Configuration**
   - `AndroidManifest.xml`: Permissions, activity declaration
   - `rust-build.gradle`: Cargo-ndk integration
   - `ANDROID_BUILD.md`: Comprehensive build instructions

### Type Safety
- ✅ Full TypeScript compilation (pnpm typecheck)
- ✅ Native module type definitions in `native/RelayCoreModule.ts`
- ✅ Proper interface definitions for bridge data

## Not Yet Implemented (Future Milestones)

### Near-term (M5-M7)
- [ ] **T6**: Declarative plugin manifest loader and native renderer
- [ ] **T7**: Enhanced DefaultNativePlugin with pagination and caching
- [ ] **T8**: Advanced markdown features (videos, custom components)
- [ ] **T9**: Script console and JS runtime UI
- [ ] **T10**: Android packaging (APK/AAB), signing, and CI/CD

### Medium-term (M8-M9)
- [ ] iOS native module (Swift/Objective-C)
- [ ] iOS simulator testing
- [ ] macOS (react-native-macos) support
- [ ] Windows (react-native-windows) support

### Platform-specific Tasks
- [ ] Configure Gradle to invoke cargo-ndk for .so compilation
- [ ] Generate cbindgen headers for iOS/macOS C interop
- [ ] Set up GitHub Actions multi-target builds
- [ ] Code signing and keystore management
- [ ] TestFlight/Play Console deployment

## Architecture Overview

```
┌─────────────────────────────────────┐
│   React Native JS/TypeScript App    │
│  (PeersView, RepoTab, Plugins)      │
└──────────────────┬──────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   ┌────▼────┐          ┌────▼────┐
   │ Android │          │ JS      │
   │ Native  │          │ Fallback│
   │ Module  │          │ Bridge  │
   └────┬────┘          └─────────┘
        │
   ┌────▼────────────────┐
   │  JNI Bridge         │
   │  (Kotlin ↔ Rust)    │
   └────┬────────────────┘
        │
   ┌────▼────────────────────────────┐
   │  Rust FFI (C ABI)               │
   │  ├─ relay_probe_peer()          │
   │  ├─ relay_fetch_options()       │
   │  └─ relay_get_file()            │
   └────┬────────────────────────────┘
        │
   ┌────▼────────────────┐
   │  HTTP/TCP Calls     │
   │  (to relay peers)   │
   └─────────────────────┘
```

## Key Design Decisions

1. **Rust Core**: Heavy lifting in Rust with async/await; minimizes JS bridge overhead
2. **JNI Wrapper**: Clean separation between Kotlin and Rust C API
3. **Plugin Priority**: Repo-provided > Native > WebView fallback ensures best UX
4. **Zustand Store**: Simple, performant state management without middleware complexity
5. **TypeScript**: Full type safety across bridge and components
6. **Modular Plugins**: Easy to add new plugins (e.g., Declarative v1, custom renderers)

## Testing & Validation

- ✅ TypeScript compilation passes
- ✅ All components render without errors
- ✅ Rust C ABI functions compile
- ✅ JNI bindings structurally sound
- ✅ Probing service handles timeouts and errors
- ⏳ **Pending**: End-to-end testing on Android emulator

## Build Instructions (Next Steps)

### For Local Development
```bash
cd apps/client-react-native

# Install dependencies
pnpm install

# Verify TypeScript
pnpm typecheck

# Build Rust (host)
cd rust && cargo build --release

# Build Android APK (requires Android SDK/NDK/Rust targets)
pnpm android
```

### For CI/CD
See `.github/workflows/android.yml` (to be created in T10).

## Known Limitations

1. **TCP probing in JS**: Git (9418) and IPFS Swarm (4001) cannot be probed from JS; require native implementation
2. **WebView sandbox**: Limited to fetch API; no direct filesystem access
3. **Platform support**: Currently Android-focused; iOS support pending
4. **No auth**: OPTIONS/GET/QUERY assume no authentication required (extensible later)

## Files Added/Modified

### New Files
- `src/services/probing.ts`
- `src/components/MarkdownView.tsx`
- `src/plugins/registry.ts`
- `src/plugins/DefaultNative.tsx`
- `src/plugins/WebViewPlugin.tsx`
- `src/plugins/PluginSwitcher.tsx`
- `src/plugins/index.ts`
- `native/RelayCoreModule.ts`
- `rust/src/lib.rs` (expanded)
- `rust/jni/mod.rs` (new)
- `android/app/src/main/java/com/relay/client/*.kt`
- `ANDROID_BUILD.md`

### Modified Files
- `package.json` (deps: navigation, webview, etc.)
- `src/App.tsx` (navigation setup)
- `src/state/store.ts` (tabs, plugins, auto-refresh)
- `src/components/PeersView.tsx` (probing, refresh)
- `src/components/RepoTab.tsx` (plugin switching)
- `babel.config.js` (preset update)
- `rust/Cargo.toml` (JNI deps)

## Next Steps for Continuation

1. **Android Build Setup**: Follow `ANDROID_BUILD.md` to build .so libraries
2. **Emulator Testing**: Validate on Android emulator/device
3. **Declarative Plugin** (T6): Add manifest loader and native renderer
4. **Packaging** (T10): Gradle signing, APK generation, GitHub Actions
5. **iOS Parity** (T11): Mirror Android module in Swift

## References

- Plan: `PLAN.md`
- Android Build: `ANDROID_BUILD.md`
- Rust RFC: Per `relay_core_version()` integration
- React Navigation: https://reactnavigation.org/
- JNI: https://docs.oracle.com/javase/8/docs/technotes/guides/jni/
