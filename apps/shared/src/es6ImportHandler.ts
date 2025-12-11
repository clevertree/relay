/**
 * ES6 Import Handler for React Native
 *
 * Provides runtime support for ES6 dynamic import() calls in React Native.
 * Allows hooks to use modern ES6 import syntax instead of CommonJS require().
 *
 * Usage in hook code:
 *   const Utils = await import('./utils.mjs')
 *   const { formatDate } = await import('@relay/shared')
 */

export interface ImportHandlerOptions {
  host: string
  protocol?: 'http' | 'https'
  baseUrl?: string
  onDiagnostics?: (diag: any) => void
  transpiler?: (code: string, filename: string) => Promise<string>
}

/**
 * ES6 Import Handler - manages dynamic module loading for hooks
 */
export class ES6ImportHandler {
  private moduleCache = new Map<string, any>()
  private transpiling = new Map<string, Promise<any>>()
  private host: string
  private protocol: 'http' | 'https'
  private baseUrl: string
  private onDiagnostics: (diag: any) => void
  private transpiler: (code: string, filename: string) => Promise<string>
  private currentModulePath: string | null = null
  private executionContext: any = null
  private loadModuleDelegate: ((modulePath: string, fromPath?: string | null, ctx?: any) => Promise<any>) | null = null

  constructor(options: ImportHandlerOptions) {
    this.host = options.host
    this.protocol = options.protocol || 'https'
    this.baseUrl = options.baseUrl || '/hooks'
    this.onDiagnostics = options.onDiagnostics || ((diag: any) => {
      console.debug('[ES6ImportHandler] Diagnostics:', diag)
    })
    this.transpiler = options.transpiler || this.defaultTranspiler
  }

  /**
   * Allow the host to delegate import() to a provided loader (e.g., helpers.loadModule)
   */
  setLoadModuleDelegate(
    delegate: (modulePath: string, fromPath?: string | null, ctx?: any) => Promise<any>
  ): void {
    this.loadModuleDelegate = delegate
  }

  /**
   * Inform the handler of the currently executing module path so relative imports resolve correctly
   */
  setCurrentModulePath(path: string | null): void {
    this.currentModulePath = path || null
  }

  /**
   * Provide the current execution context so a delegate can use it
   */
  setExecutionContext(ctx: any): void {
    this.executionContext = ctx
  }

  /**
   * Default transpiler using SWC if available
   */
  private async defaultTranspiler(code: string, filename: string): Promise<string> {
    // Will be provided by caller or use fallback
    console.warn('[ES6ImportHandler] No transpiler provided, returning code as-is')
    return code
  }

  /**
   * Handle import() calls from hook code
   * Called as: const mod = await __import__('./utils.mjs')
   */
  async handle(modulePath: string): Promise<any> {
    const normalizedPath = this.normalizePath(modulePath)
    const cacheKey = `${this.host}:${normalizedPath}`

    this.onDiagnostics({
      phase: 'import',
      action: 'handle_import',
      modulePath,
      normalizedPath,
      cached: this.moduleCache.has(cacheKey),
    })

    // Check cache first
    if (this.moduleCache.has(cacheKey)) {
      console.debug('[ES6ImportHandler] Cache hit:', cacheKey)
      return this.moduleCache.get(cacheKey)
    }

    // Check if already transpiling (prevent duplicate requests)
    if (this.transpiling.has(cacheKey)) {
      console.debug('[ES6ImportHandler] Waiting for in-flight transpile:', cacheKey)
      return this.transpiling.get(cacheKey)!
    }

    // If a delegate is provided (e.g., helpers.loadModule), use it first
    const promise = (async () => {
      if (this.loadModuleDelegate) {
        try {
          const mod = await this.loadModuleDelegate(modulePath, this.currentModulePath, this.executionContext)
          // Cache the module under the normalized path key if available
          this.moduleCache.set(cacheKey, mod)
          this.onDiagnostics({ phase: 'import', action: 'delegate_success', modulePath, normalizedPath })
          return mod
        } catch (delegateErr) {
          // Fall back to direct fetch/transpile below
          this.onDiagnostics({ phase: 'import', action: 'delegate_failed', modulePath, normalizedPath, error: String(delegateErr) })
        }
      }
      // Fetch and transpile module
      return this.loadAndTranspile(modulePath, normalizedPath, cacheKey)
    })()
    this.transpiling.set(cacheKey, promise)

    try {
      const result = await promise
      return result
    } finally {
      this.transpiling.delete(cacheKey)
    }
  }

