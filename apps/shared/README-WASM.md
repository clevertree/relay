# WASM build and re-embed instructions

This document describes how to build the project's wasm-enabled crates and where to place the generated wasm-bindgen artifacts for the client-web app.

Canonical location for wasm-bindgen outputs
- apps/client-web/src/wasm/

Why this location?
- The client-web Vite build can statically analyze and rewrite imports for modules inside `src/`.
- Keeping the generated JS and .wasm files inside `apps/client-web/src/wasm` avoids Vite `fs.allow` and `/public` import limitations.

How to rebuild themed-styler (example)
1. Build the themed-styler crate for wasm32:

```bash
cd <repo-root>
cargo build --manifest-path crates/themed-styler/Cargo.toml --target wasm32-unknown-unknown --release
```

2. Run wasm-bindgen to produce bundler-target glue (JS + wasm + .d.ts):

```bash
wasm-bindgen target/wasm32-unknown-unknown/release/themed_styler.wasm \
  --out-dir /tmp/themed-styler-wasm --target bundler --typescript
```

3. Copy the produced files into the client-web src folder:

```bash
mkdir -p apps/client-web/src/wasm
cp /tmp/themed-styler-wasm/themed_styler.* apps/client-web/src/wasm/
```

4. Restart the client-web dev server (Vite) so the new files are picked up.

Notes about hook-transpiler
- The hook-transpiler wasm follows the same pattern. Build the crate and run wasm-bindgen and copy outputs into `apps/client-web/src/wasm`.

Loader
- The shared consolidated loader (`apps/shared/src/wasmLoader.ts`) now expects a client shim at `/src/wasmEntry` which re-exports the generated glue and exposes `initAllClientWasms()` for initialization.

Troubleshooting
- If Vite errors about importing files in /public: ensure you import the shim from `/src/wasmEntry` (inside `src`), not from `/public` directly.
- If the global hooks are not available at runtime, visit `/wasm-test.html` to see logs and failure reasons.

