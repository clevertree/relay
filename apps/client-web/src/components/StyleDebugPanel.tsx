import {useCallback, useEffect, useMemo, useState} from 'react'
import {unifiedBridge, styleManager} from '@relay/shared'

function JsonBlock({value}:{value:any}){
  const text = useMemo(()=>{
    try { return JSON.stringify(value, null, 2) }
    catch(e){ return String(value) }
  },[value])
  return <pre className="font-mono text-xs bg-black/5 p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">{text}</pre>
}

export default function StyleDebugPanel(){
  const [css, setCss] = useState('')
  const [usage, setUsage] = useState<any>(null)
  const [themesState, setThemesState] = useState<any>(null)
  const [themedStylerFullState, setThemedStylerFullState] = useState<any>(null)
  const [themedStylerVersion, setThemedStylerVersion] = useState<any>(null)
  const [themedStylerGlobalVersion, setThemedStylerGlobalVersion] = useState<any>(null)
  const [themedStylerModuleVersion, setThemedStylerModuleVersion] = useState<any>(null)
  const [themedStylerWasmInfo, setThemedStylerWasmInfo] = useState<any>(null)
  const [wasmApi, setWasmApi] = useState<any>(null)
  const [wasmError, setWasmError] = useState<null | {message: string, stack?: string, time: string}>(null)
  const refresh = useCallback(()=>{
    try{
      setCss(unifiedBridge.getCssForWeb())
    }catch(e){ setCss(String(e)) }
    try{ setUsage(unifiedBridge.getUsageSnapshot()) }catch(e){ setUsage({error:String(e)}) }
    try{
      const themes = unifiedBridge.getThemes && typeof unifiedBridge.getThemes === 'function' ? unifiedBridge.getThemes() : null
      setThemesState(themes)
      try {
        const usageSnapshot = unifiedBridge.getUsageSnapshot ? unifiedBridge.getUsageSnapshot() : { selectors: [], classes: [] }
        const themesMap = themes && themes.themes ? themes.themes : {}
        const current = themes && typeof themes.currentTheme !== 'undefined' ? themes.currentTheme : null
        const defaultTheme = current || Object.keys(themesMap)[0] || null
        const full = {
          themes: themesMap,
          default_theme: defaultTheme,
          current_theme: current,
          variables: {},
          breakpoints: {},
          used_selectors: usageSnapshot.selectors || [],
          used_classes: usageSnapshot.classes || [],
        }
        setThemedStylerFullState(full)
      } catch (e) {
        setThemedStylerFullState({ error: String(e) })
      }
    }catch(e){ setThemesState({error:String(e)}) }
    // Prefer the global version set by wasm init; fall back to the raw module API if present
    try {
      const globalVersion = (globalThis as any).__themedStyler_version
      setThemedStylerGlobalVersion(globalVersion || null)
      if (wasmApi && typeof wasmApi.get_version === 'function') {
        try { setThemedStylerModuleVersion((wasmApi as any).get_version()) } catch (e:any) { setThemedStylerModuleVersion(null) }
      } else {
        setThemedStylerModuleVersion(null)
      }
      // Primary display remains a single combined view for backwards compat
      if (globalVersion && typeof globalVersion === 'string') {
        setThemedStylerVersion(globalVersion)
      } else if (wasmApi && typeof wasmApi.get_version === 'function') {
        try { setThemedStylerVersion((wasmApi as any).get_version()) } catch (e:any) { setThemedStylerVersion(null) }
      } else {
        setThemedStylerVersion(null)
      }
    } catch (e:any) {
      setWasmError({ message: String(e?.message ?? e), stack: e?.stack, time: new Date().toISOString() })
      setThemedStylerVersion(null)
    }
  },[])

  useEffect(()=>{
    // initial
    refresh()
    // Try to initialize wasm via the centralized initializer first so it can use the
    // manifest-based cache-busted URL. Only after that do we import the generated
    // module so we avoid premature auto-init using a bundler-resolved wasm.
    ;(async ()=>{
      try{
        try {
          const wasmEntry = await import('../wasmEntry')
          if (wasmEntry && typeof (wasmEntry as any).initAllClientWasms === 'function') {
            await (wasmEntry as any).initAllClientWasms()
          }
        } catch (e:any) {
          console.warn('[StyleDebugPanel] wasmEntry.initAllClientWasms failed', e)
        }

        // Now import the wasm-bindgen-generated module (it may be already-initialized,
        // but calling init above ensures the preferred manifest URL will be used when
        // possible).
        const styler = await import('../wasm/themed_styler')
        setWasmApi(styler)

        const globalVersion = (globalThis as any).__themedStyler_version
        setThemedStylerGlobalVersion(globalVersion || null)
        if (styler && typeof (styler as any).get_version === 'function') {
          try { setThemedStylerModuleVersion((styler as any).get_version()) } catch (e:any) { setThemedStylerModuleVersion(null) }
        }
        if (globalVersion && typeof globalVersion === 'string') {
          setThemedStylerVersion(globalVersion)
        } else if (styler && typeof (styler as any).get_version === 'function') {
          try { setThemedStylerVersion((styler as any).get_version()) } catch (e:any) { setThemedStylerVersion(null) }
        }

        // Also attempt to resolve the actual wasm URL via the public manifest and fetch
        // headers for debugging cache/stale issues. This ensures we reflect the canonical
        // served path (/wasm/...) rather than any bundler-resolved import.
        try {
          // Prefer bundler-resolved URL (Vite) which points at src/wasm
          try {
            // @ts-ignore
            const mod = await import('../wasm/themed_styler_bg.wasm?url')
            const url = String((mod as any).default || mod)
            setThemedStylerWasmInfo({ url })
            try {
              const head = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
              setThemedStylerWasmInfo({ url, status: head.status, headers: { 'content-length': head.headers.get('content-length'), 'last-modified': head.headers.get('last-modified'), etag: head.headers.get('etag') } })
            } catch (e) {
              // ignore
            }
          } catch (e) {
            // bundler import not available; fall back to local manifest
            try {
              // @ts-ignore
              const m = await import('../wasm/themed_styler.manifest.json')
              if (m && m.default && m.default.wasm_path) {
                const ts = m.default.generated_at ? encodeURIComponent(m.default.generated_at) : Date.now()
                const wasmUrl = `${m.default.wasm_path}?t=${ts}`
                setThemedStylerWasmInfo({ url: wasmUrl })
                try {
                  const head = await fetch(wasmUrl, { method: 'HEAD', cache: 'no-cache' })
                  setThemedStylerWasmInfo({ url: wasmUrl, status: head.status, headers: { 'content-length': head.headers.get('content-length'), 'last-modified': head.headers.get('last-modified'), etag: head.headers.get('etag') } })
                } catch (e) {}
              }
            } catch (e) {
              // ignore
            }
          }
        } catch (e) {
          // ignore
        }
      }catch(e:any){
        setWasmError({ message: String(e?.message ?? e), stack: e?.stack, time: new Date().toISOString() })
      }
    })()
    // subscribe to styleManager change events for immediate updates
    const unsub = styleManager.onChange ? styleManager.onChange(refresh) : () => {}
    return () => { try { unsub() } catch (e) {} }
  },[refresh])

  const copyCss = useCallback(()=>{
    navigator.clipboard?.writeText(css)
  },[css])

  const forceLoadFromManifest = useCallback(async ()=>{
    try {
      const wasmEntry = await import('../wasmEntry')
      if (wasmEntry && typeof (wasmEntry as any).forceInitThemedStylerFromManifest === 'function') {
        const v = await (wasmEntry as any).forceInitThemedStylerFromManifest()
        // re-run refresh to update UI state
        refresh()
        return v
      }
    } catch (e:any) {
      console.warn('[StyleDebugPanel] forceInit failed', e)
    }
    return null
  },[refresh])

  return (
    <div className="p-3 mt-4 border rounded bg-white/80 dark:bg-black/60 text-sm">
      {wasmError ? (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/60 border border-red-200 dark:border-red-700 rounded">
          <div className="font-semibold text-red-700 dark:text-red-300">Themed-styler WebAssembly failed to load</div>
          <div className="text-xs text-red-600 dark:text-red-200 mt-1">Diagnostics:</div>
          <div className="mt-2 text-xs">
            <div><strong>Message:</strong> {wasmError.message}</div>
            {wasmError.stack ? <pre className="font-mono text-xs bg-black/5 p-2 rounded mt-2 overflow-auto max-h-40 whitespace-pre-wrap">{wasmError.stack}</pre> : null}
            <div className="mt-2 text-xs text-gray-600">Captured at: {wasmError.time}</div>
            <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">Suggested actions: ensure the wasm build step ran and that the wasm file is served correctly; check browser console/network for errors.</div>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Themed Styler — Debug</div>
        <div className="space-x-2">
          <button onClick={refresh} className="px-2 py-1 bg-blue-500 text-white rounded text-xs">Refresh</button>
          <button onClick={forceLoadFromManifest} className="px-2 py-1 bg-green-500 text-white rounded text-xs">Force manifest load</button>
          <button onClick={copyCss} className="px-2 py-1 bg-gray-200 dark:bg-gray-800 rounded text-xs">Copy CSS</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="font-semibold mt-3 mb-1">Themed-styler version</div>
          <JsonBlock value={themedStylerVersion} />
            <div className="font-semibold mb-1">Generated CSS</div>
            <pre className="font-mono text-xs bg-black/5 p-2 rounded overflow-auto max-h-72 whitespace-pre-wrap">{css}</pre>
          <div className="text-xs text-gray-600 mt-2">(Diagnostics)</div>
          <div className="text-xs mt-1">Global version: <span className="font-mono">{String(themedStylerGlobalVersion ?? 'null')}</span></div>
          <div className="text-xs mt-1">Module-reported: <span className="font-mono">{String(themedStylerModuleVersion ?? 'null')}</span></div>
          {themedStylerWasmInfo ? (
            <div className="mt-2 text-xs">
              <div>WASM URL: <span className="font-mono break-all">{themedStylerWasmInfo.url}</span></div>
              <div>HTTP status: {themedStylerWasmInfo.status ?? 'n/a'}</div>
              <div>Content-Length: {themedStylerWasmInfo?.headers?.['content-length'] ?? 'n/a'}</div>
              <div>Last-Modified: {themedStylerWasmInfo?.headers?.['last-modified'] ?? 'n/a'}</div>
              <div>ETag: {themedStylerWasmInfo?.headers?.etag ?? 'n/a'}</div>
            </div>
          ) : null}
          <div className="font-semibold mt-3 mb-1">Themed-styler (full state)</div>
          <JsonBlock value={themedStylerFullState} />
          <div className="font-semibold mb-1">Usage Snapshot</div>
          <JsonBlock value={usage} />
          <div className="font-semibold mt-3 mb-1">Themed-styler (summary)</div>
          <JsonBlock value={themesState} />
          <div className="font-semibold mt-3 mb-1">Style Manager (raw)</div>
          <JsonBlock value={styleManager && (styleManager as any).state ? (styleManager as any).state : { available: Boolean(styleManager) }} />
        </div>
      </div>
    </div>
  )
}
