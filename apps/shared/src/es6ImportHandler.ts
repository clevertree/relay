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
  private baseUrl: string
  private onDiagnostics: (diag: any) => void
  private transpiler: (code: string, filename: string) => Promise<string>

  constructor(options: ImportHandlerOptions) {
    this.host = options.host
    this.baseUrl = options.baseUrl || '/hooks'
    this.onDiagnostics = options.onDiagnostics || ((diag: any) => {
      console.debug('[ES6ImportHandler] Diagnostics:', diag)
    })
    this.transpiler = options.transpiler || this.defaultTranspiler
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

    // Fetch and transpile module
    const promise = this.loadAndTranspile(modulePath, normalizedPath, cacheKey)
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
      const moduleUrl = `http://${this.host}${normalizedPath}`
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
try {
  ${code}
} catch (err) {
  console.error('[ES6ImportHandler.executeModule] Code execution error in ${filename}:', err.message || err);
  throw err;
}
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
    // Handle relative imports
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      // For now, assume relative to /hooks/
      // TODO: Track current module path and resolve relative to it
      const cleaned = modulePath.replace(/^\.\//g, '')
      const resolved = `/hooks/${cleaned}`
      console.debug('[ES6ImportHandler] Resolved relative path:', { modulePath, resolved })
      return resolved
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
