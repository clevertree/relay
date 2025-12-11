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
      
      // Robust init without explicit wasm asset import to avoid Vite import-analysis issues
      if (!initialized) {
        try {
          if (typeof ns?.default === 'function') {
            console.log('[swcBridge] Calling ns.default() (async init)')
            await ns.default()
          } else if (typeof ns?.init === 'function') {
            console.log('[swcBridge] Calling ns.init() (async init)')
            await ns.init()
          } else if (typeof ns?.initSync === 'function') {
            console.log('[swcBridge] Calling ns.initSync() (sync init)')
            ns.initSync()
          }
          initialized = true
          console.log('[swcBridge] WASM initialized successfully')
        } catch (e) {
          console.error('[swcBridge] WASM initialization error (continuing, transform() may still work):', e)
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
