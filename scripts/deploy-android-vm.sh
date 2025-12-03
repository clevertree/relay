#!/bin/bash
# Deploy Android release APK to VM or device
# Usage: ./deploy-android-vm.sh <target_vm_ip> [port]

set -e

VM_IP="${1:-localhost}"
ADB_PORT="${2:-5555}"
APK_FILE="releases/android/relay-release-20251203-095202.apk"

if [ ! -f "$APK_FILE" ]; then
    echo "Error: APK not found at $APK_FILE"
    exit 1
fi

echo "🚀 Android Release Deployment"
echo "========================================"
echo "APK: $APK_FILE"
echo "Target: $VM_IP:$ADB_PORT"
echo ""

# Check ADB availability
if ! command -v adb &> /dev/null; then
    echo "❌ ADB not found. Install Android SDK Platform Tools"
    exit 1
fi

echo "📱 Connecting to device/emulator..."
adb connect "$VM_IP:$ADB_PORT" || true

# Wait for device to be ready
echo "⏳ Waiting for device to be ready..."
adb -s "$VM_IP:$ADB_PORT" wait-for-device
sleep 2

echo "📦 Installing APK..."
adb -s "$VM_IP:$ADB_PORT" install -r "$APK_FILE"

echo "✅ Installation complete!"
echo ""
echo "🎬 Launching app..."
adb -s "$VM_IP:$ADB_PORT" shell am start -n com.relayapp/.MainActivity

echo ""
echo "📊 App launched! Monitoring logs..."
adb -s "$VM_IP:$ADB_PORT" logcat | grep -E "relay|Exception|FATAL" &
LOGCAT_PID=$!

sleep 5
echo ""
echo "💡 Tips:"
echo "   - Press Ctrl+C to stop log monitoring"
echo "   - Keep this terminal open to see app output"
echo "   - Run 'adb logcat' in another terminal for detailed logs"
echo ""

wait $LOGCAT_PID 2>/dev/null || true
