/**
 * Unified Runtime Loader for Relay Hooks
 *
 * Provides a shared interface for loading and transpiling TS/TSX/JSX hooks
 * across both web and React Native clients. Abstracts away platform-specific
 * module execution (browser import vs RN eval).
 */

/**
 * Babel transform configuration for hook modules
 */
export interface TransformOptions {
  filename: string
  hasJsxPragma?: boolean
  development?: boolean
}

/**
 * Result of transpiling code to CommonJS (used in RN)
 */
export interface TransformResult {
  code: string
  sourceMaps?: string
}

/**
 * Context passed to executed hooks
 */
export interface HookContext {
  React: any
  createElement: any
  FileRenderer: React.ComponentType<{ path: string }>
  Layout?: React.ComponentType<any>
  params: Record<string, any>
  helpers: HookHelpers
}

/**
 * Helper functions available to hooks
 */
export interface HookHelpers {
  navigate: (path: string) => void
  buildPeerUrl: (path: string) => string
  loadModule: (modulePath: string) => Promise<any>
  setBranch?: (branch: string) => void
  buildRepoHeaders?: (branch?: string, repo?: string) => Record<string, string>
}

/**
 * Diagnostics and error information
 */
export interface LoaderDiagnostics {
  phase: 'init' | 'options' | 'fetch' | 'transform' | 'import' | 'exec'
  kind?: 'get' | 'query' | 'put'
  error?: string
  details?: Record<string, any>
  [key: string]: any
}

/**
 * Module loader adapter for platform-specific execution
 */
export interface ModuleLoader {
  /**
   * Load and execute a module, returning its exports
   * @param code The module source code
   * @param filename Path to the module for source maps
   * @param context The hook context to make available to the module
   * @returns Resolved module exports
   */
  executeModule(code: string, filename: string, context: HookContext): Promise<any>
}

/**
 * Web-specific module loader: uses dynamic import with blob URLs
 */
export class WebModuleLoader implements ModuleLoader {
  async executeModule(code: string, filename: string, context: HookContext): Promise<any> {
    const preamble = `
const __globalCtx__ = (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {});
const React = __globalCtx__.__ctx__?.React;
const _jsx_ = (...args) => __globalCtx__.__ctx__?.React?.createElement(...args);
const _jsxFrag_ = __globalCtx__.__ctx__?.React?.Fragment;
if (!React) throw new Error('React not available in preamble');
`
    const finalCode = preamble + code

    const blob = new Blob([finalCode], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)

    try {
      // Set global context for JSX transpiled code
      ;(window as any).__ctx__ = context

      // @vite-ignore - Dynamic import of remote blob module (intentional pattern)
      const mod: any = await import(/* @vite-ignore */ blobUrl)

      if (!mod || typeof mod.default !== 'function') {
        throw new Error('Hook module does not export a default function')
      }

      return mod
    } finally {
      URL.revokeObjectURL(blobUrl)
      // Clean up global after async operations may complete
      setTimeout(() => {
        delete (window as any).__ctx__
      }, 500)
    }
  }
}

/**
 * React Native module loader: uses Function constructor with CommonJS eval
 */
export class RNModuleLoader implements ModuleLoader {
  private requireShim: (spec: string) => any

  constructor(requireShim?: (spec: string) => any) {
    this.requireShim = requireShim || ((spec: string) => {
      if (spec === 'react') return require('react')
      return {}
    })
  }

  async executeModule(code: string, filename: string, context: HookContext): Promise<any> {
    const exports: any = {}
    const module = { exports }

    // Inject context and helpers into the function scope for the hook to access
    const contextStr = JSON.stringify(context, (key, value) => {
      // Skip non-serializable values (functions, React components)
      if (typeof value === 'function' || (value && typeof value === 'object' && value.$$typeof)) {
        return undefined
      }
      return value
    })

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'require',
      'module',
      'exports',
      'context',
      `
try {
  ${code}
} catch (err) {
  console.error('[RNModuleLoader] Code execution error in ${filename}:', err.message || err);
  throw err;
}
//# sourceURL=${filename}
    `
    )
    try {
      fn(this.requireShim, module, exports, context)
    } catch (err) {
      console.error(`[RNModuleLoader] Failed to execute module ${filename}:`, err)
      throw err
    }

    const mod = (module as any).exports

