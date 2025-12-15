/**
 * HookRenderer — single reusable component to render a client hook (e.g. hooks/client/get-client.jsx)
 * Ensures identical wiring across RepoBrowser and DebugTab preview.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View, ScrollView } from 'react-native'
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

export const HookRenderer: React.FC<HookRendererProps> = ({ host, hookPath: hookPathProp }) => {
  const [element, setElement] = useState<React.ReactNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<ErrorDetails>(null)
  const [activeHookPath, setActiveHookPath] = useState<string | null>(null)
  const optionsRef = useRef<OptionsInfo | null>(null)
  const hookLoaderRef = useRef<HookLoader | null>(null)
  const importHandlerRef = useRef<ES6ImportHandler | null>(null)
  const normalizedHost = normalizeHostUrl(host)

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
        // eslint-disable-next-line global-require
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
    setLoading(true)
    setError(null)
    setDetails(null)
    try {
      let path = hookPathProp || '/hooks/client/get-client.jsx'
      let options = optionsRef.current
      if (!options) options = await loadOptions()
      const hookUrl = buildPeerUrl(normalizedHost, path)
      setActiveHookPath(path)
      if (!hookLoaderRef.current) throw new Error('Hook loader not initialized')
      const ctx = createHookContext(path)
      const el = await hookLoaderRef.current.loadAndExecuteHook(path, ctx)
      setElement(el)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setElement(null)
      setDetails({
        message,
        hookPath: hookPathProp || '/hooks/client/get-client.jsx',
        host: normalizedHost,
      })
    } finally {
      setLoading(false)
    }
  }, [createHookContext, hookPathProp, normalizedHost])

  useEffect(() => {
    void tryRender()
  }, [tryRender])

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
          {details && (
            <TWView className="mt-2 rounded-md bg-gray-100 p-2">
              <TWText className="font-mono text-xs text-gray-600">{JSON.stringify(details, null, 2)}</TWText>
            </TWView>
          )}
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
            onError={(err) => console.error('[HookRenderer] Child render error', err)}
          >
            {element}
          </HookErrorBoundary>
        </TWScroll>
      )}
    </TWView>
  )
}

export default HookRenderer
