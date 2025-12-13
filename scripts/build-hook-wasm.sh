#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CRATE_DIR="$ROOT_DIR/crates/hook-transpiler"
OUT_DIR="$ROOT_DIR/apps/client-web/public/wasm"
TARGET_DIR="$CRATE_DIR/target/wasm32-unknown-unknown/release"

echo "[build-hook-wasm] Root dir: $ROOT_DIR"
echo "[build-hook-wasm] Crate dir: $CRATE_DIR"
echo "[build-hook-wasm] Out dir:   $OUT_DIR"

mkdir -p "$OUT_DIR"

# Ensure wasm32 target
echo "[build-hook-wasm] Adding wasm32-unknown-unknown target (if needed)"
rustup target add wasm32-unknown-unknown || true

echo "[build-hook-wasm] Setting RUSTFLAGS for getrandom wasm_js backend"
export RUSTFLAGS="${RUSTFLAGS:-} --cfg getrandom_backend=\"wasm_js\""

echo "[build-hook-wasm] Building crate with cargo (release, target wasm32-unknown-unknown) in crate dir"
pushd "$CRATE_DIR" >/dev/null
cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --features wasm
popd >/dev/null

WASM_BIN="$TARGET_DIR/relay_hook_transpiler.wasm"
if [ ! -f "$WASM_BIN" ]; then
  echo "[build-hook-wasm] ERROR: Built wasm not found at $WASM_BIN" >&2
  exit 1
fi

# Locate wasm-bindgen CLI
WASM_BINDGEN_BIN="${WASM_BINDGEN_BIN:-}"
if [ -z "$WASM_BINDGEN_BIN" ]; then
  if command -v wasm-bindgen >/dev/null 2>&1; then
    WASM_BINDGEN_BIN="$(command -v wasm-bindgen)"
  elif [ -x "$HOME/.cargo/bin/wasm-bindgen" ]; then
    WASM_BINDGEN_BIN="$HOME/.cargo/bin/wasm-bindgen"
  elif [ -n "${CARGO_HOME:-}" ] && [ -x "$CARGO_HOME/bin/wasm-bindgen" ]; then
    WASM_BINDGEN_BIN="$CARGO_HOME/bin/wasm-bindgen"
  fi
fi

if [ -z "$WASM_BINDGEN_BIN" ]; then
  echo "[build-hook-wasm] wasm-bindgen not found. Install via: cargo install wasm-bindgen-cli, or set WASM_BINDGEN_BIN to the binary path." >&2
  exit 1
fi

echo "[build-hook-wasm] Using wasm-bindgen: $WASM_BINDGEN_BIN"
echo "[build-hook-wasm] Generating JS glue (target web) to $OUT_DIR"
"$WASM_BINDGEN_BIN" "$WASM_BIN" \
  --target web \
  --out-dir "$OUT_DIR" \
  --out-name hook_transpiler

echo "[build-hook-wasm] Build complete. Artifacts:"
ls -la "$OUT_DIR" | sed 's/^/[build-hook-wasm] /'
