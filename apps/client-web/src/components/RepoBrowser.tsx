import React, { useState, useEffect } from 'react'
import { useAppState } from '../state/store'
import { fetchPeerOptions } from '../services/probing'
import { MarkdownRenderer } from './MarkdownRenderer'
import { FileRenderer } from './FileRenderer'
import { TemplateLayout } from './TemplateLayout'

interface RepoBrowserProps {
  tabId: string
}

interface OptionsInfo {
  branches?: string[]
  repos?: string[]
  branchHeads?: Record<string, string>
}

export function RepoBrowser({ tabId }: RepoBrowserProps) {
  const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId))
  const updateTab = useAppState((s) => s.updateTab)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [optionsInfo, setOptionsInfo] = useState<OptionsInfo>({})
  const [pathInput, setPathInput] = useState(tab?.path ?? '/README.md')
  const [hookElement, setHookElement] = useState<React.ReactNode | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, any>[] | null>(null)
  const [searchTotal, setSearchTotal] = useState(0)
  const [previousPage, setPreviousPage] = useState<{ path: string; content: string | null; contentType: string | null } | null>(null)

  useEffect(() => {
    if (!tab || !tab.host) return
    setPathInput(tab.path ?? '/README.md')
    loadOptions()
    
    // Parse query from path if it's a search path (/search/[query])
    const path = tab.path ?? ''
    const searchMatch = path.match(/^\/search\/(.+)$/)
    if (searchMatch) {
      const searchQuery = decodeURIComponent(searchMatch[1])
      console.debug('[RepoBrowser] Search path detected:', searchQuery)
      setQueryInput(searchQuery)
    } else {
      // Clear search state when navigating away from search
      setSearchResults(null)
    }
    
    loadContent()
  }, [tab?.host, tab?.path])

  const loadOptions = async () => {
    if (!tab || !tab.host) return
    try {
      const options = await fetchPeerOptions(tab.host)
      setOptionsInfo(options)
      updateTab(tab.id, (t) => ({
        ...t,
        branches: options.branches,
        reposList: options.repos,
      }))
    } catch (err) {
      console.error('Failed to load options:', err)
    }
  }

  const loadContent = async () => {
    if (!tab || !tab.host) return

    setLoading(true)
    setError(null)
    setHookElement(null)

    try {
      // Try hook first: /hooks/router.mjs on the target host
      const hookUsed = await tryRenderWithHook('get')
      if (!hookUsed) {
        // Fallback: direct fetch
        const url = buildPeerUrl(tab.host, tab.path ?? '/README.md')
        const response = await fetch(url, {
          headers: buildRepoHeaders(tab.currentBranch, tab.repo),
        })
        if (!response.ok) {
          if (response.status === 404) {
            setError(`Content not found: ${tab.path}`)
          } else {
            setError(`Failed to load content: ${response.statusText}`)
          }
          setContent(null)
          return
        }
        const ct = response.headers.get('content-type')
        setContentType(ct)
        const text = await response.text()
        setContent(text)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load content')
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

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let normalizedPath = pathInput
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath
    }
    handleNavigate(normalizedPath)
  }

  const handleCreate = async () => {
    setError(null)
    setLoading(true)
    try {
      const used = await tryRenderWithHook('put')
      if (!used) {
        setError('Create UI not available: /hooks/put.mjs hook not found in repo')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load create UI')
    } finally {
      setLoading(false)
    }
  }

  const performSearch = async (query: string) => {
    if (!query.trim()) return
    
    console.debug(`[Search] Starting search for: "${query}"`)
    console.debug(`[Search] Current tab:`, { host: tab?.host, path: tab?.path, branch: tab?.currentBranch })
    
    // Save current page state for back button
    if (!previousPage && tab?.path && !tab.path.startsWith('/search') && !tab.path.startsWith('/view')) {
      setPreviousPage({ path: tab.path, content, contentType })
    }
    
    // Navigate to /search/[query] path - router.mjs handles the rest
    handleNavigate(`/search/${encodeURIComponent(query)}`)
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!queryInput.trim()) return
    await performSearch(queryInput)
  }

  const tryRenderWithHook = async (
    kind: 'get' | 'query' | 'put',
    extraParams?: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!tab?.host) {
      console.debug(`[Hook ${kind}] No host available`)
      return false
    }
    
    const protocol = tab.host.includes(':') ? 'http' : 'https'
    // Router handles both get and search routes
    const hookName = kind === 'get' ? 'router' : kind === 'query' ? 'query-client' : kind
    const hookUrl = `${protocol}://${tab.host}/hooks/${hookName}.mjs`
    console.debug(`[Hook ${kind}] Probing: ${hookUrl}`)

    // Probe availability with detailed logging
    try {
      const probe = await fetch(hookUrl, { method: 'HEAD' })
      console.debug(`[Hook ${kind}] Probe response:`, { 
        status: probe.status, 
        ok: probe.ok,
        contentType: probe.headers.get('content-type')
      })
      
      if (!probe.ok) {
        console.debug(`[Hook ${kind}] Probe failed with status ${probe.status}`)
        return false
      }
    } catch (probeErr) {
      console.debug(`[Hook ${kind}] Probe error:`, probeErr instanceof Error ? probeErr.message : probeErr)
      return false
    }

    // Fetch hook source and dynamic import
    try {
      console.debug(`[Hook ${kind}] Fetching source: ${hookUrl}`)
      const srcResp = await fetch(hookUrl)
      
      console.debug(`[Hook ${kind}] Fetch response:`, { 
        status: srcResp.status, 
        ok: srcResp.ok,
        contentType: srcResp.headers.get('content-type')
      })
      
      if (!srcResp.ok) {
        console.debug(`[Hook ${kind}] Fetch failed with status ${srcResp.status}`)
        return false
      }
      
      const code = await srcResp.text()
      console.debug(`[Hook ${kind}] Received code (${code.length} chars)`)
      
      const blob = new Blob([code], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      console.debug(`[Hook ${kind}] Created blob URL: ${blobUrl}`)
      
      try {
        // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
        console.debug(`[Hook ${kind}] Attempting dynamic import...`)
        const mod: any = await import(/* @vite-ignore */ blobUrl)
        console.debug(`[Hook ${kind}] Import successful, module:`, mod)
        
        if (!mod || typeof mod.default !== 'function') {
          console.debug(`[Hook ${kind}] Module missing or default is not a function:`, { has: !!mod, typeOfDefault: typeof mod?.default })
          return false
        }
        
        // Handle query hook specially - capture results and render table
        if (kind === 'query') {
          console.debug(`[Hook ${kind}] Processing query results...`)
          const remoteLayout = await tryLoadRemoteLayout()
          const ctx = buildHookContext(kind, extraParams, remoteLayout ?? undefined)
          const queryResponse = await mod.default(ctx)
          console.debug(`[Hook ${kind}] Query response:`, queryResponse)
          
          // If response contains items/results, render as table
          if (queryResponse && typeof queryResponse === 'object') {
            const items = queryResponse.items || queryResponse.results || []
            const total = queryResponse.total || 0
            console.debug(`[Hook ${kind}] Setting search results: ${items.length} items, total ${total}`)
            setSearchResults(items)
            setSearchTotal(total)
            setContent(null)
            setContentType(null)
            setHookElement(null)
            return true
          }
          
          console.debug(`[Hook ${kind}] Setting hook element`)
          setHookElement(queryResponse)
          setSearchResults(null)
          setContent(null)
          setContentType(null)
          return true
        }
        
        // Handle get hook with search-ui type response
        if (kind === 'get') {
          const remoteLayout = await tryLoadRemoteLayout()
          const ctx = buildHookContext(kind, extraParams, remoteLayout ?? undefined)
          const response = await mod.default(ctx)
          console.debug(`[Hook ${kind}] Response:`, response)
          
          // Check if response is a search-ui type (from get-client.mjs /search route)
          if (response && typeof response === 'object' && response.type === 'search-ui') {
            const items = response.items || []
            const total = response.total || 0
            console.debug(`[Hook ${kind}] Search UI response: ${items.length} items, total ${total}`)
            setSearchResults(items)
            setSearchTotal(total)
            setContent(null)
            setContentType(null)
            setHookElement(null)
            if (response.error) {
              setError(response.error)
            }
            return true
          }
          
          // Regular React element response
          if (response) {
            setHookElement(response)
            setSearchResults(null)
            setContent(null)
            setContentType(null)
            return true
          }
          return false
        }
        
        const remoteLayout = await tryLoadRemoteLayout()
        const ctx = buildHookContext(kind, extraParams, remoteLayout ?? undefined)
        const element: React.ReactNode = await mod.default(ctx)
        console.debug(`[Hook ${kind}] Hook executed successfully`)
        setHookElement(element)
        setSearchResults(null)
        setContent(null)
        setContentType(null)
        return true
      } catch (err) {
        // Hook failed to load or execute - fall back to direct fetch
        console.debug(`[Hook ${kind}] Execution failed:`, err instanceof Error ? err.message : err)
        console.error(`[Hook ${kind}] Full error:`, err)
        return false
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    } catch (fetchErr) {
      console.debug(`[Hook ${kind}] Fetch error:`, fetchErr instanceof Error ? fetchErr.message : fetchErr)
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
        const currentDir = (tab.path ?? '/hooks/router.mjs').split('/').slice(0, -1).join('/')
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
        const blob = new Blob([code], { type: 'text/javascript' })
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
        loadModule,
      },
    }
  }

  const tryLoadRemoteLayout = async (): Promise<React.ComponentType<any> | null> => {
    if (!tab?.host) return null
    const protocol = tab.host.includes(':') ? 'http' : 'https'
    const candidates = [
      `${protocol}://${tab.host}/template/ui/layout.mjs`,
      `${protocol}://${tab.host}/template/ui/layout.js`,
    ]
    for (const url of candidates) {
      const headOk = await fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false)
      if (!headOk) continue
      const resp = await fetch(url)
      if (!resp.ok) continue
      const code = await resp.text()
      const blob = new Blob([code], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      try {
        // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
        const mod: any = await import(/* @vite-ignore */ blobUrl)
        const LayoutComp = mod.default || mod.Layout || null
        if (LayoutComp) return LayoutComp as React.ComponentType<any>
      } catch {
        // ignore and try next
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    }
    return null
  }

  if (!tab) {
    return <div className="repo-browser">Tab not found</div>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col gap-3 p-0 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
        <form className="flex gap-2 p-2" onSubmit={handlePathSubmit}>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="Enter path..."
            className="flex-1 px-2 py-2 border border-gray-300 rounded font-mono text-sm"
          />
          <button type="submit" className="px-4 py-2 bg-blue-500 text-white border-none rounded cursor-pointer text-sm font-medium hover:bg-blue-600">Go</button>
          <button type="button" onClick={handleCreate} className="px-4 py-2 bg-emerald-600 text-white border-none rounded cursor-pointer text-sm font-medium hover:bg-emerald-700">Create</button>
        </form>

        <div className="flex gap-4 p-2">
          {optionsInfo.branches && optionsInfo.branches.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span>Branch:</span>
              <select
                value={tab.currentBranch ?? optionsInfo.branches[0] ?? ''}
                onChange={(e) => {
                  updateTab(tab.id, (t) => ({
                    ...t,
                    currentBranch: e.target.value,
                  }))
                }}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 dark:text-white cursor-pointer"
              >
                {optionsInfo.branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form className="flex items-center gap-2 ml-auto" onSubmit={handleSearch}>
            <input
              type="search"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search..."
              className="px-2 py-1 border border-gray-300 rounded text-sm"
            />
            <button type="submit" className="px-3 py-1 bg-gray-700 text-white rounded text-sm hover:bg-black">Search</button>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {loading && <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>}

        {error && (
          <div className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
            <h3 className="mt-0">Error</h3>
            <p>{error}</p>
            <button onClick={loadContent} className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer mt-4 hover:bg-red-700">Try Again</button>
          </div>
        )}

        {searchResults && searchResults.length > 0 && (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSearchResults(null)
                setContent(null)
                setContentType(null)
                setQueryInput('')
                handleNavigate(previousPage?.path ?? '/')
              }}
              className="px-4 py-2 bg-gray-600 text-white rounded text-sm font-medium hover:bg-gray-700"
            >
              ← Back
            </button>
            <div className="space-y-3">
              <h2 className="text-xl font-bold">Search Results ({searchTotal} total)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {searchResults.map((result, idx) => {
                  const source = result.source || 'tmdb'
                  const itemId = result.id
                  const viewPath = `/view/${source}/${itemId}`
                  
                  return (
                    <div
                      key={result.id || idx}
                      className="p-4 border border-gray-300 dark:border-gray-600 rounded-lg hover:shadow-md transition-shadow"
                    >
                      {result.poster_url ? (
                        <button
                          onClick={() => handleNavigate(viewPath)}
                          className="w-full border-0 bg-transparent p-0 cursor-pointer"
                        >
                          <img
                            src={result.poster_url}
                            alt={result.title || `Item ${idx + 1}`}
                            className="rounded mb-3 w-full h-48 object-cover hover:opacity-90 transition-opacity"
                          />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleNavigate(viewPath)}
                          className="w-full border-0 p-0 cursor-pointer"
                        >
                          <div className="bg-gray-200 dark:bg-gray-700 rounded mb-3 w-full h-48 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                            <span className="text-sm">{result.title || `Item ${idx + 1}`}</span>
                          </div>
                        </button>
                      )}
                      <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                        {result.title && (
                          <h3 className="font-semibold text-base text-gray-900 dark:text-white">{result.title}</h3>
                        )}
                        {result.release_date && (
                          <p className="text-gray-600 dark:text-gray-400">📅 {result.release_date}</p>
                        )}
                        {result.vote_average && (
                          <p className="text-gray-600 dark:text-gray-400">⭐ {Number(result.vote_average).toFixed(1)}/10</p>
                        )}
                        {result.genre_names && result.genre_names.length > 0 && (
                          <p className="text-gray-600 dark:text-gray-400">🎬 {result.genre_names.join(', ')}</p>
                        )}
                        {result.overview && (
                          <p className="text-gray-600 dark:text-gray-400 line-clamp-2">{result.overview}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleNavigate(viewPath)}
                        className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        View Details
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {searchResults && searchResults.length === 0 && (
          <div className="space-y-4">
            <button
              onClick={() => {
                setSearchResults(null)
                setContent(null)
                setContentType(null)
                setQueryInput('')
                handleNavigate(previousPage?.path ?? '/')
              }}
              className="px-4 py-2 bg-gray-600 text-white rounded text-sm font-medium hover:bg-gray-700"
            >
              ← Back
            </button>
            <div className="p-8 bg-gray-100 dark:bg-gray-800 rounded-lg text-center text-gray-600 dark:text-gray-400">
              <p>No results found for "{queryInput}"</p>
              <p className="text-sm mt-2">Try a different search term</p>
            </div>
          </div>
        )}

        {!loading && !searchResults && hookElement}

        {content && !loading && !hookElement && !searchResults && (
          contentType && contentType.includes('markdown') ? (
            <MarkdownRenderer content={content} navigate={handleNavigate} />
          ) : (
            <FileRenderer content={content} contentType={contentType ?? 'text/plain'} />
          )
        )}
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
