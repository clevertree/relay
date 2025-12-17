import unifiedBridge from './unifiedBridge'
import { useEffect } from 'react'

let styleEl: HTMLStyleElement | null = null
let syncInterval: any | null = null
let lastSnapshotJson = ''
let debounceTimer: any | null = null
let forceRenderNext = false
function createEmitter() {
  if (typeof window !== 'undefined' && typeof (globalThis as any).EventTarget !== 'undefined') {
    return new (globalThis as any).EventTarget()
  }
  // minimal fallback emitter for non-browser environments (React Native)
  const handlers: Array<(ev?: any) => void> = []
  return {
    addEventListener: (_: string, h: (ev?: any) => void) => { handlers.push(h) },
    removeEventListener: (_: string, h: (ev?: any) => void) => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1) },
    dispatchEvent: (ev?: any) => { handlers.slice().forEach(h => { try { h(ev) } catch (e) {} }); return true }
  }
}
const emitter = createEmitter()
const isDevMode = (() => {
  try {
    if (typeof (globalThis as any).__DEV__ !== 'undefined') return !!(globalThis as any).__DEV__
  } catch (e) {}
  try {
    return (typeof process !== 'undefined' && (process.env && process.env.NODE_ENV === 'development')) || false
  } catch (e) {
    return false
  }
})()

export function ensureStyleElement() {
  if (typeof document === 'undefined') return null
  if (styleEl) return styleEl
  styleEl = document.createElement('style')
  styleEl.setAttribute('data-themed-styler', 'true')
  document.head.appendChild(styleEl)
  return styleEl
}

export function renderCssIntoDom() {
  const el = ensureStyleElement()
  if (!el) return
  const css = unifiedBridge.getCssForWeb()
  const hasRenderer = typeof (globalThis as any).__themedStylerRenderCss === 'function'
  if (isDevMode) {
    console.debug('[styleManager] renderCssIntoDom', { renderer: hasRenderer, cssLength: css?.length ?? 0 })
  }
  el.textContent = css
}

export function requestRender() {
  // trigger checkAndRender but keep debounced behavior
  forceRenderNext = true
  try {
    checkAndRender()
    if (emitter) emitter.dispatchEvent(new Event('change'))
  } catch (e) {}
}

export function wrapCreateElement(reactModule: any) {
  const baseCreate = reactModule.createElement.bind(reactModule)
  function hookedCreate(type: any, props: any, ...children: any[]) {
    if (typeof type === 'string') {
      try {
        unifiedBridge.registerUsage(type, props)
        requestRender()
      } catch (e) {}
    }
    return baseCreate(type, props, ...children)
  }
  return { ...reactModule, createElement: hookedCreate }
}

export function useStyleManager(cb?: (ev?: Event) => void) {
  useEffect(() => {
    if (!cb || !emitter) return
    const handler = (ev: Event) => cb(ev)
    emitter.addEventListener('change', handler)
    return () => emitter.removeEventListener('change', handler)
  }, [cb])
  return { requestRender, renderCssIntoDom }
}

export function tearDownStyleElement() {
  if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
  styleEl = null
}

function checkAndRender() {
  try {
    const snap = unifiedBridge.getUsageSnapshot()
    const j = JSON.stringify(snap)
    const selectorsCount = snap?.selectors?.length ?? 0
    const changed = j !== lastSnapshotJson
    if (!changed && !forceRenderNext) return
    if (isDevMode) {
      console.debug('[styleManager] checkAndRender', { selectors: selectorsCount, changed, forceRender: forceRenderNext })
    }
    lastSnapshotJson = j
    forceRenderNext = false
    // debounce actual DOM writes to avoid thrash
    if (debounceTimer) globalThis.clearTimeout(debounceTimer)
    debounceTimer = globalThis.setTimeout(() => {
      try { renderCssIntoDom() } catch (e) {}
      debounceTimer = null
    }, 50)
  } catch (e) {
    // swallow
  }
}

export function startAutoSync(pollInterval = 250) {
  if (typeof globalThis === 'undefined') return
  stopAutoSync()
  // take initial snapshot
  try { lastSnapshotJson = JSON.stringify(unifiedBridge.getUsageSnapshot()) } catch (e) { lastSnapshotJson = '' }
  syncInterval = globalThis.setInterval(checkAndRender, pollInterval)
}

export function stopAutoSync() {
  if (syncInterval) {
    globalThis.clearInterval(syncInterval)
    syncInterval = null
  }
  if (debounceTimer) {
    globalThis.clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function onChange(cb: (ev?: Event) => void) {
  if (!emitter) return () => {}
  const h = (ev: Event) => cb(ev)
  emitter.addEventListener('change', h)
  return () => emitter.removeEventListener('change', h)
}

export default { ensureStyleElement, renderCssIntoDom, tearDownStyleElement, startAutoSync, stopAutoSync, requestRender, onChange, wrapCreateElement, useStyleManager }
