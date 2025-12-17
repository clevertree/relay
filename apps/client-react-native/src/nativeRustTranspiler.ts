import NativeHookTranspiler from './specs/NativeHookTranspiler'

function getHookTranspilerModule() {
  return NativeHookTranspiler
}

export async function initNativeRustTranspiler(): Promise<void> {
  if ((globalThis as any).__hook_transpile_jsx) {
    return
  }

  const module = getHookTranspilerModule()
  if (!module || typeof module.transpile !== 'function') {
    console.warn('[nativeRustTranspiler] Native module not linked; transpiler will stay disabled until native bridge is available')
    return
  }

  if (typeof module.initialize === 'function') {
    try {
      await module.initialize()
    } catch (initErr) {
      console.warn('[nativeRustTranspiler] Native module initialization failed', initErr)
    }
  }

  const version = await (async () => {
    if (typeof module.getVersion === 'function') {
      try {
        return await module.getVersion()
      } catch (err) {
        console.warn('[nativeRustTranspiler] getVersion() failed, falling back to version field', err)
      }
    }
    return module.version || 'native'
  })()

  const transpileFn = async (code: string, filename: string): Promise<string> => {
    const resolvedFilename = filename || 'module.tsx'
    const result = await module.transpile(code, resolvedFilename)
    if (typeof result !== 'string') {
      throw new Error('Rust transpiler native module returned non-string output')
    }
    return result
  }

    ; (globalThis as any).__hook_transpiler_version = version
    ; (globalThis as any).__hook_transpile_jsx = transpileFn
  console.log('[nativeRustTranspiler] Native hook transpiler bridge ready:', version)
}
