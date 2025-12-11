/**
 * Unified Runtime Loader for Relay Hooks
 *
 * Provides a shared interface for loading and transpiling TS/TSX/JSX hooks
 * across both web and React Native clients. Abstracts away platform-specific
 * module execution (browser import vs RN eval).
 */

import { ES6ImportHandler, type ImportHandlerOptions } from './es6ImportHandler'

// Provide type definitions for global scope (for React and process availability)
declare const global: any
declare const process: any/**
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
 * Web-specific module loader: uses Function constructor for Metro compatibility
 */
export class WebModuleLoader implements ModuleLoader {
  async executeModule(code: string, filename: string, context: HookContext): Promise<any> {
    // Note: preamble is now added BEFORE transpilation in transpileCode(),
    // so we no longer need to add it again here

    const exports: any = {}
    const module = { exports }

    try {
      // Set global context for JSX transpiled code
      ;(window as any).__ctx__ = context

      // Use Function constructor instead of dynamic import for Metro compatibility
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
  console.error('[WebModuleLoader] Code execution error in ${filename}:', err.message || err);
  throw err;
}
        `
      )

      // Execute the module code
      fn(
        (spec: string) => {
          // Basic require shim for web
          if (spec === 'react') {
            // eslint-disable-next-line no-undef
            return window.React || {}
          }
          return {}
        },
        module,
        exports,
        context
      )

      // Return the module exports
      const mod = module.exports
      if (!mod || typeof mod.default !== 'function') {
        throw new Error('Hook module does not export a default function')
      }

      return mod
    } finally {
      // Clean up global after async operations may complete
      setTimeout(() => {
        delete (window as any).__ctx__
      }, 500)
    }
  }
}

/**
 * React Native module loader: uses Function constructor with ES6 import() support
 * 
 * Executes hook code with support for ES6 dynamic imports via __import__() calls.
 * This allows hooks to use modern import() syntax instead of CommonJS require().
 */
export class RNModuleLoader implements ModuleLoader {
  private importHandler: ES6ImportHandler | null = null
  private requireShim: (spec: string) => any
  private transpiler: (code: string, filename: string) => Promise<string>

  constructor(options?: {
    requireShim?: (spec: string) => any
    host?: string
    transpiler?: (code: string, filename: string) => Promise<string>
    onDiagnostics?: (diag: any) => void
  }) {
    this.requireShim = options?.requireShim || ((spec: string) => {
      // Provide basic React shim for RN
      if (spec === 'react') {
        // For RN, React is already in the global scope
        return typeof (global as any).React !== 'undefined' ? (global as any).React : {}
      }
      return {}
    })

    this.transpiler = options?.transpiler || (async (code: string) => code)

    // Initialize ES6 import handler if host is provided
    if (options?.host) {
      this.importHandler = new ES6ImportHandler({
        host: options.host,
        baseUrl: '/hooks',
        onDiagnostics: options?.onDiagnostics,
        transpiler: this.transpiler,
      })
    }
  }

  /**
   * Set up the import handler (called after host is known)
   */
  setImportHandler(importHandler: ES6ImportHandler): void {
    this.importHandler = importHandler
  }

  async executeModule(code: string, filename: string, context: HookContext): Promise<any> {
    const exports: any = {}
    const module = { exports }

    // Check if code uses ES6 import() syntax
    const usesES6Import = /\bawait\s+import\s*\(|import\s*\(/.test(code)

    if (usesES6Import && !this.importHandler) {
      console.warn(
        '[RNModuleLoader] Code uses import() but no ES6ImportHandler available. Install will fail.',
        { filename }
      )
    }

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      '__import__',
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
      // Provide current execution context and filename to import handler so it can
      // resolve relative paths and optionally delegate to helpers.loadModule
      if (this.importHandler) {
        try {
          // @ts-ignore - methods exist on ES6ImportHandler
          this.importHandler.setCurrentModulePath?.(filename)
          // @ts-ignore
          this.importHandler.setExecutionContext?.(context)
        } catch (e) {
          console.warn('[RNModuleLoader] Failed to set import handler context:', e)
        }
      }
      // Pass ES6 import handler as first parameter (or dummy if not available)
      let importFn = this.importHandler?.handle.bind(this.importHandler)
      if (!importFn) {
        importFn = (modulePath: string) => {
          throw new Error(`import('${modulePath}') not supported - ES6ImportHandler not initialized`)
        }
      }

      await fn(importFn, this.requireShim, module, exports, context)
      
      // Ensure module.exports and exports are in sync
      // If code modified exports, make sure it's reflected in module.exports
      // If code modified module.exports, make sure it overwrites exports
      if (module.exports !== exports) {
        // Code modified module.exports - use that
        // module.exports already has the right value
      } else {
        // Code modified exports but not module.exports - sync them
        module.exports = exports
      }
    } catch (err) {
      console.error(`[RNModuleLoader] Failed to execute module ${filename}:`, err)
      throw err
    }

    const mod = (module as any).exports || exports
    
    // Debug logging
    console.log('[RNModuleLoader] After execution - mod object:', JSON.stringify(mod, null, 2))
    console.log('[RNModuleLoader] mod.default type:', typeof (mod?.default))
    console.log('[RNModuleLoader] module.exports === exports?', (module as any).exports === exports)
    console.log('[RNModuleLoader] exports object:', JSON.stringify(exports, null, 2))

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
  // STRICT MODE: Disable SWC/Babel/server fallbacks.
  // Only use the new Rust crate WASM binding if available on the page.
  // The web app must load the crate and expose globalThis.__hook_transpile_jsx(source, filename) => string
  const filename = options.filename || 'module.tsx'
  const g: any = (typeof globalThis !== 'undefined' ? (globalThis as any) : {})
  const wasmTranspile: any = g.__hook_transpile_jsx
  if (typeof wasmTranspile !== 'function') {
    throw new Error('HookTranspiler WASM not loaded: expected globalThis.__hook_transpile_jsx(source, filename)')
  }

  // Extract JSX pragma (default to h / React.Fragment)
  let pragmaFn = 'h'
  let pragmaFragFn = 'React.Fragment'
  const pragmaMatch = code.match(/\/\*+\s*@jsx\s+([\w.]+)\s*\*+\//)
  const pragmaFragMatch = code.match(/\/\*+\s*@jsxFrag\s+([\w.]+)\s*\*+\//)
  if (pragmaMatch && pragmaMatch[1]) pragmaFn = pragmaMatch[1]
  if (pragmaFragMatch && pragmaFragMatch[1]) pragmaFragFn = pragmaFragMatch[1]
  const preamble = ``
  const codeWithPreamble = preamble + code

  const out = await wasmTranspile(codeWithPreamble, filename)
  if (typeof out !== 'string') {
    throw new Error('HookTranspiler returned non-string output')
  }
  // Rewrite dynamic import() to helpers.loadModule()
  const rewritten = out.replace(/\bimport\s*\(/g, 'context.helpers.loadModule(')
  return rewritten + `\n//# sourceURL=${filename}`
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
  transpiler?: (code: string, filename: string) => Promise<string>
  onDiagnostics?: (diag: LoaderDiagnostics) => void
}

export class HookLoader {
  private host: string
  private protocol: 'http' | 'https'
  private moduleLoader: ModuleLoader
  private transpiler?: (code: string, filename: string) => Promise<string>
  private onDiagnostics: (diag: LoaderDiagnostics) => void
  private moduleCache: Map<string, any> = new Map()

