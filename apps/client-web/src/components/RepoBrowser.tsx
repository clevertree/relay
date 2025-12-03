import { useState, useEffect } from 'react'
import { useAppState } from '../state/store'
import { fetchPeerOptions } from '../services/probing'
import { MarkdownRenderer } from './MarkdownRenderer'

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
  const [optionsInfo, setOptionsInfo] = useState<OptionsInfo>({})
  const [pathInput, setPathInput] = useState(tab?.path ?? '/README.md')

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

    try {
      // Build URL with repo and branch headers
      const url = buildPeerUrl(tab.host, tab.path ?? '/README.md')

      const response = await fetch(url)

      if (!response.ok) {
        if (response.status === 404) {
          setError(`Content not found: ${tab.path}`)
        } else {
          setError(`Failed to load content: ${response.statusText}`)
        }
        setContent(null)
        return
      }

      const text = await response.text()
      setContent(text)
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

  if (!tab) {
    return <div className="repo-browser">Tab not found</div>
  }

  return (
    <div className="repo-browser">
      <div className="repo-header">
        <form className="repo-path-input" onSubmit={handlePathSubmit}>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="Enter path..."
          />
          <button type="submit">Go</button>
        </form>

        <div className="repo-branches">
          {optionsInfo.branches && optionsInfo.branches.length > 0 && (
            <label>
              <span>Branch:</span>
              <select
                value={tab.currentBranch ?? optionsInfo.branches[0] ?? ''}
                onChange={(e) => {
                  updateTab(tab.id, (t) => ({
                    ...t,
                    currentBranch: e.target.value,
                  }))
                }}
              >
                {optionsInfo.branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="repo-content">
        {loading && <div className="loading">Loading...</div>}

        {error && (
          <div className="error">
            <h3>Error</h3>
            <p>{error}</p>
            <button onClick={loadContent}>Try Again</button>
          </div>
        )}

        {content && !loading && (
          <MarkdownRenderer content={content} navigate={handleNavigate} />
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
