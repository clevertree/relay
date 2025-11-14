#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const crateDir = path.join(projectRoot, 'crates', 'relay-wasm');
const outDir = path.join(projectRoot, 'apps', 'web', 'public', 'pkg');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

async function run(cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: true, ...options });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function ensureDirs() {
  await mkdir(outDir, { recursive: true });
}

async function buildOnce() {
  // Build the crate for wasm32
  await run('rustup', ['target', 'add', 'wasm32-unknown-unknown']).catch(() => {});
  await run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: crateDir });

  const targetWasm = path.join(crateDir, 'target', 'wasm32-unknown-unknown', 'release', 'relay_wasm.wasm');

  // Prefer wasm-bindgen if available, otherwise try wasm-pack
  async function has(cmd) {
    try { await run(cmd, ['--version']); return true; } catch { return false; }
  }

  if (await has('wasm-bindgen')) {
    const tmpOut = path.join(crateDir, 'pkg');
    await rm(tmpOut, { recursive: true, force: true }).catch(() => {});
    await run('wasm-bindgen', [
      targetWasm,
      '--target', 'web',
      '--out-dir', tmpOut,
      '--no-typescript'
    ]);
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(outDir, { recursive: true });
    await cp(tmpOut + path.sep, outDir + path.sep, { recursive: true });
  } else if (await has('wasm-pack')) {
    await run('wasm-pack', ['build', '--target', 'web', '--release', '--out-dir', 'pkg'], { cwd: crateDir });
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(outDir, { recursive: true });
    await cp(path.join(crateDir, 'pkg') + path.sep, outDir + path.sep, { recursive: true });
  } else {
    console.error('[build-wasm] Neither wasm-bindgen-cli nor wasm-pack is installed. Please install one of them:');
    console.error('  cargo install wasm-bindgen-cli');
    console.error('  # or');
    console.error('  cargo install wasm-pack');
    process.exit(1);
  }
}

async function main() {
  await ensureDirs();

  if (!watch) {
    await buildOnce();
    return;
  }

  // Watch mode: re-run build on Rust changes
  console.log('[build-wasm] Watching for changes...');
  // Support either `chokidar` or `chokidar-cli` binary name under node_modules/.bin.
  // Prefer `chokidar` (present in this workspace) so watch mode runs reliably.
  const possibleBins = ['chokidar', 'chokidar-cli'];
  let found = false;
  for (const bin of possibleBins) {
    const p = path.join(projectRoot, 'node_modules', '.bin', bin);
    try {
      // Execute the binary via shell (some bin shims are shell scripts, not Node modules)
      await run(p, [path.join(crateDir, 'src', '**', '*'), '-c', `node ${path.relative(projectRoot, __filename)}`]);
      found = true;
      break;
    } catch (e) {
      // try next
    }
  }
  if (!found) {
    console.warn('[build-wasm] chokidar-cli/chokidar not found; running single build. Install as devDependency if you want live rebuilds.');
    await buildOnce();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
