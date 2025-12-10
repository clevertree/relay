# SWC Console Probe Instructions

## Quick Start

1. Build the debug version:
   ```bash
   npm run web:build:debug
   ```

2. Start the server:
   ```bash
   npm run dev:server:dist:debug
   ```

3. Open in browser:
   - Main app: http://localhost:8080
   - Test page: http://localhost:8080/swc-test.html (recommended)

4. Open DevTools (F12 or Cmd+Option+I)

## Testing Methods

### Method 1: Interactive Test Page (Recommended)
Visit http://localhost:8080/swc-test.html and:
1. Click "Check Status" to verify SWC is initialized
2. Click "Run JSX Probe" to test JSX transpilation
3. Click "Run TSX Probe" to test TypeScript JSX
4. Click "Run Simple JSX Probe" to test simple JSX syntax
5. View all console output in the page itself

### Method 2: Manual Console Commands

**A) JSX Transpilation Probe**

Copy and paste this into the browser DevTools console:

```javascript
await window.__swc.transform(
  "export default function X(){ return _jsx_('div', null) }",
  { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_' } } }, module: { type: 'es6' }, filename: 'probe.jsx' }
)
```

Expected output:
```javascript
{
  code: "export default function X() {\n    return _jsx_('div', null);\n}\n",
  map: null
}
```

**B) TSX Transpilation Probe**

Copy and paste this into the browser DevTools console:

```javascript
await window.__swc.transform(
  "export default function X():any{ return _jsx_('div', null) }",
  { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_' } } }, module: { type: 'es6' }, filename: 'probe.tsx' }
)
```

Expected output:
```javascript
{
  code: "export default function X() {\n    return _jsx_('div', null);\n}\n",
  map: null
}
```

**C) Simple JSX Probe**

Copy and paste this into the browser DevTools console:

```javascript
await window.__swc.transform(
  "return <div>Hello</div>",
  { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_' } } }, module: { type: 'es6' }, filename: 'simple.jsx' }
)
```

Expected output:
```javascript
{
  code: "return _jsx_(\"div\", {\n    children: \"Hello\"\n});\n",
  map: null
}
```

## Debugging Commands

**Check if SWC is initialized:**
```javascript
console.log('SWC available:', !!window.__swc)
console.log('Transform available:', typeof window.__swc?.transform)
console.log('Transform sync available:', typeof window.__swc?.transformSync)
```

**View SWC module contents:**
```javascript
console.log('SWC module keys:', Object.keys(window.__swc))
```

**View initialization logs:**
```javascript
// Scroll up in the console to see [swcBridge] logs
// Filter by "[swcBridge]" to see only initialization logs
```

**Check transpilation logs:**
```javascript
// Scroll in the console to see [transpileCode] logs
// Filter by "[transpileCode]" to see transpilation steps
```

**Simulate a failed transpilation:**
```javascript
// This should show error handling
await window.__swc.transform(
  "invalid syntax !!!",
  { jsc: { parser: { syntax: 'ecmascript', jsx: true } }, module: { type: 'es6' }, filename: 'error.jsx' }
)
```

## What to Look For

### Success Indicators
- ✓ Console shows `[swcBridge] SWC preload complete`
- ✓ `window.__swc` is defined and has `transform` function
- ✓ Probes return objects with `code` property
- ✓ Console shows `[transpileCode] Transform succeeded`

### Error Indicators
- ✗ Console shows `[swcBridge] Failed to preload SWC wasm`
- ✗ `window.__swc` is undefined
- ✗ `TypeError: Cannot read properties of undefined`
- ✗ WASM initialization errors
- ✗ Probes return undefined or error objects

## Troubleshooting

### If SWC is not initialized:
1. Check browser console for `[swcBridge]` messages
2. Verify WASM file is loading (check Network tab for wasm_bg-*.wasm)
3. Check if `init()` or `initSync()` is being called
4. Look for CORS or fetch errors loading the WASM file

### If transpilation fails:
1. Check the error message for specifics
2. Verify the SWC options are correct JSON
3. Try the simple JSX probe first, then move to complex examples
4. Check console for `[transpileCode] Transform error` messages

### If you see "_windgen_add_to_stack_pointer" errors:
1. This means WASM is not properly initialized
2. Check `[swcBridge]` logs to see where initialization failed
3. Verify `initSync()` or `init()` completed successfully
4. Check that WASM binary was fetched correctly

## Expected Console Output

When everything works, you should see:
```
[swcBridge] Starting preloadSwc
[swcBridge] Imported @swc/wasm-web
[swcBridge] Module keys: ["transform","transformSync","parse","parseSync","minify","minifySync","print","printSync","init","initSync","default"]
[swcBridge] initSync available: true init available: true
[swcBridge] WASM URL from ?url: /assets/wasm_bg-CbEtLhSO.wasm
[swcBridge] Fetched WASM bytes, length: 15622447
[swcBridge] Calling initSync with WASM bytes
[swcBridge] WASM initialized successfully
[swcBridge] SWC module ready, has transform: function has transformSync: function
[swcBridge] SWC preload complete
```

Then when you run a probe:
```
[transpileCode] Starting transpilation for probe.jsx code length: 53
[transpileCode] __swc available: true
[transpileCode] Found transformFn: function isSync: false
[transpileCode] Calling transform with options: ...
[transpileCode] Transform succeeded, result code length: 77
```

## Browser Console Tips

- Open with F12 (Windows/Linux) or Cmd+Option+I (Mac)
- Filter console output by typing in the filter box
- Click the "Clear console" button to reset
- Use `Ctrl+L` or `Cmd+K` to clear, or click the circle with line icon
- Right-click on a message to copy or filter by it
