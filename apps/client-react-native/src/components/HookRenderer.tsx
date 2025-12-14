/**
 * HookRenderer — single reusable component to render a client hook (e.g. hooks/client/get-client.jsx)
 * Ensures identical wiring across RepoBrowser and DebugTab preview.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { createHookReact } from './HookDomAdapter'
import { HookErrorBoundary } from './HookErrorBoundary'
import MarkdownRenderer from './MarkdownRenderer'
import { HookLoader, RNModuleLoader, transpileCode, type HookContext, ES6ImportHandler, buildPeerUrl } from '../../../shared/src'

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

export const HookRenderer: React.FC<HookRendererProps> = ({ host, hookPath: hookPathProp }) => {
  const [element, setElement] = useState<React.ReactNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<any>(null)
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
      // Ensure nativewind is available to transpiled hooks at runtime. Prefer real package,
      // fall back to our local shim if nativewind isn't present as a runtime export.
      if (spec === 'nativewind' || spec.startsWith('nativewind/')) {
        try {
          // eslint-disable-next-line global-require
          return require('nativewind')
        } catch (e) {
          try {
            // eslint-disable-next-line global-require
            return require('../nativewind-shim')
          } catch (err) {
            return {}
          }
        }
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
    } catch (e: any) {
      setError('Failed to load repository OPTIONS')
      setDetails({ phase: 'options', message: e?.message || String(e) })
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
            } catch (err) {
              setError(`Failed to load ${filePath}: ${(err as any)?.message || err}`)
              setContent('')
            } finally {
              setLoading(false)
            }
          })()
        }, [filePath])
        if (loading) return <Text>Loading...</Text>
        if (error) return <Text style={{ color: 'red' }}>{error}</Text>
        return <MarkdownRenderer content={content} />
      }

      const loadModule = async (modulePath: string): Promise<any> => {
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
    } catch (e: any) {
      const message = e?.message || String(e)
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
    <View style={styles.container}>
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          {details && (
            <View style={styles.errorDetails}>
              <Text style={styles.errorDetailText}>{JSON.stringify(details, null, 2)}</Text>
            </View>
          )}
        </View>
      )}

      {!loading && !error && element && (
        <View style={styles.hookContainer}>
          <HookErrorBoundary
            scriptPath={activeHookPath || ''}
            onError={(err) => console.error('[HookRenderer] Child render error', err)}
          >
            {element}
          </HookErrorBoundary>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#dc3545',
    marginBottom: 12,
  },
  errorText: {
    color: '#333',
  },
  errorDetails: {
    marginTop: 10,
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 6,
  },
  errorDetailText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#555',
  },
  hookContainer: {
    flex: 1,
  },
})

export default HookRenderer
