# Master Peer List E2E Test

This end-to-end test validates the RELAY_MASTER_PEER_LIST nodes by performing comprehensive HTTP and Git protocol checks.

## Test Coverage

### 1. **HTTP Connectivity** (`testHTTPConnectivity`)
- Verifies basic HTTP connectivity to each node
- Checks root path accessibility
- Reports content size and status code

### 2. **OPTIONS Request** (`testOPTIONS`)
- Tests the HTTP OPTIONS method on root path
- Captures and displays response headers:
  - `Allow` - HTTP methods allowed
  - `Access-Control-Allow-Methods` - CORS methods
  - `Access-Control-Allow-Headers` - CORS headers
  - `Content-Type` - Response content type
  - `Server` - Server identification
- Displays response body if available

### 3. **README.md File Existence** (`testREADMEFile`)
- Attempts to retrieve `/README.md` from each node
- Verifies file accessibility (HTTP GET)
- Reports file size and first 100 characters
- Handles 404 and other response codes appropriately

### 4. **Git Authentication Check** (`testGitAuthentication`)
- Tests access to `.git/HEAD` endpoint
- Verifies whether git endpoints require authentication (401/403)
- Confirms that endpoints without auth are properly exposed
- Reports 404 for non-exposed git directories

### 5. **Git Repository Listing** (`testGitRepoListing`)
- Tests git service discovery via `info/refs?service=git-receive-pack`
- Checks if repository operations require authentication
- Verifies bare repository detection
- Reports git service availability and authentication requirements

## Usage

### Run the test
```bash
npm run test:e2e:peers
```

### Or run directly with Node
```bash
node scripts/e2e/test-master-peers.mjs
```

## Configuration

The test reads `RELAY_MASTER_PEER_LIST` from the `.env` file in the project root.

Format: semicolon-separated list of nodes
```env
RELAY_MASTER_PEER_LIST=node-dfw1.relaynet.online;node-dfw2.relaynet.online;node-dfw3.relaynet.online
```

Nodes can include or omit the `http://` protocol prefix.

## Output

The test produces detailed output for each node including:
- Individual test results with ✓ (passed), ✗ (failed), or ℹ (info) markers
- Response headers and body content for debugging
- Status codes and error messages
- Final summary with pass/fail counts

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed

## Environment Handling

- Tests use a 5-second timeout per HTTP request
- Gracefully handles network errors and timeouts
- Supports nodes with or without HTTP protocol prefix
- Automatically parses `.env` file without external dependencies

## Example Output

```
═══════════════════════════════════════════════════════════════
Master Peer List E2E Test Suite
═══════════════════════════════════════════════════════════════

✓ Found 3 master peer nodes: node-dfw1.relaynet.online, node-dfw2.relaynet.online, node-dfw3.relaynet.online

─────────────────────────────────────────────────────────────
Testing node: http://node-dfw1.relaynet.online
─────────────────────────────────────────────────────────────

Testing basic HTTP connectivity for http://node-dfw1.relaynet.online...
  ✓ HTTP connectivity OK (200), content length: 1234 bytes

Testing OPTIONS for http://node-dfw1.relaynet.online...
  ✓ OPTIONS status: 200
  ✓ Response headers: { "allow": "GET, POST, OPTIONS", ... }

Testing /README.md for http://node-dfw1.relaynet.online...
  ✓ README.md found (200), size: 5678 bytes
  ✓ First 100 chars: # Relay Node...

Testing Git authentication (no-auth repo listing) for http://node-dfw1.relaynet.online...
  ✓ Git endpoint requires authentication (403) - Good!

Testing Git repository listing for http://node-dfw1.relaynet.online...
  ✓ Git operations require authentication (403)

═══════════════════════════════════════════════════════════════
Test Results Summary
═══════════════════════════════════════════════════════════════
✓ Passed: 15
✗ Failed: 0
Total: 15
```

## Notes

- All HTTP requests use `fetch()` API with 5-second timeout
- The test validates but does not modify any remote state
- Git authentication tests only verify accessibility, not actual credentials
- Failed connectivity does not stop other nodes from being tested
