// Themed-styler WASM loader scaffold
// This file attempts to import the wasm-bindgen-generated JS glue for themed-styler
// and expose two functions on globalThis:
//  - __themedStylerRenderCss(usageSnapshot, themes) -> string
//  - __themedStylerGetRn(selector, classes) -> object
// To use: build the themed-styler crate with wasm-bindgen and drop the generated
// files under apps/shared/src/wasm/themed_styler.js (+ .wasm) or serve them from /wasm/.

export async function initThemedStylerWasm(): Promise<void> {
  try {
    const loader = await import('./wasmLoader')
    if (loader && typeof loader.initAllWasms === 'function') {
      await loader.initAllWasms()
    }
  } catch (e) {
    console.warn('[themedStylerWasm] delegate init failed', e)
  }
}

export default { initThemedStylerWasm }
