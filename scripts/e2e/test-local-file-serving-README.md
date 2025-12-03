# Local File Serving E2E Test

This end-to-end test validates that the relay server can properly serve files (like README.md, index.md, relay.yaml) from a cloned bare git repository. This test is designed to diagnose why deployed servers may not be serving files correctly.

## Test Coverage

### Setup Phase
1. **Clean Test Environment** - Removes any previous test artifacts from `tmp/e2e-local-server-test/`
2. **Clone Repository** - Clones `relay-template` as a bare git repository to simulate production setup
3. **Verify Repository Contents** - Confirms key files (index.md, relay.yaml) exist in the bare repo

### Server Phase
4. **Start Local Server** - Launches the relay server with `RELAY_REPO_PATH` pointing to the bare repo
5. **Wait for Readiness** - Polls the server until it responds to OPTIONS requests
6. **Capture Server Output** - Records all server output for debugging

### File Serving Tests
7. **OPTIONS Request** - Verifies server responds to OPTIONS and exposes allowed methods
8. **Root Path** - Tests GET / (should return repository index)
9. **README.md** - **PRIMARY TEST** - Verifies GET /README.md returns 200 with content
10. **index.md** - Tests GET /index.md (alternative index file)
11. **relay.yaml** - Tests GET /relay.yaml (repository configuration)
12. **404 Handling** - Confirms proper 404 for non-existent files
13. **Nested Paths** - Tests GET /docs/ (subdirectories)

## Usage

### Run the test
```bash
npm run test:e2e:local
```

### Or run directly
```bash
node scripts/e2e/test-local-file-serving.mjs
```

## Requirements

- **git** - For cloning the relay-template repository
- **cargo & Rust toolchain** - For building and running the relay server
- **Node.js** - For running the test script
- **~3-5 minutes** - First run builds the server; subsequent runs are faster

## Configuration

The test uses these environment variables automatically:

- `RELAY_REPO_PATH` - Points to the temporary bare repository (set by test)
- `RUST_BACKTRACE=1` - Enables Rust panic backtraces for debugging

Test parameters are hardcoded:
- Server URL: `http://localhost:8088`
- Server port: `8088`
- Timeout: 30 seconds for server startup
- Test directory: `tmp/e2e-local-server-test/`

## Debugging Failed Tests

### If README.md test fails:

1. **Check the repository was cloned correctly**
   - Look in `tmp/e2e-local-server-test/relay-template.git/`
   - Verify it has HEAD, objects/, refs/ directories (bare repo structure)

2. **Check server startup logs**
   - Look for `[server]` prefixed output in the test output
   - Search for error messages or panic traces

3. **Manual verification**
   - While server is running, test manually:
     ```bash
     curl http://localhost:8088/README.md
     curl http://localhost:8088/index.md
     curl -X OPTIONS http://localhost:8088/ -v
     ```

4. **Check if git repository structure is correct**
   ```bash
   ls -la tmp/e2e-local-server-test/relay-template.git/
   cat tmp/e2e-local-server-test/relay-template.git/HEAD
   ```

### If server fails to start:

1. Try building the server manually first:
   ```bash
   cargo build --manifest-path apps/server/Cargo.toml
   ```

2. Try running the server manually:
   ```bash
   RELAY_REPO_PATH=tmp/e2e-local-server-test/relay-template.git cargo run --manifest-path apps/server/Cargo.toml -- serve
   ```

3. Check for port conflicts (8088 already in use):
   ```bash
   netstat -an | grep 8088  # on Linux/Mac
   netstat -ano | findstr :8088  # on Windows
   ```

## Output Example

```
═══════════════════════════════════════════════════════════════
Local Server E2E Test - File Serving from Git Repos
═══════════════════════════════════════════════════════════════

1️⃣  Preparing test environment...

  Cleaning up existing test directory: /path/to/tmp/e2e-local-server-test
  Created test directory: /path/to/tmp/e2e-local-server-test

2️⃣  Cloning relay-template repository...

  Cloning from: https://github.com/clevertree/relay-template
  To: /path/to/tmp/e2e-local-server-test/relay-template.git

  ✓ Repository cloned successfully

3️⃣  Verifying repository contents...

  Verifying file exists: index.md
    ✓ File exists (1234 bytes)
  Verifying file exists: relay.yaml
    ✓ File exists (567 bytes)

4️⃣  Starting relay server...

  Command: cargo run --manifest-path apps/server/Cargo.toml -- serve
  With RELAY_REPO_PATH=/path/to/tmp/e2e-local-server-test/relay-template.git

  [server] Listening on 0.0.0.0:8088

5️⃣  Waiting for server to become ready...

  ✓ Server is ready
  ✓ Server status: {...}

6️⃣  Testing file serving...

  Testing OPTIONS request...
    ✓ OPTIONS status: 200
    ✓ Allow header: GET, PUT, DELETE, OPTIONS, QUERY

  Testing root path (/)...
    Testing GET /...
      ✓ Status 200 OK
      ✓ Content length: 1234 bytes
      ✓ Preview: # Repository...

  Testing README.md file serving...
    Testing GET /README.md...
      ✓ Status 200 OK
      ✓ Content length: 5678 bytes
      ✓ Preview: # Relay Template...

  Testing relay.yaml file serving...
    Testing GET /relay.yaml...
      ✓ Status 200 OK
      ✓ Content length: 890 bytes

═══════════════════════════════════════════════════════════════
Test Results Summary
═══════════════════════════════════════════════════════════════
✓ Passed: 9
✗ Failed: 0
Total: 9
```

## Key Issues This Test Helps Diagnose

1. **File serving not working in production** - If this test passes locally but fails on deployed servers, the issue is likely configuration-specific
2. **README.md not being served** - Indicates potential routing or git repository access issues
3. **Git bare repository structure** - Ensures the repository is properly formatted
4. **Server initialization** - Validates that the server can start with the expected repository path
5. **File permissions** - Detects if git objects are readable by the server process

## Related Files

- `apps/server/Cargo.toml` - Server build configuration
- `apps/server/src/main.rs` - Server implementation (file serving logic)
- `.env` - Environment configuration (not used by this test directly)
- `relay.yaml` - Repository metadata schema

## Notes

- This test creates a completely fresh bare repository each run, ensuring clean state
- The temporary test directory is NOT cleaned up after the test (for debugging); delete manually or it will be recreated on next run
- Server output is captured to help diagnose startup issues
- All HTTP requests use fetch API with built-in timeout handling
