// SWC WASM bridge for the web app
// Ensures the WASM is bundled, initialized once, and a stable transform()
// reference is available for shared runtime via globalThis.__swc

let ready: Promise<void> | null = null
let swcRef: any = null

export async function preloadSwc() {
  if (ready) return ready
  ready = (async () => {
    try {
      const ns: any = await import('@swc/wasm-web')
      // Prefer explicit WASM url initialization to avoid double-loader issues
      // Vite will turn this into a URL to the emitted wasm asset
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - query import
      const wasmUrl: string | undefined = (await import('@swc/wasm-web/wasm_bg.wasm?url')).default
      // Some bundlers wrap the exports under .default
      const swc: any = ns && (ns.default ? { ...ns.default, ...ns } : ns)
      const init = typeof swc?.init === 'function' ? swc.init : typeof ns?.init === 'function' ? ns.init : null
      const initSync = typeof swc?.initSync === 'function' ? swc.initSync : typeof ns?.initSync === 'function' ? ns.initSync : null
      if (init || initSync) {
        try {
          if (initSync && wasmUrl) {
            // Fetch bytes and initialize synchronously to avoid races
            const res = await fetch(wasmUrl)
            const bytes = await res.arrayBuffer()
            initSync(bytes as any)
          } else if (init) {
            if (wasmUrl) {
              await init(wasmUrl as any)
            } else {
              await init()
            }
          }
        } catch (_) {
          // Ignore double‑init errors
        }
      }
      if (typeof swc?.transform !== 'function') {
        const keys = Object.keys(ns || {})
        const dkeys = Object.keys((ns as any)?.default || {})
        throw new Error(`SWC bridge failed: missing transform(). keys=${JSON.stringify(keys)} defaultKeys=${JSON.stringify(dkeys)}`)
      }
      swcRef = swc
      ;(globalThis as any).__swc = swc
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
