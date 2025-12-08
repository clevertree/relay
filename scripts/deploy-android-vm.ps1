# Deploy Android release APK to VM or device
# Usage: .\deploy-android-vm.ps1 [-VmIp "127.0.0.1"] [-AdbPort 5555]

param(
    [string]$VmIp = "127.0.0.1",
    [int]$AdbPort = 5555,
    [switch]$LaunchApp,
    [switch]$Logs
)

$APK_FILE = "apps\client-react-native\android\app\build\outputs\apk\release\app-release.apk"
$PACKAGE_NAME = "com.relay.client"
$ACTIVITY_NAME = ".MainActivity"

# Determine connection string
$connection = if ($VmIp -match "^emulator-\d+$") { 
    # Direct emulator reference
    $VmIp 
} else { 
    # IP:Port format
    "$VmIp`:$AdbPort" 
}

# Verify APK exists
if (-not (Test-Path $APK_FILE)) {
    Write-Error "APK not found at $APK_FILE"
    exit 1
}

Write-Host "[*] Android Release Deployment" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "APK: $APK_FILE"
Write-Host "Target: $VmIp`:$AdbPort"
Write-Host ""

# Check ADB availability
try {
    $adb_version = adb version 2>&1 | Select-Object -First 1
    Write-Host "[OK] ADB found: $adb_version" -ForegroundColor Green
} catch {
    Write-Error "ADB not found. Install Android SDK Platform Tools"
    exit 1
}

Write-Host "[*] Connecting to device/emulator..." -ForegroundColor Cyan

# Connect only if IP:Port format
if ($connection -match ":\d+$") {
    adb connect $connection | Out-Null
}

# Wait for device
Write-Host "[*] Waiting for device to be ready..." -ForegroundColor Yellow
$max_attempts = 30
$attempt = 0
while ($attempt -lt $max_attempts) {
    $devices = adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "device$" }
    if ($devices) {
        Write-Host "[OK] Device connected" -ForegroundColor Green
        break
    }
    Start-Sleep -Seconds 1
    $attempt++
}

# Install APK
Write-Host "[*] Installing APK ($((Get-Item $APK_FILE).Length / 1MB)MB)..." -ForegroundColor Cyan
$result = adb -s $connection install -r $APK_FILE
if ($LASTEXITCODE -ne 0) {
    Write-Error "Installation failed: $result"
    exit 1
}
Write-Host "[OK] Installation complete!" -ForegroundColor Green

# Launch app
if ($LaunchApp) {
    Write-Host "[*] Launching app..." -ForegroundColor Cyan
    adb -s $connection shell am start -n "$PACKAGE_NAME/$ACTIVITY_NAME"
    Start-Sleep -Seconds 2
    Write-Host "[OK] App launched!" -ForegroundColor Green
}

# Show logs
if ($Logs) {
    Write-Host ""
    Write-Host "[*] Monitoring logs (Press Ctrl+C to stop)..." -ForegroundColor Yellow
    adb -s $connection logcat | Select-String -Pattern "relay|Exception|FATAL|Error" -CaseSensitive
}

Write-Host ""
Write-Host "[*] Next steps:" -ForegroundColor Cyan
Write-Host "   1. Monitor logs: .\deploy-android-vm.ps1 -VmIp $VmIp -Logs"
Write-Host "   2. Uninstall: adb uninstall $PACKAGE_NAME"
Write-Host "   3. View all logs: adb logcat"
Write-Host "   4. Test with: npm run test:e2e:peers" -ForegroundColor Cyan
Write-Host ""
