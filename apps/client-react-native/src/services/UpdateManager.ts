/**
 * Update Manager Service
 * Handles the business logic for checking, downloading, and installing updates
 */

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as GitHubUpdateService from './GitHubUpdateService';

const { APKInstaller } = NativeModules;

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  artifactName?: string;
  artifactUrl?: string;
  createdAt?: string;
}

export interface UpdateProgress {
  status: 'checking' | 'downloading' | 'installing' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
  error?: string;
}

let currentVersion = '1.0.0'; // Will be set from package.json or app config

/**
 * Set the current app version
 */
export function setCurrentVersion(version: string): void {
  currentVersion = version;
}

/**
 * Check if an update is available
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const latestAPK = await GitHubUpdateService.getLatestAPK();

    if (!latestAPK) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: 'unknown',
      };
    }

    // Simple version comparison: always consider it an update if we got a valid artifact
    // In production, you'd want to parse semantic versions
    return {
      hasUpdate: true,
      currentVersion,
      latestVersion: latestAPK.artifact.createdAt,
      artifactName: latestAPK.artifact.name,
      artifactUrl: latestAPK.downloadUrl,
      createdAt: latestAPK.artifact.createdAt,
    };
  } catch (error) {
    console.error('Error checking for update:', error);
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: 'error',
    };
  }
}

/**
 * Request necessary permissions for installing APK
 */
export async function requestInstallPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    console.warn('APK installation only supported on Android');
    return false;
  }

  try {
    const permission = PermissionsAndroid.PERMISSIONS.REQUEST_INSTALL_PACKAGES;
    const granted = await PermissionsAndroid.request(permission, {
      title: 'Install Update',
      message: 'Relay needs permission to install the updated app.',
      buttonNeutral: 'Ask Me Later',
      buttonNegative: 'Cancel',
      buttonPositive: 'OK',
    });

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.error('Error requesting install permissions:', error);
    return false;
  }
}

/**
 * Download APK from URL
 */
export async function downloadAPK(
  url: string,
  onProgress?: (progress: UpdateProgress) => void
): Promise<string | null> {
  try {
    onProgress?.({
      status: 'downloading',
      progress: 0,
      message: 'Starting download...',
    });

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = parseInt(contentLength || '0', 10);

    // Read the blob
    const blob = await response.blob();

    onProgress?.({
      status: 'downloading',
      progress: 100,
      message: 'Download complete',
    });

    // Return the blob URI - will be passed to APKInstaller
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.({
      status: 'error',
      progress: 0,
      message: 'Download failed',
      error: message,
    });
    console.error('Error downloading APK:', error);
    return null;
  }
}

/**
 * Install APK using native module
 */
export async function installAPK(
  apkPath: string,
  onProgress?: (progress: UpdateProgress) => void
): Promise<boolean> {
  if (Platform.OS !== 'android') {
    console.warn('APK installation only supported on Android');
    return false;
  }

  try {
    if (!APKInstaller) {
      throw new Error('APKInstaller native module not available');
    }

    onProgress?.({
      status: 'installing',
      progress: 50,
      message: 'Installing update...',
    });

    const result = await APKInstaller.installAPK(apkPath);

    onProgress?.({
      status: 'completed',
      progress: 100,
      message: 'Update installed successfully',
    });

    return result.success === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.({
      status: 'error',
      progress: 0,
      message: 'Installation failed',
      error: message,
    });
    console.error('Error installing APK:', error);
    return false;
  }
}

/**
 * Full update flow: check, download, request permissions, install
 */
export async function performUpdate(
  onProgress?: (progress: UpdateProgress) => void
): Promise<boolean> {
  try {
    // Check for update
    onProgress?.({
      status: 'checking',
      progress: 10,
      message: 'Checking for updates...',
    });

    const updateInfo = await checkForUpdate();
    if (!updateInfo.hasUpdate) {
      onProgress?.({
        status: 'completed',
        progress: 100,
        message: 'App is already up to date',
      });
      return true;
    }

    // Request permissions
    onProgress?.({
      status: 'checking',
      progress: 20,
      message: 'Requesting permissions...',
    });

    const permissionsGranted = await requestInstallPermissions();
    if (!permissionsGranted) {
      throw new Error('Install permissions denied');
    }

    // Download APK
    if (!updateInfo.artifactUrl) {
      throw new Error('No download URL available');
    }

    const apkData = await downloadAPK(updateInfo.artifactUrl, (progress) => {
      onProgress?.({
        ...progress,
        progress: Math.min(20 + progress.progress * 0.5, 70),
      });
    });

    if (!apkData) {
      throw new Error('Failed to download APK');
    }

    // Install APK
    const installSuccess = await installAPK(apkData, (progress) => {
      onProgress?.({
        ...progress,
        progress: Math.min(70 + progress.progress * 0.3, 100),
      });
    });

    return installSuccess;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.({
      status: 'error',
      progress: 0,
      message: 'Update failed',
      error: message,
    });
    console.error('Error performing update:', error);
    return false;
  }
}
