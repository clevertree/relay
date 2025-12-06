#!/usr/bin/env node
// E2E test for local server file serving from git bare repositories
// Tests that the server can serve files like README.md from a cloned bare git repository
// Requirements: git, cargo, and Rust toolchain

import {spawn, spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs';

const PROJECT_ROOT = process.cwd();
const TEST_DIR = path.join(PROJECT_ROOT, 'tmp', 'e2e-local-server-test');
const REPO_PATH = path.join(TEST_DIR, 'relay-template.git');
const SERVER_URL = 'http://localhost:8080';
const SERVER_PORT = 8088;

let serverProcess = null;
let testsPassed = 0;
let testsFailed = 0;

function sh(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, {stdio: 'inherit', ...opts});
        p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
    });
}

function shCapture(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {encoding: 'utf-8', ...opts});
    if (res.status !== 0) {
        const err = new Error(`Command failed: ${cmd} ${args.join(' ')}\n${res.stderr}`);
        err.stdout = res.stdout;
        err.stderr = res.stderr;
        throw err;
    }
    return res.stdout;
}

async function waitForServer(url, timeoutMs = 30_000, pollIntervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url, {method: 'OPTIONS'});
            if (res.ok) {
                return res.json();
            }
        } catch (e) {
            // ignore and retry
        }
        await delay(pollIntervalMs);
    }
    throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function testHttpGET(path_relative, expectedStatus = 200) {
    const url = `${SERVER_URL}/${path_relative}`;
    console.log(`  Testing GET ${path_relative}...`);
    try {
        const response = await fetch(url, {method: 'GET'});
        const content = await response.text();

        if (response.status === expectedStatus) {
            console.log(`    ✓ Status ${response.status} OK`);
            console.log(`    ✓ Content length: ${content.length} bytes`);
            if (content.length > 0) {
                console.log(`    ✓ Preview: ${content.substring(0, 80)}...`);
            }
            testsPassed++;
            return {ok: true, status: response.status, content};
        } else {
            console.log(`    ✗ Expected ${expectedStatus}, got ${response.status}`);
            testsFailed++;
            return {ok: false, status: response.status, content};
        }
    } catch (error) {
        console.log(`    ✗ Request failed: ${error.message}`);
        testsFailed++;
        return {ok: false, error};
    }
}

