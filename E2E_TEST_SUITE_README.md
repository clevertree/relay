# E2E Test Suite Summary

## Overview
Created a comprehensive E2E test suite to diagnose and verify file serving functionality in the relay server, specifically addressing issues with serving README.md and other files from git bare repositories.

## Tests Created

### 1. test-local-file-serving.mjs ⭐ PRIMARY TEST FOR YOUR ISSUE
**Purpose**: Test file serving from a cloned relay-template repository on the local machine

**What it does**:
- Clones `relay-template` as a bare git repository
- Starts the local relay server with that repository
- Tests that files like README.md, index.md, relay.yaml are properly served
- Verifies HTTP OPTIONS request returns proper headers
- Tests 404 handling for non-existent files

**How to run**:
```bash
npm run test:e2e:local
```

**Key diagnostic value**: If this passes locally but fails on production servers, you'll know the issue is environment/deployment-specific.

### 2. test-master-peers.mjs
**Purpose**: Test all nodes in RELAY_MASTER_PEER_LIST for basic functionality

**What it does**:
- Reads RELAY_MASTER_PEER_LIST from .env
- Tests HTTP connectivity to each node
- Checks OPTIONS request responses and headers
- Attempts to serve README.md from each node
- Tests git authentication requirements
- Checks git repository listing capabilities

**How to run**:
```bash
npm run test:e2e:peers
```

## Files Modified

### package.json
Added three new test scripts:
```json
"test:e2e:peers": "node scripts/e2e/test-master-peers.mjs",
"test:e2e:local": "node scripts/e2e/test-local-file-serving.mjs",
```

## Directory Structure

```
scripts/e2e/
├── e2e.mjs                                    (existing - Docker e2e)
├── ipfs-fallback.mjs                          (existing)
├── test-master-peers.mjs                      (NEW - tests deployed nodes)
├── test-master-peers-README.md                (NEW - documentation)
├── test-local-file-serving.mjs                (NEW - tests local server file serving)
└── test-local-file-serving-README.md          (NEW - documentation)
```

## Key Features

### test-local-file-serving.mjs
✅ **Clone from GitHub** - Fetches relay-template as bare repo (no external dependency conflicts)
✅ **Local Server Testing** - Tests actual server behavior before deployment
✅ **File Serving Validation** - Specifically tests README.md, index.md, relay.yaml
✅ **Server Output Capture** - Logs all server output for debugging
✅ **Graceful Cleanup** - Properly terminates server process
✅ **Clear Status Reporting** - Shows which tests pass/fail with content previews
✅ **Timeout Handling** - 30-second server startup timeout
✅ **Git Integration** - Validates bare repository structure

### test-master-peers.mjs
✅ **Multi-node Testing** - Tests all configured master peer nodes
✅ **OPTIONS Inspection** - Captures and displays all response headers
✅ **Git Security** - Checks authentication requirements
✅ **Timeout Resilience** - 10-15 second timeouts per request
✅ **No Dependencies** - Pure Node.js, no external npm packages needed
✅ **Detailed Reporting** - Shows pass/fail counts with specific error info

## Testing README.md Serving Issue

### To diagnose your issue:

1. **Run locally first**:
   ```bash
   npm run test:e2e:local
   ```
   - If this PASSES: Your server code is correct, issue is deployment/configuration
   - If this FAILS: Server has file serving bug that needs fixing

2. **Check deployed servers**:
   ```bash
   npm run test:e2e:peers
   ```
   - Tests all nodes in RELAY_MASTER_PEER_LIST
   - Shows which nodes can't serve README.md
   - Displays OPTIONS headers and capabilities

3. **Compare results**:
   - Local test shows what SHOULD happen
   - Master peers test shows what IS happening in production
   - Difference reveals the root cause

## Debugging Tips

### If local test passes but deployed nodes fail:
- Check if git repository exists at deployment path
- Verify permissions on git objects
- Check server logs on deployed machines
- Verify networking/firewall isn't blocking requests
- Check if .git/config has correct fetch/push settings

### If local test fails:
- Check server build is working: `npm run build:server`
- Try manual server start: `RELAY_REPO_PATH=tmp/e2e-local-server-test/relay-template.git cargo run --manifest-path apps/server/Cargo.toml -- serve`
- Check port 8088 isn't already in use
- Review server output for panic/error messages

## Test Output Example

```
═══════════════════════════════════════════════════════════════
Local Server E2E Test - File Serving from Git Repos
═══════════════════════════════════════════════════════════════

1️⃣  Preparing test environment...
   ✓ Created test directory

2️⃣  Cloning relay-template repository...
   ✓ Repository cloned successfully

3️⃣  Verifying repository contents...
   ✓ File exists: index.md (1234 bytes)
   ✓ File exists: relay.yaml (567 bytes)

4️⃣  Starting relay server...
   [server] Listening on 0.0.0.0:8088

5️⃣  Waiting for server to become ready...
   ✓ Server is ready

6️⃣  Testing file serving...
   ✓ OPTIONS status: 200
   ✓ GET / returns 200
   ✓ GET /README.md returns 200 (5678 bytes)
   ✓ GET /relay.yaml returns 200
   
═══════════════════════════════════════════════════════════════
Test Results Summary
═══════════════════════════════════════════════════════════════
✓ Passed: 9
✗ Failed: 0
Total: 9
```

## Next Steps

1. **Run the local test**:
   ```bash
   npm run test:e2e:local
   ```

2. **If it passes**: Your server code is correct. Check deployment configuration.

3. **If it fails**: Use server output capture to identify what's wrong with file serving.

4. **Test deployed nodes**:
   ```bash
   npm run test:e2e:peers
   ```
   This will show README.md test results for all production nodes.

## Requirements

- git (for cloning)
- cargo & Rust (for building/running server)
- Node.js (for test script)
- Port 8088 available (local test only)