    if (!mod || typeof mod.default !== 'function') {
      throw new Error('Hook module must export default function(ctx)')
    }

    return mod
  }
}

/**
 * Transpile TypeScript/JSX to JavaScript (using @babel/standalone)
 *
 * @param code Source code to transpile
 * @param options Transform configuration
 * @param toCommonJs If true, also transform ESM imports/exports to CommonJS (for RN)
 * @returns Transpiled code
 */
export async function transpileCode(
  code: string,
  options: TransformOptions,
  _toCommonJs: boolean = false
): Promise<string> {
  // Use SWC WASM in the browser to transpile TS/TSX/JSX → modern JS (ESM)
  // No external network calls; the wasm is bundled by Vite.
  try {
    // 1) Prefer a preloaded SWC instance exposed by the web app
    const g: any = (typeof globalThis !== 'undefined' ? (globalThis as any) : (window as any)) || {}
    let swc: any = g.__swc
    let swcNs: any = undefined
    if (!swc) {
      // 2) Fallback to dynamic import if bridge not present
      swcNs = await import('@swc/wasm-web')
      swc = swcNs && (swcNs.default ? { ...swcNs.default, ...swcNs } : swcNs)
      const initFn = typeof swc?.init === 'function' ? swc.init : typeof swcNs?.init === 'function' ? swcNs.init : undefined
      if (initFn) {
        try {
          // init() is idempotent; ignore errors if already initialized
          await initFn()
        } catch (_) {
          // Some bundlers initialize automatically; proceed on failure
        }
      }
      // Cache globally for subsequent calls
      try { (globalThis as any).__swc = swc } catch {}
    }

    const filename = options.filename || 'module.tsx'
    const isTs = /\.(tsx?|mts|cts)$/.test(filename)
    const isJsx = /\.(jsx|tsx)$/.test(filename) || /<([A-Za-z][A-Za-z0-9]*)\s/.test(code)
    // Infer development mode from environment when not explicitly provided
    const isDevEnv = (() => {
      try {
        // Vite exposes import.meta.env.MODE
        // eslint-disable-next-line no-undef
        const viteMode = (import.meta as any)?.env?.MODE
        if (viteMode) return String(viteMode) === 'development'
      } catch {}
      try {
        // Fallback to process.env.NODE_ENV if defined by bundler
        // eslint-disable-next-line no-undef
        if (typeof process !== 'undefined' && (process as any)?.env?.NODE_ENV) {
          return (process as any).env.NODE_ENV === 'development'
        }
      } catch {}
      return false
    })()
    const reactDev = options.development ?? isDevEnv

    const transformOptions = {
      jsc: {
        target: 'es2022',
        parser: isTs
          ? { syntax: 'typescript' as const, tsx: isJsx }
          : { syntax: 'ecmascript' as const, jsx: isJsx },
        transform: isJsx
          ? {
              react: {
                runtime: 'classic',
                pragma: '_jsx_',
                pragmaFrag: '_jsxFrag_',
                development: !!reactDev,
              },
            }
          : undefined,
      },
      module: { type: 'es6' as const },
      sourceMaps: !!reactDev,
      filename,
    }

    const transformFn = swc?.transformSync || swcNs?.transformSync || swcNs?.default?.transformSync || swc?.transform || swcNs?.transform || swcNs?.default?.transform
    if (typeof transformFn !== 'function') {
      const keys = swcNs ? Object.keys(swcNs || {}) : []
      const dkeys = swcNs ? Object.keys((swcNs as any)?.default || {}) : []
      const hint = g.__swc ? 'Global __swc exists but lacks transform().' : 'Global __swc not found.'
      throw new Error(`SWC not available: missing transform(). ${hint} Module keys=${JSON.stringify(keys)}, default keys=${JSON.stringify(dkeys)}`)
    }
    // Some environments exhibit a weird error from swc glue: reading 'transform' of undefined.
    // Normalize options to plain JSON and retry once with a conservative shape if it happens.
    const callTransform = async (opts: any) => {
      // Strip undefined and functions
      const jsonOpts = JSON.parse(JSON.stringify(opts))
      return transformFn(code, jsonOpts)
    }
    let result
    try {
      result = await callTransform(transformOptions)
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/reading 'transform'/.test(msg) || /Cannot read properties of undefined \(reading 'transform'\)/.test(msg)) {
        // Retry with forced jsc.transform object present
        const retryOpts = {
          ...transformOptions,
          jsc: {
            ...transformOptions.jsc,
            transform: {
              react: {
                runtime: 'classic',
                pragma: '_jsx_',
                pragmaFrag: '_jsxFrag_',
                development: !!reactDev,
              },
            },
          },
        }
        result = await callTransform(retryOpts)
      } else {
        throw e
      }
    }
    const out: string = (result && result.code) || ''
    return out + `\n//# sourceURL=${filename}`
  } catch (err) {
    console.error('[transpileCode] SWC transform failed:', err)
    const message = (err as any)?.message || String(err)
    const e: any = new Error(`TranspileError: ${options.filename || 'unknown'}: ${message}`)
    e.name = 'TranspileError'
    if ((err as any)?.stack) e.stack = (err as any).stack
    if ((err as any)?.code) (e as any).code = (err as any).code
    if ((err as any)?.cause) (e as any).cause = (err as any).cause
    throw e
  }
}

