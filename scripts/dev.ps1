# Developer convenience script for Relay monorepo (Windows PowerShell)
# Runs dev tasks across workspaces using Turborepo and Cargo

# Ensure pnpm and turbo are available
$ErrorActionPreference = "Stop"

Write-Host "Starting dev tasks via Turborepo..." -ForegroundColor Cyan
pnpm dev