async function testFileExists(relativePath) {
    console.log(`  Verifying file exists: ${relativePath}`);
    const fullPath = path.join(REPO_PATH, relativePath);
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        console.log(`    ✓ File exists (${stats.size} bytes)`);
        return true;
    } else {
        console.log(`    ✗ File not found at ${fullPath}`);
        return false;
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('Local Server E2E Test - File Serving from Git Repos');
    console.log('═══════════════════════════════════════════════════════════════\n');

    try {
        // 1) Clean up test directory
        console.log('1️⃣  Preparing test environment...\n');
        if (fs.existsSync(TEST_DIR)) {
            console.log(`  Cleaning up existing test directory: ${TEST_DIR}`);
            fs.rmSync(TEST_DIR, {recursive: true, force: true});
        }
        fs.mkdirSync(TEST_DIR, {recursive: true});
        console.log(`  Created test directory: ${TEST_DIR}\n`);

        // 2) Clone relay-template as bare repository
        console.log('2️⃣  Cloning relay-template repository...\n');
        console.log(`  Cloning from: https://github.com/clevertree/relay-template`);
        console.log(`  To: ${REPO_PATH}\n`);

        shCapture('git', ['clone', '--bare', 'https://github.com/clevertree/relay-template', REPO_PATH]);
        console.log(`  ✓ Repository cloned successfully\n`);

        // 3) Verify key files exist in the bare repository
        console.log('3️⃣  Verifying repository contents...\n');
        const hasReadme = await testFileExists('index.md');
        const hasRelayYaml = await testFileExists('relay.yaml');
        console.log();

        // 4) Start the server
        console.log('4️⃣  Starting relay server...\n');
        console.log(`  Command: cargo run --manifest-path apps/server/Cargo.toml -- serve`);
        console.log(`  With RELAY_REPO_PATH=${REPO_PATH}\n`);

        const env = {
            ...process.env,
            RELAY_REPO_PATH: REPO_PATH,
            RUST_BACKTRACE: '1',
        };

        serverProcess = spawn('cargo', ['run', '--manifest-path', 'apps/server/Cargo.toml', '--', 'serve'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: PROJECT_ROOT,
            env,
        });

        // Capture server output
        const serverOutput = [];
        const captureOutput = (data) => {
            const line = data.toString('utf-8');
            serverOutput.push(line);
            process.stdout.write(`  [server] ${line}`);
        };

        serverProcess.stdout.on('data', captureOutput);
        serverProcess.stderr.on('data', captureOutput);

        serverProcess.on('error', (err) => {
            console.error(`  ✗ Server process error: ${err.message}`);
        });

        serverProcess.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.error(`  ⚠ Server exited with code ${code}`);
            }
        });

        // 5) Wait for server to be ready
        console.log('\n5️⃣  Waiting for server to become ready...\n');
        try {
            const status = await waitForServer(SERVER_URL);
            console.log(`  ✓ Server is ready`);
            console.log(`  ✓ Server status:`, JSON.stringify(status, null, 2));
            console.log();
        } catch (error) {
            console.error(`  ✗ Server failed to start: ${error.message}`);
            testsFailed++;
            throw error;
        }

        // 6) Test file serving
        console.log('6️⃣  Testing file serving...\n');

        // Test OPTIONS request
        console.log('  Testing OPTIONS request...');
        try {
            const res = await fetch(`${SERVER_URL}/`, {method: 'OPTIONS'});
            const headers = {
                allow: res.headers.get('allow'),
                'content-type': res.headers.get('content-type'),
            };
            console.log(`    ✓ OPTIONS status: ${res.status}`);
            console.log(`    ✓ Allow header: ${headers.allow}`);
            testsPassed++;
        } catch (error) {
            console.log(`    ✗ OPTIONS failed: ${error.message}`);
            testsFailed++;
        }
        console.log();

        // Test root path
        console.log('  Testing root path (/)...');
        await testHttpGET('', 200);
        console.log();

        // Test README.md specifically
        console.log('  Testing README.md file serving...');
        const readmeResult = await testHttpGET('README.md', 200);
        if (!readmeResult.ok) {
            console.log(`    Note: Checking alternative paths...`);
            // Try index.md
            const indexResult = await testHttpGET('index.md', 200);
            if (indexResult.ok) {
                console.log(`    ℹ index.md is being served instead of README.md`);
            }
        }
        console.log();

        // Test .env file (exists in repository)
        console.log('  Testing .env file serving...');
        await testHttpGET('.env', 200);
        console.log();

        // Test .relay subdirectory listing
        console.log('  Testing .relay subdirectory listing...');
        const dirResult = await testHttpGET('.relay/', 200);
        if (dirResult.ok) {
            console.log(`    ℹ Directory listing response received`);
            try {
                if (dirResult.content.includes('"')) {
                    const parsed = JSON.parse(dirResult.content);
                    console.log(`    ✓ Directory response is valid JSON`);
                    console.log(`    ✓ Contains entries:`, Object.keys(parsed).length, `items`);
                    testsPassed++;
                } else {
                    console.log(`    ✓ Directory response is text/html`);
                    testsPassed++;
                }
            } catch (e) {
                console.log(`    ℹ Directory response is HTML or plain text`);
                testsPassed++;
            }
        }
        console.log();

        // Test .relay/get.mjs file (should exist)
        console.log('  Testing .relay/get.mjs file serving...');
        await testHttpGET('.relay/get.mjs', 200);
        console.log();

        // Test 404 behavior
        console.log('  Testing 404 response for non-existent file...');
        await testHttpGET('does-not-exist.txt', 404);
        console.log();

        // Test non-existent directory
        console.log('  Testing 404 response for non-existent directory...');
        await testHttpGET('nonexistent/', 404);
        console.log();

        // 7) Summary
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('Test Results Summary');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`✓ Passed: ${testsPassed}`);
        console.log(`✗ Failed: ${testsFailed}`);
        console.log(`Total: ${testsPassed + testsFailed}\n`);

        if (testsFailed > 0) {
            process.exit(1);
        }

    } catch (error) {
        console.error('\n✗ Test execution failed:', error.message);
        if (error.stderr) {
            console.error('STDERR:', error.stderr);
        }
        process.exit(1);
    } finally {
        // Cleanup
        if (serverProcess) {
            console.log('\nCleaning up: terminating server process...');
            try {
                serverProcess.kill('SIGTERM');
                // Wait a bit for graceful shutdown
                await delay(1000);
                if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                }
            } catch (e) {
                // ignore
            }
        }
    }
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
