# Relay Dev Server

## Overview

The Relay dev server (`dev-server.cjs`) runs the client-web Vite dev server alongside a static file server for the `/template` folder.

## Architecture

The dev server implements a three-tier architecture:

1. **Template Static Server** (port 3001)
   - Serves files from `/template` folder
   - Handles directory index resolution
   - Proper MIME type detection

2. **Vite Dev Server** (port 5173)
   - Runs React dev server with HMR
   - Handles all app routes and React assets
   - TypeScript compilation and reload

3. **Main Proxy Server** (port 3000)
   - Routes `/template/*` requests to template server
   - Routes everything else to Vite server
   - Provides single entry point for development

## Usage

### Start the dev server

```bash
npm run web:dev:full
```

Or directly:

```bash
node dev-server.cjs
```

### Access the application

Open your browser to: **http://localhost:3000**

- Main app: http://localhost:3000 (proxied to Vite)
- Template assets: http://localhost:3000/template/* (served from `/template` folder)
- Direct template access: http://localhost:3001
- Direct Vite access: http://localhost:5173

### Stop the server

Press `Ctrl+C` in the terminal

## How It Works

1. The dev server starts a template static file server on port 3001
2. It spawns the Vite dev server (which runs on port 5173)
3. It creates a proxy server on port 3000 that:
   - Routes requests starting with `/template/` to port 3001
   - Routes all other requests to port 5173 (Vite)

This allows both the React app and static template files to be served under a single domain during development.

## Features

- ✅ Hot Module Replacement (HMR) via Vite
- ✅ Static file serving from `/template`
- ✅ Proper Content-Type headers for all file types
- ✅ Directory index.html fallback
- ✅ CORS headers for cross-origin requests
- ✅ No external dependencies (uses built-in Node modules)
- ✅ Clean shutdown with Ctrl+C

## Troubleshooting

### Port already in use

If port 3000, 3001, or 5173 is already in use, you'll see connection errors. Kill the existing process:

```bash
# On Windows, find and kill the process using the port
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Vite fails to start

Ensure you're in the relay directory and npm dependencies are installed:

```bash
npm install
cd apps/client-web
npm install
cd ../..
```

### Template files not loading

Check that the `/template` folder exists and contains the files you expect:

```bash
ls -la template/
```

Access directly at http://localhost:3001 to debug the template server independently.

## Development Workflow

1. Start the dev server: `npm run web:dev:full`
2. Make changes to React components in `/apps/client-web/src/`
3. Changes are automatically reloaded via Vite HMR
4. Template changes in `/template/` are served immediately on the next request

## Files

- `dev-server.cjs` - Main dev server script
- `package.json` - Contains the `web:dev:full` script entry
