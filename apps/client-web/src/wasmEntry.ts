// Re-export shim for wasm-bindgen outputs so bundlers (Vite) can statically analyze imports.
// This file should live inside client-web/src so import('/src/wasmEntry') is valid.

export * as hook_transpiler from './wasm/hook_transpiler.js'
export * as themed_styler from './wasm/themed_styler.js'

// Default helper: call default exports if available to initialize both modules.
export async function initAllClientWasms(): Promise<void> {
  // hook-transpiler
  try {
    // Import the JS glue and the wasm file URL separately so Vite doesn't need native wasm ESM support.
    // The wasm-bindgen bundler output exposes a default init function that accepts a URL/input.
    // @ts-ignore
    const hookMod = await import('./wasm/hook_transpiler.js')
    // import wasm as url so Vite treats it as an asset URL
    // @ts-ignore
    const { default: hookWasmUrl } = await import('./wasm/hook_transpiler_bg.wasm?url')
    if (hookMod && typeof hookMod.default === 'function') {
      try {
        await (hookMod as any).default(hookWasmUrl)
      } catch (e) {
        // some builds may already auto-init; ignore
      }
      if (typeof (hookMod as any).transpile_jsx === 'function') {
        ;(globalThis as any).__hook_transpile_jsx = (hookMod as any).transpile_jsx.bind(hookMod)
        ;(globalThis as any).__hook_transpiler_version = (typeof (hookMod as any).get_version === 'function') ? (hookMod as any).get_version() : 'unknown'
      }
    }
  } catch (e) {
    console.warn('[wasmEntry] hook init failed', e)
  }

  // themed-styler
  try {
    // @ts-ignore
    const stylerMod = await import('./wasm/themed_styler.js')
    // @ts-ignore
    const { default: stylerWasmUrl } = await import('./wasm/themed_styler_bg.wasm?url')
    if (stylerMod) {
      // wasm-bindgen generated file: default is an init function that can accept a URL/input
      if (typeof (stylerMod as any).default === 'function') {
        try { await (stylerMod as any).default(stylerWasmUrl) } catch (e) { /* ignore init failures */ }
      }
      const renderCss = (stylerMod as any).render_css_for_web as ((s: string) => string) | undefined
      const getRn = (stylerMod as any).get_rn_styles as ((state_json: string, selector: string, classes_json: string) => string) | undefined
      // Expose themed-styler version if available
      if (typeof (stylerMod as any).get_version === 'function') {
        try { (globalThis as any).__themedStyler_version = (stylerMod as any).get_version() } catch (e) { (globalThis as any).__themedStyler_version = 'unknown' }
      } else {
        (globalThis as any).__themedStyler_version = (globalThis as any).__themedStyler_version || 'unknown'
      }

      if (typeof renderCss === 'function') {
        ;(globalThis as any).__themedStylerRenderCss = (usageSnapshot: any, themes: any) => {
          try {
            const themeMap = themes?.themes || {}
            const currentTheme = themes?.currentTheme
            const defaultTheme = currentTheme || Object.keys(themeMap)[0] || 'default'
            const state = JSON.stringify({
              themes: themeMap,
              current_theme: currentTheme || defaultTheme,
              default_theme: defaultTheme,
              used_selectors: usageSnapshot?.selectors || [],
              used_classes: usageSnapshot?.classes || [],
            })
            return String(renderCss(state))
          } catch (e) {
            return ''
          }
        }
      }

      if (typeof getRn === 'function') {
        ;(globalThis as any).__themedStylerGetRn = (selector: string, classes: string[]) => {
          try {
            const classesJson = JSON.stringify(classes || [])
            const stateJson = JSON.stringify({})
            return JSON.parse(String(getRn(stateJson, selector, classesJson)))
          } catch (e) {
            return {}
          }
        }
      }
    }
  } catch (e) {
    console.warn('[wasmEntry] themed-styler init failed', e)
  }
}

export default { initAllClientWasms }
