# hook-transpiler — Rust Crate for Cross‑Platform JSX/TSX Transpiling and Loading

Last updated: 2025-12-12 10:02 (local)

## Purpose
Minimal, reliable transpiler used by Relay clients (web and React Native) to:
- Transpile JSX/TSX → executable JavaScript
- Rewrite dynamic `import()` → `context.helpers.loadModule(spec)` for lazy loading
- Offer friendly diagnostics suitable for non‑devs
- Provide fetch helpers (with TLS) for server/native contexts (future work)

This crate is the foundation for client‑side (WASM) and server‑side transpilation. Client‑web uses the WASM build first; server `/api/transpile` acts as a fallback. RN initially uses the server endpoint, with room to evolve to on‑device transpilation.

## Current Status Summary
- Core Rust crate exists and compiles in workspace
- Core transforms implemented (TS strip, React classic runtime, `import()` rewrite)
- Friendly error types implemented (parse/transform/codegen)
- Initial unit tests included (JSX basics, dynamic import rewrite, minimal get‑client snippet)
- Server fallback route implemented and calling this crate: `POST /api/transpile`
- Client‑web wired for strict crate‑WASM usage (no SWC/Babel/server fallback while validating) — confirmed working
- RN integration next: choose native binding approach (JSI) or use server fallback initially
- A separate isolated WASM crate for the browser is aligned to `swc_core v50.x` APIs (in progress; usable subset already powering client‑web)

## Task List and Status

1. Core crate (this directory)
   - [x] Create crate and add to workspace
   - [x] Implement parser and transforms (TS strip, React classic w/ pragma, dynamic `import()` → loader)
   - [x] Error types for parse/transform/codegen with filename and positions
   - [x] Optional CommonJS output flag (for RN if needed)
   - [x] Initial unit tests (basic JSX, dynamic import rewrite, minimal get‑client)
   - [ ] Expand unit tests
     - [ ] Full `template/hooks/client/get-client.jsx` transpilation (integration test)
     - [ ] TSX inter‑module async imports (A lazily imports B)
     - [ ] Negative cases with user‑friendly diagnostics (parse error locations)

2. Web/WASM build (client‑first)
   - [x] Add build script to emit wasm + JS glue to client‑web public assets (`scripts/build-hook-wasm.sh`)
   - [x] Client‑web loader that initializes the WASM and exposes `globalThis.__hook_transpile_jsx`
   - [*] Align and finalize WASM build against `swc_core v50.x` (isolated browser crate) — in progress
   - [x] Minimal wasm‑exposed API shape: `transpile_jsx(source, filename) -> { code, map?, diagnostics? }`
   - [x] Document WASM loading behavior and troubleshooting — see Release Validation doc

3. Server fallback (apps/server)
   - [x] Implement `POST /api/transpile` endpoint invoking this crate
   - [x] Map errors to friendly diagnostics for clients
   - [ ] Add source map support (optional, nice‑to‑have)
   - [ ] Integration test covering endpoint with typical inputs

4. Client‑web integration (apps/client‑web)
   - [x] Strict mode using only crate‑WASM during bring‑up (no SWC/Babel/server fallback)
   - [x] Settings option to allow server fallback or force server‑only
   - [*] Re‑enable server fallback after WASM is green (client‑first strategy) — available via Settings
   - [ ] Surface diagnostics in the UI where hooks are rendered
   - [ ] E2E test: load `get-client.jsx`, verify lazy imports route via `helpers.loadModule`

5. Client‑React‑Native integration (apps/client‑react‑native)
   - [ ] Decide native integration path (modern & efficient):
     - [ ] Phase 1: Use server endpoint for reliability on all devices
     - [ ] Phase 2: Add native JSI/TurboModule binding to Rust (C++ shim), compile crate as shared lib (.so/.a) via NDK/clang
       - [ ] Android: cargo-ndk build, Gradle packaging, Hermes compatibility
       - [ ] iOS: Xcode build settings, CocoaPods or Swift Package linking
   - [ ] Expose minimal API to JS: `transpileJsx(source, filename) -> string | { code }`
   - [ ] Optionally request CommonJS output until ESM path is uniform
   - [ ] Replace Debug tab tests with a single “Client Transpiler Test”
   - [ ] Settings toggle to choose Client vs Server transpiler (default: Client)

