/**
 * Native Repo Browser Component
 * Simple hook host - all UI/search/navigation is handled by the repo hook.
 * Client is a dumb host that loads and renders the hook module.
 */

import React, {useState, useCallback, useRef, useEffect} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MarkdownRenderer from './MarkdownRenderer';
import { createHookReact } from './HookDomAdapter';
import { HookErrorBoundary } from './HookErrorBoundary';
import { HookLoader, RNModuleLoader, transpileCode, type HookContext, ES6ImportHandler, buildPeerUrl, buildRepoHeaders } from '../../../shared/src';

type OptionsInfo = {
  client?: { hooks?: { get?: { path: string }; query?: { path: string } } }
  [k: string]: unknown
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

const HookReact = createHookReact(React)

function useHookRenderer(host: string) {
  const [element, setElement] = useState<React.ReactNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<any>(null)
  const [activeHookPath, setActiveHookPath] = useState<string | null>(null)
  const optionsRef = useRef<OptionsInfo | null>(null)
  const hookLoaderRef = useRef<HookLoader | null>(null)
  const importHandlerRef = useRef<ES6ImportHandler | null>(null)
  const normalizedHost = normalizeHostUrl(host)
  console.debug(`[useHookRenderer] initialized with host: ${host}, normalized: ${normalizedHost}`)

  // Initialize hook loader with RN module executor
  useEffect(() => {
    const jsxRuntimeShim = {
      jsx: HookReact.createElement,
      jsxs: HookReact.createElement,
      jsxDEV: HookReact.createElement,
    }

    const requireShim = (spec: string) => {
      if (spec === 'react') return HookReact
      if (spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') return jsxRuntimeShim
      return {}
    }

    // Extract protocol and host from normalizedHost early for downstream wiring
    const urlMatch = normalizedHost.match(/^(https?):\/\/(.+)$/)
    const protocol: 'https' | 'http' = (urlMatch ? urlMatch[1] : 'https') as 'https' | 'http'
    const hostOnly = urlMatch ? urlMatch[2] : normalizedHost

    // Wrapper for transpileCode to match the expected signature
    // CRITICAL: React Native RNModuleLoader expects CommonJS (module.exports)
    // transpileCode outputs ES6 modules, so we need to convert to CommonJS
    const transpileWrapper = async (code: string, filename: string): Promise<string> => {
      console.debug('[transpileWrapper] Input code length:', code.length, 'filename:', filename)
      const firstChars = code.substring(0, 50)
      console.debug('[transpileWrapper] First 50 chars:', firstChars)
      console.debug('[transpileWrapper] First 10 char codes:',
        Array.from(firstChars.substring(0, 10)).map((c) => c.charCodeAt(0)).join(', '))

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

      let sanitizedCode = sanitizeEncoding(code)
      if (sanitizedCode !== code) {
        console.debug('[transpileWrapper] Fixed encoding issues, code length:', sanitizedCode.length)
      }

      const resolvedFilename = filename || 'module.tsx'

      try {
        const transpiled = await transpileCode(sanitizedCode, { filename: resolvedFilename })
        const converted = transpiled
          .replace(/export\s+default\s+/g, 'module.exports.default = ')
          .replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')
        console.debug('[transpileWrapper] Native transpilation produced length:', converted.length)
        return converted
      } catch (internalErr) {
        console.error('[transpileWrapper] Native transpiler failed:', internalErr)
        throw internalErr
      }
    }

    // Create RN module loader with ES6 import support
    const rnModuleLoader = new RNModuleLoader({
      requireShim,
      host: normalizedHost.replace(/^https?:\/\//, ''), // Remove protocol for host
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => {
        console.debug('[RNModuleLoader] Diagnostics:', diag)
      },
    })

    // Create ES6 import handler and set it on the loader
    const importHandler = new ES6ImportHandler({
      host: normalizedHost.replace(/^https?:\/\//, ''),
      protocol,
      baseUrl: '/hooks',
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => {
        console.debug('[ES6ImportHandler] Diagnostics:', diag)
      },
    })
    rnModuleLoader.setImportHandler(importHandler)
    importHandlerRef.current = importHandler

    hookLoaderRef.current = new HookLoader({
      host: hostOnly,
      protocol,
      moduleLoader: rnModuleLoader,
      transpiler: transpileWrapper,
      onDiagnostics: (diag) => {
        console.debug('[HookLoader] Diagnostics:', diag)
      },
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
    (hookPath: string): HookContext => {
      // Use the shared buildPeerUrl utility that handles proper slash joining
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
          ;(async () => {
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
        if (!hookLoaderRef.current) {
          throw new Error('[useHookRenderer] Hook loader not initialized')
        }
        return hookLoaderRef.current.loadModule(modulePath, hookPath, createHookContext(hookPath))
      }

      return {
        React: HookReact,
        createElement: HookReact.createElement,
        FileRenderer: FileRendererAdapter,
        Layout: undefined,
        params: {},
        helpers: {
          navigate: () => {},
          setBranch: () => {},
          buildPeerUrl: buildUrl,
          loadModule,
          buildRepoHeaders: () => ({}),
        },
      }
    },
    [normalizedHost]
  )

  // Keep the ES6 import() handler delegated to HookLoader so dynamic imports can use helpers.loadModule semantics
  useEffect(() => {
    if (!importHandlerRef.current) return
    importHandlerRef.current.setLoadModuleDelegate(async (modulePath: string, fromPath?: string | null, ctxArg?: HookContext) => {
      if (!hookLoaderRef.current) {
        throw new Error('Hook loader not initialized')
      }
      const base = (typeof fromPath === 'string' && fromPath) ? fromPath : '/hooks/client/get-client.jsx'
      const ctx = ctxArg || createHookContext(base)
      return hookLoaderRef.current.loadModule(modulePath, base, ctx)
    })
  }, [createHookContext])

  const tryRender = useCallback(async () => {
    console.debug('[tryRender] Starting hook rendering...')
    setLoading(true)
    setError(null)
    setDetails(null)
    setActiveHookPath(null)

    let hookPath: string | undefined
    try {
      // Fetch repository OPTIONS to discover hook locations
      const opts = await loadOptions()
      if (!opts) {
        // loadOptions already set error/details
        return
      }
      optionsRef.current = opts
      console.debug('[tryRender] Got options:', opts)
      hookPath = opts?.client?.hooks?.get?.path

      // Ensure hookPath starts with /
      if (hookPath && !hookPath.startsWith('/')) {
        hookPath = '/' + hookPath
      }

      setActiveHookPath(hookPath ?? null)

      if (!hookPath) {
        setError('Missing hook path in OPTIONS')
        setDetails({
          phase: 'options',
          message: 'The repository did not advertise the GET hook path in OPTIONS at client.hooks.get.path.',
          what_to_do: [
            'Ask the repository owner to add a client GET hook and expose it in OPTIONS as client.hooks.get.path',
            'Ensure the hook file exists at hooks/client/get-client.jsx in the repository',
            `Verify that OPTIONS / on ${normalizedHost} returns a JSON object with {"client":{"hooks":{"get":{"path":"/hooks/client/get-client.jsx"}}}}`,
          ],
          options: opts,
        })
        setLoading(false)
        return
      }

      if (!hookLoaderRef.current) {
        throw new Error('Hook loader not initialized')
      }

      const ctx = createHookContext(hookPath)
      const hookUrl = buildPeerUrl(normalizedHost, hookPath)
      console.debug(`[RepoBrowser] Attempting to load hook from: ${hookUrl}`)
      const el = await hookLoaderRef.current.loadAndExecuteHook(hookPath, ctx)
      setElement(el)
      setError(null)
      setDetails(null)
    } catch (e: any) {
      const hookUrl = buildPeerUrl(normalizedHost, hookPath || '')
      setError('Hook execution failed')
      
      // Capture detailed error info for debugging network issues
      let errorType = 'Unknown error'
      
      if (e.message) {
        errorType = e.message
        // Try to extract error details if available
        if (e.message.includes('Network') || e.message.includes('fetch')) {
          errorType = 'Network request failed - Check server connectivity, SSL certificates, or network configuration'
        }
      }
      
      const errorInfo = { 
        message: e?.message || String(e),
        errorType,
        stack: e?.stack?.split('\n').slice(0, 3).join('\n'),
        hookPath,
        attemptedUrl: hookUrl,
        host: normalizedHost,
        errorObject: {
          name: e?.name,
          code: e?.code,
          errno: e?.errno,
        },
      }
      console.error(`[RepoBrowser] Hook execution failed for ${hookUrl}:`, errorInfo)
      setDetails(errorInfo)
      setElement(null)
    } finally {
      setLoading(false)
    }
  }, [createHookContext])

  useEffect(() => {
    console.debug('[useHookRenderer] useEffect hook called (on mount), calling tryRender...')
    void tryRender()
  }, [])

  return { element, loading, error, details, activeHookPath }
}

interface RepoBrowserProps {
  host: string;
  branch?: string;
  initialPath?: string;
  onNavigate?: (path: string) => void;
}

const RepoBrowser: React.FC<RepoBrowserProps> = ({
  host,
}) => {
  const normalizedHost = normalizeHostUrl(host)
  const hookRenderer = useHookRenderer(normalizedHost)

  return (
    <View style={styles.container}>
      {hookRenderer.loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {hookRenderer.error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorText}>{hookRenderer.error}</Text>
          {hookRenderer.details && (
            <View style={styles.errorDetails}>
              <Text style={styles.errorDetailText}>
                {JSON.stringify(hookRenderer.details, null, 2)}
              </Text>
            </View>
          )}
        </View>
      )}

      {!hookRenderer.loading && !hookRenderer.error && hookRenderer.element && (
        <View style={styles.hookContainer}>
          <HookErrorBoundary
            scriptPath={hookRenderer.activeHookPath}
            onError={(error) =>
              console.error('[RepoBrowser] Hook child threw during render', {
                script: hookRenderer.activeHookPath ?? 'unknown',
                error,
              })
            }
          >
            {hookRenderer.element}
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
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 12,
  },
  errorDetails: {
    backgroundColor: '#fdf2f2',
    borderWidth: 1,
    borderColor: '#f5c6cb',
    padding: 12,
    borderRadius: 6,
  },
  errorDetailText: {
    fontSize: 12,
    color: '#4a4a4a',
    fontFamily: 'monospace',
  },
  hookContainer: {
    flex: 1,
  },
})

export default RepoBrowser;
