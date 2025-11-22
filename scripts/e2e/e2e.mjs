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

async function waitForServer(url, timeoutMs = 180_000, pollIntervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'POST' });
      if (res.ok) return await res.json();
    } catch (e) {
      // ignore and retry
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function main() {
  // 1) Attempt to use Docker; otherwise fall back to running server locally via cargo
  const image = 'relay-all-in-one:test';
  const name = `relay-e2e-${Date.now()}`;
  let needCleanup = false;
  let localServerProc = null;
  let runtime = null;
  // Parse flags
  const useLocal = process.argv.includes('--local');

  if (useLocal) {
    console.log('E2E: running server locally (cargo run) because --local specified');
    // spawn cargo run in background
    localServerProc = spawn('cargo', ['run', '--manifest-path', 'apps/server/Cargo.toml'], { stdio: 'inherit' });
    needCleanup = true;
  } else {
    // Detect container runtime: prefer Docker, fall back to Podman. Fail if neither available.
    try {
      const res = sync('docker', ['info'], { stdio: 'ignore' });
      if (res.status === 0) runtime = 'docker';
    } catch (e) {
      // ignore
    }
    if (!runtime) {
      try {
        const res = sync('podman', ['info'], { stdio: 'ignore' });
        if (res.status === 0) runtime = 'podman';
      } catch (e) {
        // ignore
      }
    }
    if (!runtime) {
      console.error('E2E requires Docker or Podman and a running daemon. Aborting.');
      process.exit(2);
    }

    console.log(`Using container runtime: ${runtime}`);

    // 2) Build image
    await sh(runtime, ['build', '-t', image, '.']);

    // 3) Run container (do not --rm so logs persist on failure). Map ports.
    const ports = ['-p', '8088:8088'];
    // Podman may run rootless; run similarly to docker
    await sh(runtime, ['run', '-d', '--name', name, ...ports, image]);
    needCleanup = true;
  }
  try {
    // 3) Wait for server readiness
    const status = await waitForServer('http://localhost:8088/status');
    if (!status || !status.ok) throw new Error('Status not ok');

    // If server does not expose rules (no relay.yaml in repo), inject one from template/relay.yaml
    const hasMetaProps = status.rules && status.rules.metaSchema && status.rules.metaSchema.properties;
    if (!hasMetaProps) {
      console.log('Server did not return rules.metaSchema.properties — injecting template/relay.yaml into repo');
      const bareRepoPath = path.join(process.cwd(), 'data', 'repo.git');
      const tmpRepo = path.join(process.cwd(), 'tmp', 'e2e', 'rules-push');
      fs.mkdirSync(tmpRepo, { recursive: true });
      // Copy template rules if available, otherwise create a minimal relay.yaml
      const templatePath = path.join(process.cwd(), 'template', 'relay.yaml');
      const destRules = path.join(tmpRepo, 'relay.yaml');
      if (fs.existsSync(templatePath)) {
        fs.copyFileSync(templatePath, destRules);
      } else {
        const minimal = `allowedPaths:\n  - data/**/meta.json\ninsertTemplate: "{{title}}"\nmetaSchema:\n  type: object\n  properties:\n    title: { type: string }\n    release_date: { type: string }\n    genre: { type: array, items: { type: string } }\n  required: [title, release_date]\n`;
        fs.writeFileSync(destRules, minimal);
      }

      // Initialize tmp git repo and push to bare
      sync('git', ['init'], { cwd: tmpRepo });
      sync('git', ['checkout', '-b', 'main'], { cwd: tmpRepo });
      sync('git', ['add', 'relay.yaml'], { cwd: tmpRepo });
      sync('git', ['-c', 'user.name=E2E', '-c', "user.email=e2e@local", 'commit', '-m', 'add rules'], { cwd: tmpRepo });
      const bareUrl = `file://${bareRepoPath}`;
      try {
        sync('git', ['remote', 'add', 'origin', bareUrl], { cwd: tmpRepo });
      } catch (e) {
        // ignore if remote exists
      }
      sync('git', ['push', '--force', 'origin', 'main'], { cwd: tmpRepo });

      // Re-query status after push
      await delay(1000);
      const status2 = await waitForServer('http://localhost:8088/status');
      if (!status2 || !status2.rules || !status2.rules.metaSchema || !status2.rules.metaSchema.properties) {
        throw new Error('Injecting relay.yaml did not populate server rules.metaSchema.properties');
      }
      console.log('relay.yaml injected and server now reports metaSchema.properties');
    }

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

    // Verify rules/metaSchema properties are returned by the server via connect response
    const rules = connectJson.rules;
    if (!rules || !rules.metaSchema || !rules.metaSchema.properties) {
      throw new Error('Server /status did not return metaSchema.properties in rules (required for meta tests)');
    }
    const propertyList = Object.keys(rules.metaSchema.properties);
    if (!Array.isArray(propertyList) || propertyList.length === 0) {
      throw new Error('metaSchema.properties is empty');
    }
    console.log('Discovered meta properties from server:', propertyList.join(', '));

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

    // 7b) Attempt to PUT an invalid/disallowed file type (e.g., .html) and expect rejection
    const invalidBody = '<!doctype html><html><body>bad</body></html>\n';
    const invalidPath = 'data/e2e/index.html';
    // Use spawnSync to capture exit status (CLI should fail when server rejects the commit)
    const invalidRes = sync(cliPath, [ 'put', 'http://localhost:8088', invalidPath, '--branch', 'main' ], { input: invalidBody, encoding: 'utf-8' });
    if (invalidRes.status === 0) {
      // CLI exited 0 — invalid file was accepted which violates rules
      throw new Error('Invalid file (html) was accepted; expected rejection by relay.yaml');
    } else {
      console.log('Invalid file correctly rejected by server (as expected)');
      if (invalidRes.stdout) console.log('Server response stdout:', invalidRes.stdout);
      if (invalidRes.stderr) console.log('Server response stderr:', invalidRes.stderr);
    }

    // 8) META JSON tests: create a valid meta.json using the server-declared property list
    // Build a valid meta object using required property names from the server metaSchema
    const validMeta = {};
    // reasonable defaults: title, release_date, genre
    if (propertyList.includes('title')) validMeta.title = 'E2E Movie';
    if (propertyList.includes('release_date')) validMeta.release_date = '2025-11-21';
    if (propertyList.includes('genre')) validMeta.genre = ['drama', 'e2e'];

    const metaPath = 'data/e2e/meta.json';
    const metaStr = JSON.stringify(validMeta, null, 2);
    console.log('Uploading valid meta.json:', metaStr);
    const putMetaOut = shCapture(cliPath, ['put', 'http://localhost:8088', metaPath, '--branch', 'main'], { input: metaStr });
    const putMetaJson = JSON.parse(putMetaOut);
    if (!putMetaJson.commit) throw new Error('PUT meta.json did not return commit (expected success)');
    console.log('Valid meta.json committed as expected');

    // 9) Upload an invalid meta.json that violates schema: missing required fields or wrong type
    const invalidMeta = { random_field: 'should fail' };
    const invalidMetaStr = JSON.stringify(invalidMeta);
    console.log('Uploading invalid meta.json (should be rejected):', invalidMetaStr);
  // Try to overwrite the same meta.json with invalid content (should be rejected by schema validation)
  const invalidMetaRes = sync(cliPath, ['put', 'http://localhost:8088', metaPath, '--branch', 'main'], { input: invalidMetaStr, encoding: 'utf-8' });
    if (invalidMetaRes.status === 0) {
      throw new Error('Invalid meta.json was accepted; expected validation rejection');
    } else {
      console.log('Invalid meta.json correctly rejected by server (validation)');
      if (invalidMetaRes.stdout) console.log('Server response stdout:', invalidMetaRes.stdout);
      if (invalidMetaRes.stderr) console.log('Server response stderr:', invalidMetaRes.stderr);
    }

    // 8) TODO: query test once implemented for template repo rules
    console.log('TODO: add QUERY E2E when server rules.db queryPolicy is active');

    console.log('E2E SUCCESS');
  } finally {
    if (needCleanup) {
      if (localServerProc) {
        try { localServerProc.kill('SIGINT'); } catch (e) {}
      } else {
        // print container logs for debugging
        try {
          console.log('\n--- Container logs start ---');
          const logs = spawnSync(runtime || 'docker', ['logs', '--tail', '200', name], { encoding: 'utf-8' });
          if (logs.stdout) console.log(logs.stdout);
          if (logs.stderr) console.error(logs.stderr);
          console.log('--- Container logs end ---\n');
        } catch (e) {
          // ignore
        }
        try { await sh(runtime || 'docker', ['rm', '-f', name]); } catch (e) { /* ignore */ }
      }
    }
  }
}

main().catch((e) => {
  console.error('E2E FAILED:', e);
  process.exit(1);
});
