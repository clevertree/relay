import React, {useEffect, useMemo, useState} from 'react'
import {useAppState} from '../state/store'
import {TemplateLayout} from './TemplateLayout'
import {FileRenderer} from './FileRenderer'
import {buildPeerUrl, buildRepoHeaders, transpileCode} from '@relay/shared'
import {RepoFetchProvider} from '../context/RepoFetchContext'
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
    const [hookElement, setHookElement] = useState<React.ReactNode | null>(null)
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
        // Resolve hook path strictly from OPTIONS
        const info = optsOverride ?? optionsInfo
        const getPath = info?.client?.hooks?.get?.path
        const queryPath = info?.client?.hooks?.query?.path
        const hookPath = kind === 'get' ? getPath : kind === 'query' ? queryPath : undefined
        if (!hookPath) {
            // No fallbacks: surface a strict error when client hooks are not provided by OPTIONS
            setError(
                'Missing client hook path in repository discovery. Ensure your .relay.yaml defines client.hooks.get.path and client.hooks.query.path and that OPTIONS / returns them.'
            )
            setErrorDetails({
                ...diagnostics,
                phase: 'options',
                reason: 'missing-hook-path',
                options: info || {},
            })
            console.error('[RepoBrowser] Missing client hook path in OPTIONS payload:', info)
            return false
        }
        // Use resolvePath to properly join baseUrl and hookPath without double slashes
        const hookUrl = resolvePath(hookPath)
        console.debug(`[Hook ${kind}] Loading: ${hookUrl}`)

        // Fetch hook source and dynamic import
        try {
            console.debug(`[Hook ${kind}] Fetching source: ${hookUrl}`)
            const srcResp = await fetch(hookUrl)
            diagnostics.hookUrl = hookUrl
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

            // Detect SPA fallback: HTML served instead of JS module
            const ctLower = (diagnostics.fetch.contentType || '').toLowerCase()
            if (ctLower.includes('text/html') || /^\s*<!?doctype\s+html/i.test(code) || /^\s*<html/i.test(code)) {
                setError('Hook source request returned HTML, not a JS module. This often happens when a missing file 404 is converted to index.html by the proxy (SPA fallback).')
                setErrorDetails({
                    ...diagnostics,
                    reason: 'hook-html-fallback',
                    fetchHtml: {
                        url: hookUrl,
                        status: diagnostics.fetch.status,
                        ok: diagnostics.fetch.ok,
                        contentType: diagnostics.fetch.contentType,
                        sample: code.slice(0, 256),
                    },
                })
                return false
            }

            // Optionally pre-process JSX/TSX if present/opted-in
            let finalCode = code
            let usedJsx = false
            try {
                const looksLikeJsxOrTsx = /\/\s*@use-jsx|\/\s*@use-ts|<([A-Za-z][A-Za-z0-9]*)\s|jsxRuntime\s*:\s*['\"]automatic['\"]/m.test(code)
                    || hookPath.endsWith('.jsx') || hookPath.endsWith('.tsx') || hookPath.endsWith('.ts')
                if (looksLikeJsxOrTsx) {
                    console.debug(`[Hook ${kind}] JSX/TSX detected, transforming with SWC (wasm) runtime`)
                    const transformed = await transpileCode(code, {filename: hookPath.split('/').pop() || 'hook.tsx'})
                    // transpileCode() already prepends the full preamble with React helpers
                    finalCode = transformed
                    usedJsx = true
                    console.debug(`[Hook ${kind}] First 1000 chars of final code:\n${finalCode.substring(0, 1000)}`)
                }
            } catch (jsxErr) {
                console.warn(`[Hook ${kind}] JSX transform failed`, jsxErr)
                const msg = jsxErr instanceof Error ? jsxErr.message : String(jsxErr)
                // Surface a clear transpile error instead of proceeding to raw import (which causes 'Unexpected token')
                setError(`Hook transpilation failed: ${msg}. Ensure the file extension is .jsx/.tsx or add '// @use-jsx' at the top.`)
                setErrorDetails({
                    ...diagnostics,
                    reason: 'transpile-failed',
                    error: msg,
                    jsxError: jsxErr instanceof Error ? {
                        message: jsxErr.message,
                        name: jsxErr.name,
                        stack: jsxErr.stack,
                        ...(jsxErr as any).pos && {pos: (jsxErr as any).pos},
                        ...(jsxErr as any).loc && {loc: (jsxErr as any).loc},
                        ...(jsxErr as any).codeFrame && {codeFrame: (jsxErr as any).codeFrame},
                    } : jsxErr,
                })
                return false
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
                const element: any = await mod.default(ctx)
                const isElement = !!(element && React.isValidElement(element))
                console.debug(`[Hook ${kind}] Hook executed, isValidElement=`, isElement, 'type:', typeof element, element?.constructor?.name)
                if (!isElement) {
                    const summary = typeof element === 'object' ? `{ ${Object.keys(element || {}).join(', ')} }` : String(element)
                    setError('Hook returned a non-React element. Expected a React element from default export.')
                    setErrorDetails({
                        ...diagnostics,
                        reason: 'invalid-element',
                        returnedType: typeof element,
                        summary,
                    })
                    return false
                }
                setHookElement(element as React.ReactNode)
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
                // If this came from helpers.fetchJson (repo-aware), surface its diagnostic details
                const fetchJsonDetails = (err as any)?.name === 'RepoFetchJsonError' ? (err as any).details : undefined
                setError(`Hook execution failed: ${errMsg}.`)
                setErrorDetails({
                    ...diagnostics,
                    reason: 'execution-failed',
                    error: errMsg,
                    stack: errStack.split('\n').slice(0, 5),
                    ...(fetchJsonDetails ? {fetchJson: fetchJsonDetails} : {}),
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

    /**
     * Resolves paths within /template context
     * Handles both relative paths (./foo, ../foo) and absolute paths (/hooks/foo)
     * Returns properly formatted URL without double slashes
     */
    const resolvePath = (modulePath: string, fromHookPath?: string): string => {
        if (!tab?.host) {
            throw new Error('[resolvePath] No host available')
        }

        let resolvedPath = modulePath

        if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            // Relative to current hook path
            const basePath = fromHookPath && fromHookPath.startsWith('/')
                ? fromHookPath
                : '/hooks/client/get-client.jsx'
            const currentDir = basePath.split('/').slice(0, -1).join('/')
            resolvedPath = `${currentDir}/${modulePath}`
                .replace(/\/\.\//g, '/')
                .replace(/\/[^/]+\/\.\.\//g, '/')
        } else if (!modulePath.startsWith('/')) {
            // Assume absolute from /template root
            resolvedPath = `/${modulePath}`
        }

        const baseUrl = normalizeHostUrl(tab.host)
        // Use URL constructor to properly join paths without double slashes
        return new URL(resolvedPath.startsWith('/') ? resolvedPath.slice(1) : resolvedPath, baseUrl).toString()
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
                        const url = resolvePath(filePath)
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
            path: tab?.path ?? '/',
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
                // Resolve relative to the current hook path (defaults to client hook)
                const basePath = hookBasePath && hookBasePath.startsWith('/')
                    ? hookBasePath
                    : '/hooks/client/get-client.jsx'
                try {
                    const resolved = new URL(modulePath, new URL(basePath, 'http://resolver.local'))
                    normalizedPath = resolved.pathname
                } catch {
                    const currentDir = basePath.split('/').slice(0, -1).join('/')
                    normalizedPath = `${currentDir}/${modulePath}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
                }
            } else if (!modulePath.startsWith('/')) {
                // Assume it's relative to /hooks/client/
                normalizedPath = `/hooks/client/${modulePath}`
            }

            // Use resolvePath to properly join baseUrl and path without double slashes
            const moduleUrl = resolvePath(normalizedPath, hookBasePath)
            console.debug('[loadModule] Loading:', {modulePath, normalizedPath, moduleUrl})

            try {
                const response = await fetch(moduleUrl)
                if (!response.ok) {
                    throw new Error(`ModuleLoadError: ${moduleUrl} → ${response.status} ${response.statusText}`)
                }
                const ct = (response.headers.get('content-type') || '').toLowerCase()
                if (ct.includes('text/html')) {
                    throw new Error(`ModuleLoadError: ${moduleUrl} returned HTML (content-type=${ct})`)
                }

                const code = await response.text()
                // Transform TS/TSX/JSX if needed
                let finalCode = code
                const looksLikeTsOrJsx = /\/\s*@use-jsx|\/\s*@use-ts|<([A-Za-z][A-Za-z0-9]*)\s|jsxRuntime\s*:\s*['\"]automatic['\"]/m.test(code)
                    || normalizedPath.endsWith('.tsx') || normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.jsx')
                if (looksLikeTsOrJsx) {
                    try {
                        const transformed = await transpileCode(code, {filename: normalizedPath.split('/').pop() || 'module.tsx'})
                        // transpileCode() already prepends the full preamble with React helpers
                        finalCode = transformed
                    } catch (e) {
                        // Throw a structured error so hook UI can present useful information
                        const errMsg = (e as any)?.message || String(e)
                        const te: any = new Error(`TranspileError: ${normalizedPath.split('/').pop()}: ${errMsg}`)
                        te.name = 'TranspileError'
                        if ((e as any)?.loc) te.loc = (e as any).loc
                        if ((e as any)?.codeFrame) te.codeFrame = (e as any).codeFrame
                        throw te
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

        // Repo-aware resolver for generic relative URLs (e.g., "/hooks/env.json")
        const resolveRelative = (p: string) => {
            if (!tab?.host) throw new Error('[helpers.resolve] No host available')
            const baseUrl = normalizeHostUrl(tab.host)
            const path = p.startsWith('/') ? p.slice(1) : p
            return new URL(path, baseUrl).toString()
        }

        // Repo-aware fetch that resolves relative paths against the repo socket
        const repoFetch = async (input: any, init?: RequestInit): Promise<Response> => {
            try {
                if (typeof input === 'string') {
                    const isAbsolute = /^(https?:)?\/\//i.test(input)
                    const url = isAbsolute ? input : resolveRelative(input)
                    return fetch(url, init)
                }
                if (input instanceof URL) {
                    return fetch(input.toString(), init)
                }
                // Request object or other types
                return fetch(input, init)
            } catch (e) {
                return Promise.reject(e)
            }
        }

        // Validated JSON fetch helper with HTML-fallback detection
        const repoFetchJson = async (path: string, init?: RequestInit): Promise<any> => {
            const url = resolveRelative(path)
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
                if (text.trim().startsWith('<')) throw mkErr('Expected JSON but received HTML (likely SPA fallback)')
            }
            try {
                return JSON.parse(text)
            } catch (err) {
                throw mkErr(`Failed to parse JSON: ${(err as any)?.message || String(err)}`)
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
                resolvePath: (modulePath: string) => resolvePath(modulePath, hookBasePath),
                fetch: repoFetch,
                resolve: resolveRelative,
                fetchJson: repoFetchJson,
            },
        }
    }

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
                        {loading &&
                            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>}

                        {error && (
                            <div
                                className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
                                <h3 className="mt-0">Error</h3>
                                <p className="font-semibold">{error}</p>

                                {errorDetails && (
                                    <div className="mt-4 space-y-3 text-sm">
                                        {/* Show hook path and HTTP request info */}
                                        {errorDetails.kind && (
                                            <div className="bg-red-600/10 p-3 rounded border border-red-400/50">
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

                                        {/* Show JSX transpilation errors */}
                                        {errorDetails.jsxError && (
                                            <div className="bg-red-600/10 p-3 rounded border border-red-400/50">
                                                <div className="font-semibold text-xs mb-2">JSX Transpilation Error:
                                                </div>
                                                <pre
                                                    className="text-xs overflow-auto max-h-32 whitespace-pre-wrap font-mono bg-black/20 p-2 rounded">
{typeof errorDetails.jsxError === 'string' ? errorDetails.jsxError : JSON.stringify(errorDetails.jsxError, null, 2)}
                                        </pre>
                                            </div>
                                        )}

                                        {/* Show execution errors */}
                                        {errorDetails.reason === 'execution-failed' && errorDetails.error && (
                                            <div className="bg-red-600/10 p-3 rounded border border-red-400/50">
                                                <div className="font-semibold text-xs mb-2">Execution Error:</div>
                                                <div className="font-mono text-xs">{errorDetails.error}</div>
                                                {errorDetails.stack && Array.isArray(errorDetails.stack) && (
                                                    <pre
                                                        className="text-xs mt-2 overflow-auto max-h-16 whitespace-pre-wrap opacity-80">
{errorDetails.stack.join('\n')}
                                            </pre>
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

                        {!loading && hookElement}
                        {/* No placeholders: if the hook didn't render and there's no error, render nothing */}
                    </div>
                </ErrorBoundary>

                {/* Footer with version and git pull button */}
                <div
                    className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center justify-between">
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
