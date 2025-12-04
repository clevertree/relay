# Self-Update Feature for Relay Android App

This implementation adds Over-The-Air (OTA) update capability to the Relay Android app, allowing it to download and install the latest APK from GitHub Actions workflow artifacts.

## Architecture

### Components

1. **GitHubUpdateService** (`src/services/GitHubUpdateService.ts`)
   - Fetches latest successful Android build from GitHub Actions API
   - Gets artifact information and download URLs
   - No authentication required for public repos (reads artifacts metadata)

2. **UpdateManager** (`src/services/UpdateManager.ts`)
   - High-level update orchestration
   - Handles check → download → permission request → install flow
   - Progress tracking with callbacks

3. **APKInstallerModule** (`android/app/src/main/java/.../APKInstallerModule.kt`)
   - Native Android module for installing APK files
   - Handles base64 data conversion
   - FileProvider integration for secure file access
   - Supports API 21+

4. **UpdateModal** (`src/components/UpdateModal.tsx`)
   - React Native UI component
   - Shows update progress and status
   - User-friendly dialogs for confirmation

5. **useAppUpdate** (`src/hooks/useAppUpdate.ts`)
   - React hook for easy integration into components

## Setup Instructions

### 1. Update build.gradle (if needed)

The AndroidManifest.xml already has the required permissions:
- `android.permission.REQUEST_INSTALL_PACKAGES` - to trigger APK installation
- `android.permission.INTERNET` - to download APK

### 2. Register the Native Module

Already done in `android/app/src/main/java/com/relay/client/MainApplication.kt`:

```kotlin
override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
      add(RelayCorePackage())
      add(APKInstallerPackage())  // ✓ Already added
    }
```

### 3. Add Build Configuration

Update your build version in `android/app/build.gradle`:

```groovy
android {
    defaultConfig {
        applicationId "com.relay.client"
        minSdkVersion 21  // or higher
        targetSdkVersion 34  // or your target
        versionCode 1
        versionName "1.0.0"
    }
}
```

## Usage

### Option A: Simple Check Button

```tsx
import { useAppUpdate } from '../hooks/useAppUpdate';
import { UpdateModal } from '../components/UpdateModal';
import { TouchableOpacity, Text } from 'react-native';

export function SettingsScreen() {
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  return (
    <>
      <TouchableOpacity onPress={checkForUpdate}>
        <Text>Check for Updates</Text>
      </TouchableOpacity>

      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </>
  );
}
```

### Option B: Auto-Check on App Launch

```tsx
import { useEffect } from 'react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { UpdateModal } from '../components/UpdateModal';

export function App() {
  const { showUpdateModal, setShowUpdateModal, checkForUpdate } = useAppUpdate();

  useEffect(() => {
    // Check for updates on app launch
    checkForUpdate();
  }, []);

  return (
    <>
      {/* Your app content */}
      <UpdateModal
        visible={showUpdateModal}
        onDismiss={() => setShowUpdateModal(false)}
      />
    </>
  );
}
```

### Option C: Manual Control with Progress Tracking

```tsx
import { UpdateManager } from '../services/UpdateManager';

async function customUpdateFlow() {
  const success = await UpdateManager.performUpdate((progress) => {
    console.log(`${progress.status}: ${progress.message} (${progress.progress}%)`);
  });

  if (success) {
    console.log('Update completed!');
  } else {
    console.error('Update failed');
  }
}
```

## How It Works

### Update Flow

1. **Check for Update**
   - Calls GitHub API to get latest successful `android-build` workflow run
   - Fetches artifacts from that run
   - Returns artifact info and download URL

2. **Request Permissions**
   - Android 12+: Prompts user for `REQUEST_INSTALL_PACKAGES` permission
   - Lower versions: Permission is granted at install time

3. **Download APK**
   - Downloads APK from GitHub (public artifact)
   - Converts to base64 data URL for native module
   - Shows download progress

4. **Install APK**
   - Passes APK data to native `APKInstallerModule`
   - Uses FileProvider for secure file access
   - Triggers system install UI

### Data Flow Diagram

```
UpdateModal (UI)
    ↓
useAppUpdate (Hook)
    ↓
UpdateManager (Orchestration)
    ↓
GitHubUpdateService (API)  ←→  GitHub API
    ↓
APKInstallerModule (Native)
    ↓
Android System (Install)
```

