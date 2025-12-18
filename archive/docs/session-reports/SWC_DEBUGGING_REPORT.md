# SWC Transpiler Debugging Session Report

## Session Overview
**Date**: December 9, 2025
**Objective**: Debug and fix SWC transpiler issues in the Relay web application
**Status**: In Progress - Debugging tools and logging added

## Issues Identified

### 1. **WASM Initialization Problems**
**Error**: `Cannot read properties of undefined (reading '_windgen_add_to_stack_pointer')`
**Root Cause**: The SWC WASM module was not being properly initialized before transform operations were called.

**Details**:
- The `@swc/wasm-web` module requires explicit initialization via `init()` or `initSync()` before any transform operations can be called
- The WASM binary (`wasm_bg.wasm`) needs to be fetched and passed to `initSync()` or the URL passed to `init()`
- Without proper initialization, the WASM memory is not available, causing references to internal WASM functions like `_windgen_add_to_stack_pointer` to fail

### 2. **Module Export Structure**
**Issue**: Unclear how the @swc/wasm-web module exports its functions in bundled form
**Impact**: The swcBridge wasn't properly detecting and using all available functions

### 3. **Async/Sync Function Selection**
**Issue**: Code was trying to detect which version of transform (sync vs async) was available, but wasn't ensuring the WASM was initialized for whichever version was selected

## Fixes Applied

### 1. **Enhanced swcBridge.ts**
**File**: `apps/client-web/src/swcBridge.ts`

**Changes**:
- Added comprehensive debug logging at each initialization step
- Separated WASM module imports from function discovery
- Explicit WASM initialization with byte fetching via `?url` import
- Added fallback to `initSync()` with ArrayBuffer if byte fetching fails
- Better error handling and logging for initialization failures
- Proper initialization state tracking to prevent double-initialization

**Code Flow**:
```
1. Import @swc/wasm-web module
2. Extract init/initSync functions from module
3. Fetch WASM binary via the ?url import
4. Call initSync(wasmBytes) to initialize WASM
5. Export the SWC module to globalThis.__swc
6. Return to caller
```

### 2. **Enhanced transpileCode() Function**
**File**: `apps/shared/src/runtimeLoader.ts`

**Changes**:
- Added detailed logging at each transpilation step
- Improved error detection for WASM-related errors (looking for `_windgen`, `memory`, `WebAssembly` references)
- Added retry logic when WASM initialization-related errors occur
- Better error propagation and message formatting
- Logging of module state and available functions

**Error Handling**:
- Detects patterns indicating WASM not initialized:
  - `reading 'transform'`
  - `reading '_windgen_add_to_stack_pointer'`
  - `reading 'memory'`
  - WASM/WebAssembly errors
- Retries with explicit jsc.transform options on WASM errors
- Provides detailed error messages for debugging

### 3. **Created SWC Test Page**
**File**: `apps/client-web/dist/swc-test.html`

**Features**:
- Initialization status checker
- Three JSX/TSX transpilation probes:
  - A) Full JSX with _jsx_ function
  - B) TypeScript JSX with type annotation
  - C) Simple JSX element syntax
- Real-time console output capture
- Interactive button-based testing
- Color-coded status messages
- Code output display with syntax highlighting

**Testing Endpoints**:
- `http://localhost:8080/swc-test.html` - Debug test page
- Main app: `http://localhost:8080/` - Full relay client-web

## Build & Deployment

### Build Process
```bash
npm run web:build:debug
# Creates debug build with source maps in apps/client-web/dist/
```

### Server Startup
```bash
RELAY_REPO_PATH=./data \
RELAY_STATIC_DIR=apps/client-web/dist \
RELAY_HTTP_PORT=8080 \
RELAY_HTTPS_PORT=8443 \
cargo run --manifest-path apps/server/Cargo.toml -- serve
```

### Files Modified
1. `apps/client-web/src/swcBridge.ts` - WASM initialization bridge
2. `apps/shared/src/runtimeLoader.ts` - Transpile function with logging
3. `apps/client-web/dist/swc-test.html` - Debug test page (new)

## Debug Logging Output

### SWC Bridge Logs
Look for `[swcBridge]` prefixed messages:
- `[swcBridge] Starting preloadSwc` - Bridge initialization started
- `[swcBridge] Imported @swc/wasm-web` - Module loaded
- `[swcBridge] WASM URL from ?url:` - WASM binary located
- `[swcBridge] Calling initSync with WASM bytes` - Initialization in progress
- `[swcBridge] WASM initialized successfully` - Ready to use

