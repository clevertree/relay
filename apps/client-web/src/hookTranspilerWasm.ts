// Loader for the Rust hook-transpiler WASM build.
// Exposes globalThis.__hook_transpile_jsx(source, filename) used by runtimeLoader.ts

// NOTE: This expects the crate to be built for wasm32-unknown-unknown with wasm-bindgen,
// and the JS glue to be available for import from /wasm/hook_transpiler.js (or similar).
// For dev, you can place the generated files under apps/client-web/public/wasm/.

export async function initHookTranspilerWasm(): Promise<void> {
  if ((globalThis as any).__hook_transpile_jsx) {
    console.log('[hookWasm] WASM already initialized')
    return
  }
  try {
    console.log('[hookWasm] Loading hook-transpiler WASM module')
    // Import the wasm-bindgen generated module
    const mod: any = await import('./wasm/hook_transpiler.js')
    
    console.log('[hookWasm] WASM module imported, initializing...')
    
    // Initialize WASM - the default export handles finding the .wasm file
    // It will look for hook_transpiler_bg.wasm relative to hook_transpiler.js
    if (typeof mod?.default === 'function') {
      await mod.default()
      console.log('[hookWasm] WASM initialization complete')
    } else {
      throw new Error('WASM module missing default export (init function)')
    }

    // Get the transpile_jsx function
    const transpileFn = mod?.transpile_jsx
    if (typeof transpileFn !== 'function') {
      throw new Error(`transpile_jsx export not found. Available: ${Object.keys(mod).join(', ')}`)
    }

    // Get the version
    const versionFn = mod?.get_version
    const version = typeof versionFn === 'function' ? versionFn() : 'unknown'

    // Bind to globalThis for use by runtimeLoader.ts
    ;(globalThis as any).__hook_transpile_jsx = transpileFn.bind(mod)
    ;(globalThis as any).__hook_transpiler_version = version
    console.log('[hookWasm] Hook transpiler WASM ready - v' + version + ' - transpile_jsx available')
    delete (globalThis as any).__hook_transpiler_error
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    ;(globalThis as any).__hook_transpiler_error = error
    console.error('[hookWasm] Failed to load hook-transpiler WASM:', e)
    throw e
  }
}
