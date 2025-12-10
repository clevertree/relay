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
    // Note: preamble is now added BEFORE transpilation in transpileCode(),
    // so we no longer need to add it again here

    const blob = new Blob([code], { type: 'text/javascript' })
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
    // Extract JSX pragma from source code (e.g., /** @jsx h */ or /** @jsx React.createElement */)
  // Use internal unique pragma names to avoid colliding with user-land
  // helpers or multiple injections of the same identifier (e.g. _jsx_)
  let pragmaFn = '__relay_jsx__'
  let pragmaFragFn = '__relay_jsxFrag__'
    const pragmaMatch = code.match(/\/\*+\s*@jsx\s+([\w.]+)\s*\*+\//)
    const pragmaFragMatch = code.match(/\/\*+\s*@jsxFrag\s+([\w.]+)\s*\*+\//)
    if (pragmaMatch && pragmaMatch[1]) {
      pragmaFn = pragmaMatch[1]
      console.log('[transpileCode] Found @jsx pragma:', pragmaFn)
    }
    if (pragmaFragMatch && pragmaFragMatch[1]) {
      pragmaFragFn = pragmaFragMatch[1]
      console.log('[transpileCode] Found @jsxFrag pragma:', pragmaFragFn)
    }
    
    // **CRITICAL**: Prepend preamble BEFORE transpilation so JSX pragma function is defined
    // when SWC transpiles JSX syntax to pragma function calls
  const preamble = `const __globalCtx__ = (typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {});
// Safe React accessor: prefer bundler-provided React if available, otherwise fall back to runtime context
const __getReact__ = () => (typeof React !== 'undefined' ? (React) : (__globalCtx__.__ctx__?.React || __globalCtx__.React));
// Define internal helpers defensively so multiple injections do not throw
if (typeof __relay_jsx__ === 'undefined') { var __relay_jsx__ = (...args) => __getReact__()?.createElement(...args); }
if (typeof __relay_jsxFrag__ === 'undefined') { var __relay_jsxFrag__ = __getReact__()?.Fragment; }
if (typeof ${pragmaFn} === 'undefined') { var ${pragmaFn} = __relay_jsx__; }
if (typeof ${pragmaFragFn} === 'undefined') { var ${pragmaFragFn} = __relay_jsxFrag__; }
if (typeof h === 'undefined') { var h = (...args) => __getReact__()?.createElement(...args); }
`
    const codeWithPreamble = preamble + code
    console.log('[transpileCode] Prepended preamble with pragma:', pragmaFn)
    
    // 1) Prefer a preloaded SWC instance exposed by the web app
    const g: any = (typeof globalThis !== 'undefined' ? (globalThis as any) : (window as any)) || {}
    let swc: any = g.__swc
    let swcNs: any = undefined
    console.log('[transpileCode] Starting transpilation for', options.filename, 'code length:', code.length)
    console.log('[transpileCode] Global __swc available:', !!g.__swc)
    
    if (!swc) {
      // If the app is preloading SWC, wait a short period for it to finish to avoid a race
      try {
        const gAny: any = globalThis as any
        if (gAny.__swc_ready && typeof gAny.__swc_ready.then === 'function') {
          console.log('[transpileCode] awaiting global __swc_ready for init')
          // await but don't block indefinitely - 1200ms grace
          const p = Promise.race([gAny.__swc_ready, new Promise((res) => setTimeout(res, 1200))])
          await p
          swc = (globalThis as any).__swc
        }
      } catch (e) {
        console.warn('[transpileCode] error awaiting __swc_ready (continuing):', e)
      }
    }
    if (!swc) {
      // 2) Fallback to dynamic import if bridge not present
      console.log('[transpileCode] __swc not preloaded, importing @swc/wasm-web')
      swcNs = await import('@swc/wasm-web')
      console.log('[transpileCode] @swc/wasm-web imported, keys:', Object.keys(swcNs), 'default:', typeof swcNs?.default)
      
      // @swc/wasm-web uses wasm-pack, which auto-initializes when you first access
      // the module. However, the initialization can be finicky. Try explicit init first.
      try {
        // Prefer async init if available (better for WASM loading)
        if (typeof swcNs?.default === 'function') {
          console.log('[transpileCode] Calling ns.default() for async init')
          await swcNs.default()
          console.log('[transpileCode] Async init completed')
        } else if (typeof swcNs?.init === 'function') {
          console.log('[transpileCode] Calling ns.init() for async init')
          await swcNs.init()
          console.log('[transpileCode] Async init completed')
        } else if (typeof swcNs?.initSync === 'function') {
          console.log('[transpileCode] Calling ns.initSync() for sync init')
          swcNs.initSync()
          console.log('[transpileCode] Sync init completed')
        } else {
          console.log('[transpileCode] No explicit init function found, assuming auto-init')
        }
      } catch (e) {
        console.warn('[transpileCode] Explicit init failed (may auto-init):', e)
        // Continue - some bundlers handle init automatically
      }
      
      // Use the namespace exports as the SWC module (named exports live here)
      swc = swcNs
      try { (globalThis as any).__swc = swc } catch {}
      console.log('[transpileCode] Cached swc to globalThis.__swc, has transform:', typeof swc?.transform)
    } else {
      console.log('[transpileCode] Using preloaded __swc, has transform:', typeof swc.transform)
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
                pragma: pragmaFn,
                pragmaFrag: pragmaFragFn,
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
    console.log('[transpileCode] Found transformFn:', typeof transformFn, 'isSync:', !!(swc?.transformSync || swcNs?.transformSync || swcNs?.default?.transformSync))
    
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
      console.log('[transpileCode] Calling transform with options:', JSON.stringify(jsonOpts).substring(0, 200))
      try {
        const res = await transformFn(codeWithPreamble, jsonOpts)
        console.log('[transpileCode] Transform succeeded, result code length:', res?.code?.length)
        return res
      } catch (e) {
        console.error('[transpileCode] Transform call failed:', e?.message || String(e))
        throw e
      }
    }
    let result
    try {
      result = await callTransform(transformOptions)
    } catch (e: any) {
      console.error('[transpileCode] Transform error on first try:', e?.message || String(e), 'stack:', e?.stack)
      const msg = e?.message || String(e)
      if (/reading 'transform'|reading '_windgen|reading 'memory'|wasm|WebAssembly/i.test(msg) || /Cannot read properties of undefined/.test(msg)) {
        console.log('[transpileCode] Retrying with forced jsc.transform (appears to be WASM/init issue)')
        // Retry with forced jsc.transform object present
        const retryOpts = {
          ...transformOptions,
          jsc: {
            ...transformOptions.jsc,
            transform: {
              react: {
                runtime: 'classic',
                // Use the internal pragma names for retry as well
                pragma: '__relay_jsx__',
                pragmaFrag: '__relay_jsxFrag__',
                development: !!reactDev,
              },
            },
          },
        }
        try {
          result = await callTransform(retryOpts)
        } catch (retryErr: any) {
          console.error('[transpileCode] Retry also failed:', retryErr?.message || String(retryErr))
          throw retryErr
        }
      } else {
        throw e
      }
    }
    let out: string = (result && result.code) || ''
    // Defensive: some inputs or transforms may still emit references or
    // declarations for the classic runtime helpers named `_jsx_`/_jsxFrag_.
    // Replace those identifiers with our internal unique names so they
    // use the single preamble we injected and avoid duplicate declarations.
    try {
      out = out.replace(/\b_jsx_\b/g, '__relay_jsx__').replace(/\b_jsxFrag_\b/g, '__relay_jsxFrag__')
    } catch (e) {
      // If anything goes wrong with the replace, continue with original output
      console.warn('[transpileCode] Post-transform replace failed:', e)
    }
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
