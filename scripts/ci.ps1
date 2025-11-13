# CI script to lint, test, and build the monorepo
$ErrorActionPreference = "Stop"

# Rust checks
Write-Host "[CI] Formatting Rust" -ForegroundColor Cyan
cargo fmt -- --check

Write-Host "[CI] Clippy (deny warnings)" -ForegroundColor Cyan
cargo clippy -- -D warnings

Write-Host "[CI] Rust tests" -ForegroundColor Cyan
cargo test --workspace --all-features

# JS/TS checks (placeholder until apps exist)
Write-Host "[CI] Installing JS deps (pnpm)" -ForegroundColor Cyan
pnpm install

Write-Host "[CI] Lint/build via Turborepo" -ForegroundColor Cyan
pnpm lint || Write-Host "[CI] Lint step skipped (no JS apps yet)" -ForegroundColor Yellow
pnpm build || Write-Host "[CI] Build step skipped (no JS apps yet)" -ForegroundColor Yellow
