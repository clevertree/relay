package com.relay.client

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.io.FileOutputStream
import java.util.Base64

@ReactModule(name = "APKInstaller")
class APKInstallerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "APKInstaller"
  }

  override fun getName(): String = "APKInstaller"

  /**
   * Install an APK file
   * @param apkPath Path or base64 data URL of the APK file
   */
  @ReactMethod
  fun installAPK(apkPath: String, promise: Promise) {
    try {
      val apkFile = if (apkPath.startsWith("data:application/octet-stream;base64,")) {
        // Handle base64 data URL
        decodeBase64AndSaveAPK(apkPath)
      } else if (apkPath.startsWith("file://")) {
        // Handle file URI
        File(Uri.parse(apkPath).path ?: "")
      } else {
        // Handle regular file path
        File(apkPath)
      }

      if (!apkFile.exists()) {
        promise.reject("FILE_NOT_FOUND", "APK file not found at: $apkPath")
        return
      }

      Log.d(TAG, "Installing APK from: ${apkFile.absolutePath}")

      val context = currentActivity ?: reactApplicationContext
      val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        FileProvider.getUriForFile(
          context,
          "${context.packageName}.fileprovider",
          apkFile
        )
      } else {
        @Suppress("DEPRECATION")
        Uri.fromFile(apkFile)
      }

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
      }

      context.startActivity(intent)

      promise.resolve(
        mapOf(
          "success" to true,
          "message" to "APK installation initiated"
        )
      )
    } catch (e: Exception) {
      Log.e(TAG, "Error installing APK", e)
      promise.reject("INSTALL_ERROR", e.message ?: "Unknown error")
    }
  }

  /**
   * Decode a base64 data URL and save it as an APK file
   */
  private fun decodeBase64AndSaveAPK(dataUrl: String): File {
    val base64Data = dataUrl.substringAfter("base64,")
    val decodedBytes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Base64.getDecoder().decode(base64Data)
    } else {
      @Suppress("DEPRECATION")
      android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
    }

    val cacheDir = reactApplicationContext.externalCacheDir ?: reactApplicationContext.cacheDir
    val apkFile = File(cacheDir, "relay_update_${System.currentTimeMillis()}.apk")

    FileOutputStream(apkFile).use { fos ->
      fos.write(decodedBytes)
    }

    Log.d(TAG, "Saved APK to: ${apkFile.absolutePath}")
    return apkFile
  }

  /**
   * Get the current app version
   */
  @ReactMethod
  fun getAppVersion(promise: Promise) {
    try {
      val packageManager = reactApplicationContext.packageManager
      val packageName = reactApplicationContext.packageName
      @Suppress("DEPRECATION")
      val packageInfo = packageManager.getPackageInfo(packageName, 0)
      
      promise.resolve(
        mapOf(
          "version" to packageInfo.versionName,
          "buildNumber" to packageInfo.versionCode
        )
      )
    } catch (e: Exception) {
      promise.reject("VERSION_ERROR", e.message ?: "Unknown error")
    }
  }
}
