#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
HOOK_CRATE_DIR="$ROOT_DIR/crates/hook-transpiler"
CARGO_TARGET_DIR="$HOOK_CRATE_DIR/target"
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

#if ! command -v cargo-ndk >/dev/null 2>&1; then
#  echo "[rn-prepare-hook-transpiler] cargo-ndk is not installed. Install it via 'cargo install cargo-ndk' and ensure Android targets are configured." >&2
#  exit
#fi

pushd "$HOOK_CRATE_DIR" >/dev/null
NDK_ARGS=()
for target in "${TARGETS[@]}"; do
  NDK_ARGS+=("-t" "$target")
done
# Enable the Android feature so JNI symbols are exported from the cdylib
# Without this, the library loads but methods like
# Java_com_relay_client_RustTranspilerModule_nativeTranspile are missing.
NDK_ARGS+=(build --release --features android)

cargo ndk "${NDK_ARGS[@]}"
popd >/dev/null

echo "[rn-prepare-hook-transpiler] Copying native libraries into $JNI_LIBS_DIR"

for idx in "${!TARGETS[@]}"; do
  target="${TARGETS[$idx]}"
  abi="${ABI_DIRS[$idx]}"
  src_path="$HOOK_CRATE_DIR/target/$target/release/librelay_hook_transpiler.so"
  if [[ ! -f "$src_path" ]]; then
    echo "[rn-prepare-hook-transpiler] ERROR: expected build artifact missing at $src_path" >&2
    exit 1
  fi
  dest_dir="$JNI_LIBS_DIR/$abi"
  mkdir -p "$dest_dir"
  cp "$src_path" "$dest_dir/librelay_hook_transpiler.so"
  echo "[rn-prepare-hook-transpiler] Updated $dest_dir/librelay_hook_transpiler.so"
done

echo "[rn-prepare-hook-transpiler] Hook transpiler embedding complete."
