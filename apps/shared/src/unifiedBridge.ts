import themedStylerBridge from './themedStylerBridge'

// Unified bridge that exposes both hook-transpiler transpile API and the themed-styler runtime bridge
const unifiedBridge = {
  // Transpile API: wraps global hook-transpiler function if present
  async transpile(code: string, filename?: string) {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    const fn = g.__hook_transpile_jsx
    if (typeof fn === 'function') {
      return await fn(code, filename || 'module.tsx')
    }
    throw new Error('hook-transpiler not initialized')
  },
  getTranspilerVersion() {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : {}
    return g.__hook_transpiler_version || null
  },

  // Themed-styler delegation
  registerUsage: themedStylerBridge.registerUsage,
  clearUsage: themedStylerBridge.clearUsage,
  getUsageSnapshot: themedStylerBridge.getUsageSnapshot,
  registerTheme: themedStylerBridge.registerTheme,
  setCurrentTheme: themedStylerBridge.setCurrentTheme,
  getThemes: themedStylerBridge.getThemes,
  getCssForWeb: themedStylerBridge.getCssForWeb,
  getRnStyles: themedStylerBridge.getRnStyles,
}

export default unifiedBridge
