#!/usr/bin/env node

/**
 * Relay Dev Server
 * 
 * Runs both:
 * 1. Vite dev server for client-web (with HMR) on port 5173
 * 2. Simple static server for /template on port 3001
 * 3. Proxy server on port 3000 combining both
 * 
 * Access at: http://localhost:3000
 * 
 * Usage: node dev-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const url = require('url');

const root = path.resolve(__dirname);
const clientWebDir = path.join(root, 'apps', 'client-web');
const templateDir = path.join(root, 'template');

const MAIN_PORT = 3000;
const VITE_PORT = 5173;
const TEMPLATE_PORT = 3001;

console.log('\n🚀 Relay Dev Server\n');
console.log(`   Main proxy: http://localhost:${MAIN_PORT}`);
console.log(`   Vite dev server: http://localhost:${VITE_PORT}`);
console.log(`   Template server: http://localhost:${TEMPLATE_PORT}`);
console.log(`   Template folder: ${templateDir}\n`);

// 1. Start static server for template folder
const templateServer = http.createServer((req, res) => {
  let filePath = path.join(templateDir, req.url === '/' ? 'index.html' : req.url);
  
  // Prevent directory traversal
  if (!filePath.startsWith(templateDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check if it's a directory, serve index.html
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch (e) {
    // File doesn't exist, that's ok - will handle below
  }

  // Try to serve the file
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + req.url);
      return;
    }

    const ext = path.extname(filePath);
    const contentTypeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.md': 'text/markdown',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
});

templateServer.listen(TEMPLATE_PORT, () => {
  console.log(`✓ Template server listening on port ${TEMPLATE_PORT}`);
});

// 2. Start Vite dev server
console.log(`\n📦 Starting Vite dev server...\n`);
const viteProcess = spawn('npm', ['run', 'dev'], {
  cwd: clientWebDir,
  stdio: 'inherit',
  shell: true,
});

// Give Vite a moment to start
setTimeout(() => {
  // 3. Start main proxy server
  const mainServer = http.createServer((req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

      // Proxy MDN example media so VTT/MP4 can be served same-origin (avoid CORS/mixed-protocol issues)
      if (pathname && pathname.startsWith('/media/cc0-videos/')) {
        const targetUrl = `https://interactive-examples.mdn.mozilla.net${pathname}`;
        forwardRequest(req, res, targetUrl);
        return;
      }

    // Check if file exists in template folder first (serve template at root)
    const templateFilePath = path.join(templateDir, pathname === '/' ? 'index.html' : pathname);
    
    try {
      const stat = fs.statSync(templateFilePath);
      // File exists in template and is not trying to escape template dir
      if (templateFilePath.startsWith(templateDir) && stat.isFile()) {
        // Serve from template server without query params in path
        const targetUrl = `http://localhost:${TEMPLATE_PORT}${pathname}`;
        forwardRequest(req, res, targetUrl);
        return;
      }
    } catch (e) {
      // File doesn't exist in template, fall through to Vite
    }

    // Route everything else to Vite
    const targetUrl = `http://localhost:${VITE_PORT}${req.url}`;
    forwardRequest(req, res, targetUrl);
  });

  mainServer.listen(MAIN_PORT, () => {
    console.log(`\n✓ Dev server listening on http://localhost:${MAIN_PORT}\n`);
    console.log('   Press Ctrl+C to stop\n');
  });

  // Forward function for proxying
  function forwardRequest(req, res, targetUrl) {
    const isHttps = targetUrl.startsWith('https');
    const client = isHttps ? require('https') : http;
    const options = url.parse(targetUrl);
    options.method = req.method;
    options.headers = req.headers;

    const proxyReq = client.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`\n⚠️  Proxy error for ${targetUrl}:`, err.message);
      res.writeHead(503);
      res.end('Service unavailable');
    });

    req.pipe(proxyReq);
  }

  // Cleanup
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    viteProcess.kill();
    templateServer.close();
    mainServer.close(() => {
      console.log('✓ Dev servers stopped\n');
      process.exit(0);
    });
  });
}, 1500);

viteProcess.on('error', (err) => {
  console.error('Failed to start Vite:', err);
  process.exit(1);
});