/**
 * Detect if code looks like TypeScript/JSX/TSX
 */
export function looksLikeTsOrJsx(code: string, filename: string): boolean {
  const hasPragma = /@use-jsx|@use-ts|@jsx\s+h/m.test(code)
  const hasJsxSyntax = /<([A-Za-z][A-Za-z0-9]*)\s/.test(code)
  const isTypescriptExt = filename.endsWith('.tsx') || filename.endsWith('.ts') || filename.endsWith('.jsx')
  return hasPragma || hasJsxSyntax || isTypescriptExt
}

/**
 * Hook loader orchestrator: handles full lifecycle of loading and executing hooks
 */
export interface HookLoaderOptions {
  host: string
  protocol: 'http' | 'https'
  moduleLoader: ModuleLoader
  onDiagnostics?: (diag: LoaderDiagnostics) => void
}

export class HookLoader {
  private host: string
  private protocol: 'http' | 'https'
  private moduleLoader: ModuleLoader
  private onDiagnostics: (diag: LoaderDiagnostics) => void
  private moduleCache: Map<string, any> = new Map()

  constructor(options: HookLoaderOptions) {
    this.host = options.host
    this.protocol = options.protocol
    this.moduleLoader = options.moduleLoader
    this.onDiagnostics = options.onDiagnostics || (() => {})
  }

