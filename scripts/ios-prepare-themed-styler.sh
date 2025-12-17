#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STYLER_CRATE_DIR="$ROOT_DIR/crates/themed-styler"
CARGO_TARGET_DIR="$STYLER_CRATE_DIR/target"
export CARGO_TARGET_DIR
IOS_FRAMEWORKS_DIR="$ROOT_DIR/apps/client-react-native/ios/Frameworks"

TARGETS=(
  aarch64-apple-ios
  aarch64-apple-ios-sim
  x86_64-apple-ios
)

mkdir -p "$IOS_FRAMEWORKS_DIR"

echo "[ios-prepare-themed-styler] Building for iOS targets..."
pushd "$STYLER_CRATE_DIR" >/dev/null

for target in "${TARGETS[@]}"; do
  echo "[ios-prepare-themed-styler] Building $target..."
  cargo build --release --target "$target"
done

popd >/dev/null

echo "[ios-prepare-themed-styler] Creating universal binary..."

# Create lipo universal binary for device + simulator
lipo -create \
  "$CARGO_TARGET_DIR/aarch64-apple-ios/release/libthemed_styler.a" \
  "$CARGO_TARGET_DIR/aarch64-apple-ios-sim/release/libthemed_styler.a" \
  -output "$IOS_FRAMEWORKS_DIR/libthemed_styler.a"

echo "[ios-prepare-themed-styler] Universal binary created at $IOS_FRAMEWORKS_DIR/libthemed_styler.a"
echo "[ios-prepare-themed-styler] iOS themed-styler build complete."
