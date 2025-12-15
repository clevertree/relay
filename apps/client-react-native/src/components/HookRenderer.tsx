/**
 * HookRenderer — single reusable component to render a client hook (e.g. hooks/client/get-client.jsx)
 * Ensures identical wiring across RepoBrowser and DebugTab preview.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View, ScrollView, TouchableOpacity } from 'react-native'
import { createHookReact } from './HookDomAdapter'
import { HookErrorBoundary } from './HookErrorBoundary'
import MarkdownRenderer from './MarkdownRenderer'
import { HookLoader, RNModuleLoader, transpileCode, type HookContext, ES6ImportHandler, buildPeerUrl } from '../../../shared/src'
import { registerThemeStyles, styled, tailwindToStyle } from '../tailwindRuntime'

type OptionsInfo = {
  client?: { hooks?: { get?: { path: string }; query?: { path: string } } }
  [k: string]: unknown
}

function normalizeHostUrl(host: string): string {
  if (!host) return ''
  if (host.startsWith('http://') || host.startsWith('https://')) return host
  if (host.includes(':')) return `http://${host}`
  return `https://${host}`
}

const HookReact = createHookReact(React)

export interface HookRendererProps {
  host: string
  hookPath?: string // defaults to /hooks/client/get-client.jsx
}

type ErrorDetails = {
  phase?: string
  message?: string
  hookPath?: string
  host?: string
} | null

const TWView = styled(View)
const TWScroll = styled(ScrollView)
const TWText = styled(Text)
const TWButton = styled(TouchableOpacity)
const MAX_ERROR_RETRIES = 3

export const HookRenderer: React.FC<HookRendererProps> = ({ host, hookPath: hookPathProp }) => {
  const [element, setElement] = useState<React.ReactNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<ErrorDetails>(null)
  const [activeHookPath, setActiveHookPath] = useState<string | null>(null)
  const [retryAttempts, setRetryAttempts] = useState(0)
  const optionsRef = useRef<OptionsInfo | null>(null)
  const hookLoaderRef = useRef<HookLoader | null>(null)
  const importHandlerRef = useRef<ES6ImportHandler | null>(null)
  const inFlightRef = useRef(false)
  const inFlightKeyRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  const lastAttemptRef = useRef<number>(0)
  const elementRef = useRef<React.ReactNode | null>(null)
  const errorRef = useRef<string | null>(null)
  const errorRetriesRef = useRef(0)
  const manualRetryRef = useRef(false)
  const normalizedHost = normalizeHostUrl(host)

  useEffect(() => {
    console.debug('[HookRenderer] mounted', { host: normalizedHost, hookPathProp })
    return () => console.debug('[HookRenderer] unmounted', { host: normalizedHost, hookPathProp })
  }, [normalizedHost, hookPathProp])

  useEffect(() => {
    const jsxRuntimeShim = {
      jsx: HookReact.createElement,
      jsxs: HookReact.createElement,
      jsxDEV: HookReact.createElement,
    }
    const requireShim = (spec: string) => {
      if (spec === 'react') return HookReact
      if (spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') return jsxRuntimeShim
      // Map any styling runtime imports to our internal tailwind runtime.
      // We intentionally removed the nativewind shim and rely on our own implementation.
      if (spec === 'nativewind' || spec.startsWith('nativewind/') || spec === 'tailwindRuntime') {
         
        return require('../tailwindRuntime')
      }
      return {}
    }

    const urlMatch = normalizedHost.match(/^(https?):\/\/(.+)$/)
    const protocol: 'https' | 'http' = (urlMatch ? urlMatch[1] : 'https') as 'https' | 'http'
    const hostOnly = urlMatch ? urlMatch[2] : normalizedHost

    const transpileWrapper = async (code: string, filename: string): Promise<string> => {
      const sanitizeEncoding = (input: string): string =>
        input
          .replace(/â€"/g, '—')
          .replace(/â€œ/g, '"')
          .replace(/â€/g, '"')
          .replace(/â€™/g, "'")
          .replace(/ΓÇö/g, '--')
          .replace(/ΓÇ£/g, '"')
          .replace(/ΓÇ¥/g, '"')
          .replace(/ΓÇÖ/g, "'")

      const sanitizedCode = sanitizeEncoding(code)
      const resolvedFilename = filename || 'module.tsx'

      const transpiled = await transpileCode(sanitizedCode, { filename: resolvedFilename })
      // Convert exported ESM forms to CommonJS for RN execution
      const converted = transpiled
        .replace(/export\s+default\s+/g, 'module.exports.default = ')
        .replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')
      return converted
    }

    const rnModuleLoader = new RNModuleLoader({
      requireShim,
      host: normalizedHost.replace(/^https?:\/\//, ''),
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => console.debug('[RNModuleLoader] Diagnostics:', diag),
    })

    const importHandler = new ES6ImportHandler({
      host: normalizedHost.replace(/^https?:\/\//, ''),
      protocol,
      baseUrl: '/hooks',
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => console.debug('[ES6ImportHandler] Diagnostics:', diag),
    })
    rnModuleLoader.setImportHandler(importHandler)
    importHandlerRef.current = importHandler

    hookLoaderRef.current = new HookLoader({
      host: hostOnly,
      protocol,
      moduleLoader: rnModuleLoader,
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => console.debug('[HookLoader] Diagnostics:', diag),
    })
  }, [normalizedHost])

  const loadOptions = useCallback(async (): Promise<OptionsInfo | null> => {
    try {
      const resp = await fetch(`${normalizedHost}/`, { method: 'OPTIONS' })
      if (!resp.ok) throw new Error(`OPTIONS / failed: ${resp.status}`)
      const json = (await resp.json()) as OptionsInfo
      optionsRef.current = json
      return json
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError('Failed to load repository OPTIONS')
      setDetails({ phase: 'options', message: msg })
      return null
    }
  }, [normalizedHost])

  const createHookContext = useCallback(
    (baseHookPath: string): HookContext => {
      const buildUrl = (p: string) => buildPeerUrl(normalizedHost, p)

      const FileRendererAdapter = ({ path: filePath }: { path: string }) => {
        const [content, setContent] = useState<string>('')
        const [loading, setLoading] = useState(true)
        const [error, setError] = useState<string | null>(null)
        useEffect(() => {
          if (!filePath) {
            setLoading(false)
            return
          }
          ; (async () => {
            try {
              const url = buildUrl(filePath)
              const resp = await fetch(url)
              if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`)
              const text = await resp.text()
              setContent(text)
              setError(null)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              setError(`Failed to load ${filePath}: ${msg}`)
              setContent('')
            } finally {
              setLoading(false)
            }
          })()
        }, [filePath])
        if (loading) return <TWText>Loading...</TWText>
        if (error) return <TWText className="text-red-600">{error}</TWText>
        return <MarkdownRenderer content={content} />
      }

      const loadModule = async (modulePath: string): Promise<unknown> => {
        if (!hookLoaderRef.current) throw new Error('[HookRenderer] Hook loader not initialized')
        return hookLoaderRef.current.loadModule(modulePath, baseHookPath, createHookContext(baseHookPath))
      }

      return {
        React: HookReact,
        createElement: HookReact.createElement,
        FileRenderer: FileRendererAdapter,
        Layout: undefined,
        params: {},
        helpers: {
          navigate: () => { },
          setBranch: () => { },
          buildPeerUrl: buildUrl,
          loadModule,
          buildRepoHeaders: () => ({}),
          registerThemeStyles,
        },
      }
    },
    [normalizedHost]
  )

  useEffect(() => {
    if (!importHandlerRef.current) return
    importHandlerRef.current.setLoadModuleDelegate(async (modulePath: string, fromPath?: string | null, ctxArg?: HookContext) => {
      if (!hookLoaderRef.current) throw new Error('Hook loader not initialized')
      const base = typeof fromPath === 'string' && fromPath ? fromPath : '/hooks/client/get-client.jsx'
      const ctx = ctxArg || createHookContext(base)
      return hookLoaderRef.current.loadModule(modulePath, base, ctx)
    })
  }, [createHookContext])

  const tryRender = useCallback(async () => {
    const basePath = hookPathProp || '/hooks/client/get-client.jsx'
    const key = `${normalizedHost}|${basePath}`
    const now = Date.now()
    console.debug('[HookRenderer.tryRender] start key=', key, 'inFlight=', inFlightRef.current, 'inFlightKey=', inFlightKeyRef.current, 'lastKey=', lastKeyRef.current, 'lastError=', errorRef.current, 'lastAttemptMsAgo=', now - lastAttemptRef.current)

    // If we're already loading the same key, don't start another request
    if (inFlightRef.current && inFlightKeyRef.current === key) {
      console.debug('[HookRenderer.tryRender] Skipping start — already in flight for key', key)
      return
    }

    if (errorRetriesRef.current >= MAX_ERROR_RETRIES && !manualRetryRef.current) {
      console.debug('[HookRenderer.tryRender] Skipping auto retry after repeated failures', { key, retries: errorRetriesRef.current })
      setLoading(false)
      return
    }

    // Avoid redundant re-renders if we already have content for the same key and no error
    if (lastKeyRef.current === key && elementRef.current && !errorRef.current) {
      console.debug('[HookRenderer.tryRender] Skipping start — have cached element for key', key)
      return
    }

    // Throttle retries on error for the same key (5s)
    if (lastKeyRef.current === key && errorRef.current) {
      if (now - lastAttemptRef.current < 5000) {
        console.debug('[HookRenderer.tryRender] Skipping retry — recent failed attempt for key', key)
        return
      }
    }

    console.debug('[HookRenderer.tryRender] claiming inFlight for key', key)
    inFlightRef.current = true
    inFlightKeyRef.current = key
    lastAttemptRef.current = now
    setLoading(true)
    setError(null)
    setDetails(null)
    try {
      const path = basePath
      let options = optionsRef.current
      if (!options) options = await loadOptions()
      const hookUrl = buildPeerUrl(normalizedHost, path)
      setActiveHookPath(path)
      if (!hookLoaderRef.current) throw new Error('Hook loader not initialized')
      const ctx = createHookContext(path)
      const el = await hookLoaderRef.current.loadAndExecuteHook(path, ctx)
      console.debug('[HookRenderer.tryRender] loaded element for key', key, 'elementType=', typeof el)
      setElement(el)
      elementRef.current = el
      errorRetriesRef.current = 0
      setRetryAttempts(0)
      errorRef.current = null
      // mark success for this key
      lastKeyRef.current = key
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      console.debug('[HookRenderer.tryRender] caught error for key', key, message)
      setError(message)
      errorRef.current = message
      const nextAttempts = Math.min(errorRetriesRef.current + 1, MAX_ERROR_RETRIES)
      errorRetriesRef.current = nextAttempts
      setRetryAttempts(nextAttempts)
      setElement(null)
      setDetails({
        message,
        hookPath: hookPathProp || '/hooks/client/get-client.jsx',
        host: normalizedHost,
      })
    } finally {
      setLoading(false)
      inFlightRef.current = false
      inFlightKeyRef.current = null
      manualRetryRef.current = false
      console.debug('[HookRenderer.tryRender] finished for key', key, 'success=', !!elementRef.current, 'error=', errorRef.current)
    }
  }, [createHookContext, hookPathProp, normalizedHost])

  const handleRetry = useCallback(() => {
    manualRetryRef.current = true
    errorRef.current = null
    elementRef.current = null
    lastKeyRef.current = null
    lastAttemptRef.current = 0
    errorRetriesRef.current = 0
    setRetryAttempts(0)
    setDetails(null)
    setError(null)
    void tryRender()
  }, [tryRender])

  useEffect(() => {
    // Trigger render when host or hookPath change
    console.debug('[HookRenderer] effect trigger — normalizedHost/hookPathProp changed', { normalizedHost, hookPathProp })
    void tryRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedHost, hookPathProp])

  return (
    <TWView className="flex-1 min-h-0 bg-white">
      {loading && (
        <TWView className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#007AFF" />
          <TWText className="mt-3 text-gray-600">Loading...</TWText>
        </TWView>
      )}

      {error && (
        <TWView className="flex-1 justify-center p-5">
          <TWText className="text-lg font-bold text-red-600 mb-3">Error</TWText>
          <TWText className="text-gray-800">{error}</TWText>
          {retryAttempts >= MAX_ERROR_RETRIES && (
            <TWText className="text-xs text-gray-500 mt-2">
              Automatic retries paused after {MAX_ERROR_RETRIES} failed attempts. Tap Retry to try again.
            </TWText>
          )}
          {details && (
            <TWView className="mt-2 rounded-md bg-gray-100 p-2">
              <TWText className="font-mono text-xs text-gray-600">{JSON.stringify(details, null, 2)}</TWText>
            </TWView>
          )}
          <TWButton className="mt-3 bg-primary px-4 py-2 rounded" onPress={handleRetry}>
            <TWText className="text-white text-center font-semibold">Retry</TWText>
          </TWButton>
        </TWView>
      )}

      {!loading && !error && element && (
        <TWScroll
          className="flex-1 min-h-0 w-full"
          contentContainerStyle={tailwindToStyle('flex-grow min-h-0 pb-8')}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <HookErrorBoundary
            scriptPath={activeHookPath || ''}
            onError={(err, info) => {
              try {
                console.error('[HookRenderer] Child render error', err, info?.componentStack)
                // Pause automatic retries when a child render throws, to avoid repeated auto-refresh loops
                errorRef.current = err?.message || String(err)
                setError(err?.message || 'Child render error')
                setDetails({ phase: 'render', message: err?.message || String(err), hookPath: activeHookPath || undefined, host: normalizedHost })
                // mark that we've hit the retry cap so auto retries stop until manual retry
                errorRetriesRef.current = MAX_ERROR_RETRIES
                setRetryAttempts(MAX_ERROR_RETRIES)
              } catch (e) {
                // best-effort only
                console.error('[HookRenderer] onError handler failed', e)
              }
            }}
          >
            {element}
          </HookErrorBoundary>
        </TWScroll>
      )}
    </TWView>
  )
}

export default HookRenderer
