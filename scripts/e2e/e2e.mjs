// Node-based E2E that builds the Docker server, runs it, then exercises the relay CLI
// Requirements: Docker installed and accessible from PATH; Rust toolchain for building CLI
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync as sync } from 'node:child_process';

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

function shCapture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
  if (res.status !== 0) {
    const err = new Error(`Command failed: ${cmd} ${args.join(' ')}\n${res.stderr}`);
    err.stdout = res.stdout; err.stderr = res.stderr;
    throw err;
  }
  return res.stdout;
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) return await res.json();
    } catch {}
    await delay(1000);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function main() {
  // 1) Attempt to use Docker; otherwise fall back to running server locally via cargo
  const image = 'relay-all-in-one:test';
  const name = `relay-e2e-${Date.now()}`;
  let needCleanup = false;
  let localServerProc = null;
  // Require Docker to be available for E2E. Fail fast if not present.
  try {
    const res = sync('docker', ['info'], { stdio: 'ignore' });
    if (res.status !== 0) throw new Error('docker info returned non-zero');
  } catch (e) {
    console.error('E2E requires Docker and the Docker daemon to be running. Aborting.');
    process.exit(2);
  }

  // 2) Build Docker image
  await sh('docker', ['build', '-t', image, '.']);

  // 3) Run container
  const ports = ['-p', '8088:8088'];
  await sh('docker', ['run', '-d', '--rm', '--name', name, ...ports, image]);
  needCleanup = true;
  try {
    // 3) Wait for server readiness
    const status = await waitForServer('http://localhost:8088/status');
    if (!status || !status.ok) throw new Error('Status not ok');

    // 4) Build relay-cli
    await sh('cargo', ['build', '-p', 'relay-cli', '--release']);
    const binDir = path.join(process.cwd(), 'target', 'release');
    const exe = platform() === 'win32' ? 'relay-cli.exe' : 'relay-cli';
    const cliPath = path.join(binDir, exe);
    if (!fs.existsSync(cliPath)) throw new Error(`CLI binary not found at ${cliPath}`);

    // 5) Connect
    const connectOut = shCapture(cliPath, ['connect', 'http://localhost:8088']);
    const connectJson = JSON.parse(connectOut);
    if (!connectJson.ok) throw new Error('CLI connect failed');

    // 6) Prepare a test file and PUT
    const testBody = '# E2E Test\n\nHello Relay!\n';
    const testPath = 'data/e2e/index.md';
    const putOut = shCapture(cliPath, ['put', 'http://localhost:8088', testPath, '--branch', 'main'], { input: testBody });
    const putJson = JSON.parse(putOut);
    if (!putJson.commit) throw new Error('PUT did not return commit');

  // 7) GET and verify (use tmp/e2e for generated files)
  const tmpDir = path.join(process.cwd(), 'tmp', 'e2e');
  const tmpFile = path.join(tmpDir, 'tmp-index.md');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    await sh(cliPath, ['get', 'http://localhost:8088', testPath, '--branch', 'main', '--out', tmpFile]);
    const got = fs.readFileSync(tmpFile, 'utf-8');
    if (got.trim() !== testBody.trim()) throw new Error('GET content mismatch');

    // 8) TODO: query test once implemented for template repo rules
    console.log('TODO: add QUERY E2E when server rules.db queryPolicy is active');

    console.log('E2E SUCCESS');
  } finally {
    if (needCleanup) {
      if (localServerProc) {
        try { localServerProc.kill('SIGINT'); } catch (e) {}
      } else {
        try { await sh('docker', ['rm', '-f', name]); } catch (e) { /* ignore */ }
      }
    }
  }
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
