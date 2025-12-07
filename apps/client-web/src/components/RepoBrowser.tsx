import React, {useEffect, useState} from 'react'
import {useAppState} from '../state/store'
import {TemplateLayout} from './TemplateLayout'
import {FileRenderer} from './FileRenderer'

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
    const [hookElement, setHookElement] = useState<React.ReactNode | null>(null)
    // Client is now dumb: search and navigation UI are moved into repo layout
    // Keep minimal state only for hook/file rendering

    useEffect(() => {
        if (!tab || !tab.host) return
            ;
        (async () => {
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

            setOptionsInfo(options)
            diagnostics.parsedFrom = parsedFrom
            const branches = options.repos?.[0]?.branches ? Object.keys(options.repos[0].branches) : undefined
            updateTab(tab.id, (t) => ({
                ...t,
                branches,
                reposList: options.repos?.map((r) => r.name),
            }))
            if (!options?.client?.hooks?.get?.path || !options?.client?.hooks?.query?.path) {
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
        setHookElement(null)

        try {
            // If we don't have options, abort with a clearer error and diagnostics
            const info = opts || optionsInfo
            if (!info || !info.client) {
                setError('Repository discovery did not return client hooks. OPTIONS may be blocked or empty; attempted GET fallback. See details for diagnostics.')
                setErrorDetails({phase: 'render', reason: 'no-options', optionsInfo})
                return
            }

            // Render strictly via repo-provided hook path from discovery
            const hookUsed = await tryRenderWithHook('get', undefined, info)
            if (!hookUsed) {
                setError('Failed to render via repository hook')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load content')
            setErrorDetails(err)
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
        // const fullPath = `${tab.host}${path}`
        window.history.pushState({tabId}, ''); // , `/?open=${fullPath}`)
    }

    // Client no longer owns search or direct content rendering; repo hook must render everything.

    const tryRenderWithHook = async (
        kind: 'get' | 'query' | 'put',
        extraParams?: Record<string, unknown>,
        optsOverride?: OptionsInfo | null,
    ): Promise<boolean> => {
        const diagnostics: Record<string, any> = {phase: 'init', kind}
        if (!tab?.host) {
            console.debug(`[Hook ${kind}] No host available`)
            setErrorDetails({...diagnostics, reason: 'no-host'})
            return false
        }
        const baseUrl = normalizeHostUrl(tab.host)
        // Resolve hook path strictly from OPTIONS
        const info = optsOverride ?? optionsInfo
        const getPath = info?.client?.hooks?.get?.path
        const queryPath = info?.client?.hooks?.query?.path
        const hookPath = kind === 'get' ? getPath : kind === 'query' ? queryPath : undefined
        if (!hookPath) {
            console.debug(`[Hook ${kind}] Missing hook path in discovery, attempting one-time refresh`)
            const refreshed = await loadOptions()
            const retryInfo = refreshed ?? optionsInfo
            const retryPath = kind === 'get' ? retryInfo?.client?.hooks?.get?.path : kind === 'query' ? retryInfo?.client?.hooks?.query?.path : undefined
            if (!retryPath) {
                setError(
                    'Missing hook path in repository discovery. OPTIONS may be empty or blocked by proxy. We also attempted GET / fallback. Ensure .relay.yaml exposes client.hooks.get.path and client.hooks.query.path.'
                )
                setErrorDetails({
                    ...diagnostics,
                    reason: 'missing-hook-path',
                    note: 'OPTIONS returned empty or missing body; GET fallback may have succeeded or failed. See optionsInfo for raw payload.',
                    options: retryInfo || {},
                })
                console.error('[RepoBrowser] Hook path missing after refresh. Discovery payload:', retryInfo)
                return false
            }
            return tryRenderWithHook(kind, extraParams, retryInfo)
        }
        const hookUrl = `${baseUrl}${hookPath}`
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
                setErrorDetails({
                    ...diagnostics,
                    reason: 'fetch-failed',
                    status: srcResp.status,
                    statusText: srcResp.statusText
                })
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
                    // @ts-ignore - @babel/standalone doesn't have type definitions
                    const BabelNs: any = await import(/* @vite-ignore */ '@babel/standalone')
                    const Babel: any = (BabelNs && (BabelNs as any).default) ? (BabelNs as any).default : BabelNs

                    const presets: any[] = []
                    // TypeScript first so JSX remains for React preset to handle
                    const TS_PRESET = Babel.availablePresets?.typescript || Babel.presets?.typescript || 'typescript'
                    const REACT_PRESET = Babel.availablePresets?.react || Babel.presets?.react || 'react'
                    if (TS_PRESET) {
                        presets.push([TS_PRESET])
                    }
                    // Use classic runtime with _jsx_ helper - we'll inject it at the top
                    presets.push([REACT_PRESET, {
                        runtime: 'classic',
                        pragma: '_jsx_',
                        pragmaFrag: '_jsxFrag_',
                        development: true
                    }])
                    const result = Babel.transform(code, {
                        filename: hookPath.split('/').pop() || 'hook.tsx',
                        presets,
                        sourceMaps: 'inline',
                        retainLines: true,
                        plugins: [],
                    })
                    // Inject helpers that reference window.__ctx__
                    // Use globalThis for better compatibility with blob modules
                    const preamble = `
const __ctx_obj__ = (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {});
const React = __ctx_obj__.__ctx__ && __ctx_obj__.__ctx__.React;
if (!React) {
  const errorMsg = 'React not available in preamble. __ctx_obj__=' + (typeof __ctx_obj__) + ', __ctx_obj__.__ctx__=' + (typeof __ctx_obj__.__ctx__) + ', React=' + (typeof React);
  console.error(errorMsg);
  throw new Error(errorMsg);
}
const _jsx_ = (...args) => __ctx_obj__.__ctx__.React.createElement(...args);
const _jsxFrag_ = __ctx_obj__.__ctx__.React.Fragment;
`
                    finalCode = preamble + result.code
                    usedJsx = true
                    console.debug(`[Hook ${kind}] Preamble:`, preamble)
                    console.debug(`[Hook ${kind}] First 1000 chars of final code:\n${finalCode.substring(0, 1000)}`)
                }
            } catch (jsxErr) {
                console.warn(`[Hook ${kind}] JSX transform failed, will attempt raw import`, jsxErr)
                diagnostics.jsxError = jsxErr instanceof Error ? jsxErr.message : String(jsxErr)
            }

            const blob = new Blob([finalCode], {type: 'text/javascript'})
            const blobUrl = URL.createObjectURL(blob)
            console.debug(`[Hook ${kind}] Created blob URL: ${blobUrl}`)

            try {
                // Build context first so we can inject it as global for JSX transpiled code
                const ctx = buildHookContext(kind, extraParams, undefined, hookPath)

                console.debug(`[Hook ${kind}] Context ready, React type:`, typeof ctx.React)
                if (!ctx.React) {
                    throw new Error(`[Hook ${kind}] buildHookContext returned falsy React: ${ctx.React}`)
                }
                console.debug(`[Hook ${kind}] Setting window.__ctx__:`, {hasReact: !!ctx.React, keys: Object.keys(ctx)})

                // Inject __ctx__ as a global for JSX transpilation (React.createElement calls)
                ;(window as any).__ctx__ = ctx

                // Verify immediately after setting
                const verifyCtx = (window as any).__ctx__
                if (!verifyCtx || !verifyCtx.React) {
                    throw new Error(`[Hook ${kind}] Failed to set window.__ctx__ or React not available. ctx=${typeof verifyCtx}, React=${typeof verifyCtx?.React}`)
                }
                console.debug(`[Hook ${kind}] window.__ctx__ set and verified, React available:`, verifyCtx.React.constructor?.name)

                // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
                console.debug(`[Hook ${kind}] Attempting dynamic import...`, usedJsx ? '(transformed from JSX)' : '')
                const mod: any = await import(/* @vite-ignore */ blobUrl)
                console.debug(`[Hook ${kind}] Import successful, module:`, mod)

                if (!mod || typeof mod.default !== 'function') {
                    console.debug(`[Hook ${kind}] Module missing or default is not a function:`, {
                        has: !!mod,
                        typeOfDefault: typeof mod?.default
                    })
                    setError('Hook module does not export a default function. Export default async function(ctx) { ... }')
                    setErrorDetails({...diagnostics, reason: 'bad-export'})
                    console.error('[RepoBrowser] Hook module bad export (expected default function):', hookUrl)
                    return false
                }

                console.debug(`[Hook ${kind}] Calling hook function...`)
                const element: React.ReactNode = await mod.default(ctx)
                console.debug(`[Hook ${kind}] Hook executed successfully, element:`, element)
                console.debug(`[Hook ${kind}] Element type:`, typeof element, element?.constructor?.name, React.isValidElement(element))
                setHookElement(element)
                // Clear any previous error state so diagnostics <pre> disappears
                setError(null)
                setErrorDetails(null)
                return true
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err)
                const errStack = err instanceof Error && err.stack ? err.stack : ''
                console.debug(`[Hook ${kind}] Execution failed:`, errMsg)
                console.error(`[Hook ${kind}] Full error:`, err)
                console.error(`[Hook ${kind}] Stack:`, errStack)
                setError(
                    `Hook execution failed: ${errMsg}. If using JSX, add '// @use-jsx' comment at the top or use .jsx extension so the loader transpiles it.`
                )
                setErrorDetails({
                    ...diagnostics,
                    reason: 'execution-failed',
                    error: errMsg,
                    stack: errStack.split('\n').slice(0, 5)
                })
                return false
            } finally {
                URL.revokeObjectURL(blobUrl)
                // Clean up global - delayed because the hook may still be running async operations
                // that depend on window.__ctx__ (via helpers.loadModule calls)
                setTimeout(() => {
                    delete (window as any).__ctx__
                    console.debug(`[Hook ${kind}] Cleaned up window.__ctx__ after async operations`)
                }, 500)
            }
        } catch (fetchErr) {
            console.debug(`[Hook ${kind}] Fetch error:`, fetchErr instanceof Error ? fetchErr.message : fetchErr)
            setError(`Network error while fetching hook: ${(fetchErr as any)?.message || fetchErr}`)
            setErrorDetails({...diagnostics, reason: 'network-error'})
            console.error('[RepoBrowser] Network error while fetching hook:', fetchErr)
            return false
        }
    }

    const buildHookContext = (
        kind: 'get' | 'query' | 'put',
        extraParams?: Record<string, unknown>,
        RemoteLayout?: React.ComponentType<any>,
        hookBasePath?: string, // full path to the loaded hook module (e.g., /hooks/get-client.jsx)
    ) => {
        // Wrap FileRenderer to adapt it from { content, contentType } to { path }
        // This allows hooks to use FileRenderer({ path: "/file.md" })
        const FileRendererAdapter = ({path: filePath}: { path: string }) => {
            const [content, setContent] = React.useState<string>('')
            const [contentType, setContentType] = React.useState<string>('')
            const [loading, setLoading] = React.useState(true)
            const [error, setError] = React.useState<string | null>(null)

            React.useEffect(() => {
                if (!filePath) {
                    setLoading(false)
                    return
                }
                ;(async () => {
                    try {
                        const url = buildPeerUrl(tab!.host!, filePath)
                        const resp = await fetch(url, {
                            headers: buildRepoHeaders(tab?.currentBranch, tab?.repo),
                        })
                        if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`)
                        const text = await resp.text()
                        setContent(text)
                        setContentType(resp.headers.get('Content-Type') || 'text/plain')
                        setError(null)
                    } catch (err) {
                        setError(`Failed to load ${filePath}: ${(err as any)?.message || err}`)
                        setContent('')
                    } finally {
                        setLoading(false)
                    }
                })()
            }, [filePath])

            if (loading) return <div className="text-gray-500">Loading...</div>
            if (error) return <div className="text-red-500">{error}</div>
            return <FileRenderer content={content} contentType={contentType}/>
        }

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
                // Relative to current hook path, not the content path
                const basePath = hookBasePath && hookBasePath.startsWith('/')
                    ? hookBasePath
                    : '/hooks/get-client.jsx'
                const currentDir = basePath.split('/').slice(0, -1).join('/')
                normalizedPath = `${currentDir}/${modulePath}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
            } else if (!modulePath.startsWith('/')) {
                // Assume it's relative to /hooks/
                normalizedPath = `/hooks/${modulePath}`
            }

            const baseUrl = normalizeHostUrl(tab.host)
            const moduleUrl = `${baseUrl}${normalizedPath}`
            console.debug('[loadModule] Loading:', {modulePath, normalizedPath, moduleUrl})

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
                        // @ts-ignore - @babel/standalone doesn't have type definitions
                        const BabelNs: any = await import(/* @vite-ignore */ '@babel/standalone')
                        const Babel: any = (BabelNs && (BabelNs as any).default) ? (BabelNs as any).default : BabelNs
                        const presets: any[] = []
                        const TS_PRESET = Babel.availablePresets?.typescript || Babel.presets?.typescript || 'typescript'
                        const REACT_PRESET = Babel.availablePresets?.react || Babel.presets?.react || 'react'
                        if (TS_PRESET) {
                            presets.push([TS_PRESET])
                        }
                        // Use classic runtime with _jsx_ helper
                        presets.push([REACT_PRESET, {
                            runtime: 'classic',
                            pragma: '_jsx_',
                            pragmaFrag: '_jsxFrag_',
                            development: true
                        }])
                        const result = Babel.transform(code, {
                            filename: normalizedPath.split('/').pop() || 'module.tsx',
                            presets,
                            sourceMaps: 'inline',
                            retainLines: true,
                        })
                        // Inject _jsx_ and _jsxFrag_ helpers
                        const preamble = `
const __globalCtx__ = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {};
const React = __globalCtx__.__ctx__?.React;
const _jsx_ = (...args) => __globalCtx__.__ctx__?.React?.createElement(...args);
const _jsxFrag_ = __globalCtx__.__ctx__?.React?.Fragment;
if (!React) throw new Error('React not available in loadModule preamble');
`
                        finalCode = preamble + result.code
                    } catch (e) {
                        console.warn('[loadModule] Babel transform failed, trying raw import', e)
                    }
                }

                const blob = new Blob([finalCode], {type: 'text/javascript'})
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
            FileRenderer: FileRendererAdapter,
            Layout: RemoteLayout ?? TemplateLayout,
            params,
            helpers: {
                buildRepoHeaders,
                buildPeerUrl: (p: string) => buildPeerUrl(tab!.host!, p),
                navigate: handleNavigate,
                setBranch: (br: string) => updateTab(tab!.id, (t) => ({...t, currentBranch: br})),
                loadModule,
            },
        }
    }

    if (!tab) {
        return <div className="repo-browser">Tab not found</div>
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">
                {loading && <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>}

                {error && (
                    <div
                        className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
                        <h3 className="mt-0">Error</h3>
                        <p>{error}</p>
                        {errorDetails && (
                            <pre className="text-xs mt-3 overflow-auto max-h-64 whitespace-pre-wrap opacity-80">
{JSON.stringify(errorDetails, null, 2)}
              </pre>
                        )}
                        <div className="mt-4 text-sm opacity-80">
                            <ul className="list-disc pl-5 space-y-1">
                                <li>Verify <code>.relay.yaml</code> contains <code>client.hooks.get.path</code> and <code>client.hooks.query.path</code>.
                                </li>
                                <li>Ensure the hook module exports a default function: <code>export default async
                                    function(ctx) {'{'} return ... {'}'} </code></li>
                                <li>If using JSX, add a top-of-file comment <code>// @use-jsx</code> or
                                    use <code>.jsx</code>/<code>.tsx</code> extension.
                                </li>
                            </ul>
                        </div>
                        <button onClick={loadContent}
                                className="px-4 py-2 bg-red-600 text-white border-none rounded cursor-pointer mt-4 hover:bg-red-700">Try
                            Again
                        </button>
                    </div>
                )}

                {!loading && hookElement}
                {!loading && !error && !hookElement && (
                    <div className="p-4 bg-blue-100 text-blue-700">
                        No content - hook returned null or undefined
                    </div>
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
    // const protocol = host.includes(':') ? 'http' : 'https'

    return `${host}${host.endsWith('/') || path.startsWith('/') ? '' : '/'}${path}`

    // If path doesn't have extension, assume markdown
    // if (!path.includes('.') || path.endsWith('/')) {
    //     if (!path.endsWith('/')) url += '/'
    //     url += 'index.md'
    // }

}

function buildRepoHeaders(branch?: string, repo?: string): HeadersInit {
    const headers: Record<string, string> = {}
    if (branch) headers['x-relay-branch'] = branch
    if (repo) headers['x-relay-repo'] = repo
    return headers
}
