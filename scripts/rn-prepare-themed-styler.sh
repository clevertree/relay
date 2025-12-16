#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CRATE_DIR="$ROOT_DIR/crates/themed-styler"
CARGO_TARGET_DIR="$CRATE_DIR/target"
export CARGO_TARGET_DIR
JNI_LIBS_DIR="$ROOT_DIR/apps/client-react-native/android/app/src/main/jniLibs"

TARGETS=(
  aarch64-linux-android
  armv7-linux-androideabi
  x86_64-linux-android
)
ABI_DIRS=(
  arm64-v8a
  armeabi-v7a
  x86_64
)

# Build using cargo-ndk (if unavailable instruct user)
if ! command -v cargo-ndk >/dev/null 2>&1; then
  echo "[rn-prepare-themed-styler] cargo-ndk is not installed. Install it via 'cargo install cargo-ndk' and ensure Android targets are configured." >&2
  exit 1
fi

pushd "$CRATE_DIR" >/dev/null
NDK_ARGS=()
for target in "${TARGETS[@]}"; do
  NDK_ARGS+=("-t" "$target")
done
NDK_ARGS+=(build --release)

cargo ndk "${NDK_ARGS[@]}"
popd >/dev/null

echo "[rn-prepare-themed-styler] Copying native libraries into $JNI_LIBS_DIR"

for idx in "${!TARGETS[@]}"; do
  target="${TARGETS[$idx]}"
  abi="${ABI_DIRS[$idx]}"
  src_path="$CRATE_DIR/target/$target/release/libthemed_styler.so"
  if [[ ! -f "$src_path" ]]; then
    echo "[rn-prepare-themed-styler] ERROR: expected build artifact missing at $src_path" >&2
    exit 1
  fi
  dest_dir="$JNI_LIBS_DIR/$abi"
  mkdir -p "$dest_dir"
  cp "$src_path" "$dest_dir/libthemed_styler.so"
  echo "[rn-prepare-themed-styler] Updated $dest_dir/libthemed_styler.so"
done

echo "[rn-prepare-themed-styler] Themed-styler embedding complete."
