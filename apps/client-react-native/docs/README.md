# Relay Client — React Native

This is the React Native client for Relay. It targets Android and iOS first, with optional desktop later.

Status: early scaffold. See `PLAN.md` for the full implementation plan and milestones.

Quick start (UI only; no native modules yet):

1. Install dependencies at repo root:
   - Node.js >= 20, pnpm
2. From repo root, run Metro or platform commands via pnpm filters:
   - `pnpm rn:start` — start Metro
   - `pnpm rn:android` — run on Android (requires generated `android/` project; TODO)
   - `pnpm rn:ios` — run on iOS (requires generated `ios/` project; TODO)

Environment:
- Master peer list is taken from a global `RN$RELAY_MASTER_PEER_LIST` (semicolon-separated, full URLs with scheme like `http://localhost:3000;https://node1.example.com`) if present, or defaults to emulator-localhost: `http://10.0.2.2:8080` (Android) / `http://localhost:8080` (iOS).

Next steps:
- Generate `android/` and `ios/` projects via React Native CLI (no Expo) and wire the Rust cdylib via JNI/Swift native modules.
- Implement peers probing via the Rust core bridge.

References:
- `apps/client-react-native/PLAN.md`
