#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy Relay to Rackspace Kubernetes cluster

.DESCRIPTION
    This script updates the Relay daemon sets with the new container image
    and monitors the rollout.

.PARAMETER Namespace
    Kubernetes namespace to deploy to (default: default)

.PARAMETER WaitTimeout
    Timeout in seconds for rollout to complete (default: 300)

.EXAMPLE
    .\deploy-to-rackspace.ps1
    .\deploy-to-rackspace.ps1 -Namespace relay -WaitTimeout 600
#>

param(
    [string]$Namespace = "default",
    [int]$WaitTimeout = 300
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Deploying Relay to Rackspace" -ForegroundColor Cyan

# Get script directory and kubeconfig path
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$kubeconfigPath = Join-Path $scriptDir "relay-kubeconfig.yaml"

# Verify kubeconfig exists
if (-not (Test-Path $kubeconfigPath)) {
    Write-Host "✗ Kubeconfig not found: $kubeconfigPath" -ForegroundColor Red
    exit 1
}

Write-Host "📋 Using kubeconfig: $kubeconfigPath" -ForegroundColor Yellow

# Verify kubectl connection
Write-Host "📋 Checking cluster connection..." -ForegroundColor Yellow
try {
    $env:KUBECONFIG = $kubeconfigPath
    $context = kubectl config current-context
    Write-Host "✓ Connected to: $context" -ForegroundColor Green
}
catch {
    Write-Host "✗ Failed to connect to cluster" -ForegroundColor Red
    exit 1
}

# Get k8s manifests directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$k8sDir = Join-Path $scriptDir "terraform/rackspace-spot/k8s"

if (-not (Test-Path $k8sDir)) {
    Write-Host "✗ K8s manifests directory not found: $k8sDir" -ForegroundColor Red
    exit 1
}

Write-Host "📂 K8s manifests: $k8sDir" -ForegroundColor Yellow

# Apply daemonsets
Write-Host "`n📦 Applying relay-daemonset.yaml..." -ForegroundColor Yellow
kubectl apply -f "$k8sDir/relay-daemonset.yaml"
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "📦 Applying relay-daemonset-dfw2.yaml..." -ForegroundColor Yellow
kubectl apply -f "$k8sDir/relay-daemonset-dfw2.yaml"
if ($LASTEXITCODE -ne 0) { exit 1 }

# Restart rollout
Write-Host "`n🔄 Restarting relay-daemon..." -ForegroundColor Yellow
kubectl rollout restart daemonset/relay-daemon -n $Namespace
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "🔄 Restarting relay-daemon-dfw2..." -ForegroundColor Yellow
kubectl rollout restart daemonset/relay-daemon-dfw2 -n $Namespace
if ($LASTEXITCODE -ne 0) { exit 1 }

# Wait for rollout
Write-Host "`n⏳ Waiting for rollout (timeout: ${WaitTimeout}s)..." -ForegroundColor Yellow

Write-Host "  - relay-daemon" -ForegroundColor Gray
kubectl rollout status daemonset/relay-daemon -n $Namespace --timeout="${WaitTimeout}s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ relay-daemon rollout failed" -ForegroundColor Red
    exit 1
}

Write-Host "  - relay-daemon-dfw2" -ForegroundColor Gray
kubectl rollout status daemonset/relay-daemon-dfw2 -n $Namespace --timeout="${WaitTimeout}s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ relay-daemon-dfw2 rollout failed" -ForegroundColor Red
    exit 1
}

# Verify deployment
Write-Host "`n✅ Deployment successful!" -ForegroundColor Green

Write-Host "`n📊 Pod Status:" -ForegroundColor Cyan
kubectl get pods -n $Namespace -l app=relay,app=relay-dfw2 2>/dev/null || `
kubectl get pods -n $Namespace -l app=relay
kubectl get pods -n $Namespace -l app=relay-dfw2

Write-Host "`n🔍 Image Verification:" -ForegroundColor Cyan
Write-Host "relay-daemon:" -ForegroundColor Gray
kubectl describe pod -n $Namespace -l app=relay | grep "Image:" | head -1

Write-Host "relay-daemon-dfw2:" -ForegroundColor Gray
kubectl describe pod -n $Namespace -l app=relay-dfw2 | grep "Image:" | head -1

Write-Host "`n✨ Relay is now running the latest version!" -ForegroundColor Green
