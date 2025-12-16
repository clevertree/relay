import unifiedBridge from './unifiedBridge'
import { useEffect } from 'react'

let styleEl: HTMLStyleElement | null = null
let syncInterval: number | null = null
let lastSnapshotJson = ''
let debounceTimer: number | null = null
let forceRenderNext = false
const emitter = (typeof window !== 'undefined' ? new EventTarget() : null)
const isDevMode = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV

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
    if (debounceTimer) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      try { renderCssIntoDom() } catch (e) {}
      debounceTimer = null
    }, 50)
  } catch (e) {
    // swallow
  }
}

export function startAutoSync(pollInterval = 250) {
  if (typeof window === 'undefined') return
  stopAutoSync()
  // take initial snapshot
  try { lastSnapshotJson = JSON.stringify(unifiedBridge.getUsageSnapshot()) } catch (e) { lastSnapshotJson = '' }
  syncInterval = window.setInterval(checkAndRender, pollInterval)
}

export function stopAutoSync() {
  if (syncInterval) {
    window.clearInterval(syncInterval)
    syncInterval = null
  }
  if (debounceTimer) {
    window.clearTimeout(debounceTimer)
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