## Configuration

### GitHub API Settings

In `GitHubUpdateService.ts`, you can customize:

```typescript
const GITHUB_OWNER = 'clevertree';      // Your GitHub username/org
const GITHUB_REPO = 'relay';             // Your repository name
const WORKFLOW_NAME = 'android-build.yml'; // Workflow filename
```

### Version Management

Set current app version in your App.tsx:

```tsx
import { setCurrentVersion } from '../services/UpdateManager';

// In your App component
useEffect(() => {
  setCurrentVersion('1.0.0'); // Match your build.gradle versionName
}, []);
```

## Permissions Required

### AndroidManifest.xml (already added)

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

### Runtime Permissions

The update flow automatically requests `REQUEST_INSTALL_PACKAGES` at runtime before installation.

## Security Considerations

### Current Implementation

- ✓ Uses HTTPS for GitHub API
- ✓ FileProvider for secure file access
- ✓ Validates artifact existence before download
- ✓ APK signature verified by Android system

### For Production

1. **Add Version Validation**
   ```typescript
   // Compare semantic versions
   function isNewVersion(current: string, latest: string): boolean {
     return semver.gt(latest, current);
   }
   ```

2. **Add Checksum Verification**
   ```typescript
   // Verify APK hash before installation
   const hash = await calculateSHA256(apkBlob);
   if (hash !== expectedHash) throw new Error('APK verification failed');
   ```

3. **Implement Rollback Logic**
   ```typescript
   // Store previous APK version for fallback
   if (updateFails()) {
     await revertToPreviousVersion();
   }
   ```

4. **Add Error Reporting**
   ```typescript
   // Track update failures
   if (updateFailed) {
     await reportToAnalytics('update_failed', { error, version });
   }
   ```

## Troubleshooting

### "APK file not found"

- Check that the artifact is generated by the GitHub workflow
- Verify the workflow has completed successfully
- Check artifact retention settings

### "Permission denied"

- Ensure `REQUEST_INSTALL_PACKAGES` permission is in AndroidManifest.xml
- User must grant permission when prompted
- Some Android versions may block side-loaded apps

### "Installation failed"

- Verify the APK signature matches
- Check Android version compatibility (minSdkVersion)
- Ensure sufficient storage space

### Network Issues

- Implement retry logic for download failures
- Add timeout configuration for large APK files
- Consider using differential updates for smaller downloads

## Testing

### Manual Testing

1. Build and run the app
2. Navigate to settings and tap "Check for Updates"
3. Accept the update when prompted
4. Monitor the download and installation process
5. App should restart with new version

### Automated Testing

```typescript
// Example test
test('checkForUpdate returns hasUpdate: true when new APK available', async () => {
  const result = await UpdateManager.checkForUpdate();
  expect(result.hasUpdate).toBe(true);
  expect(result.latestVersion).toBeDefined();
});
```

## Next Steps

1. **Integrate UpdateModal into your main App.tsx**
2. **Set up auto-check on app launch** (optional)
3. **Test with a real GitHub Actions workflow run**
4. **Customize UI to match app theme**
5. **Implement error tracking and analytics**

## API Reference

### UpdateManager

```typescript
// Check for update availability
checkForUpdate(): Promise<UpdateCheckResult>

// Get current version
setCurrentVersion(version: string): void

// Request install permissions
requestInstallPermissions(): Promise<boolean>

// Download APK from URL
downloadAPK(url: string, onProgress?: callback): Promise<string>

// Install downloaded APK
installAPK(apkPath: string, onProgress?: callback): Promise<boolean>

// Full update flow
performUpdate(onProgress?: callback): Promise<boolean>
```

### GitHubUpdateService

```typescript
// Get latest successful workflow run
getLatestWorkflowRun(): Promise<WorkflowRun | null>

// Get artifacts from a specific run
getArtifactsForRun(runId: number): Promise<ArtifactInfo[]>

// Get download URL for an artifact
getArtifactDownloadUrl(artifactId: number, token?: string): Promise<string>

// Get latest APK with download URL
getLatestAPK(token?: string): Promise<{artifact, downloadUrl}>
```

## License

This implementation is part of the Relay project.
