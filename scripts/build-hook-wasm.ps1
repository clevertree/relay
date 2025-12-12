#!/usr/bin/env pwsh
# PowerShell version of build-hook-wasm.sh for Windows/cross-platform support

$ErrorActionPreference = "Continue"
$WarningPreference = "SilentlyContinue"

# Get root directory
$RootDir = (Get-Item (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))).FullName
$CrateDir = Join-Path $RootDir "apps/client-web/wasm-transpiler"
$OutDir = Join-Path $RootDir "apps/client-web/src/wasm"
$PublicDir = Join-Path $RootDir "apps/client-web/public/wasm"
$TargetDir = Join-Path $CrateDir "target/wasm32-unknown-unknown/release"

Write-Host "[build-hook-wasm] Root dir: $RootDir"
Write-Host "[build-hook-wasm] Crate dir: $CrateDir"
Write-Host "[build-hook-wasm] Out dir (src):   $OutDir"
Write-Host "[build-hook-wasm] Out dir (public): $PublicDir"

# Create output directories
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null

# Ensure wasm32 target
Write-Host "[build-hook-wasm] Adding wasm32-unknown-unknown target (if needed)"
&rustup target add wasm32-unknown-unknown 2>&1 | Out-Null

# Set RUSTFLAGS
Write-Host "[build-hook-wasm] Setting RUSTFLAGS for getrandom wasm_js backend"
$env:RUSTFLAGS = "--cfg getrandom_backend=`"wasm_js`""

# Build crate
Write-Host "[build-hook-wasm] Building crate with cargo (release, target wasm32-unknown-unknown) in crate dir"
Push-Location $CrateDir
try {
    cargo build `
      --target wasm32-unknown-unknown `
      --release
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# Check that WASM binary exists
$WasmBin = Join-Path $TargetDir "wasm_hook_transpiler.wasm"
if (-not (Test-Path $WasmBin)) {
    Write-Host "[build-hook-wasm] ERROR: Built wasm not found at $WasmBin" -ForegroundColor Red
    exit 1
}

# Locate wasm-bindgen CLI
$WasmBindgenBin = $env:WASM_BINDGEN_BIN
if ([string]::IsNullOrWhiteSpace($WasmBindgenBin)) {
    # Try to find it in PATH
    $WasmBindgenPath = (Get-Command wasm-bindgen -ErrorAction SilentlyContinue).Source
    if ($WasmBindgenPath) {
        $WasmBindgenBin = $WasmBindgenPath
    } else {
        # Try cargo bin directories
        $CargoHome = $env:CARGO_HOME
        if ([string]::IsNullOrWhiteSpace($CargoHome)) {
            $CargoHome = Join-Path $env:USERPROFILE ".cargo"
        }
        $WasmBindgenBin = Join-Path $CargoHome "bin/wasm-bindgen.exe"
        if (-not (Test-Path $WasmBindgenBin)) {
            Write-Host "[build-hook-wasm] wasm-bindgen not found. Install via: cargo install wasm-bindgen-cli, or set WASM_BINDGEN_BIN to the binary path." -ForegroundColor Red
            exit 1
        }
    }
}

Write-Host "[build-hook-wasm] Using wasm-bindgen: $WasmBindgenBin"
Write-Host "[build-hook-wasm] Generating JS glue (target web) to both src/wasm and public/wasm"

# First generate to src/wasm for module imports
& $WasmBindgenBin $WasmBin `
  --target web `
  --out-dir $OutDir `
  --out-name hook_transpiler

if ($LASTEXITCODE -ne 0) {
    Write-Host "[build-hook-wasm] ERROR: wasm-bindgen to src/wasm failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit 1
}

# Then copy to public/wasm for static serving as fallback
Copy-Item -Path (Join-Path $OutDir "*") -Destination $PublicDir -Recurse -Force

Write-Host "[build-hook-wasm] Build complete. Artifacts in src/wasm:"
Get-ChildItem $OutDir | ForEach-Object {
    Write-Host "[build-hook-wasm] $_"
}
