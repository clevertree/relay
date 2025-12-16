// Loader for the Rust hook-transpiler WASM build.
// Exposes globalThis.__hook_transpile_jsx(source, filename) used by runtimeLoader.ts

// NOTE: This expects the crate to be built for wasm32-unknown-unknown with wasm-bindgen,
// and the JS glue to be available for import from /wasm/hook_transpiler.js (or similar).
// For dev, you can place the generated files under apps/client-web/public/wasm/.

export async function initHookTranspilerWasm(): Promise<void> {
  // Delegate to consolidated wasm loader
  try {
    const loader = await import('@relay/shared')
    if (loader && loader.wasmLoader && typeof loader.wasmLoader.initAllWasms === 'function') {
      await loader.wasmLoader.initAllWasms()
    }
  } catch (e) {
    console.warn('[hookWasm] delegate init failed', e)
  }
}
