# Android APK Signing Key Management Plan

## Problem
Currently, each GitHub Actions build generates a new debug keystore, which means:
- New APKs cannot be installed over previous versions (signature mismatch)
- Users cannot perform in-app OTA updates to newer versions
- Each build is treated as a completely different app by Android

## Solution: Store Signing Key in GitHub Secrets

### Implementation Steps

#### 1. Generate a Production Signing Key (One-time, Local Setup)
```bash
# Generate a new keystore for production releases
keytool -genkey -v -keystore relay-release.keystore -keyalg RSA -keysize 2048 -validity 10000 \
  -alias relay-release -keypass <STRONG_PASSWORD> -storepass <STRONG_PASSWORD> \
  -dname "CN=Relay,O=Relay,L=Earth,ST=World,C=US"

# DO NOT commit this file to Git!
```

#### 2. Encode Keystore as Base64 for GitHub Secrets
```bash
# Convert binary keystore to base64 for safe storage
base64 -w 0 relay-release.keystore > relay-release.keystore.b64
cat relay-release.keystore.b64  # Copy output

# Store passwords securely
echo "KEYSTORE_ALIAS=relay-release"
echo "KEYSTORE_PASSWORD=<from-step-1>"
echo "KEY_PASSWORD=<from-step-1>"
```

#### 3. Create GitHub Secrets
Go to: `Settings → Secrets and variables → Actions → New repository secret`

Create these secrets:
- **`ANDROID_KEYSTORE_B64`**: The base64-encoded keystore (from step 2)
- **`ANDROID_KEYSTORE_ALIAS`**: `relay-release`
- **`ANDROID_KEYSTORE_PASSWORD`**: The keystore password
- **`ANDROID_KEY_PASSWORD`**: The key password (usually same as keystore)

#### 4. Update `build.gradle` (app/build.gradle)
Modify the signing config to use environment variables:

```groovy
signingConfigs {
  release {
    keyAlias System.getenv("ANDROID_KEYSTORE_ALIAS") ?: "androiddebugkey"
    keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: "android"
    storeFile file(System.getenv("KEYSTORE_PATH") ?: "debug.keystore")
    storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD") ?: "android"
  }
}
```

#### 5. Update GitHub Actions Workflow
Add these steps before `Assemble release APK`:

```yaml
- name: Restore signing keystore from secrets
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  working-directory: apps/client-react-native/android/app
  env:
    KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}
    KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
    KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
    KEYSTORE_ALIAS: ${{ secrets.ANDROID_KEYSTORE_ALIAS }}
  run: |
    if [ -z "$KEYSTORE_B64" ]; then
      echo "Keystore secret not configured, generating debug key..."
      keytool -genkey -v -keystore debug.keystore -keyalg RSA -keysize 2048 -validity 10000 \
        -alias androiddebugkey -keypass android -storepass android \
        -dname "CN=Android Debug,O=Android,C=US"
    else
      echo "Decoding keystore from secrets..."
      echo "$KEYSTORE_B64" | base64 -d > relay-release.keystore
      echo "Keystore restored successfully"
    fi

- name: Assemble release APK
  working-directory: apps/client-react-native/android
  env:
    KEYSTORE_PATH: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && './app/relay-release.keystore' || '' }}
    ANDROID_KEYSTORE_ALIAS: ${{ secrets.ANDROID_KEYSTORE_ALIAS }}
    ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
  run: |
    chmod +x gradlew
    ./gradlew assembleRelease -x bundleReleaseResources --no-daemon
```

#### 6. Add Keystore to .gitignore
```bash
# Ensure keystores are never committed
echo "*.keystore" >> .gitignore
echo "*.keystore.b64" >> .gitignore
echo "*-release.keystore" >> .gitignore
```

### Behavior

| Scenario | Keystore Used | APK Signature |
|----------|---------------|---------------|
| PR / Branch builds | Debug (generated) | Changes each build |
| Main branch push | Release (from secrets) | **Consistent** ✓ |
| Local development | Local debug.keystore | Varies |

### Benefits
✓ All main branch releases use the **same signature**  
✓ APKs can be installed over previous versions  
✓ OTA updates work seamlessly  
✓ Debug builds on branches don't interfere  
✓ Secrets are encrypted and secure  
✓ No keystore checked into version control  

### Security Considerations
- The keystore password is stored in GitHub Secrets (encrypted at rest)
- Base64 encoding is not encryption—only for safe storage in plain-text YAML
- Consider using GitHub's "dependabot secrets" with expiration if needed
- Keystore should never be committed to Git
- Regenerate keystore if compromised

### Next Steps
1. Generate the production keystore locally
2. Encode it to base64
3. Add the 3 secrets to GitHub repository settings
4. Update `build.gradle` and `.github/workflows/android-build.yml`
5. Test on a push to `main`
6. Verify APK signature consistency with `jarsigner -verify -verbose -certs <apk>`

### Verification
After setup, verify the signature is consistent:
```bash
# Download two APKs from different builds
jarsigner -verify -verbose -certs app-release-1.apk
jarsigner -verify -verbose -certs app-release-2.apk

# Should show the same certificate details and owner
```

