# Build all workspaces: Rust and JS
$ErrorActionPreference = "Stop"

Write-Host "Formatting Rust..." -ForegroundColor Cyan
cargo fmt

Write-Host "Linting Rust (clippy)..." -ForegroundColor Cyan
cargo clippy -- -D warnings

Write-Host "Building Rust workspace..." -ForegroundColor Cyan
cargo build --workspace

Write-Host "Installing JS deps (pnpm) and building via Turborepo..." -ForegroundColor Cyan
pnpm install
pnpm build
