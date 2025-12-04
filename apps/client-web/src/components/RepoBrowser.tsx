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

  useEffect(() => {
    if (!tab || !tab.host) return
    setPathInput(tab.path ?? '/README.md')
    loadOptions()
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
      // Try hook first: /template/hooks/get.mjs on the target host
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
        setError('Create UI not available: /template/hooks/put.mjs hook not found in repo')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load create UI')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!queryInput.trim()) return
    setError(null)
    setLoading(true)
    try {
      const used = await tryRenderWithHook('query', { q: queryInput })
      if (!used) {
        setError('Search UI not available: /template/hooks/query.mjs hook not found in repo')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run search')
    } finally {
      setLoading(false)
    }
  }

  const tryRenderWithHook = async (
    kind: 'get' | 'query' | 'put',
    extraParams?: Record<string, unknown>,
  ): Promise<boolean> => {
    if (!tab?.host) return false
    const protocol = tab.host.includes(':') ? 'http' : 'https'
    const hookUrl = `${protocol}://${tab.host}/template/hooks/${kind}.mjs`

    // Probe availability
    const probe = await fetch(hookUrl, { method: 'HEAD' }).catch(() => null)
    if (!probe || !probe.ok) return false

    // Fetch hook source and dynamic import
    const srcResp = await fetch(hookUrl)
    if (!srcResp.ok) return false
    const code = await srcResp.text()
    const blob = new Blob([code], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    try {
      // @ts-ignore webpackIgnore for remote blob
      const mod: any = await import(/* webpackIgnore: true */ blobUrl)
      if (!mod || typeof mod.default !== 'function') return false
      const remoteLayout = await tryLoadRemoteLayout()
      const ctx = buildHookContext(kind, extraParams, remoteLayout ?? undefined)
      const element: React.ReactNode = await mod.default(ctx)
      setHookElement(element)
      setContent(null)
      setContentType(null)
      return true
    } finally {
      URL.revokeObjectURL(blobUrl)
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
    return {
      React,
      createElement: React.createElement,
      FileRenderer,
      Layout: RemoteLayout ?? TemplateLayout,
      params,
      helpers: {
        buildRepoHeaders,
        buildPeerUrl: (p: string) => buildPeerUrl(tab!.host!, p),
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
        // @ts-ignore webpackIgnore
        const mod: any = await import(/* webpackIgnore: true */ blobUrl)
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
    <div className="flex flex-col h-full bg-white">
      <div className="flex flex-col gap-3 p-0 bg-gray-50 border-b border-gray-200 flex-shrink-0">
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
                className="px-2 py-1 border border-gray-300 rounded text-sm bg-white cursor-pointer"
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
          <div className="p-8 bg-red-100/50 border border-red-300/50 rounded-lg text-red-600">
            <h3 className="mt-0">Error</h3>
            <p>{error}</p>
            <button onClick={loadContent} className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer mt-4 hover:bg-red-700">Try Again</button>
          </div>
        )}

        {!loading && hookElement}

        {content && !loading && !hookElement && (
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