  constructor(options: HookLoaderOptions) {
    this.host = options.host
    this.protocol = options.protocol
    this.moduleLoader = options.moduleLoader
    this.transpiler = options.transpiler
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

      let response: Response
      let code: string
      
      try {
        // Try fetch with a timeout using XMLHttpRequest as fallback
        response = await fetch(hookUrl)
        code = await response.text()
      } catch (fetchErr) {
        console.error('[HookLoader] Fetch failed, got error immediately:', fetchErr)
        throw fetchErr
      }

      console.debug(`[HookLoader] Received hook code (${code.length} chars)`)

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

      diag.codeLength = code.length

      // Transpile if needed
      diag.phase = 'transform'
      let finalCode = code
      if (looksLikeTsOrJsx(code, hookPath)) {
        try {
          console.debug(`[HookLoader] Transpiling ${hookPath}`)
          
          // Use custom transpiler if provided (e.g., for React Native with CommonJS conversion)
          if (this.transpiler) {
            finalCode = await this.transpiler(code, hookPath.split('/').pop() || 'hook.tsx')
          } else {
            finalCode = await transpileCode(
              code,
              { filename: hookPath.split('/').pop() || 'hook.tsx', hasJsxPragma: /@jsx\s+h/m.test(code) },
              false // Web uses dynamic import
            )
          }
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
