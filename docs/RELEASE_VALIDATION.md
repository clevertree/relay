# Release Validation Checklist

Last updated: 2025-12-12 10:02 (local)

This document describes how to validate a release of Relay across the crate, server, web client, and React Native app. It assumes you have Rust (stable), Node 20+, and Android SDK/adb (for RN) installed.

Contents
- 1. Hook Transpiler Crate (Rust)
- 2. Server /api/transpile (fallback)
- 3. Client‑Web (WASM first; optional server fallback)
- 4. React Native (Android) Release APK
- 5. Troubleshooting

## 1) Hook Transpiler Crate (Rust)

Build and test the crate:

```
cargo build -p hook-transpiler
cargo test  -p hook-transpiler
```

What to expect:
- Tests pass: JSX basics, dynamic import() rewrite to `context.helpers.loadModule()`, and template fixtures (if present)

## 2) Server fallback API

Start the server (in a separate terminal):

```
npm run dev:server
```

Test the endpoint with a basic JSX snippet:

```
curl -sS http://localhost:8080/api/transpile \
  -H 'content-type: application/json' \
  -d '{"code":"export default function X(){return <div/>}","filename":"x.jsx"}' | jq .
```

Expect: `{ ok: true, code: "..." }` and header `x-relay-transpiler-version` present.

Error path:

```
curl -sS http://localhost:8080/api/transpile \
  -H 'content-type: application/json' \
  -d '{"code":"export default <div>","filename":"broken.jsx"}' | jq .
```

Expect: `{ ok: false, diagnostics: "Parse error ..." }` and 400 status.

## 3) Client‑Web validation

Build the WASM for the web app (choose the script for your OS):

```
# Windows PowerShell
npm run build:hook-wasm

# Linux/macOS
npm run build:hook-wasm:sh
```

Start the dev server:

```
npm run web:dev
```

In the app Settings (web):
- Client‑only: Uses the WASM transpiler shipped with the app.
- Allow server fallback: If WASM fails to load, call `/api/transpile`.
- Server‑only: Always call `/api/transpile`.

Load a JSX hook (e.g., `template/hooks/client/get-client.jsx`).

Expectations:
- In Client‑only mode, the page renders and lazy `import()` calls are rewritten to `context.helpers.loadModule()` by the transpiler.
- In Server‑only mode, the app calls POST `/api/transpile` and executes returned JS.

## 4) React Native (Android) — Release APK

Build and install the release APK to a connected device:

```
# optional: start Metro
npm run rn:start

# build + install (requires adb)
npm run rn:build:release
```

In the RN app Debug tab:
- Use the Transpiler Settings toggle (Client or Server). Default is Client. Server mode posts to `/api/transpile` with `to_common_js=true`.
- Run the single "Client Transpiler Test" to verify in‑app JSX transpilation.

## 5) Troubleshooting

WASM not loading in web:
- Ensure files exist: `apps/client-web/public/wasm/hook_transpiler.js` and `hook_transpiler_bg.wasm`.
- Use the correct build script for your OS (`build:hook-wasm` on Windows, `build:hook-wasm:sh` on Linux/macOS).

Server 404 for /api/transpile:
- Make sure the server is running (`npm run dev:server`) and reachable at the same origin (or update the client to point to the server hostname).

RN adb install fails:
- Configure signing in `apps/client-react-native/android/app/build.gradle` for installRelease, or sideload the APK manually.

Diagnostics not visible:
- Server returns `diagnostics` for parse/transform/codegen errors. Inspect network responses and console logs.
