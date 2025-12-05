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
  toCommonJs: boolean = false
): Promise<string> {
  try {
    // @ts-ignore - @babel/standalone doesn't have type definitions
    const BabelNs: any = await import('@babel/standalone')
    const Babel: any = (BabelNs && (BabelNs as any).default) ? (BabelNs as any).default : BabelNs

    const presets: any[] = []
    const plugins: any[] = []

    // TypeScript support
    const TS_PRESET = Babel.availablePresets?.typescript || Babel.presets?.typescript || 'typescript'
    if (TS_PRESET) {
      presets.push([
        TS_PRESET,
        options.hasJsxPragma ? { jsxPragma: 'h', jsxPragmaFrag: 'React.Fragment' } : {},
      ])
    }

    // React JSX support - use classic runtime for consistency
    const REACT_PRESET = Babel.availablePresets?.react || Babel.presets?.react || 'react'
    if (REACT_PRESET) {
      const runtimeOpts = options.hasJsxPragma
        ? { runtime: 'classic', pragma: 'h', pragmaFrag: 'React.Fragment', development: options.development ?? true }
        : { runtime: 'classic', pragma: '_jsx_', pragmaFrag: '_jsxFrag_', development: options.development ?? true }
      presets.push([REACT_PRESET, runtimeOpts])
    }

    // CommonJS transformation (for React Native eval)
    if (toCommonJs) {
      const CJS_PLUGIN =
        Babel.availablePlugins?.['transform-modules-commonjs'] ||
        Babel.availablePlugins?.['commonjs'] ||
        'transform-modules-commonjs'
      if (CJS_PLUGIN) {
        plugins.push([CJS_PLUGIN, {}])
      }
    }

    const result = Babel.transform(code, {
      filename: options.filename,
      presets,
      plugins,
      sourceMaps: 'inline',
      retainLines: true,
    })

    return result.code as string
  } catch (err) {
    console.error('[transpileCode] Babel transform failed:', err)
    throw err
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
    fromPath: string = '/hooks/get-client.jsx',
    context: HookContext
  ): Promise<any> {
    // Resolve path
    let normalizedPath = modulePath
    if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
      const baseDir = fromPath.split('/').slice(0, -1).join('/') || '/hooks'
      normalizedPath = `${baseDir}/${modulePath}`.replace(/\/\.\//g, '/').replace(/\/[^/]+\/\.\.\//g, '/')
    } else if (!modulePath.startsWith('/')) {
      normalizedPath = `/hooks/${modulePath}`
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
        throw new Error(`Failed to fetch module: ${response.status} ${response.statusText}`)
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
          console.warn('[HookLoader.loadModule] Transpilation failed, trying raw:', err)
        }
      }

      // Execute and cache
      const mod = await this.moduleLoader.executeModule(finalCode, normalizedPath, context)
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
        throw new Error(`Failed to fetch hook: ${response.status} ${response.statusText}`)
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
