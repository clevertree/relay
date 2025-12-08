# Android APK Internet Access Debugging Guide

## Summary of Issues Found

Based on the code analysis, here are the potential issues preventing the Android APK from accessing the internet:

### 1. **Missing Network Security Configuration (CRITICAL)**
**Problem**: Android 9+ (API 28+) blocks cleartext (HTTP) traffic by default. Your APK has:
- `targetSdkVersion = 34` (Android 14)
- Network endpoints that may include `http://localhost:3000` (cleartext)
- **No `network_security.xml` file** to allow cleartext traffic to specific domains

**Solution**: Create a network security configuration file to allow cleartext traffic to development/test servers.

### 2. **Incomplete Native Module Implementation**
**Problem**: The `RelayCoreModule.kt` in Kotlin has only placeholder implementations:
- `getMasterPeerList()` returns an empty list instead of reading from environment
- No actual network calls are implemented
- All methods are stubs waiting for Rust native code

**Impact**: Even with proper permissions, the app can't connect because the native bridge doesn't actually implement network functionality.

### 3. **Environment Injection May Not Work**
**Problem**: The `env-inject.js` file is manually edited but there's no build process to auto-generate it from `.env`:
- Uses hardcoded peer list instead of dynamic configuration
- Environment variables from Gradle/Android build system aren't injected
- Development APKs may not have the correct peer list

### 4. **Missing Permissions Implementation**
**Problem**: While `INTERNET` and `ACCESS_NETWORK_STATE` permissions are declared in `AndroidManifest.xml`, there's no runtime permission handling:
- Android 6+ (API 23+) requires runtime permission requests
- The APK declares permissions but doesn't request them at runtime
- App may be blocked from networking due to missing runtime permissions

## Fixes Required

### Fix 1: Create Network Security Configuration

Create file: `android/app/src/main/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Allow cleartext for localhost development -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
    
    <!-- Allow cleartext for local network ranges -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">192.168.0.0</domain>
        <domain includeSubdomains="true">10.0.0.0</domain>
        <domain includeSubdomains="true">172.16.0.0</domain>
    </domain-config>
    
    <!-- Production domains (HTTPS only) -->
    <!-- node-dfw1.relaynet.online and node-dfw2.relaynet.online use HTTPS -->
</network-security-config>
```

Then update `AndroidManifest.xml` to reference this configuration:

```xml
<application
    android:name="com.relay.client.MainApplication"
    android:label="@string/app_name"
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:allowBackup="false"
    android:theme="@style/AppTheme"
    android:supportsRtl="true"
    android:networkSecurityConfig="@xml/network_security_config">
    <!-- rest of config -->
</application>
```

### Fix 2: Implement Runtime Permission Handling

Create file: `android/app/src/main/java/com/relay/client/PermissionsManager.kt`

```kotlin
package com.relay.client

import android.Manifest
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.app.Activity

object PermissionsManager {
    private const val INTERNET_PERMISSION_REQUEST_CODE = 1001
    
    fun checkAndRequestNetworkPermissions(activity: Activity): Boolean {
        val permissions = arrayOf(
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE
        )
        
        val missingPermissions = permissions.filter { permission ->
            ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED
        }
        
        if (missingPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                activity,
                missingPermissions.toTypedArray(),
                INTERNET_PERMISSION_REQUEST_CODE
            )
            return false
        }
        return true
    }
}
```

Update `MainActivity.kt`:

```kotlin
import android.os.Bundle

class MainActivity : ReactActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PermissionsManager.checkAndRequestNetworkPermissions(this)
    }
    
    // ... rest of activity code
}
```

### Fix 3: Implement RelayCoreModule Network Functionality

Update `RelayCoreModule.kt` to actually read the peer list:

```kotlin
package com.relay.client

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.module.annotations.ReactModule
import java.net.URL

@ReactModule(name = "RelayCore")
class RelayCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "RelayCore"

  @ReactMethod
  fun getMasterPeerList(promise: Promise) {
    try {
      // Read from environment variable set during build or at runtime
      val peerListStr = System.getenv("RELAY_MASTER_PEER_LIST")
        ?: "http://10.0.2.2:3000"  // Android emulator default
      
      val peers = peerListStr.split(";")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { parseUrl(it) }
      
      promise.resolve(peers)
    } catch (e: Exception) {
      promise.reject("ERROR", "Failed to get master peer list: ${e.message}")
    }
  }

  private fun parseUrl(fullUrl: String): String {
    return try {
      val url = URL(fullUrl)
      val port = if (url.port != -1) ":${url.port}" else ""
      "${url.host}$port"
    } catch (e: Exception) {
      fullUrl  // Return as-is if parsing fails
    }
  }

  @ReactMethod
  fun probePeer(peerId: String, promise: Promise) {
    try {
      promise.reject("ERROR", "probePeer not yet implemented - use JS fallback")
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  @ReactMethod
  fun fetchOptions(promise: Promise) {
    try {
      promise.reject("ERROR", "fetchOptions not yet implemented - use JS fallback")
    } catch (e: Exception) {
      promise.reject("ERROR", e.message)
    }
  }

  // ... other stubs
}
```

### Fix 4: Add Build Configuration for Environment Injection

Update `android/app/build.gradle` to support environment variables:

```groovy
// Add at the top after imports
import java.io.BufferedReader
import java.io.InputStreamReader

android {
    // ... existing config ...
    
    // Read .env file for peer list
    defaultConfig {
        applicationId "com.relay.client"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
        
        // Build a list of peers from environment
        def relayPeerList = System.getenv("RELAY_MASTER_PEER_LIST")
        if (relayPeerList) {
            buildConfigField "String", "RELAY_PEER_LIST", "\"$relayPeerList\""
        } else {
            buildConfigField "String", "RELAY_PEER_LIST", "\"http://10.0.2.2:3000\""
        }
    }
}
```

Then use `BuildConfig` in the module:

```kotlin
// In RelayCoreModule.kt
val peerListStr = BuildConfig.RELAY_PEER_LIST
```

## Debugging Steps

### Step 1: Verify Permissions in APK
```bash
# Extract and check manifest
adb install -r app-release.apk
adb shell dumpsys package com.relay.client | grep permission
```

### Step 2: Enable Network Debugging
Add logging in `probing.ts`:

```typescript
console.debug(`[Probing] Attempting to fetch: ${url}`);
try {
  const res = await fetchWithTimeout(url, options);
  console.debug(`[Probing] Response: ${res.status} from ${url}`);
} catch (error) {
  console.error(`[Probing] Failed to reach ${url}: ${error.message}`);
}
```

### Step 3: Check Logcat for Network Errors
```bash
adb logcat | grep -E "(Network|HTTP|fetch|EHOSTUNREACH|ECONNREFUSED)"
```

### Step 4: Test with curl/wget
On Android device via adb:
```bash
adb shell
curl -v http://localhost:3000  # or your peer address
```

### Step 5: Verify Network Connectivity
```bash
adb shell
# Check network status
getprop net.dns1
getprop net.dns2
netstat -tuln | grep LISTEN  # See listening ports
```

## Network Security Config Best Practices

For **production**: Only HTTPS to verified domains
For **staging**: Allow HTTP to internal test servers with proper domain restrictions
For **development**: Allow cleartext to localhost and 10.0.2.2 (emulator host)

Example production config:
```xml
<domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="true">relaynet.online</domain>
</domain-config>
```

## Testing Checklist

- [ ] Network security config XML created and references correct domains
- [ ] AndroidManifest.xml updated to use `android:networkSecurityConfig`
- [ ] Runtime permissions requested in MainActivity
- [ ] RelayCoreModule returns actual peer list (not empty)
- [ ] Environment variables properly injected during build
- [ ] Logcat shows successful HTTP/HTTPS connections
- [ ] APK can reach at least one peer
- [ ] Peer probing displays results in PeersView

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Failed to fetch" errors | Cleartext blocked by Android 9+ | Create network_security_config.xml |
| Empty peer list | RelayCoreModule returns empty array | Implement getMasterPeerList() properly |
| Permissions denied | Runtime permissions not requested | Add permission requests in MainActivity |
| Localhost unreachable | Using wrong IP for emulator | Use 10.0.2.2 for Android emulator host |
| HTTPS certificate errors | Self-signed certs in dev | Add domain to network_security_config with cleartextTrafficPermitted |
| "Unknown host" errors | DNS not resolving | Check network connectivity, try IP address instead |

## References

- [Android Network Security Configuration](https://developer.android.com/training/articles/security-config)
- [Android Runtime Permissions](https://developer.android.com/training/permissions/requesting)
- [React Native Bridge Documentation](https://reactnative.dev/docs/native-modules-android)
