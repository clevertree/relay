// SWC WASM bridge for the web app
// Ensures the WASM is bundled, initialized once, and a stable transform()
// reference is available for shared runtime via globalThis.__swc

let ready: Promise<void> | null = null
let swcRef: any = null
let initialized = false

export async function preloadSwc() {
  if (ready) return ready
  ready = (async () => {
    try {
      console.log('[swcBridge] Starting preloadSwc')
      const ns: any = await import('@swc/wasm-web')
      console.log('[swcBridge] Imported @swc/wasm-web')
      console.log('[swcBridge] Module keys:', Object.keys(ns))
      console.log('[swcBridge] ns.default:', typeof ns?.default)
      
      // The @swc/wasm-web module uses wasm-pack which typically exposes:
      // - A default export that is the init function (for async init)
      // - Named exports for the actual functions (transform, transformSync, etc.)
      // - The WASM module is auto-loaded by the wrapper if possible
      
      if (!initialized) {
        try {
          // Try to call the default export (usually the async init function)
          if (typeof ns?.default === 'function') {
            console.log('[swcBridge] Calling ns.default() (async init)')
            await ns.default()
            console.log('[swcBridge] Default init completed')
          } else if (typeof ns?.init === 'function') {
            console.log('[swcBridge] Calling ns.init() (alternate async init)')
            await ns.init()
            console.log('[swcBridge] ns.init() completed')
          } else if (typeof ns?.initSync === 'function') {
            console.log('[swcBridge] Only initSync available, attempting call')
            ns.initSync()
            console.log('[swcBridge] initSync completed')
          }
          initialized = true
          console.log('[swcBridge] WASM initialized successfully')
        } catch (e) {
          console.error('[swcBridge] WASM initialization error:', e)
          // Some bundlers auto-init, so continue anyway
        }
      }
      
      // Now get the transform functions from the module
      const swc: any = ns
      
      if (typeof swc?.transform !== 'function' && typeof swc?.transformSync !== 'function') {
        const keys = Object.keys(ns || {})
        throw new Error(`SWC bridge failed: missing transform() or transformSync(). keys=${JSON.stringify(keys)}`)
      }
      
      console.log('[swcBridge] SWC module ready, has transform:', typeof swc?.transform, 'has transformSync:', typeof swc?.transformSync)
      swcRef = swc
      ;(globalThis as any).__swc = swc
      // Expose the readiness promise so other modules can await initialization
      try { (globalThis as any).__swc_ready = ready } catch {}
      console.log('[swcBridge] SWC preload complete')
    } catch (err) {
      console.error('[swcBridge] Failed to preload SWC wasm:', err)
      throw err
    }
  })()
  return ready
}

export function getSwc(): any {
  if (swcRef) return swcRef
  return (globalThis as any).__swc
}
