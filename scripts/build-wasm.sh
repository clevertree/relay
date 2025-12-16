#!/usr/bin/env bash
set -euo pipefail

# Simple helper to build wasm crates and copy wasm-bindgen outputs into apps/client-web/src/wasm
# Usage: ./scripts/build-wasm.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_WASM_DIR="$REPO_ROOT/apps/client-web/src/wasm"
CLIENT_PUBLIC_WASM_DIR="$REPO_ROOT/apps/client-web/public/wasm"
TMP_DIR="$(mktemp -d)"

mkdir -p "$CLIENT_WASM_DIR"
mkdir -p "$CLIENT_PUBLIC_WASM_DIR"
# We will populate "$CLIENT_WASM_DIR" with wasm-bindgen outputs so Vite can
# use bundler-resolved `?url` imports. public/wasm is optional and not primary.

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
# copy all outputs from wasm-bindgen into src/wasm (bundler-friendly). We also
# keep a copy in public/wasm for optional static serving, but src/wasm is primary.
cp "$TMP_DIR"/* "$CLIENT_WASM_DIR/" || true
cp "$TMP_DIR"/* "$CLIENT_PUBLIC_WASM_DIR/" || true
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
# Copy all themed_styler outputs (match underscores like themed_styler_bg.wasm)
cp "$TMP_DIR"/*themed_styler* "$CLIENT_WASM_DIR/" || {
  cp "$TMP_DIR"/*themed_styler* "$CLIENT_WASM_DIR/" || true
}
# also copy to public for optional static serving
cp "$TMP_DIR"/*themed_styler* "$CLIENT_PUBLIC_WASM_DIR/" || true

# Write a small manifest that includes the crate version and wasm md5 so the UI can detect stale files
if [ -f "$REPO_ROOT/crates/themed-styler/Cargo.toml" ]; then
  version=$(grep '^version' "$REPO_ROOT/crates/themed-styler/Cargo.toml" | head -n1 | awk -F'=' '{gsub(/"/, "", $2); print $2}' | tr -d '[:space:]') || version="unknown"
else
  version="unknown"
fi
wasm_path_src="$CLIENT_WASM_DIR/themed_styler_bg.wasm"
if [ -f "$wasm_path_src" ]; then
  wasm_md5=$(md5 -q "$wasm_path_src" 2>/dev/null || echo "")
  cat > "$CLIENT_PUBLIC_WASM_DIR/themed_styler.manifest.json" <<EOF
{
  "version": "${version}",
  "wasm_md5": "${wasm_md5}",
  "wasm_path": "/wasm/themed_styler_bg.wasm",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  # Also copy manifest into src/wasm so the code that reads the local file can
  # inspect it if needed.
  cp "$CLIENT_PUBLIC_WASM_DIR/themed_styler.manifest.json" "$CLIENT_WASM_DIR/" || true
fi

# The theme defaults are now embedded in the Rust crate (crates/themed-styler/src/default_state.rs).
# Previous embedding into a JSON file has been removed.

# cleanup
rm -rf "$TMP_DIR"

echo "WASM build complete. Artifacts copied to $CLIENT_WASM_DIR"

exit 0
