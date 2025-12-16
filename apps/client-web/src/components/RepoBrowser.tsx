import React, {useEffect, useMemo, useState} from 'react'
import {useAppState} from '../state/store'
import {RepoFetchProvider} from '../context/RepoFetchContext'
import HookRenderer from './HookRenderer'
import StyleDebugPanel from './StyleDebugPanel'
import ErrorBoundary from './ErrorBoundary'

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

/**
 * Helper to normalize host URL - ensures proper protocol is added if missing
 */
function normalizeHostUrl(host: string): string {
    if (host.startsWith('http://') || host.startsWith('https://')) {
        return host
    }
    if (host.includes(':')) {
        return `http://${host}` // Has port, assume http
    }
    return `https://${host}` // No port, assume https
}

export function RepoBrowser({tabId}: RepoBrowserProps) {
    const tab = useAppState((s) => s.tabs.find((t) => t.id === tabId))
    const updateTab = useAppState((s) => s.updateTab)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [errorDetails, setErrorDetails] = useState<any>(null)
    const [optionsInfo, setOptionsInfo] = useState<OptionsInfo>({})
    // Hook rendering delegated to HookRenderer component
    // Server version and git pull state
    const [serverHeadCommit, setServerHeadCommit] = useState<string | null>(null)
    const [isPulling, setIsPulling] = useState(false)
    const [pullResult, setPullResult] = useState<any>(null)
    const [showUpdateModal, setShowUpdateModal] = useState(false)
    // Client is now dumb: search and navigation UI are moved into repo layout
    // Keep minimal state only for hook/file rendering

    // Get server version from OPTIONS response (already includes branch commit hash)
    const fetchServerVersion = async (opts: OptionsInfo) => {
        if (!opts?.repos?.[0]?.branches) return
        try {
            const currentBranch = tab?.currentBranch || 'main'
            const commitHash = opts.repos[0].branches[currentBranch]
            if (commitHash) {
                setServerHeadCommit(commitHash.substring(0, 7)) // Short hash
            }
        } catch (e) {
            console.debug('[RepoBrowser] Could not extract commit hash from OPTIONS:', e)
        }
    }

    // Handle git pull from server
    const handleGitPull = async () => {
        if (!tab || !tab.host) return
        setIsPulling(true)
        try {
            const baseUrl = normalizeHostUrl(tab.host)
            const resp = await fetch(`${baseUrl}/git-pull`, {method: 'POST'})
            const result = await resp.json()
            setPullResult(result)

            if (result.updated) {
                setShowUpdateModal(true)
            }
        } catch (e) {
            console.error('[RepoBrowser] Git pull failed:', e)
            setPullResult({
                success: false,
                message: 'Failed to pull from server',
                error: e instanceof Error ? e.message : String(e),
            })
        } finally {
            setIsPulling(false)
        }
    }

    // Refresh page after update
    const handleRefresh = () => {
        window.location.reload()
    }

    useEffect(() => {
        if (!tab || !tab.host) return
            ;
        (async () => {
            try {
                const opts = await loadOptions()
                await loadContent(opts)
                // Extract server version from OPTIONS response
                if (opts) {
                    await fetchServerVersion(opts)
                }
            } catch (e) {
                console.error('[RepoBrowser] init failed:', e)
            }
        })()
    }, [tab?.host, tab?.path])

    const loadOptions = async (): Promise<OptionsInfo | null> => {
        if (!tab || !tab.host) return null
        try {
            const baseUrl = normalizeHostUrl(tab.host)
            const diagnostics: Record<string, any> = {phase: 'options', url: `${baseUrl}/`}

            // Attempt OPTIONS discovery first
            const resp = await fetch(`${baseUrl}/`, {method: 'OPTIONS'})
            diagnostics.options = {
                status: resp.status,
                ok: resp.ok,
                headers: {
                    'content-type': resp.headers.get('content-type'),
                    'content-length': resp.headers.get('content-length'),
                },
            }

            let options: OptionsInfo | null = null
            let parsedFrom: 'OPTIONS' | null = null

            try {
                // Some reverse proxies return 200 with empty body for OPTIONS
                const text = await resp.text()
                diagnostics.optionsBodyLength = text?.length || 0
                if (text && text.trim().length > 0) {
                    options = JSON.parse(text)
                    parsedFrom = 'OPTIONS'
                }
            } catch (parseErr) {
                diagnostics.optionsParseError = parseErr instanceof Error ? parseErr.message : String(parseErr)
            }

            if (!options) {
                const message = `Repository discovery failed: OPTIONS returned ${diagnostics.options?.status} with body length ${diagnostics.optionsBodyLength}. The server must implement OPTIONS / to return capabilities and client hooks.`
                setError(message)
                setErrorDetails(diagnostics)
                console.error('[RepoBrowser] Discovery failed. Diagnostics:', diagnostics)
                return null
            }

            // If OPTIONS returned a valid payload but contains no repositories, surface a clearer error
            if (Array.isArray(options.repos) && options.repos.length === 0) {
                setError('Repository discovery did not return any repos. OPTIONS responded successfully but the repos list is empty. See details for diagnostics.')
                setErrorDetails({phase: 'render', reason: 'no-repos', optionsInfo: options, diagnostics})
                console.error('[RepoBrowser] No repos returned in OPTIONS payload:', {options, diagnostics})
                return null
            }

            setOptionsInfo(options)
            diagnostics.parsedFrom = parsedFrom
            const branches = options.repos?.[0]?.branches ? Object.keys(options.repos[0].branches) : undefined
            updateTab(tab.id, (t) => ({
                ...t,
                branches,
                reposList: options.repos?.map((r) => r.name),
            }))
            if (!options?.client?.hooks?.get?.path) {
                console.error('[RepoBrowser] Discovery missing client hook paths', {options, diagnostics})
            }
            return options
        } catch (err) {
            console.error('Failed to load options:', err)
            setError('Failed to load repository OPTIONS')
            setErrorDetails({phase: 'options', reason: (err as any)?.message || String(err)})
            return null
        }
    }

    const loadContent = async (opts?: OptionsInfo | null) => {
        if (!tab || !tab.host) return

        setLoading(true)
        setError(null)

        try {
            // If we don't have options, abort with a clearer error and diagnostics
            const info = opts || optionsInfo
            if (!info || !info.client) {
                setError('Repository discovery did not return client hooks. OPTIONS may be blocked or empty; attempted GET fallback. See details for diagnostics.')
                setErrorDetails({phase: 'render', reason: 'no-options', optionsInfo})
                return
            }

            // HookRenderer will be rendered by this component; nothing else to do here.
            // loadContent only verifies options and updates auxiliary state
            return
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load content')
            setErrorDetails(err)
        } finally {
            setLoading(false)
        }
    }

    // navigation is handled via helpers passed into hooks; RepoBrowser itself doesn't navigate directly here

    // Client no longer owns search or direct content rendering; repo hook must render everything.



    /**
     * Resolves paths within /template context
     * Handles both relative paths (./foo, ../foo) and absolute paths (/hooks/foo)
     * Returns properly formatted URL without double slashes
     */
    // Module path resolution and hook helpers are provided inside HookRenderer now.



    if (!tab) {
        return <div className="repo-browser">Tab not found</div>
    }

    const repoBaseUrl = useMemo(() => tab?.host ? normalizeHostUrl(tab.host) : '/', [tab?.host])
    const providerResolve = useMemo(() => (p: string) => {
        const path = p.startsWith('/') ? p.slice(1) : p
        return new URL(path, repoBaseUrl).toString()
    }, [repoBaseUrl])
    const providerFetch = useMemo(() => (input: any, init?: RequestInit) => {
        if (typeof input === 'string') {
            const isAbs = /^(https?:)?\/\//i.test(input)
            return fetch(isAbs ? input : providerResolve(input), init)
        }
        if (input instanceof URL) return fetch(input.toString(), init)
        return fetch(input, init)
    }, [providerResolve])

    const providerFetchJson = useMemo(() => async (path: string, init?: RequestInit) => {
        const url = providerResolve(path)
        const resp = await fetch(url, init)
        const ct = (resp.headers.get('content-type') || '').toLowerCase()
        const text = await resp.text()
        const mkErr = (message: string) => {
            const e: any = new Error(message)
            e.name = 'RepoFetchJsonError'
            e.details = {url, status: resp.status, ok: resp.ok, contentType: ct, sample: text.slice(0, 256)}
            return e
        }
        if (!resp.ok) throw mkErr(`HTTP ${resp.status} while fetching JSON: ${url}`)
        if (!ct.includes('application/json')) {
            // Heuristic: many proxies return index.html (text/html)
            if (text.trim().startsWith('<')) {
                throw mkErr('Expected JSON but received HTML (likely SPA fallback)')
            }
        }
        try {
            return JSON.parse(text)
        } catch (err) {
            throw mkErr(`Failed to parse JSON: ${(err as any)?.message || String(err)}`)
        }
    }, [providerResolve])

    return (
        <RepoFetchProvider value={{
            baseUrl: repoBaseUrl,
            resolve: providerResolve,
            fetch: providerFetch,
            fetchJson: providerFetchJson
        }}>
            <div className="flex flex-col h-full">
                <ErrorBoundary>
                    <div className="flex-1 overflow-y-auto">

                    {/* Development-only style debug panel */}
                    {import.meta.env?.DEV && (
                        <div className="p-4">
                            <StyleDebugPanel />
                        </div>
                    )}

                        {loading &&
                            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>}

                        {error && (
                            <div
                                className="p-8 bg-red-500/20 dark:bg-red-900/30 border dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
                                <h3 className="mt-0">Error</h3>
                                <p className="font-semibold">{error}</p>

                                {errorDetails && (
                                    <div className="mt-4 space-y-3 text-sm">
                                        {/* Show hook path and HTTP request info */}
                                        {errorDetails.kind && (
                                            <div className="bg-red-600/10 p-3 rounded border/50">
                                                <div className="font-mono text-xs space-y-1">
                                                    <div><strong>Hook Type:</strong> {errorDetails.kind}</div>
                                                    {errorDetails.hookUrl && (
                                                        <div className="break-all"><strong>GET URL:</strong> <code
                                                            className="bg-black/20 px-1 py-0.5 rounded">{errorDetails.hookUrl}</code>
                                                        </div>
                                                    )}
                                                    {errorDetails.fetch && (
                                                        <>
                                                            <div><strong>HTTP
                                                                Status:</strong> {errorDetails.fetch.status} {errorDetails.fetch.ok ? '✓' : '✗'}
                                                            </div>
                                                            <div>
                                                                <strong>Content-Type:</strong> {errorDetails.fetch.contentType || 'not specified'}
                                                            </div>
                                                        </>
                                                    )}
                                                    {errorDetails.codeLength && (
                                                        <div><strong>Code
                                                            Length:</strong> {errorDetails.codeLength} bytes</div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Show JSX transpilation errors (from transpileCode failure) */}
                                        {(errorDetails.reason === 'transpile-failed' || errorDetails.jsxError) && (
                                            <div className="bg-red-600/10 p-3 rounded border/50 space-y-2">
                                                <div className="font-semibold text-xs">
                                                    {errorDetails.isWasmNotLoaded ? '🔌 WASM Transpiler Not Available' : '❌ JSX Transpilation Failed'}
                                                </div>

                                                {errorDetails.isWasmNotLoaded && (
                                                    <div className="text-xs bg-red-900/20 border/30 rounded p-2 space-y-1">
                                                        <p className="font-semibold">The JSX transpiler (WASM) is not available</p>
                                                        <p>This usually means:</p>
                                                        <ul className="list-disc list-inside ml-2 space-y-1">
                                                            <li>The app didn't fully load when you started browsing</li>
                                                            <li>Your browser blocked WASM module loading</li>
                                                            <li>Network issue prevented transpiler from downloading</li>
                                                        </ul>
                                                        <p className="mt-2"><strong>Fix:</strong> Refresh the page and try again. Check browser console (F12) for errors.</p>
                                                    </div>
                                                )}

                                                {!errorDetails.isWasmNotLoaded && (
                                                    <div className="text-xs bg-red-900/20 border/30 rounded p-2 space-y-1">
                                                        <p className="font-semibold">Invalid JSX syntax detected</p>
                                                        <p>The transpiler encountered syntax it couldn't convert. Check:</p>
                                                        <ul className="list-disc list-inside ml-2 space-y-1">
                                                            <li>All JSX tags are properly closed</li>
                                                            <li>Attributes are correctly formatted</li>
                                                            <li>No special characters in tag names</li>
                                                        </ul>
                                                    </div>
                                                )}

                                                <div className="font-mono text-xs bg-black/20 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                                                    {typeof errorDetails.jsxError === 'string' ? errorDetails.jsxError : (errorDetails.jsxError?.message || JSON.stringify(errorDetails.jsxError, null, 2))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Show execution errors */}
                                        {errorDetails.reason === 'execution-failed' && errorDetails.error && (
                                            <div className={`p-3 rounded border ${errorDetails.isJsxSyntaxError ? 'bg-orange-600/10 border-orange-400/50' : 'bg-red-600/10/50'}`}>
                                                <div className="font-semibold text-xs mb-3">
                                                    {errorDetails.isJsxSyntaxError ? '⚠️ JSX Transpilation Issue' : '❌ Execution Error'}
                                                </div>

                                                {/* For JSX syntax errors, provide detailed help */}
                                                {errorDetails.isJsxSyntaxError && (
                                                    <div className="space-y-2 mb-3">
                                                        <div className="text-xs bg-orange-900/20 border border-orange-400/30 rounded p-2">
                                                            <p className="font-semibold mb-2">What went wrong:</p>
                                                            <p className="mb-2">The code contains JSX syntax (<code>&lt;</code> character), but it wasn't converted to regular JavaScript before execution.</p>
                                                        </div>
                                                        <div className="text-xs bg-blue-900/20 border border-blue-400/30 rounded p-2">
                                                            <p className="font-semibold mb-2">Common causes:</p>
                                                            <ul className="list-disc list-inside space-y-1">
                                                                <li><strong>WASM transpiler failed to load:</strong> Check browser console for WASM errors</li>
                                                                <li><strong>Invalid JSX syntax:</strong> Ensure JSX tags are properly closed (e.g., <code>&lt;div&gt;content&lt;/div&gt;</code>)</li>
                                                                <li><strong>Missing React import:</strong> Add <code>const h = React.createElement</code> or equivalent</li>
                                                                <li><strong>Wrong file type:</strong> Use .jsx or .tsx extension, or add <code>// @use-jsx</code> comment at the top</li>
                                                            </ul>
                                                        </div>
                                                        <div className="text-xs bg-green-900/20 border rounded p-2">
                                                            <p className="font-semibold mb-2">How to fix:</p>
                                                            <ul className="list-disc list-inside space-y-1">
                                                                <li>Verify the hook file has .jsx or .tsx extension</li>
                                                                <li>Check the browser's developer console (F12) for detailed transpiler errors</li>
                                                                <li>Ensure JSX is properly formatted: <code>&lt;ComponentName prop="value"&gt;</code></li>
                                                                <li>For debugging, try uploading a simple JSX file first: <code>&lt;div&gt;Hello&lt;/div&gt;</code></li>
                                                            </ul>
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="font-mono text-xs mb-2">
                                                    <strong>Error Message:</strong> {errorDetails.error}
                                                </div>
                                                {errorDetails.diagnosticMsg && (
                                                    <div className="font-mono text-xs mb-2 bg-black/20 p-2 rounded whitespace-pre-wrap">
                                                        <strong>Diagnostic:</strong>
                                                        <div className="mt-1">
                                                            {errorDetails.diagnosticMsg}
                                                        </div>
                                                    </div>
                                                )}
                                                {errorDetails.transpilerVersion && (
                                                    <div className="font-mono text-xs mb-2 text-blue-100">
                                                        <strong>Hook transpiler:</strong> v{errorDetails.transpilerVersion}
                                                    </div>
                                                )}
                                                {errorDetails.transpilerDiagnostic && (
                                                    <div className="font-mono text-xs bg-black/30 rounded p-2 mb-2 break-words">
                                                        <strong>Transpiler error:</strong>
                                                        <div className="mt-1 text-[11px] whitespace-pre-wrap">
                                                            {errorDetails.transpilerDiagnostic}
                                                        </div>
                                                    </div>
                                                )}
                                                {errorDetails.finalCodeSnippet && (
                                                    <details className="text-xs bg-black/10 border border-black/20 rounded p-2 mb-2">
                                                        <summary className="cursor-pointer">Transpiled preview (first 500 chars)</summary>
                                                        <pre className="overflow-auto max-h-32 text-[11px] mt-1 whitespace-pre-wrap">{errorDetails.finalCodeSnippet}</pre>
                                                    </details>
                                                )}
                                                {errorDetails.transpiledCodeSnippet && (
                                                    <details className="text-xs bg-black/10 border border-black/20 rounded p-2 mb-2">
                                                        <summary className="cursor-pointer">Last transpiler output (window.__lastTranspiledCode)</summary>
                                                        <pre className="overflow-auto max-h-32 text-[11px] mt-1 whitespace-pre-wrap">{errorDetails.transpiledCodeSnippet}</pre>
                                                    </details>
                                                )}
                                                {errorDetails.stack && Array.isArray(errorDetails.stack) && (
                                                    <details className="text-xs">
                                                        <summary className="cursor-pointer hover:underline opacity-70 mb-1">Stack trace</summary>
                                                        <pre
                                                            className="overflow-auto max-h-24 whitespace-pre-wrap opacity-60 bg-black/20 p-2 rounded">
{errorDetails.stack.join('\n')}
                                            </pre>
                                                    </details>
                                                )}
                                            </div>
                                        )}

                                        {/* Repo fetch JSON mismatch diagnostics */}
                                        {errorDetails.fetchJson && (
                                            <div className="bg-yellow-600/10 p-3 rounded border border-yellow-400/50">
                                                <div className="font-semibold text-xs mb-2">Expected JSON but got HTML
                                                    (likely SPA fallback)
                                                </div>
                                                <div className="text-xs space-y-1 font-mono">
                                                    <div><strong>URL:</strong> {errorDetails.fetchJson.url}</div>
                                                    <div>
                                                        <strong>Status:</strong> {String(errorDetails.fetchJson.status)} ({errorDetails.fetchJson.ok ? 'ok' : 'error'})
                                                    </div>
                                                    <div>
                                                        <strong>Content-Type:</strong> {errorDetails.fetchJson.contentType || 'n/a'}
                                                    </div>
                                                    {errorDetails.fetchJson.sample && (
                                                        <details className="mt-2">
                                                            <summary className="cursor-pointer">Response sample
                                                            </summary>
                                                            <pre
                                                                className="mt-1 max-h-40 overflow-auto bg-black/20 p-2 rounded">{errorDetails.fetchJson.sample}</pre>
                                                        </details>
                                                    )}
                                                </div>
                                                <div className="text-xs mt-2 opacity-80">
                                                    Tips: Ensure the file exists in the repository, and that the relay
                                                    server serves it at the path above. If nginx SPA fallback is
                                                    enabled, upstream 404 may be converted into 200 HTML.
                                                </div>
                                            </div>
                                        )}

                                        {/* Show general diagnostics */}
                                        {errorDetails.reason && (
                                            <div className="text-xs opacity-80">
                                                <strong>Phase:</strong> {errorDetails.phase || 'unknown'} | <strong>Reason:</strong> {errorDetails.reason}
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="mt-4 text-sm opacity-80">
                                    <div className="font-semibold mb-2">Troubleshooting:</div>
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>Verify <code>.relay.yaml</code> contains <code>client.hooks.get.path</code> and <code>client.hooks.query.path</code>.
                                        </li>
                                        <li>Ensure the hook module exports a default function: <code>export default
                                            async
                                            function(ctx) {'{'} return ... {'}'} </code></li>
                                        <li>If using JSX, add a top-of-file comment <code>// @use-jsx</code> or
                                            use <code>.jsx</code>/<code>.tsx</code> extension.
                                        </li>
                                        <li>Check browser console (F12) for detailed logs starting
                                            with <code>[Hook]</code> or <code>[RepoBrowser]</code>.
                                        </li>
                                    </ul>
                                </div>

                                {/* Show full JSON for debugging */}
                                <details className="mt-4 text-xs opacity-70">
                                    <summary className="cursor-pointer font-semibold">Full Diagnostics (JSON)</summary>
                                    <pre
                                        className="mt-2 overflow-auto max-h-64 whitespace-pre-wrap bg-black/20 p-2 rounded">
{JSON.stringify(errorDetails, null, 2)}
                            </pre>
                                </details>

                                <button onClick={loadContent}
                                        className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer mt-4 hover:bg-red-700">Try
                                    Again
                                </button>
                            </div>
                        )}

                        {!loading && (
                            tab?.host ? <HookRenderer host={tab.host} /> : null
                        )}
                        {/* No placeholders: if the hook didn't render and there's no error, render nothing */}
                    </div>
                </ErrorBoundary>

                {/* Footer with version and git pull button */}
                <div
                    className="border-t bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center justify-between">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        {serverHeadCommit ? (
                            <span>
                            Version: <code
                                className="bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded text-xs">{serverHeadCommit}</code>
                        </span>
                        ) : (
                            <span>Version: loading...</span>
                        )}
                    </div>
                    <button
                        onClick={handleGitPull}
                        disabled={isPulling}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${
                            isPulling
                                ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                        }`}
                        title={isPulling ? 'Pulling updates...' : 'Pull latest updates from origin'}
                    >
                        {isPulling ? '⟳ Pulling...' : `⟳ Pull${serverHeadCommit ? ` (${serverHeadCommit})` : ''}`}
                    </button>
                </div>

                {/* Update modal */}
                {showUpdateModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
                            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
                                Update Available
                            </h2>
                            {pullResult && (
                                <div className="space-y-3 text-gray-700 dark:text-gray-300">
                                    <p>
                                        <strong>Status:</strong> {pullResult.success ? '✓ Success' : '✗ Failed'}
                                    </p>
                                    <p>
                                        <strong>Message:</strong> {pullResult.message}
                                    </p>
                                    {pullResult.before_commit && (
                                        <p>
                                            <strong>Before:</strong>{' '}
                                            <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                                                {pullResult.before_commit.substring(0, 7)}
                                            </code>
                                        </p>
                                    )}
                                    {pullResult.after_commit && (
                                        <p>
                                            <strong>After:</strong>{' '}
                                            <code className="bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-xs">
                                                {pullResult.after_commit.substring(0, 7)}
                                            </code>
                                        </p>
                                    )}
                                </div>
                            )}
                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setShowUpdateModal(false)}
                                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                                >
                                    Close
                                </button>
                                <button
                                    onClick={handleRefresh}
                                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition font-medium"
                                >
                                    Refresh
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </RepoFetchProvider>
    )
}

/**
 * Build a URL to fetch content from a peer
 * (imported from @relay/shared for consistency with React Native client)
 */
