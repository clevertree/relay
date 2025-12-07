package com.relay.client

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Manages runtime permissions for network operations on Android 6.0+
 */
object PermissionsManager {
    private const val NETWORK_PERMISSION_REQUEST_CODE = 1001
    
    /**
     * Checks if all required network permissions are granted.
     * If not, requests them from the user.
     *
     * @param activity The activity to request permissions from
     * @return true if all permissions are already granted, false if request was needed
     */
    fun checkAndRequestNetworkPermissions(activity: Activity): Boolean {
        val requiredPermissions = arrayOf(
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE
        )
        
        val missingPermissions = requiredPermissions.filter { permission ->
            ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED
        }
        
        if (missingPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                activity,
                missingPermissions.toTypedArray(),
                NETWORK_PERMISSION_REQUEST_CODE
            )
            return false
        }
        return true
    }
    
    /**
     * Checks if INTERNET permission is granted
     */
    fun hasInternetPermission(activity: Activity): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.INTERNET
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    /**
     * Checks if ACCESS_NETWORK_STATE permission is granted
     */
    fun hasNetworkStatePermission(activity: Activity): Boolean {
        return ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.ACCESS_NETWORK_STATE
        ) == PackageManager.PERMISSION_GRANTED
    }
}
