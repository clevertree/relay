# Dynamic Import Test - Debugging Progress Report

**Date:** December 11, 2025  
**Current Time:** ~12:15 UTC  
**Status:** Active Investigation

## Problem Statement

The React Native Relay app's dynamic import() wrapper test throws "Object is not a function" error when trying to call the default export of a dynamically imported module.

## Key Findings

### Working Evidence (from earlier test run at 12:03 UTC)

From logcat, we confirmed the test executes and collected these logs:

```
12-11 12:03:01.415 25840 25867 I ReactNativeJS: '[DebugTab][Import] Transpiled code (first 500 chars):', 
'\"use strict\";...\nexports[\"default\"] = _default;...'

12-11 12:03:01.415 25840 25867 I ReactNativeJS: '[DebugTab][Import] typeof default =', 'function', 'keys:', [ 'default' ]

12-11 12:03:01.415 25840 25867 I ReactNativeJS: '[DebugTab][Import] Full module object:', '{}'

12-11 12:03:01.415 25840 25867 I ReactNativeJS: '[DebugTab][Import] module.exports:', undefined

12-11 12:03:01.416 25840 25867 I ReactNativeJS: 'Dynamic import delegation failed', {
  message: 'Object is not a function',
  stack: 'TypeError: Object is not a function\n    at anonymous (/hooks/client/test-dynamic.jsx:30:46)\n...'
}
```

### The Paradox

- ✅ `typeof mod.default = 'function'` (mod.default IS a function)
- ✅ Babel successfully transpiled code: `exports["default"] = _default`
- ❌ `JSON.stringify(mod) = '{}'` (mod is empty)
- ❌ `mod.exports = undefined` (module.exports doesn't exist)
- ❌ When trying to call `await mod.default(ctx)`, we get "Object is not a function"

### Possible Root Causes

1. **Non-enumerable properties**: The `default` property might be defined as non-enumerable, so JSON.stringify() doesn't include it. But then why does `mod.default` show as a function?

2. **exports/module.exports reference broken**: The `exports` parameter and `module.exports` might not be the same object after code execution. RNModuleLoader creates:
   ```typescript
   const exports = {}
   const module = { exports }
   // ...then passes both `module` and `exports` separately to Function
   ```
   If transpiled code reassigns `exports` or `module.exports`, they could diverge.

3. **Babel transpilation output doesn't match expectations**: The Babel preset `['env', { modules: 'commonjs' }]` should convert ES exports to CommonJS, but might not be working correctly.

4. **Different object being returned**: RNModuleLoader returns `(module as any).exports`, but maybe something else should be returned.

## Recent Code Changes

### 1. DebugTab.tsx (Line ~554)
**Before:**
```typescript
const Babel = require('@babel/standalone')
```

**After:**
```typescript
// Use Babel already imported at component level
// Removed require(), now using imported Babel directly
```

**Reason:** In React Native, require() for ES modules might not work. The Babel import at the top of the file should be available in scope.

### 2. DebugTab.tsx (Line ~597-604)
**Added diagnostic logging:**
```typescript
console.log('[DebugTab][Import] mod.default direct access:', def)
console.log('[DebugTab][Import] Object.getOwnPropertyNames(mod):', Object.getOwnPropertyNames(mod || {}))
```

### 3. runtimeLoader.ts (Line ~245-250)
**Added diagnostic logging:**
```typescript
console.log('[RNModuleLoader] After execution - mod object:', JSON.stringify(mod, null, 2))
console.log('[RNModuleLoader] mod.default type:', typeof (mod?.default))
console.log('[RNModuleLoader] module.exports === exports?', (module as any).exports === exports)
console.log('[RNModuleLoader] exports object:', JSON.stringify(exports, null, 2))
```

## Next Steps

### Immediate (Critical)
1. **Verify new APK is running** - Force stop and restart app, then test
2. **Collect diagnostic logs** - Capture the new RNModuleLoader diagnostic output
3. **Analyze property enumeration** - Check if `default` property is enumerable

### Investigation
Based on diagnostic logs, determine:
- Are `exports` and `module.exports` the same object? (logged)
- What are the property names on `mod`? (logged with Object.getOwnPropertyNames)
- Is the transpilation producing valid CommonJS? (check snippet)

### Root Cause Resolution
Once diagnostics show where the problem is:
- **If exports/module.exports diverged**: Fix RNModuleLoader to handle exports reassignment
- **If property not enumerable**: Ensure default export is enumerable
- **If transpilation issue**: Adjust Babel presets

## Code Locations

- **Test code**: `/apps/client-react-native/src/components/DebugTab.tsx` lines 546-630
- **Module loader**: `/apps/shared/src/runtimeLoader.ts` lines 147-255  
- **Import handler**: `/apps/shared/src/es6ImportHandler.ts`

## Device Info

- Device: Amazon Kindle Fire (KFTRWI - 9)
- OS: Android 9
- App: com.relay.client
- Latest APK: 75.2 MB (75.3 MB for DM)

## Test Module Details

Input code:
```javascript
export default async function(ctx){
  const mod = await import('./dummy.mjs')
  return mod.default()
}
```

Expected behavior:
1. Code transpiles to CommonJS with `module.exports.default = async function...`
2. RNModuleLoader executes it and returns `{ default: async function }`
3. Test calls `await def(ctx)` successfully

Actual behavior:
1. Code transpiles correctly ✅
2. RNModuleLoader seems to return empty object while somehow having `.default` property ⚠️
3. Calling `await def(ctx)` throws "Object is not a function" ❌

## Commands to Run Next

```bash
# Force reload app
adb shell am force-stop com.relay.client
timeout 2
adb shell am start com.relay.client  
timeout 4

# Clear and test
adb logcat -c
# (manually tap Debug tab and Test button on device)
adb logcat -d | grep -E "RNModuleLoader|DebugTab.*Import|Object\.getOwnPropertyNames" 
```