6. Fetch handling utilities
   - [ ] Server/native: `reqwest` TLS‑enabled fetch helper (optional feature)
   - [ ] Web: WASM build provides a stub delegating to JS `fetch`
   - [ ] Tests for basic fetch scenarios (HTTPS + cert validation)

7. Documentation
   - [x] This README with tasks and status
   - [ ] Crate API examples and diagnostics format
   - [x] Update READMEs: hook‑transpiler, client‑react‑native, client‑web, and project root with transpiler details
   - [x] Release Validation guide: `docs/RELEASE_VALIDATION.md`
   - [ ] Migration notes for client‑web and RN

8. Server GET fallback behavior (integration & tests)
   - [x] Implement fallback option in server for GET that need transpile (route available)
   - [ ] Ensure middleware/handlers invoke transpiler where appropriate
   - [ ] Unit/integration tests for fallback path (success and diagnostics)

9. Release & Distribution
   - [ ] Android APK (release) build with RN client using the latest transpiler path
   - [ ] Install on device and smoke‑test: load `get-client.jsx`, verify lazy `import()` via `helpers.loadModule`
   - [ ] Document release steps and troubleshooting

## Build (Server/Native)
This crate is part of the Cargo workspace. To build and run tests:

```bash
cargo build -p hook-transpiler
cargo test -p hook-transpiler
```

## Build (Web/WASM)
Artifacts are generated into the web app’s source folder so Vite can bundle them. Run the cross-platform helper from the repo root:

```bash
# From repo root (cross-platform)
npm run build:wasm

# Dev cycle (build then start web dev server)
npm run web:dev:wasm
```

Expected outputs (canonical location under the web app source):
- `apps/client-web/src/wasm/hook_transpiler.js`
- `apps/client-web/src/wasm/hook_transpiler_bg.wasm`

Client‑web loads these at startup via `apps/client-web/src/wasmEntry.ts` (shim) and exposes:
```
globalThis.__hook_transpile_jsx(source: string, filename: string) => string | { code: string }
```

See also: Release validation steps in `docs/RELEASE_VALIDATION.md`.

## Minimal Public API (Rust)
The crate exposes a Rust API consumed by the server and unit tests:

```rust
pub struct TranspileOptions {
    pub filename: Option<String>,
    pub react_dev: bool,
    pub to_commonjs: bool,
    pub pragma: Option<String>,
    pub pragma_frag: Option<String>,
}

pub struct TranspileOutput {
    pub code: String,
    pub map: Option<String>,
}

pub fn transpile(source: &str, opts: TranspileOptions) -> Result<TranspileOutput, TranspileError>;
```

Error types are user‑facing and include filename and (when available) locations:
- `ParseError { filename, line, col, message }`
- `TransformError(filename, source_err)`
- `CodegenError(filename, source_err)`

## Dynamic import() rewrite
All `import(spec)` calls are rewritten to `context.helpers.loadModule(spec)` so hooks lazily load peer modules through the runtime’s loader. This is essential for TSX/JSX modules importing each other asynchronously.

## Testing
Run unit tests:

```bash
cargo test -p hook-transpiler
```

Planned tests to add:
- End‑to‑end transpilation for `template/hooks/client/get-client.jsx`
- Cross‑file lazy imports (A → import("./B"))
- Friendly diagnostics on malformed JSX/TSX

## Notes
- Source maps are currently omitted; can be enabled later.
- RN can initially rely on the server endpoint and optionally request CommonJS output (`to_commonjs: true`).
- Web client should attempt WASM first, then server fallback (once strict bring‑up completes).
