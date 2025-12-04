#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const url = require('url');

// Keep the same implementation as the root dev-server.cjs but placed under scripts/
// We'll load the original file content from the top-level dev-server.cjs to avoid duplication
const original = path.join(__dirname, '..', 'dev-server.cjs');
if (fs.existsSync(original)) {
  require(original);
} else {
  console.error('Original dev-server.cjs not found; please run from repo root with original file present.');
  process.exit(1);
}
