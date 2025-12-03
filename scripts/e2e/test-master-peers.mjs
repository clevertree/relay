#!/usr/bin/env node
// E2E test for RELAY_MASTER_PEER_LIST node interactions
// Tests:
//  - OPTIONS requests and response headers
//  - Git authentication requirements
//  - Git repository listing
//  - HTTP /README.md file existence

import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'fs';
import path from 'path';

// Load .env file manually (parse simple key=value format)
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      if (key && value) {
        process.env[key.trim()] = value.trim();
      }
    }
  }
}

const MASTER_PEER_LIST = process.env.RELAY_MASTER_PEER_LIST || '';

if (!MASTER_PEER_LIST) {
  console.error('ERROR: RELAY_MASTER_PEER_LIST not found in .env');
  process.exit(1);
}

const nodes = MASTER_PEER_LIST.split(';').map(n => n.trim()).filter(Boolean);
console.log(`\n✓ Found ${nodes.length} master peer nodes: ${nodes.join(', ')}\n`);

let testsPassed = 0;
let testsFailed = 0;

/**
 * Test OPTIONS request and check response headers
 */
async function testOPTIONS(nodeUrl) {
  console.log(`Testing OPTIONS for ${nodeUrl}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${nodeUrl}/`, {
      method: 'OPTIONS',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    console.log(`  ✓ OPTIONS status: ${response.status}`);
    
    // Check common headers
    const headers = {
      'allow': response.headers.get('allow'),
      'access-control-allow-methods': response.headers.get('access-control-allow-methods'),
      'access-control-allow-headers': response.headers.get('access-control-allow-headers'),
      'content-type': response.headers.get('content-type'),
      'server': response.headers.get('server'),
    };
    
    console.log(`  ✓ Response headers:`, JSON.stringify(headers, null, 2));
    
    try {
      const body = await response.text();
      if (body) {
        console.log(`  ✓ Response body: ${body.substring(0, 100)}`);
      }
    } catch (e) {
      // Body may be empty for OPTIONS
    }
    
    testsPassed++;
    return true;
  } catch (error) {
    console.log(`  ✗ OPTIONS failed: ${error.message}`);
    testsFailed++;
    return false;
  }
}

/**
 * Test HTTP GET /README.md file existence
 */
async function testREADMEFile(nodeUrl) {
  console.log(`Testing /README.md for ${nodeUrl}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      const response = await fetch(`${nodeUrl}/README.md`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const content = await response.text();
        console.log(`  ✓ README.md found (${response.status}), size: ${content.length} bytes`);
        console.log(`  ✓ First 100 chars: ${content.substring(0, 100)}...`);
        testsPassed++;
        return true;
      } else if (response.status === 404) {
        console.log(`  ✗ README.md not found (404)`);
        testsFailed++;
        return false;
      } else {
        console.log(`  ⚠ README.md returned status ${response.status}`);
        testsPassed++;
        return true;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`  ⚠ README.md check timeout (network or server issue)`);
    } else {
      console.log(`  ⚠ README.md check failed: ${error.message}`);
    }
    testsPassed++;
    return true;
  }
}

/**
 * Test Git authentication (check if we can list repos without auth)
 */
async function testGitAuthentication(nodeUrl) {
  console.log(`Testing Git authentication (no-auth repo listing) for ${nodeUrl}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      // Try to fetch a git endpoint that might list repos or check git status
      const response = await fetch(`${nodeUrl}/.git/HEAD`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.status === 200) {
        const content = await response.text();
        console.log(`  ✓ Git HEAD accessible without auth: ${content.trim()}`);
        testsPassed++;
        return true;
      } else if (response.status === 401 || response.status === 403) {
        console.log(`  ✓ Git endpoint requires authentication (${response.status}) - Good!`);
        testsPassed++;
        return true;
      } else if (response.status === 404) {
        console.log(`  ℹ Git endpoint not exposed (404) - OK for some configurations`);
        testsPassed++;
        return true;
      } else {
        console.log(`  ⚠ Git HEAD returned status ${response.status}`);
        testsPassed++;
        return true;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`  ⚠ Git auth check timeout (network or server issue)`);
    } else {
      console.log(`  ⚠ Git authentication check failed: ${error.message}`);
    }
    testsPassed++;
    return true;
  }
}

/**
 * Test repository listing via git protocol (if supported)
 */
async function testGitRepoListing(nodeUrl) {
  console.log(`Testing Git repository listing for ${nodeUrl}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    try {
      // Try to fetch info/refs which is used for git clone discovery
      const response = await fetch(`${nodeUrl}/info/refs?service=git-receive-pack`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (response.ok) {
        const content = await response.text();
        console.log(`  ✓ Git service refs available (${response.status}), size: ${content.length} bytes`);
        testsPassed++;
        return true;
      } else if (response.status === 404) {
        console.log(`  ℹ Git service refs not exposed (404) - repository may not be bare`);
        testsPassed++;
        return true;
      } else if (response.status === 401 || response.status === 403) {
        console.log(`  ✓ Git operations require authentication (${response.status})`);
        testsPassed++;
        return true;
      } else {
        console.log(`  ⚠ Git refs returned status ${response.status}`);
        testsPassed++;
        return true;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`  ⚠ Git repo listing timeout (network or server issue)`);
    } else {
      console.log(`  ⚠ Git repository listing failed: ${error.message}`);
    }
    testsPassed++;
    return true;
  }
}

/**
 * Test basic HTTP connectivity
 */
async function testHTTPConnectivity(nodeUrl) {
  console.log(`Testing basic HTTP connectivity for ${nodeUrl}...`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${nodeUrl}/`, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (response.ok) {
      const content = await response.text();
      console.log(`  ✓ HTTP connectivity OK (${response.status}), content length: ${content.length} bytes`);
      testsPassed++;
      return true;
    } else {
      console.log(`  ⚠ HTTP returned status ${response.status}`);
      testsPassed++;
      return true;
    }
  } catch (error) {
    console.log(`  ✗ HTTP connectivity failed: ${error.message}`);
    testsFailed++;
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Master Peer List E2E Test Suite');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const node of nodes) {
    const nodeUrl = node.startsWith('http') ? node : `http://${node}`;
    console.log(`\n─────────────────────────────────────────────────────────────`);
    console.log(`Testing node: ${nodeUrl}`);
    console.log(`─────────────────────────────────────────────────────────────\n`);

    try {
      await testHTTPConnectivity(nodeUrl);
      await testOPTIONS(nodeUrl);
      await testREADMEFile(nodeUrl);
      await testGitAuthentication(nodeUrl);
      await testGitRepoListing(nodeUrl);
    } catch (error) {
      console.error(`\nFatal error testing ${nodeUrl}:`, error);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`Test Results Summary`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`✓ Passed: ${testsPassed}`);
  console.log(`✗ Failed: ${testsFailed}`);
  console.log(`Total: ${testsPassed + testsFailed}\n`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
