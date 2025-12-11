### Hook Transpiler Migration Plan (Rust crate)

#### Goals
- New Rust crate to load, transpile, and provide executable JavaScript per OS.
- Minimal functionality:
  1) Transpile all JSX/TSX into executable JS
  2) Rewrite `import()` lazy loads to `helpers.loadModule(...)`
  3) Provide detailed, user-friendly errors
  4) Handle fetching (incl. SSL) for remote content
  5) Unit tests covering common scenarios; ensure `template/hooks/client/get-client.jsx` transpiles
  6) Update client-web to use new crate
  7) Update client-react-native to use new crate and Debug tab to test

#### Work Items and Status

- [x] Create Rust crate `crates/hook-transpiler`
  - [x] Add to Cargo workspace
  - [x] Implement SWC-based pipeline (TS/TSX parsing, TS strip, JSX transform classic runtime with pragma `h`)
  - [x] Implement dynamic `import()` rewrite to `context.helpers.loadModule(spec)`
  - [x] Optionally emit CommonJS (for RN) via transform flag
  - [x] Friendly error types (parse/transform/codegen + filename/loc)
  - [x] Initial unit tests (basic JSX, dynamic import rewrite, minimal get-client snippet)

- [ ] Expand unit tests
  - [ ] Transpile real `template/hooks/client/get-client.jsx` end-to-end
  - [ ] TSX inter-module async imports (A imports B lazily)
  - [ ] Error reporting tests with code frames and locations

- [ ] Web/WASM bindings (client-first strategy)
  - [ ] Expose `transpile_jsx(source, filename)` via `wasm-bindgen`
  - [ ] Return `{ code, map, diagnostics }`
  - [ ] Document bundling/loading in client-web
  - [ ] Ensure client-web prefers in-browser WASM transpilation first; if it fails, fallback to server `/api/transpile`

- [ ] Server integration (fallback path)
  - [ ] Add `/api/transpile` POST endpoint in `apps/server` using the crate
  - [ ] Request: `{ code, filename, toCommonJs? }` → Response: `{ code, map, diagnostics }`
  - [ ] Map crate errors to user-friendly messages + loc

- [ ] Client-web integration (client-first with server fallback)
  - [ ] Load WASM transpiler at startup; attempt client-side transpile first
  - [ ] On failure, automatically call server `/api/transpile` as a fallback (with diagnostics)
  - [ ] Replace current SWC/Babel path in `runtimeLoader` with new client-first pipeline
  - [ ] Ensure lazy imports use `helpers.loadModule` (via rewrite)
  - [ ] Surface diagnostics in UI panels

- [ ] Client-react-native integration (client-first where feasible)
  - [ ] Attempt in-app transpilation via WASM or native binding where supported; otherwise call server transpile endpoint
  - [ ] Optionally request CommonJS output for RN until export handling is unified
  - [ ] Run built-in tests from Debug tab across OSes

- [ ] Fetch handling
  - [ ] Provide native fetch helper using `reqwest` with TLS in crate (for server-side use)
  - [ ] Provide WASM stub delegating to JS `fetch` (for web)

- [ ] Documentation
  - [ ] Crate `README.md` with examples and options
  - [ ] Migration notes for web and RN clients

#### Notes and Decisions
- Execution model keeps the existing `context` parameter; rewrite targets `context.helpers.loadModule` for lazy imports.
- For RN: initial integration may use server-side transpilation to avoid WASM/JSI complexity; CommonJS option is available if needed.
- Source maps are currently omitted; can be enabled later if required.

#### Next Steps (short-term)
1) Add server `/api/transpile` endpoint using the crate with comprehensive error mapping.
2) Update client-web to call the endpoint under a feature flag and verify `get-client.jsx` end-to-end.
3) Add unit test that loads and transpiles the real `template/hooks/client/get-client.jsx` file.
4) Update RN Debug tab to invoke the transpiler and run internal tests.