  /**
   * Load a module from the peer/repo, with optional transpilation
   * @param modulePath Relative or absolute path to module
   * @param fromPath Current hook path for resolving relative imports
   * @param context Hook context for module execution
   * @returns Module exports
   */
  async loadModule(
    modulePath: string,
    fromPath: string = '/hooks/client/get-client.jsx',
    context: HookContext
  ): Promise<any> {
    // Resolve path robustly relative to the current hook file path
    let normalizedPath = modulePath
    try {
      if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
        // Ensure the base includes the 'client' segment by default
        const base = fromPath && fromPath.startsWith('/') ? fromPath : '/hooks/client/get-client.jsx'
        const baseUrl = new URL(base, 'http://resolver.local')
        const resolved = new URL(modulePath, baseUrl)
        normalizedPath = resolved.pathname
      } else if (!modulePath.startsWith('/')) {
        normalizedPath = `/hooks/client/${modulePath}`
      }
      // Collapse any '/../' leftovers defensively
      normalizedPath = normalizedPath.replace(/\/+/, '/').replace(/\/\.\//g, '/').replace(/(?:\/(?!\.\.)[^/]+\/\.\.)+/g, '/')
    } catch (_) {
      // Fallback to previous logic if URL API not available for some reason
      const baseDir = (fromPath || '/hooks/client/get-client.jsx').split('/').slice(0, -1).join('/') || '/hooks/client'
      normalizedPath = `${baseDir}/${modulePath}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
    }

    // Check cache
    const cacheKey = `${this.host}:${normalizedPath}`
    if (this.moduleCache.has(cacheKey)) {
      return this.moduleCache.get(cacheKey)
    }

    const moduleUrl = `${this.protocol}://${this.host}${normalizedPath}`

    try {
      const response = await fetch(moduleUrl)
      if (!response.ok) {
        throw new Error(`ModuleLoadError: ${moduleUrl} → ${response.status} ${response.statusText}`)
      }
      const ct = (response.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) {
        // Server likely returned an HTML error page; don't try to execute it
        throw new Error(`ModuleLoadError: ${moduleUrl} returned HTML (content-type=${ct})`)
      }

      const code = await response.text()

      // Transpile if needed
      let finalCode = code
      if (looksLikeTsOrJsx(code, normalizedPath)) {
        try {
          finalCode = await transpileCode(
            code,
            { filename: normalizedPath.split('/').pop() || 'module.tsx' },
            false // Web uses import, not CommonJS
          )
        } catch (err) {
          const msg = (err as any)?.message || String(err)
          const diag: LoaderDiagnostics = {
            phase: 'transform',
            error: msg,
            details: { moduleUrl, filename: normalizedPath, ...(err as any) }
          }
          this.onDiagnostics(diag)
          // Do NOT execute raw JSX; surface a clear error to the caller/UI
          throw new Error(`TranspileError: ${normalizedPath}: ${msg}`)
        }
      }

      // Execute and cache
      let mod: any
      try {
        mod = await this.moduleLoader.executeModule(finalCode, normalizedPath, context)
      } catch (execErr) {
        const execMsg = (execErr as any)?.message || String(execErr)
        const diag: LoaderDiagnostics = {
          phase: 'import',
          error: execMsg,
          details: { filename: normalizedPath }
        }
        this.onDiagnostics(diag)
        throw execErr
      }
      this.moduleCache.set(cacheKey, mod)
      return mod
    } catch (err) {
      console.error('[HookLoader.loadModule] Failed:', modulePath, err)
      throw err
    }
  }

  /**
   * Load and execute a hook module
   * @param hookPath Path to the hook module (from OPTIONS)
   * @param context The hook context to pass
   * @returns Executed hook element/result
   */
  async loadAndExecuteHook(hookPath: string, context: HookContext): Promise<any> {
    const diag: LoaderDiagnostics = { phase: 'init' }

    try {
      diag.phase = 'fetch'
      const hookUrl = `${this.protocol}://${this.host}${hookPath}`
      console.debug(`[HookLoader] Fetching hook from: ${hookUrl}`)

      const response = await fetch(hookUrl)

      diag.fetch = {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
      }

      if (!response.ok) {
        throw new Error(`ModuleLoadError: ${hookUrl} → ${response.status} ${response.statusText}`)
      }
      const ct = (response.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('text/html')) {
        throw new Error(`ModuleLoadError: ${hookUrl} returned HTML (content-type=${ct})`)
      }

      const code = await response.text()
      diag.codeLength = code.length
      console.debug(`[HookLoader] Received hook code (${code.length} chars)`)

      // Transpile if needed
      diag.phase = 'transform'
      let finalCode = code
      if (looksLikeTsOrJsx(code, hookPath)) {
        try {
          console.debug(`[HookLoader] Transpiling ${hookPath}`)
          finalCode = await transpileCode(
            code,
            { filename: hookPath.split('/').pop() || 'hook.tsx', hasJsxPragma: /@jsx\s+h/m.test(code) },
            false // Web uses dynamic import
          )
          console.debug(`[HookLoader] Transpilation complete (${finalCode.length} chars)`)
        } catch (err) {
          console.warn('[HookLoader] JSX transpilation failed, trying raw:', err)
          diag.transpileWarn = err instanceof Error ? err.message : String(err)
        }
      }

      // Execute
      diag.phase = 'import'
      console.debug(`[HookLoader] Executing hook module`)

      try {
        const mod = await this.moduleLoader.executeModule(finalCode, hookPath, context)

        if (!mod || typeof mod.default !== 'function') {
          throw new Error('Hook module does not export a default function')
        }

        diag.phase = 'exec'
        console.debug(`[HookLoader] Calling hook function`)
        const element = await mod.default(context)
        console.debug(`[HookLoader] Hook executed successfully`)

        return element
      } catch (execErr) {
        console.error('[HookLoader] Hook execution error:', execErr)
        throw execErr
      }
    } catch (err) {
      diag.error = err instanceof Error ? err.message : String(err)
      diag.stack = err instanceof Error ? err.stack : undefined
      console.error('[HookLoader] Error during loadAndExecuteHook:', diag)
      this.onDiagnostics(diag)
      throw err
    }
  }

  /**
   * Clear module cache (useful for hot reload or cleanup)
   */
  clearCache(): void {
    this.moduleCache.clear()
  }
}
