# Relay React Native Client

A React Native mobile application for the Relay distributed repository protocol, supporting Android and iOS platforms.

## Overview

The Relay React Native client provides a mobile interface for browsing and interacting with distributed repositories using the Relay protocol. It features:

- **Multi-repository browsing** with peer discovery
- **Plugin system** for extensible content rendering
- **Native Rust core** for high-performance operations
- **Hook transpilation** using native bindings
- **Themed styling** with cross-platform support
- **Offline-first** architecture with caching

## Quick Start

### Prerequisites

- Node.js 20+
- React Native CLI
- Android Studio (for Android)
- Xcode (for iOS, macOS only)
- Rust toolchain
- cargo-ndk (for Android builds)

### Setup

```bash
# Install dependencies
npm install

# Install Rust targets (Android)
rustup target add aarch64-linux-android armv7-linux-androideabi

# Build native modules
npm run prep-hook-transpiler  # Build hook-transpiler for Android
npm run prep-themed-styler    # Build themed-styler for Android

# Start Metro bundler
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## Architecture

### Technology Stack

- **UI Framework**: React Native 0.75.4
- **Navigation**: React Navigation 6
- **State Management**: Zustand
- **Native Bridge**: JNI (Android), Objective-C (iOS)
- **Rust Core**: relay-client-rn-core
- **Transpilation**: hook-transpiler (Rust crate)
- **Styling**: themed-styler (Rust crate)

### Directory Structure

```
apps/client-react-native/
├── android/          # Android native code
│   └── app/src/main/java/com/relay/client/
├── ios/              # iOS native code
├── rust/             # Rust native core
│   ├── src/          # Core Rust implementation
│   └── Cargo.toml
├── src/              # React Native TypeScript code
│   ├── components/   # UI components
│   ├── services/     # Business logic
│   ├── state/        # State management
│   └── plugins/      # Plugin system
├── docs/             # Documentation
└── package.json
```

### Native Architecture

The app uses a Rust core library (`relay-client-rn-core`) that provides:

1. **Network operations** - HTTP client with TLS support
2. **Repository operations** - Git-backed data access
3. **Peer probing** - Health checks and latency monitoring
4. **Hook transpilation** - JSX/TSX to JS transformation (via hook-transpiler)
5. **Styling engine** - Theme-aware styling (via themed-styler)

The Rust core is exposed to React Native via JNI (Android) and Objective-C (iOS) bridges.

## Features

### 1. Repository Browsing
- Browse files and directories in distributed repositories
- Markdown rendering with syntax highlighting
- Media preview support

### 2. Peer Discovery
- Automatic peer discovery via tracker
- Multi-protocol health checking (HTTP/HTTPS)
- Live latency monitoring
- Fallback peer selection

### 3. Plugin System
- Extensible rendering via plugins
- Default native browser plugin
- WebView plugin for web-based content
- Plugin switching UI

### 4. Hook System
- Dynamic component loading
- JSX/TSX transpilation on-device
- Sandboxed execution environment
- Theme integration

## Development

### Building Native Modules

#### Android

```bash
# Build hook-transpiler
cd ../../crates/hook-transpiler
cargo ndk -t arm64-v8a -t armeabi-v7a -o ../../apps/client-react-native/android/app/src/main/jniLibs build --release --features android

# Build themed-styler
cd ../themed-styler
cargo ndk -t arm64-v8a -t armeabi-v7a -o ../../apps/client-react-native/android/app/src/main/jniLibs build --release --features android

# Build app core
cd ../../apps/client-react-native/rust
cargo ndk -t arm64-v8a -t armeabi-v7a -o ../android/app/src/main/jniLibs build --release --features android
```

Or use the convenience scripts:

```bash
npm run prep-hook-transpiler
npm run prep-themed-styler
```

#### iOS

```bash
# Build for iOS
./scripts/ios-prepare-hook-transpiler.sh
./scripts/ios-prepare-themed-styler.sh
```

### Type Checking

```bash
npm run typecheck
```

### Testing

```bash
npm test
```

## Configuration

The app can be configured via environment variables or the built-in settings UI:

- **Tracker URL**: Discovery server for finding peers
- **Default Repositories**: Pre-configured repository list
- **Theme**: Light/dark theme selection
- **Plugin Preferences**: Default plugin selection

## Building for Production

### Android

```bash
# Build release APK
npm run build:release

# Output: android/app/build/outputs/apk/release/app-release.apk
```

### iOS

```bash
# Build release IPA via Xcode
# Product → Archive → Distribute App
```

See [Android Build Guide](docs/ANDROID_BUILD.md) for detailed build instructions.

## Troubleshooting

### Common Issues

#### Metro bundler not starting
```bash
# Clear Metro cache
npm start -- --reset-cache
```

#### Native module not found
```bash
# Rebuild native modules
npm run prep-hook-transpiler
npm run prep-themed-styler

# Reinstall app
npm run android
```

#### Build errors
```bash
# Clean build
cd android && ./gradlew clean && cd ..
npm run android
```

For more troubleshooting, see:
- [Android Build Guide](docs/ANDROID_BUILD.md)
- [Module Loading](docs/MODULE_LOADING.md)

## Documentation

- [Android Build Guide](docs/ANDROID_BUILD.md) - Detailed Android build instructions
- [Module Loading](docs/MODULE_LOADING.md) - Module loading system details
- [Plugin System](docs/T6_DECLARATIVE_PLUGIN.md) - Plugin architecture

## Contributing

1. Follow TypeScript best practices
2. Maintain type safety (no `any` types)
3. Test on both Android and iOS
4. Update documentation for new features
5. Keep native modules up to date

## License

See [LICENSE](../../LICENSE) for details.

## Related Projects

- [Relay Server](../server/README.md) - Backend server implementation
- [Relay Web Client](../client-web/README.md) - Web client
- [Hook Transpiler](../../crates/hook-transpiler/README.md) - JSX/TSX transpiler
- [Themed Styler](../../crates/themed-styler/README.md) - Styling engine
