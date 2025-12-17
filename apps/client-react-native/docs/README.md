# Relay Client — React Native

This is the React Native client for Relay. It targets Android and iOS first, with optional desktop later.

Status: Debug and Settings tabs are merged. The Debug tab contains a single "Client Transpiler Test". Transpiler mode toggle (Client/Server) is available.

Quick start

1. Install dependencies at the repo root (Node.js >= 20, Android SDK/adb for Android builds).
2. From repo root, start Metro and run Android:
   - `npm run rn:start` — start Metro
   - `npm run rn:android` — run on Android (debug)

Transpiler Modes

- Client (default): run a small JSX snippet on-device for diagnostics.
- Server: POST `/api/transpile` to the connected server and execute returned CommonJS (`to_common_js=true`).

You can toggle mode in the Debug tab under "Transpiler Settings".

Release APK (Android)

Devices are online and ready to accept APKs. Use the provided scripts to assemble and install the release build:

```
# Optional: start Metro in another terminal
npm run rn:start

# Build + install (requires adb)
npm run rn:build:release

# Alternatively (manual):
cd apps/client-react-native/android
./gradlew assembleRelease
./gradlew installRelease
```

If installation fails due to signing, configure signing in `apps/client-react-native/android/app/build.gradle` and re-run the install command.

Environment

Master peer list can be provided via a global `RN$RELAY_MASTER_PEER_LIST` (semicolon-separated URLs, e.g., `http://10.0.2.2:8080;https://node.example.com`). Defaults are emulator-localhost for Android (`http://10.0.2.2:8080`) and `http://localhost:8080` for iOS.

See also

- Release validation steps: `docs/RELEASE_VALIDATION.md`
