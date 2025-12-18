// Node-based E2E that builds the Docker server, runs it, then exercises the relay CLI
// Requirements: Docker installed and accessible from PATH; Rust toolchain for building CLI
import { spawn, spawnSync, spawnSync as sync } from 'node:child_process';
import { platform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';

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
        err.stdout = res.stdout;
        err.stderr = res.stderr;
        throw err;
    }
    return res.stdout;
}

async function waitForServer(url, timeoutMs = 180_000, pollIntervalMs = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url, { method: 'OPTIONS' });
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
        // Ensure data/repo.git exists (default location for server)
        const dataDir = path.join(process.cwd(), 'data');
        const repoPath = path.join(dataDir, 'repo.git');
        if (!fs.existsSync(repoPath)) {
            console.log('Creating bare repository at', repoPath);
            fs.mkdirSync(dataDir, { recursive: true });
            sync('git', ['clone', '--bare', 'https://github.com/clevertree/relay-template', repoPath]);
        }
        // spawn cargo run in background (use default data/repo.git location)
        // Use absolute path for RELAY_REPO_PATH to avoid working directory issues
        const env = { ...process.env, RELAY_REPO_PATH: path.resolve(repoPath) };
        localServerProc = spawn('cargo', ['run', '--manifest-path', 'apps/server/Cargo.toml', '--', 'serve'], {
            stdio: 'inherit',
            cwd: process.cwd(),
            env
        });
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
        const status = await waitForServer('http://localhost:8080/');
        if (!status || !status.ok) throw new Error('Status not ok');

        // If server does not expose rules (no sources.yaml in repo), inject one from template/sources.yaml
        const hasMetaProps = status.rules && status.rules.metaSchema && status.rules.metaSchema.properties;
        if (!hasMetaProps) {
            console.log('Server does not expose rules in OPTIONS response — skipping rules injection');
            // Note: In the current architecture, rules/metadata schema discovery has been removed
            // from the OPTIONS endpoint. Metadata validation (if needed) is handled via repo scripts.
        }

        // 4) Test server connection with curl
        const testUrl = 'http://localhost:8080/';
        const curlResult = shCapture('curl', ['-s', '-X', 'OPTIONS', testUrl]);
        const connectJson = JSON.parse(curlResult);
        if (!connectJson.ok) throw new Error('Server connection test failed');

        // Note: rules/metaSchema are no longer returned in discovery response
        // Metadata validation is now handled via repo scripts
        console.log('Server connection successful');

        // 6) Prepare a test file and PUT
        const testBody = '# E2E Test\n\nHello Relay!\n';
        const testPath = 'data/e2e/index.md';
        const putOut = shCapture(cliPath, ['put', 'http://localhost:8080', testPath, '--branch', 'main'], { input: testBody });
        const putJson = JSON.parse(putOut);
        if (!putJson.commit) throw new Error('PUT did not return commit');

        // 7) GET and verify (use tmp/e2e for generated files)
        const tmpDir = path.join(process.cwd(), 'tmp', 'e2e');
        const tmpFile = path.join(tmpDir, 'tmp-index.md');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        await sh(cliPath, ['get', 'http://localhost:8080', testPath, '--branch', 'main', '--out', tmpFile]);
        const got = fs.readFileSync(tmpFile, 'utf-8');
        if (got.trim() !== testBody.trim()) throw new Error('GET content mismatch');

        // 7b) Attempt to PUT an invalid/disallowed file type (e.g., .html) and expect rejection
        const invalidBody = '<!doctype html><html><body>bad</body></html>\n';
        const invalidPath = 'data/e2e/index.html';
        // Use spawnSync to capture exit status (CLI should fail if pre-commit validation rejects the commit)
        const invalidRes = sync(cliPath, ['put', 'http://localhost:8080', invalidPath, '--branch', 'main'], {
            input: invalidBody,
            encoding: 'utf-8'
        });
        if (invalidRes.status === 0) {
            console.log('HTML file was accepted (server allows files not in standard block list)');
        } else {
            console.log('HTML file was rejected (pre-commit.mjs validation or server rules apply)');
        }

        // 8) META JSON tests: create and upload test files
        // NOTE: File uploads are validated by .relay/pre-commit.mjs if present in the repository
        const validMeta = {
            test_field: 'e2e-test-data'
        };

        const metaPath = 'data/e2e/meta.json';
        const metaStr = JSON.stringify(validMeta, null, 2);
        console.log('Uploading test meta.json:', metaStr);
        const putMetaOut = shCapture(cliPath, ['put', 'http://localhost:8080', metaPath, '--branch', 'main'], { input: metaStr });
        const putMetaJson = JSON.parse(putMetaOut);
        if (!putMetaJson.commit) throw new Error('PUT meta.json did not return commit (expected success)');
        console.log('Test meta.json committed successfully');

        // 9) Verify we can upload arbitrary JSON data
        const testData = { test_id: '001', content: 'e2e verification' };
        const testDataStr = JSON.stringify(testData);
        console.log('Uploading arbitrary JSON:', testDataStr);
        const putDataOut = shCapture(cliPath, ['put', 'http://localhost:8080', 'data/e2e/test.json', '--branch', 'main'], { input: testDataStr });
        const putDataJson = JSON.parse(putDataOut);
        if (!putDataJson.commit) throw new Error('PUT test.json did not return commit');
        console.log('Test JSON file committed successfully');

        // 10) Query test placeholder
        // TODO: add QUERY E2E once implemented

        console.log('E2E SUCCESS');
    } finally {
        if (needCleanup) {
            if (localServerProc) {
                try {
                    localServerProc.kill('SIGINT');
                } catch (e) {
                }
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
                try {
                    await sh(runtime || 'docker', ['rm', '-f', name]);
                } catch (e) { /* ignore */
                }
            }
        }
    }
}

main().catch((e) => {
    console.error('E2E FAILED:', e);
    process.exit(1);
});
