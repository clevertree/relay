#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP_DIR="$ROOT_DIR/apps/client-react-native"
GRADLEW="$APP_DIR/android/gradlew"
GRADLEW_UNIX="$APP_DIR/android/gradlew"
SCRIPTS_DIR="$ROOT_DIR/scripts"

echo "[rn-build-release] Root: $ROOT_DIR"
echo "[rn-build-release] App:  $APP_DIR"
echo "[rn-build-release] Rebuilding hook-transpiler native libs"
bash "$SCRIPTS_DIR/rn-prepare-hook-transpiler.sh"

if [[ ! -x "$GRADLEW_UNIX" ]]; then
  echo "[rn-build-release] Gradle wrapper not executable, fixing perms"
  chmod +x "$GRADLEW_UNIX" || true
fi

pushd "$APP_DIR/android" >/dev/null
echo "[rn-build-release] Assembling release APK"
./gradlew assembleRelease

APK_DIR="app/build/outputs/apk/release"
APK_PATH=$(ls -1 "$APK_DIR"/*.apk 2>/dev/null | head -n1 || true)
if [[ -z "${APK_PATH}" ]]; then
  echo "[rn-build-release] ERROR: No APK found in $APK_DIR" >&2
  echo "[rn-build-release] Gradle finished, but the release variant may be configured to produce an AAB instead, or signing is required."
  popd >/dev/null
  exit 1
fi

echo "[rn-build-release] APK built: $APK_PATH"

echo "[rn-build-release] Attempting to install on connected devices (adb required)"
if command -v adb >/dev/null 2>&1; then
  # Optionally connect to TCP/IP devices if ADB_CONNECT is provided (comma-separated host[:port])
  if [[ -n "${ADB_CONNECT:-}" ]]; then
    IFS=',' read -r -a ADB_HOSTS <<< "$ADB_CONNECT"
    for host in "${ADB_HOSTS[@]}"; do
      host_trimmed="${host// /}"
      if [[ -n "$host_trimmed" ]]; then
        echo "[rn-build-release] adb connect $host_trimmed"
        adb connect "$host_trimmed" || true
      fi
    done
  fi

  # List devices and install to each
  DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  if [[ -z "$DEVICES" ]]; then
    echo "[rn-build-release] No device detected by adb. Set ADB_CONNECT=ip[:port][,ip2[:port]...] to auto-connect, or plug in a device and enable USB debugging." >&2
  else
    echo "[rn-build-release] Installing to devices: $DEVICES"
    install_ok=true
    for serial in $DEVICES; do
      echo "[rn-build-release] Installing to $serial"
      if adb -s "$serial" install -r "$APK_PATH"; then
        echo "[rn-build-release] Installed on $serial"
      else
        echo "[rn-build-release] Failed to install on $serial" >&2
        install_ok=false
      fi
    done
    if [[ "$install_ok" != true ]]; then
      echo "[rn-build-release] One or more installs failed. The release APK might be unsigned. Configure signing in android/app/build.gradle for installRelease, or sideload the APK manually." >&2
    fi
  fi
else
  echo "[rn-build-release] adb not found. Skipping install." >&2
fi

popd >/dev/null
echo "[rn-build-release] Done."