  /**
   * Fetch, transpile, and execute a module
   */
  private async loadAndTranspile(
    originalPath: string,
    normalizedPath: string,
    cacheKey: string
  ): Promise<any> {
    const startTime = Date.now()
    console.debug('[ES6ImportHandler] Loading module:', { originalPath, normalizedPath })

    try {
      // Fetch module source from host
      const moduleUrl = `${this.protocol}://${this.host}${normalizedPath}`
      console.debug('[ES6ImportHandler] Fetching from:', moduleUrl)

      const response = await fetch(moduleUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch ${moduleUrl}: ${response.status} ${response.statusText}`)
      }

      const code = await response.text()
      console.debug('[ES6ImportHandler] Fetched code, length:', code.length)

      // Transpile the code
      console.debug('[ES6ImportHandler] Transpiling:', normalizedPath)
      const transpiled = await this.transpiler(code, normalizedPath)
      console.debug('[ES6ImportHandler] Transpiled code, length:', transpiled.length)

      // Execute module with ES6 import support
      const moduleExports = await this.executeModule(transpiled, normalizedPath)

      // Cache the result
      this.moduleCache.set(cacheKey, moduleExports)

      const duration = Date.now() - startTime
      console.debug('[ES6ImportHandler] Successfully loaded module:', {
        path: normalizedPath,
        duration: `${duration}ms`,
        exports: Object.keys(moduleExports).slice(0, 5),
      })

      this.onDiagnostics({
        phase: 'import',
        action: 'load_success',
        modulePath: normalizedPath,
        duration,
      })

      return moduleExports
    } catch (err) {
      const duration = Date.now() - startTime
      console.error('[ES6ImportHandler] Failed to load module:', {
        path: normalizedPath,
        error: err instanceof Error ? err.message : String(err),
        duration: `${duration}ms`,
      })

      this.onDiagnostics({
        phase: 'import',
        action: 'load_error',
        modulePath: normalizedPath,
        error: err instanceof Error ? err.message : String(err),
        duration,
      })

      throw err
    }
  }

  /**
   * Execute module code with ES6 import support
   */
  private async executeModule(code: string, filename: string): Promise<any> {
    const moduleExports: any = {}
    const module = { exports: moduleExports }

    try {
      // Create function with __import__ in scope for dynamic imports
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        '__import__',
        'module',
        'exports',
        `
// Wrap in async IIFE to allow top-level await patterns in transpiled code
return (async function(){
  try {
    ${code}
  } catch (err) {
    console.error('[ES6ImportHandler.executeModule] Code execution error in ${filename}:', err && (err.message || err));
    throw err;
  }
})()
//# sourceURL=${filename}
      `
      )

      // Execute with import handler bound to this
      await fn(this.handle.bind(this), module, moduleExports)

      console.debug('[ES6ImportHandler] Module executed:', filename)
      return moduleExports
    } catch (err) {
      console.error(`[ES6ImportHandler] Failed to execute module ${filename}:`, err)
      throw err
    }
  }

  /**
   * Normalize a module path to absolute path
   */
  private normalizePath(modulePath: string): string {
    // Handle relative imports relative to current module path when available
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      try {
        const base = this.currentModulePath && this.currentModulePath.startsWith('/')
          ? this.currentModulePath
          : `${this.baseUrl}/client/get-client.jsx`
        const baseUrl = new URL(base, 'http://resolver.local')
        const resolvedUrl = new URL(modulePath, baseUrl)
        const resolved = resolvedUrl.pathname
        console.debug('[ES6ImportHandler] Resolved relative path:', { modulePath, from: this.currentModulePath, resolved })
        return resolved
      } catch {
        // Fallback to naive join with baseUrl
        const cleaned = modulePath.replace(/^\.\//g, '')
        const resolved = `${this.baseUrl}/${cleaned}`.replace(/\/+/g, '/').replace(/\/\.\//g, '/')
        console.debug('[ES6ImportHandler] Resolved (fallback) relative path:', { modulePath, resolved })
        return resolved
      }
    }

    // Handle absolute imports
    if (modulePath.startsWith('/')) {
      return modulePath
    }

    // Handle @relay/* or other scoped imports
    if (modulePath.startsWith('@')) {
      // Map @relay/shared to actual module path
      if (modulePath.startsWith('@relay/shared')) {
        // This would need to be a special case - for now return as-is
        return `/hooks${modulePath}`
      }
      return `${this.baseUrl}/${modulePath}`
    }

    // Default: assume relative to /hooks/
    return `${this.baseUrl}/${modulePath}`
  }

  /**
   * Clear the module cache (useful for development/hot reload)
   */
  clearCache(): void {
    this.moduleCache.clear()
    console.debug('[ES6ImportHandler] Cache cleared')
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.moduleCache.size,
      entries: Array.from(this.moduleCache.keys()),
    }
  }
}
