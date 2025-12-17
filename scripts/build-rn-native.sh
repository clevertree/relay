#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR="$SCRIPT_DIR/.."

echo "Building native Rust libraries for React Native..."

# Android builds
echo "Building Android libraries..."
bash "$SCRIPT_DIR/rn-prepare-hook-transpiler.sh"
bash "$SCRIPT_DIR/rn-prepare-themed-styler.sh"

# iOS builds (if on macOS)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "Building iOS libraries..."
  bash "$SCRIPT_DIR/ios-prepare-hook-transpiler.sh"
  bash "$SCRIPT_DIR/ios-prepare-themed-styler.sh"
else
  echo "Skipping iOS builds (not on macOS)"
fi

echo "All native libraries built successfully!"
