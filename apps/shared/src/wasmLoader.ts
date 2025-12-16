// Consolidated WASM loader for both hook-transpiler and themed-styler
export async function initAllWasms(): Promise<void> {
  const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}

  // If both hooks are already present, nothing to do
  if (g.__hook_transpile_jsx && g.__themedStylerRenderCss && g.__themedStylerGetRn) {
    return
  }

  // Single-source-of-truth: prefer the re-export shim inside client-web and do not probe other paths.
  try {
    // Use a static import call so Vite can analyze it. Do not use a dynamic import('pathVar') which Vite warns about.
    // @ts-ignore
    const shim = await import('/src/wasmEntry')
    if (shim && typeof shim.initAllClientWasms === 'function') {
      await shim.initAllClientWasms()
      return
    }
    console.warn('[wasmLoader] client shim /src/wasmEntry not found; no wasm initialized. Place wasm-bindgen outputs in apps/client-web/src/wasm and add the shim.')
  } catch (e) {
    console.warn('[wasmLoader] shim import failed', e)
  }
}

export default { initAllWasms }
