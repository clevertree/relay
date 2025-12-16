import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {HookLoader, WebModuleLoader, transpileCode, type HookContext, unifiedBridge, styleManager} from '@relay/shared'
import ErrorBoundary from './ErrorBoundary'
import {FileRenderer} from './FileRenderer'

type HookRendererProps = { host: string; hookPath?: string }

function normalizeHostUrl(host: string) {
    if (!host) return ''
    if (host.startsWith('http://') || host.startsWith('https://')) return host
    if (host.includes(':')) return `http://${host}`
    return `https://${host}`
}

// Lightweight client-side usage registry. This collects used selectors/classes at runtime.
// Later we can wire this to the themed-styler state via an IPC/CLI call or network endpoint.
function registerUsageFromElement(tag: string, props?: Record<string, any>) {
    try {
        // delegate to the shared runtime bridge which centralizes usage
        unifiedBridge.registerUsage(tag, props as any)
        // request a render from the style manager (debounced internally)
        try { styleManager.requestRender() } catch (e) {}
    } catch (e) {
        // noop
    }
}

function createHookReact(reactModule: typeof React) {
    const baseCreate = reactModule.createElement.bind(reactModule as any)
    function hookCreateElement(type: any, props: any, ...children: any[]) {
        if (typeof type === 'string') {
            try {
                registerUsageFromElement(type, props)
            } catch (e) {}
        }
        return baseCreate(type, props, ...children)
    }
    return { ...reactModule, createElement: hookCreateElement }
}

const HookRenderer: React.FC<HookRendererProps> = ({ host, hookPath }) => {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [element, setElement] = useState<React.ReactNode | null>(null)
    const normalizedHost = useMemo(() => normalizeHostUrl(host), [host])
    const loaderRef = useRef<HookLoader | null>(null)

    useEffect(() => {
        if (!host) return
        const protocol = normalizedHost.startsWith('https://') ? 'https' : 'http'
        const hostOnly = normalizedHost.replace(/^https?:\/\//, '')

        // No requireShim needed for web loader; WebModuleLoader executes code in a sandboxed Function

        const transpiler = async (code: string, filename: string) => {
            const out = await transpileCode(code, { filename })
            return out
        }

        const webLoader = new WebModuleLoader()
        loaderRef.current = new HookLoader({ host: hostOnly, protocol: protocol as 'http' | 'https', moduleLoader: webLoader, transpiler: transpiler })

        // Start style auto-sync while this renderer is mounted
        try {
            styleManager.startAutoSync()
            styleManager.requestRender()
        } catch (e) {}
        return () => {
            try { styleManager.stopAutoSync() } catch (e) {}
        }
    }, [normalizedHost, host])

    const createHookContext = useCallback((baseHookPath: string): HookContext => {
        const buildPeer = (p: string) => `${normalizedHost}${p.startsWith('/') ? p : '/' + p}`

        const FileRendererAdapter = ({ path }: { path: string }) => {
            const [content, setContent] = useState<string>('')
            const [contentType, setContentType] = useState<string>('text/plain')
            const [loading, setLoading] = useState(true)
            useEffect(() => {
                let cancelled = false
                ;(async () => {
                    try {
                        const url = `${normalizedHost}${path.startsWith('/') ? path : '/' + path}`
                        const resp = await fetch(url)
                        const txt = await resp.text()
                        if (!cancelled) {
                            setContent(txt)
                            setContentType(resp.headers.get('content-type') || 'text/plain')
                        }
                    } catch (e) {
                        if (!cancelled) setContent('')
                    } finally {
                        if (!cancelled) setLoading(false)
                    }
                })()
                return () => { cancelled = true }
            }, [path])

            if (loading) return <div>Loading file...</div>
            return <FileRenderer content={content} contentType={contentType} />
        }

        const loadModule = async (modulePath: string) => {
            if (!loaderRef.current) throw new Error('loader not ready')
            return loaderRef.current.loadModule(modulePath, baseHookPath, createHookContext(baseHookPath))
        }

        return {
            React: createHookReact(React),
            createElement: createHookReact(React).createElement,
            FileRenderer: FileRendererAdapter,
            Layout: undefined,
            params: {},
            helpers: {
                navigate: () => {},
                buildPeerUrl: buildPeer,
                loadModule,
                registerThemeStyles: (name: string, defs?: Record<string, any>) => {
                    unifiedBridge.registerTheme(name, defs)
                    // After registering a theme, re-render CSS into the DOM
                    try { styleManager.renderCssIntoDom() } catch (e) {}
                }
            }
        }
    }, [normalizedHost])

    const tryRender = useCallback(async () => {
        setLoading(true)
        setError(null)
        setElement(null)
        try {
            const path = hookPath || '/hooks/client/get-client.jsx'
            if (!loaderRef.current) throw new Error('hook loader not initialized')
            const ctx = createHookContext(path)
            const el = await loaderRef.current.loadAndExecuteHook(path, ctx)
            setElement(el)
            // After rendering the hook, ensure CSS for currently-registered usage is applied
            try { styleManager.renderCssIntoDom() } catch (e) {}
        } catch (e: any) {
            setError(e?.message || String(e))
        } finally {
            setLoading(false)
        }
    }, [createHookContext, hookPath])

    useEffect(() => { void tryRender() }, [tryRender])

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {loading && <div>Loading hook...</div>}
            {error && <div style={{ color: 'red' }}><strong>Error:</strong> {error}</div>}
            {!loading && !error && element && (
                <ErrorBoundary>
                    <div style={{ flex: 1 }}>{element}</div>
                </ErrorBoundary>
            )}
        </div>
    )
}

export default HookRenderer
