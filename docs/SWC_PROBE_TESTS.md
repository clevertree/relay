# SWC Transpiler Probe Tests

Run these in the browser console at `http://localhost:8080` to test the SWC transpiler.

## A) JSX Probe

```javascript
await window.__swc.transform(
  "export default function X(){ return _jsx_('div', null) }",
  { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_' } } }, module: { type: 'es6' }, filename: 'probe.jsx' }
)
```

Expected result: Should return an object with a `code` property containing transpiled JavaScript.

## B) TSX Probe

```javascript
await window.__swc.transform(
  "export default function X():any{ return _jsx_('div', null) }",
  { jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_' } } }, module: { type: 'es6' }, filename: 'probe.tsx' }
)
```

Expected result: Should return an object with a `code` property containing transpiled TypeScript.

## Debugging Steps

1. Open DevTools Console (F12)
2. Check for `[swcBridge]` log messages indicating initialization progress
3. Check for `[transpileCode]` log messages when hooks are loaded
4. Run the probes above
5. Check if `window.__swc` is defined and has a `transform` function
6. Look for errors mentioning `_windgen_add_to_stack_pointer` or other WASM errors

## Common Issues

- **Missing WASM URL**: The WASM file might not be loading properly
- **Uninitialized module**: The `init` or `initSync` function might not be called
- **Transform not available**: The `transform` or `transformSync` export might be missing
