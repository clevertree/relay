#!/usr/bin/env bash
set -euo pipefail

# Simple helper to build wasm crates and copy wasm-bindgen outputs into apps/client-web/src/wasm
# Usage: ./scripts/build-wasm.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_WASM_DIR="$REPO_ROOT/apps/client-web/src/wasm"
TMP_DIR="$(mktemp -d)"

mkdir -p "$CLIENT_WASM_DIR"

echo "Building hook-transpiler wasm..."
cd "$REPO_ROOT/crates/hook-transpiler"
# build target
cargo build --release --target wasm32-unknown-unknown
# locate the wasm artifact (filename can be prefixed by crate/lib name)
wasm_bindgen_target="$(ls "$REPO_ROOT/target/wasm32-unknown-unknown/release"/*hook*transpiler*.wasm 2>/dev/null | head -n 1 || true)"
if [ -z "$wasm_bindgen_target" ] || [ ! -f "$wasm_bindgen_target" ]; then
  echo "hook_transpiler wasm not found in $REPO_ROOT/target/wasm32-unknown-unknown/release"
  ls -la "$REPO_ROOT/target/wasm32-unknown-unknown/release" || true
  exit 1
fi
echo "Found hook wasm: $wasm_bindgen_target"
wasm-bindgen "$wasm_bindgen_target" --out-dir "$TMP_DIR" --target bundler --typescript
# copy all outputs from wasm-bindgen for the hook module (handles any filename prefixes)
cp "$TMP_DIR"/* "$CLIENT_WASM_DIR/" || true
# clear tmp for next step
rm -rf "$TMP_DIR"/*

echo "Building themed-styler wasm..."
cd "$REPO_ROOT/crates/themed-styler"
cargo build --release --target wasm32-unknown-unknown
wasm_bindgen_target="$(ls "$REPO_ROOT/target/wasm32-unknown-unknown/release"/*themed*styler*.wasm 2>/dev/null | head -n 1 || true)"
if [ -z "$wasm_bindgen_target" ] || [ ! -f "$wasm_bindgen_target" ]; then
  echo "themed_styler wasm not found in $REPO_ROOT/target/wasm32-unknown-unknown/release"
  ls -la "$REPO_ROOT/target/wasm32-unknown-unknown/release" || true
  exit 1
fi
echo "Found themed styler wasm: $wasm_bindgen_target"
wasm-bindgen "$wasm_bindgen_target" --out-dir "$TMP_DIR" --target bundler --typescript
cp "$TMP_DIR"/themed_styler.* "$CLIENT_WASM_DIR/" || {
  cp "$TMP_DIR"/*themed_styler.* "$CLIENT_WASM_DIR/" || true
}

# The theme defaults are now embedded in the Rust crate (crates/themed-styler/src/default_state.rs).
# Previous embedding into a JSON file has been removed.

# cleanup
rm -rf "$TMP_DIR"

echo "WASM build complete. Artifacts copied to $CLIENT_WASM_DIR"

exit 0