### Transpile Code Logs
Look for `[transpileCode]` prefixed messages:
- `[transpileCode] Starting transpilation for` - Transpile started
- `[transpileCode] __swc available:` - Cache check
- `[transpileCode] Found transformFn:` - Function discovery
- `[transpileCode] Calling transform with options:` - Transform call
- `[transpileCode] Transform succeeded` - Success
- `[transpileCode] Transform error on first try:` - Error detected
- `[transpileCode] Retrying with forced jsc.transform` - Retry initiated

## Testing Procedures

### 1. Check Initialization
Open browser DevTools Console and run:
```javascript
console.log('SWC available:', !!window.__swc)
console.log('Transform available:', typeof window.__swc?.transform)
```

### 2. Run JSX Probe (Manual)
```javascript
await window.__swc.transform(
  "export default function X(){ return _jsx_('div', null) }",
  { 
    jsc: { 
      parser: { syntax: 'ecmascript', jsx: true }, 
      transform: { 
        react: { 
          runtime: 'classic', 
          pragma: '_jsx_', 
          pragmaFrag: '_jsxFrag_' 
        } 
      } 
    }, 
    module: { type: 'es6' }, 
    filename: 'probe.jsx' 
  }
)
```

### 3. Run TSX Probe (Manual)
```javascript
await window.__swc.transform(
  "export default function X():any{ return _jsx_('div', null) }",
  { 
    jsc: { 
      parser: { syntax: 'typescript', tsx: true }, 
      transform: { 
        react: { 
          runtime: 'classic', 
          pragma: '_jsx_', 
          pragmaFrag: '_jsxFrag_' 
        } 
      } 
    }, 
    module: { type: 'es6' }, 
    filename: 'probe.tsx' 
  }
)
```

### 4. Use Interactive Test Page
Navigate to: `http://localhost:8080/swc-test.html`
- Click "Check Status" button to verify initialization
- Click "Run JSX Probe" to test JSX transpilation
- Click "Run TSX Probe" to test TypeScript JSX transpilation
- Click "Run Simple JSX Probe" to test simple JSX syntax
- View real-time console output in the console section

## Expected Behavior After Fix

1. **Initialization**: SWC WASM should initialize automatically when the app loads
2. **Logging**: Console should show `[swcBridge]` logs indicating successful initialization
3. **Transpilation**: All three probe tests should succeed and show transpiled code
4. **Error Handling**: If errors occur, detailed logs should explain what went wrong

## Key Files Reference

### SWC WASM Distribution Files
- `apps/client-web/dist/assets/wasm_bg-CbEtLhSO.wasm` - Binary WASM module (15.2 MB)
- `apps/client-web/dist/assets/wasm-DfPIfSWH.js` - WASM wrapper with init/transform functions
- `apps/client-web/dist/assets/wasm_bg-D9A7kWln.js` - WASM binary reference

### Generated Bundles
- `apps/client-web/dist/assets/index-C2g1u26-.js` - Main application bundle (1.3 MB)
- `apps/client-web/dist/index.html` - Entry point

## Next Steps

1. Open `http://localhost:8080/swc-test.html` in browser
2. Check browser DevTools console for `[swcBridge]` logs
3. Click "Check Status" to verify SWC initialization
4. Run each probe test and verify successful transpilation
5. Check console output for any errors or warnings
6. If errors persist:
   - Review error messages for specific WASM-related issues
   - Check if WASM binary is loading correctly
   - Verify init/initSync functions are available
   - Check for module loading issues in the network tab

## Related Configuration

### Vite Build Config
- SWC WASM is pre-optimized in `optimizeDeps.include`
- Minification disabled for readable debug builds
- Source maps enabled when `VITE_SOURCEMAP=true`
- Rollup external configuration for Babel standalone

### Server Configuration
- Static directory serving via `RELAY_STATIC_DIR` environment variable
- CORS headers enabled for all static assets
- Cache headers set to `public, max-age=3600`

## Debugging Checklist

- [x] Added comprehensive logging to swcBridge
- [x] Enhanced transpileCode error handling
- [x] Created interactive test page with probes
- [x] Built debug version with source maps
- [x] Started server with static dist directory
- [ ] Verified SWC initialization in browser
- [ ] Verified JSX transpilation works
- [ ] Verified TSX transpilation works
- [ ] Verified error messages are informative
- [ ] Confirmed no other transpilation issues
