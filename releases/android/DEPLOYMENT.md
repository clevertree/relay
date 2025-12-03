# Android Release APK Deployment Guide

## Latest Build

- **APK**: `relay-release-20251203-095202.apk`
- **Size**: 70.2 MB
- **Built**: December 3, 2025, 9:52 AM
- **Build Status**: ✅ SUCCESS (all tests passed)

## Installation Methods

### Method 1: Android Emulator (Development)

```bash
# Prerequisites: Android SDK and emulator running
# Start emulator from Android Studio or:
emulator -avd Medium_Phone_API_36.1

# Install APK
adb install relay-release-20251203-095202.apk

# Or reinstall if already installed
adb install -r relay-release-20251203-095202.apk

# Launch app
adb shell am start -n com.relayapp/.MainActivity
```

### Method 2: Physical Device (Testing)

```bash
# Connect device via USB with debugging enabled
# Verify connection
adb devices

# Install APK
adb install relay-release-20251203-095202.apk

# Launch app
adb shell am start -n com.relayapp/.MainActivity
```

### Method 3: Manual Installation (User)

1. Transfer APK to Android device
2. Open file manager and navigate to APK location
3. Tap APK to install
4. Allow installation from unknown sources if prompted
5. Tap "Install"
6. Launch app from app drawer

## Build Configuration

### Build Variant
- **Type**: Release (optimized, signed)
- **Proguard**: Enabled (code obfuscation)
- **Debugging**: Disabled (production-ready)

### What's Included
- ✅ React Native runtime
- ✅ Relay peer networking
- ✅ WebView plugin support
- ✅ Rust bridge for native performance
- ✅ Tab management
- ✅ Peer probing (health checks)
- ✅ Plugin switching (declarative & webview)

### Build Output
- **Location**: `apps/client-react-native/android/app/build/outputs/apk/release/`
- **File**: `app-release.apk` (development) → copied to `relay-release-*.apk` (versioned)
- **Signature**: Signed with release keystore

## VM Deployment

### Prerequisites for VM Testing

```powershell
# 1. Ensure Android SDK/Emulator installed
where adb

# 2. Start VM instance (Cloud/Local)
# For Hyper-V or VirtualBox with Android x86_64 guest

# 3. Access VM
ssh -p 5555 android@vm_ip  # if SSH enabled
# OR use ADB over network
adb connect vm_ip:5555
```

### Deploy to VM

```bash
# Copy APK to VM
scp releases/android/relay-release-20251203-095202.apk android@vm_ip:/home/android/

# SSH into VM
ssh android@vm_ip

# Install via ADB (if ADB daemon running on VM)
adb install relay-release-20251203-095202.apk
```

## Testing Checklist

After deployment, verify:

- [ ] App launches without crash
- [ ] PeersView displays master peer list
- [ ] Can tap peer and open tab
- [ ] Tab switching works
- [ ] Can select different plugins (Native/WebView)
- [ ] Plugin content renders
- [ ] Peer probing status updates
- [ ] No memory leaks (MonitoringTools)
- [ ] Performance acceptable (<500ms operations)

## Troubleshooting

### Installation Fails
```
adb: command not found
→ Install Android SDK Platform Tools

Installation blocked - "Parse error"
→ APK may be corrupted. Re-download or rebuild

Device storage full
→ Clear app data or uninstall unused apps
```

### App Crashes on Launch
```
Check logcat for errors:
adb logcat | grep "relay\|FATAL\|Exception"

Common causes:
- Missing Rust native libraries → Rebuild with NDK
- Incompatible Android API → Check minSdkVersion in build.gradle
- Missing permissions → Grant in app settings
```

### Tab/Plugin Not Working
```
Check Xcode debugger or logcat:
adb logcat *:V | grep "relay\|tab\|plugin"

Verify:
- WebView plugin configured
- Network permissions granted
- Peer endpoints responding
```

## Version Management

### Build Scripts in package.json

```json
{
  "rn:android": "react-native run-android",           // Debug build to emulator
  "rn:android:release": "cd android && gradlew.bat installRelease" // Release APK
}
```

### Versioning Convention

Releases stored as: `relay-release-YYYYMMDD-HHMMSS.apk`

Update version in `apps/client-react-native/package.json`:
```json
{
  "version": "0.1.0"  // Increment for major releases
}
```

## Build Performance

- **Debug build**: ~2-3 minutes (includes Metro bundle)
- **Release build**: ~2-3 minutes (includes ProGuard + optimization)
- **Deployment**: ~30 seconds to emulator/device
- **App startup**: <2 seconds on modern devices

## Next Steps

1. **Deploy to emulator** for quick testing
2. **Monitor logs** for any issues
3. **Test peer connectivity** with staging peers
4. **Generate ProGuard mappings** for crash debugging
5. **Prepare for Play Store** release (signing, screenshots, description)

## Support

For issues with:
- **Build**: Check `apps/client-react-native/ANDROID_BUILD.md`
- **React Native**: Review `apps/client-react-native/docs/`
- **Rust bridge**: Check `apps/client-react-native/rust/` for FFI issues
- **Peer networking**: Test with `npm run test:e2e:peers`
