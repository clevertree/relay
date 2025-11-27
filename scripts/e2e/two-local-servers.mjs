// Launch two local relay servers on ports 8088 and 8089 sharing the same bare repo
// This simulates "replication" for the e2e test by serving from the same repo path.
// Requirements: Rust toolchain; hooks binary available (we build it).

import {spawn, spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function onExit(child, name) {
    child.on('exit', (code, signal) => {
        console.log(`${name} exited with`, {code, signal});
    });
}

function buildHooksPath() {
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'relay-hooks.exe' : 'relay-hooks';
    // Prefer debug build
    const p = path.join(process.cwd(), 'target', 'debug', exe);
    if (fs.existsSync(p)) return p;
    console.log('Building hooks binary...');
    // Synchronously build hooks
    const res = spawnSync('cargo', ['build', '-p', 'relay-hooks'], {stdio: 'inherit'});
    if (res.status !== 0) {
        throw new Error('Failed to build relay-hooks');
    }
    if (fs.existsSync(p)) return p;
    throw new Error('relay-hooks binary not found after build at ' + p);
}

async function main() {
    const repoPath = path.join(process.cwd(), 'data', 'repo.git');
    fs.mkdirSync(path.dirname(repoPath), {recursive: true});
    const hooksBin = await buildHooksPath();

    // Seed the bare repo with relay.yaml on default branch if empty
    function seedRepoIfNeeded() {
        const headPath = path.join(repoPath, 'HEAD');
        const hasHead = fs.existsSync(headPath);
        // Even if HEAD exists, the branch may be empty; we attempt a graceful push anyway.
        const tmp = path.join(process.cwd(), 'tmp', 'e2e', 'seed');
        fs.mkdirSync(tmp, {recursive: true});
        // Create a minimal working repo
        if (!fs.existsSync(path.join(tmp, '.git'))) {
            spawnSync('git', ['init'], {cwd: tmp, stdio: 'inherit'});
            spawnSync('git', ['checkout', '-b', 'main'], {cwd: tmp, stdio: 'inherit'});
        }
        // Copy template/relay.yaml or create minimal rules
        const templateRules = path.join(process.cwd(), 'template', 'relay.yaml');
        const destRules = path.join(tmp, 'relay.yaml');
        if (fs.existsSync(templateRules)) {
            fs.copyFileSync(templateRules, destRules);
        } else {
            const minimal = [
                'allowedPaths:',
                '  - data/**/meta.json',
                '  - data/**/index.md',
                '  - data/**/assets/**',
                'metaSchema:',
                '  type: object',
                '  properties:',
                '    title: { type: string }',
                '    release_date: { type: string }',
                '    genre: { type: array, items: { type: string } }',
                '  required: [title, release_date, genre]',
                ''
            ].join('\n');
            fs.writeFileSync(destRules, minimal);
        }
        spawnSync('git', ['add', '.'], {cwd: tmp, stdio: 'inherit'});
        // Commit may fail if nothing changed; ignore non-zero
        spawnSync('git', ['commit', '-m', 'seed rules'], {cwd: tmp, stdio: 'inherit'});
        // Add bare as remote and push
        const remoteName = 'bare';
        const remotes = spawnSync('git', ['remote'], {cwd: tmp, encoding: 'utf-8'});
        if (!remotes.stdout.split(/\r?\n/).includes(remoteName)) {
            spawnSync('git', ['remote', 'add', remoteName, repoPath], {cwd: tmp, stdio: 'inherit'});
        }
        spawnSync('git', ['push', remoteName, 'main', '--force'], {cwd: tmp, stdio: 'inherit'});
    }

    seedRepoIfNeeded();

    const baseEnv = {
        ...process.env,
        RELAY_REPO_PATH: repoPath,
        RELAY_HOOKS_BIN: hooksBin,
        // Allow creating repo directory if missing
        RELAY_ALLOW_CREATE_REPO: '1',
    };

    console.log('Starting two local servers:');
    console.log(' - node1: http://localhost:8088');
    console.log(' - node2: http://localhost:8089');
    console.log('Shared bare repo:', repoPath);

    const s1 = spawn('cargo', ['run', '--manifest-path', 'apps/server/Cargo.toml'], {
        env: {...baseEnv, RELAY_BIND: '127.0.0.1:8088'},
        stdio: 'inherit',
    });
    onExit(s1, 'server-8088');

    // small delay so ports don't race for stdout
    await new Promise((r) => setTimeout(r, 750));

    const s2 = spawn('cargo', ['run', '--manifest-path', 'apps/server/Cargo.toml'], {
        env: {...baseEnv, RELAY_BIND: '127.0.0.1:8089'},
        stdio: 'inherit',
    });
    onExit(s2, 'server-8089');

    function shutdown() {
        console.log('\nShutting down servers...');
        s1.kill('SIGINT');
        s2.kill('SIGINT');
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('\nServers started. In another terminal, run:');
    console.log('  pnpm test:e2e  # defaults to localhost:8088 -> localhost:8089');
    console.log('\nTo test remote nodes instead, run:');
    console.log('  NODE1=http://node-dfw1.relaynet.online NODE2=http://node-dfw2.relaynet.online pnpm test:e2e');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
