import { useCallback, useEffect, useMemo, useState } from 'react'
import { styleManager, unifiedBridge } from '@relay/shared'
import { useTranspilerSetting } from '../state/transpilerSettings'

export function SettingsTab() {
  const { setting, setSetting } = useTranspilerSetting()

  // Compute description based on two modes only
  const selectedDescription = useMemo(() => {
    if (setting === 'server-only')
      return 'Always use the server /api/transpile endpoint for hooks. Useful for environments where WASM is unavailable.'
    return 'Use the WASM hook transpiler that ships with the web app. Syntax errors are reported directly from the client.'
  }, [setting])

  // classes inspector
  const [search, setSearch] = useState('')
  const [classes, setClasses] = useState<string[]>([])
  const [stylerStatus, setStylerStatus] = useState({
    styleTag: false,
    selectors: 0,
    classes: 0,
    cssPreview: '',
  })

  const collectActiveClasses = () => {
    const set = new Set<string>()
    try {
      const all = document.body.querySelectorAll('*')
      all.forEach((el) => {
        const cls = (el as HTMLElement).className || ''
        if (typeof cls === 'string' && cls.length) {
          cls
            .split(/\s+/)
            .map((c) => c.trim())
            .filter(Boolean)
            .forEach((c) => set.add(c))
        }
      })
    } catch {}
    return Array.from(set).sort()
  }

  const refreshClasses = () => setClasses(collectActiveClasses())
  const refreshStylerStatus = useCallback(() => {
    try {
      const snapshot = unifiedBridge.getUsageSnapshot()
      const tag = document.querySelector('style[data-themed-styler]')
      let preview = tag?.textContent?.trim() || ''
      if (preview.length > 300) {
        preview = `${preview.slice(0, 300)}...`
      }
      setStylerStatus({
        styleTag: !!tag,
        selectors: snapshot.selectors.length,
        classes: snapshot.classes.length,
        cssPreview: preview,
      })
    } catch (e) {
      setStylerStatus((prev) => ({ ...prev, cssPreview: `Error: ${(e as Error)?.message || String(e)}` }))
    }
  }, [])

  useEffect(() => {
    refreshClasses()
    // Optional: observe DOM changes to keep list updated
    const obs = new MutationObserver(() => {
      // lightweight throttle by requestAnimationFrame
      requestAnimationFrame(() => refreshClasses())
    })
    obs.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    refreshStylerStatus()
    const unsub = styleManager.onChange ? styleManager.onChange(refreshStylerStatus) : () => {}
    return () => unsub()
  }, [refreshStylerStatus])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return classes
    return classes.filter((c) => c.toLowerCase().includes(q))
  }, [classes, search])

  const isServer = setting === 'server-only'

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Relay settings</h1>
        <p className="text-sm text-gray-500 mt-1">Control how hooks are transpiled.</p>
      </div>

      <section className="bg-[var(--bg-surface)] border rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Transpiler</h2>
            <p className="text-sm text-gray-500">Choose between client-side (WASM) and server-side transpilation.</p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-base font-medium text-gray-900">{isServer ? 'Server-side transpiler' : 'Client-side hook transpiler'}</p>
            <p className="text-sm text-gray-500 mt-1">{selectedDescription}</p>
          </div>
          <label className="inline-flex items-center cursor-pointer select-none">
            <span className="mr-3 text-sm text-gray-600">Client</span>
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isServer}
              onChange={(e) => setSetting(e.target.checked ? 'server-only' : 'client-only')}
            />
            <div className="w-12 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:bg-blue-600 transition-colors relative">
              <div className="absolute top-0.5 left-0.5 h-5 w-5 bg-white rounded-full shadow transform transition-transform peer-checked:translate-x-6" />
            </div>
            <span className="ml-3 text-sm text-gray-600">Server</span>
          </label>
        </div>
      </section>

      <section className="bg-[var(--bg-surface)] border rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Active classes</h2>
            <p className="text-sm text-gray-500">Currently applied classes in the UI. Total: {classes.length}</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search classes..."
              className="px-3 py-2 border rounded-lg text-sm bg-[var(--bg-surface)]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              onClick={refreshClasses}
              className="px-3 py-2 text-sm border rounded-lg"
            >
              Refresh
            </button>
          </div>
        </div>
        <div className="max-h-64 overflow-auto border rounded-md">
          <ul className="divide-y divide-[var(--border)]">
            {filtered.map((c) => (
              <li key={c} className="px-3 py-2 font-mono text-xs text-[var(--text)]">{c}</li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-500">No classes match your search.</li>
            )}
          </ul>
        </div>
        <div className="text-xs text-gray-500">Showing {filtered.length} of {classes.length}</div>
      </section>

      <section className="bg-[var(--bg-surface)] border rounded-lg shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Themed Styler status</h2>
            <p className="text-sm text-gray-500">Runtime injector visibility and registered classes.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              styleManager.requestRender()
              refreshStylerStatus()
            }}
            className="px-3 py-2 text-sm border dark:rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Ensure CSS
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-center justify-between text-base font-medium text-gray-900">
              Style tag
              <span className={stylerStatus.styleTag ? 'text-green-600' : 'text-red-500'}>
                {stylerStatus.styleTag ? 'injected' : 'missing'}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {stylerStatus.selectors} selectors · {stylerStatus.classes} classes registered
            </div>
          </div>
          <div>
            <div className="text-xs font-mono text-[var(--text-code)] bg-[var(--bg-code)] rounded p-2 overflow-auto max-h-40">
              {stylerStatus.cssPreview || 'No CSS generated yet.'}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
