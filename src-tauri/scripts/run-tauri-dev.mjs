#!/usr/bin/env node
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const port = process.env.FRONTEND_PORT || '13337'
const tauriCliPath = path.join(__dirname, 'tauri.cli.json')

const tauriConfig = {
  build: {
    devUrl: `http://localhost:${port}`,
    frontendDist: '../host/static'
  }
}
// Enable the Tauri allowlist during dev so the JS API is exposed in the webview.
// Put allowlist at the top-level of the override so it merges correctly.
tauriConfig.allowlist = { all: true }

fs.writeFileSync(tauriCliPath, JSON.stringify(tauriConfig, null, 2))
console.log(`Wrote Tauri override config to ${tauriCliPath} -> devUrl=http://localhost:${port}`)

// Start the web dev server (pnpm --filter ./apps/web dev) with FRONTEND_PORT in env
const web = spawn('pnpm', ['--filter', './apps/web', 'dev'], {
  cwd: repoRoot,
  env: { ...process.env, FRONTEND_PORT: port },
  stdio: 'inherit'
})

// Start the cargo tauri dev process using the generated config
const tauri = spawn('cargo', ['tauri', 'dev', '--config', tauriCliPath], {
  cwd: path.join(repoRoot, 'src-tauri'),
  env: { ...process.env, TAURI_CONFIG: tauriCliPath },
  stdio: 'inherit'
})

const forwardExit = (code) => process.exit(code ?? 0)
web.on('exit', (code) => {
  console.log('web process exited', code)
  tauri.kill()
  forwardExit(code)
})
tauri.on('exit', (code) => {
  console.log('tauri process exited', code)
  web.kill()
  forwardExit(code)
})
