#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
HOOK_CRATE_DIR="$ROOT_DIR/crates/hook-transpiler"
CARGO_TARGET_DIR="$HOOK_CRATE_DIR/target"
export CARGO_TARGET_DIR
IOS_FRAMEWORKS_DIR="$ROOT_DIR/apps/client-react-native/ios/Frameworks"

TARGETS=(
  aarch64-apple-ios
  aarch64-apple-ios-sim
  x86_64-apple-ios
)

mkdir -p "$IOS_FRAMEWORKS_DIR"

echo "[ios-prepare-hook-transpiler] Building for iOS targets..."
pushd "$HOOK_CRATE_DIR" >/dev/null

for target in "${TARGETS[@]}"; do
  echo "[ios-prepare-hook-transpiler] Building $target..."
  cargo build --release --target "$target"
done

popd >/dev/null

echo "[ios-prepare-hook-transpiler] Creating universal binary..."

# Create lipo universal binary for device + simulator
lipo -create \
  "$CARGO_TARGET_DIR/aarch64-apple-ios/release/librelay_hook_transpiler.a" \
  "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/librelay_hook_transpiler.a" \
  -output "$IOS_FRAMEWORKS_DIR/librelay_hook_transpiler.a"

echo "[ios-prepare-hook-transpiler] Universal binary created at $IOS_FRAMEWORKS_DIR/librelay_hook_transpiler.a"
echo "[ios-prepare-hook-transpiler] iOS hook-transpiler build complete."
