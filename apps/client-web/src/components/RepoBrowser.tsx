import React, { useState, useEffect } from 'react'
import { useAppState } from '../state/store'
import { TemplateLayout } from './TemplateLayout'
import { FileRenderer } from './FileRenderer'

interface RepoBrowserProps {
  tabId: string
}

interface OptionsInfo {
  // Entire OPTIONS payload merged from .relay.yaml + server additions
  client?: {
    hooks?: {
      get?: { path: string }
      query?: { path: string }
    }
  }
  repos?: { name: string; branches: Record<string, string> }[]
  capabilities?: { supports: string[] }
  [key: string]: any
}

export function RepoBrowser({ tabId }: RepoBrowserProps) {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId))
  const updateTab = useAppState((s) => s.updateTab)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorDetails, setErrorDetails] = useState<any>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [optionsInfo, setOptionsInfo] = useState<OptionsInfo>({})
  const [pathInput, setPathInput] = useState(tab?.path ?? '/README.md')
  const [hookElement, setHookElement] = useState<React.ReactNode | null>(null)
  // Client is now dumb: search and navigation UI are moved into repo layout
  // Keep minimal state only for hook/file rendering

  useEffect(() => {
    if (!tab || !tab.host) return
    setPathInput(tab.path ?? '/README.md')
    ;(async () => {
      try {
        const opts = await loadOptions()
        await loadContent(opts)
      } catch (e) {
        console.error('[RepoBrowser] init failed:', e)
      }
    })()
  }, [tab?.host, tab?.path])

  const loadOptions = async (): Promise<OptionsInfo | null> => {
    if (!tab || !tab.host) return null
    try {
      const protocol = tab.host.includes(':') ? 'http' : 'https'
      const resp = await fetch(`${protocol}://${tab.host}/`, { method: 'OPTIONS' })
      if (!resp.ok) throw new Error(`OPTIONS failed: ${resp.status} ${resp.statusText}`)
      const options = (await resp.json()) as OptionsInfo
      setOptionsInfo(options)
      const branches = options.repos?.[0]?.branches ? Object.keys(options.repos[0].branches) : undefined
      updateTab(tab.id, (t) => ({
        ...t,
        branches,
        reposList: options.repos?.map((r) => r.name),
      }))
      if (!options?.client?.hooks?.get?.path || !options?.client?.hooks?.query?.path) {
        console.error('[RepoBrowser] OPTIONS missing client hook paths', options)
      }
      return options
    } catch (err) {
      console.error('Failed to load options:', err)
      setError('Failed to load repository OPTIONS')
      setErrorDetails({ phase: 'options', reason: (err as any)?.message || String(err) })
      return null
    }
  }

  const loadContent = async (opts?: OptionsInfo | null) => {
    if (!tab || !tab.host) return

    setLoading(true)
    setError(null)
    setHookElement(null)

    try {
      // Render strictly via repo-provided hook path from OPTIONS
      const hookUsed = await tryRenderWithHook('get', undefined, opts || optionsInfo)
      if (!hookUsed) {
        setError('Failed to render via repository hook')
        setContent(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content')
      setErrorDetails(err)
      setContent(null)
    } finally {
      setLoading(false)
    }
  }

  const handleNavigate = (path: string) => {
    if (!tab) return
    updateTab(tab.id, (t) => ({
      ...t,
      path,
    }))
    // Update URL in address bar
    const fullPath = `${tab.host}${path}`
    window.history.pushState({ tabId }, '', `/?open=${fullPath}`)
  }

  // Client no longer owns search or direct content rendering; repo hook must render everything.

  const tryRenderWithHook = async (
    kind: 'get' | 'query' | 'put',
    extraParams?: Record<string, unknown>,
    optsOverride?: OptionsInfo | null,
  ): Promise<boolean> => {
    const diagnostics: Record<string, any> = { phase: 'init', kind }
    if (!tab?.host) {
      console.debug(`[Hook ${kind}] No host available`)
      setErrorDetails({ ...diagnostics, reason: 'no-host' })
      return false
    }
    const protocol = tab.host.includes(':') ? 'http' : 'https'
    // Resolve hook path strictly from OPTIONS
    const info = optsOverride ?? optionsInfo
    const getPath = info?.client?.hooks?.get?.path
    const queryPath = info?.client?.hooks?.query?.path
    const hookPath = kind === 'get' ? getPath : kind === 'query' ? queryPath : undefined
    if (!hookPath) {
      console.debug(`[Hook ${kind}] Missing hook path in OPTIONS, attempting one-time refresh`)
      const refreshed = await loadOptions()
      const retryInfo = refreshed ?? optionsInfo
      const retryPath = kind === 'get' ? retryInfo?.client?.hooks?.get?.path : kind === 'query' ? retryInfo?.client?.hooks?.query?.path : undefined
      if (!retryPath) {
        setError(
          'Missing hook path in OPTIONS. Ensure .relay.yaml has client.hooks.get.path and client.hooks.query.path.'
        )
        setErrorDetails({ ...diagnostics, reason: 'missing-hook-path', options: retryInfo || {} })
        console.error('[RepoBrowser] Hook path missing after refresh. OPTIONS payload:', retryInfo)
        return false
      }
      return tryRenderWithHook(kind, extraParams, retryInfo)
    }
    const hookUrl = `${protocol}://${tab.host}${hookPath}`
    console.debug(`[Hook ${kind}] Loading: ${hookUrl}`)

    // Fetch hook source and dynamic import
    try {
      console.debug(`[Hook ${kind}] Fetching source: ${hookUrl}`)
      const srcResp = await fetch(hookUrl)
      diagnostics.fetch = {
        status: srcResp.status,
        ok: srcResp.ok,
        contentType: srcResp.headers.get('content-type'),
      }
      
      console.debug(`[Hook ${kind}] Fetch response:`, diagnostics.fetch)
      
      if (!srcResp.ok) {
        console.debug(`[Hook ${kind}] Fetch failed with status ${srcResp.status}`)
        setError(
          `Failed to fetch hook source (${srcResp.status} ${srcResp.statusText}). Verify client.hooks.${kind}.path points to a valid module and that the server serves it.`
        )
        setErrorDetails({ ...diagnostics, reason: 'fetch-failed', status: srcResp.status, statusText: srcResp.statusText })
        console.error('[RepoBrowser] Failed to fetch hook source:', hookUrl, srcResp.status, srcResp.statusText)
        return false
      }
      
      const code = await srcResp.text()
      diagnostics.codeLength = code.length
      console.debug(`[Hook ${kind}] Received code (${code.length} chars)`) 

      // Optionally pre-process JSX/TSX if present/opted-in
      let finalCode = code
      let usedJsx = false
      try {
        const looksLikeJsxOrTsx = /\/\s*@use-jsx|\/\s*@use-ts|<([A-Za-z][A-Za-z0-9]*)\s|jsxRuntime\s*:\s*['\"]automatic['\"]/m.test(code)
          || hookPath.endsWith('.jsx') || hookPath.endsWith('.tsx') || hookPath.endsWith('.ts')
        if (looksLikeJsxOrTsx) {
          console.debug(`[Hook ${kind}] JSX/TSX detected, transforming with @babel/standalone`)
          const Babel: any = await import(/* @vite-ignore */ '@babel/standalone')
          const presets: any[] = []
          // Choose React runtime: if file explicitly opts into pragma with @jsx h, transpile with classic runtime to avoid injecting jsx-runtime imports
          const hasJsxPragma = /@jsx\s+h/m.test(code)
          // TypeScript first so JSX remains for React preset to handle
          if (Babel.presets.typescript) {
            const tsOpts = hasJsxPragma ? { jsxPragma: 'h', jsxPragmaFrag: 'React.Fragment' } : {}
            presets.push([Babel.presets.typescript, tsOpts])
          }
          presets.push([Babel.presets.react, hasJsxPragma ? { runtime: 'classic', pragma: 'h', pragmaFrag: 'React.Fragment', development: true } : { runtime: 'automatic', development: true }])
          const result = Babel.transform(code, {
            filename: hookPath.split('/').pop() || 'hook.tsx',
            presets,
            sourceMaps: 'inline',
            retainLines: true,
            // Keep modules as ESM for dynamic import
            plugins: [],
          })
          finalCode = result.code
          usedJsx = true
        }
      } catch (jsxErr) {
        console.warn(`[Hook ${kind}] JSX transform failed, will attempt raw import`, jsxErr)
        diagnostics.jsxError = jsxErr instanceof Error ? jsxErr.message : String(jsxErr)
      }

      const blob = new Blob([finalCode], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      console.debug(`[Hook ${kind}] Created blob URL: ${blobUrl}`)
      
      try {
        // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
        console.debug(`[Hook ${kind}] Attempting dynamic import...`, usedJsx ? '(transformed from JSX)' : '')
        const mod: any = await import(/* @vite-ignore */ blobUrl)
        console.debug(`[Hook ${kind}] Import successful, module:`, mod)
        
        if (!mod || typeof mod.default !== 'function') {
          console.debug(`[Hook ${kind}] Module missing or default is not a function:`, { has: !!mod, typeOfDefault: typeof mod?.default })
          setError('Hook module does not export a default function. Export default async function(ctx) { ... }')
          setErrorDetails({ ...diagnostics, reason: 'bad-export' })
          console.error('[RepoBrowser] Hook module bad export (expected default function):', hookUrl)
          return false
        }
        
        const ctx = buildHookContext(kind, extraParams, undefined)
        const element: React.ReactNode = await mod.default(ctx)
        console.debug(`[Hook ${kind}] Hook executed successfully`)
        setHookElement(element)
        setContent(null)
        setContentType(null)
        return true
      } catch (err) {
        console.debug(`[Hook ${kind}] Execution failed:`, err instanceof Error ? err.message : err)
        console.error(`[Hook ${kind}] Full error:`, err)
        setError(
          `Hook execution failed: ${(err as any)?.message || err}. If using JSX, add '// @use-jsx' comment at the top or use .jsx extension so the loader transpiles it.`
        )
        setErrorDetails({ ...diagnostics, reason: 'execution-failed' })
        return false
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    } catch (fetchErr) {
      console.debug(`[Hook ${kind}] Fetch error:`, fetchErr instanceof Error ? fetchErr.message : fetchErr)
      setError(`Network error while fetching hook: ${(fetchErr as any)?.message || fetchErr}`)
      setErrorDetails({ ...diagnostics, reason: 'network-error' })
      console.error('[RepoBrowser] Network error while fetching hook:', fetchErr)
      return false
    }
  }

  const buildHookContext = (
    kind: 'get' | 'query' | 'put',
    extraParams?: Record<string, unknown>,
    RemoteLayout?: React.ComponentType<any>,
  ) => {
    const params = {
      socket: tab?.host,
      path: tab?.path ?? '/README.md',
      branch: tab?.currentBranch,
      repo: tab?.repo,
      kind,
      ...extraParams,
    }
    
    /**
     * Load a module from the same repo/host
     * @param modulePath - Relative path like './lib/utils.mjs' or absolute like '/hooks/lib/utils.mjs'
     * @returns Promise that resolves to the module's exports
     */
    const loadModule = async (modulePath: string): Promise<any> => {
      if (!tab?.host) {
        throw new Error('[loadModule] No host available')
      }
      
      // Normalize path - handle both relative and absolute
      let normalizedPath = modulePath
      if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
        // Relative to current hook path
        const currentDir = (tab.path ?? '/hooks/get-client.tsx').split('/').slice(0, -1).join('/')
        normalizedPath = `${currentDir}/${modulePath}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
      } else if (!modulePath.startsWith('/')) {
        // Assume it's relative to /hooks/
        normalizedPath = `/hooks/${modulePath}`
      }
      
      const protocol = tab.host.includes(':') ? 'http' : 'https'
      const moduleUrl = `${protocol}://${tab.host}${normalizedPath}`
      console.debug('[loadModule] Loading:', { modulePath, normalizedPath, moduleUrl })
      
      try {
        const response = await fetch(moduleUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch module: ${response.status} ${response.statusText}`)
        }
        
        const code = await response.text()
        // Transform TS/TSX/JSX if needed
        let finalCode = code
        const looksLikeTsOrJsx = /\/\s*@use-jsx|\/\s*@use-ts|<([A-Za-z][A-Za-z0-9]*)\s|jsxRuntime\s*:\s*['\"]automatic['\"]/m.test(code)
          || normalizedPath.endsWith('.tsx') || normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.jsx')
        if (looksLikeTsOrJsx) {
          try {
            const Babel: any = await import(/* @vite-ignore */ '@babel/standalone')
            const presets: any[] = []
            const hasJsxPragma = /@jsx\s+h/m.test(code)
            if (Babel.presets.typescript) {
              const tsOpts = hasJsxPragma ? { jsxPragma: 'h', jsxPragmaFrag: 'React.Fragment' } : {}
              presets.push([Babel.presets.typescript, tsOpts])
            }
            presets.push([Babel.presets.react, hasJsxPragma ? { runtime: 'classic', pragma: 'h', pragmaFrag: 'React.Fragment', development: true } : { runtime: 'automatic', development: true }])
            const result = Babel.transform(code, {
              filename: normalizedPath.split('/').pop() || 'module.tsx',
              presets,
              sourceMaps: 'inline',
              retainLines: true,
            })
            finalCode = result.code
          } catch (e) {
            console.warn('[loadModule] Babel transform failed, trying raw import', e)
          }
        }

        const blob = new Blob([finalCode], { type: 'text/javascript' })
        const blobUrl = URL.createObjectURL(blob)
        
        try {
          // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
          const mod: any = await import(/* @vite-ignore */ blobUrl)
          console.debug('[loadModule] Successfully loaded:', modulePath)
          return mod
        } finally {
          URL.revokeObjectURL(blobUrl)
        }
      } catch (err) {
        console.error('[loadModule] Failed to load module:', modulePath, err)
        throw err
      }
    }
    
    return {
      React,
      createElement: React.createElement,
      FileRenderer,
      Layout: RemoteLayout ?? TemplateLayout,
      params,
      helpers: {
        buildRepoHeaders,
        buildPeerUrl: (p: string) => buildPeerUrl(tab!.host!, p),
        navigate: handleNavigate,
        setBranch: (br: string) => updateTab(tab!.id, (t) => ({ ...t, currentBranch: br })),
        loadModule,
      },
    }
  }

  if (!tab) {
    return <div className="repo-browser">Tab not found</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-8">
        {loading && <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>}

        {error && (
          <div className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
            <h3 className="mt-0">Error</h3>
            <p>{error}</p>
            {errorDetails && (
              <pre className="text-xs mt-3 overflow-auto max-h-64 whitespace-pre-wrap opacity-80">
{JSON.stringify(errorDetails, null, 2)}
              </pre>
            )}
            <div className="mt-4 text-sm opacity-80">
              <ul className="list-disc pl-5 space-y-1">
                <li>Verify <code>.relay.yaml</code> contains <code>client.hooks.get.path</code> and <code>client.hooks.query.path</code>.</li>
                <li>Ensure the hook module exports a default function: <code>export default async function(ctx) {'{'} return ... {'}'} </code></li>
                <li>If using JSX, add a top-of-file comment <code>// @use-jsx</code> or use <code>.jsx</code>/<code>.tsx</code> extension.</li>
              </ul>
            </div>
            <button onClick={loadContent} className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer mt-4 hover:bg-red-700">Try Again</button>
          </div>
        )}

        {!loading && hookElement}
      </div>
    </div>
  )
}

/**
 * Build a URL to fetch content from a peer
 */
function buildPeerUrl(host: string, path: string): string {
  // Prefer HTTPS, fallback to HTTP
  const protocol = host.includes(':') ? 'http' : 'https'
  
  let url = `${protocol}://${host}${path}`
  
  // If path doesn't have extension, assume markdown
  if (!path.includes('.') || path.endsWith('/')) {
    if (!path.endsWith('/')) url += '/'
    url += 'index.md'
  }

  return url
}

function buildRepoHeaders(branch?: string, repo?: string): HeadersInit {
  const headers: Record<string, string> = {}
  if (branch) headers['x-relay-branch'] = branch
  if (repo) headers['x-relay-repo'] = repo
  return headers
}
