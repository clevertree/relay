// Loader for the Rust hook-transpiler WASM build.
// Exposes globalThis.__hook_transpile_jsx(source, filename) used by runtimeLoader.ts

// NOTE: This expects the crate to be built for wasm32-unknown-unknown with wasm-bindgen,
// and the JS glue to be available for import from /wasm/hook_transpiler.js (or similar).
// For dev, you can place the generated files under apps/client-web/public/wasm/.

declare const global: any

export async function initHookTranspilerWasm(): Promise<void> {
  if ((globalThis as any).__hook_transpile_jsx) return
  try {
    console.log('[hookWasm] Loading hook-transpiler WASM')
    // The following path assumes you copy wasm-bindgen output to public/wasm/
    // Files expected: hook_transpiler_bg.wasm, hook_transpiler.js
    // Vite will serve them at /wasm/*
    // Use vite-ignore so dev server doesn't try to pre-resolve it at build time.
    // This path must exist at runtime under apps/client-web/public/wasm.
    const mod: any = await import(/* @vite-ignore */ '/wasm/hook_transpiler.js')
    if (typeof mod?.default === 'function') {
      // Initialize with explicit WASM url; adjust filename if different
      await mod.default('/wasm/hook_transpiler_bg.wasm')
    } else if (typeof (mod as any)?.init === 'function') {
      await (mod as any).init('/wasm/hook_transpiler_bg.wasm')
    }
    const transpileFn = (mod as any)?.transpile_jsx || (mod as any)?.transpileJsx
    if (typeof transpileFn !== 'function') {
      throw new Error('hook-transpiler wasm: transpile_jsx export not found')
    }
    ;(globalThis as any).__hook_transpile_jsx = transpileFn
    console.log('[hookWasm] Hook transpiler WASM ready')
  } catch (e) {
    console.error('[hookWasm] Failed to load hook-transpiler WASM:', e)
    throw e
  }
}
