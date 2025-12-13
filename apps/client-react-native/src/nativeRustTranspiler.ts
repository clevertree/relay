import { NativeModules } from 'react-native'

type RustTranspilerModule = {
  transpile: (code: string, filename: string) => Promise<string>
  initialize?: () => Promise<void>
  getVersion?: () => Promise<string>
  version?: string
}

const { RustTranspiler } = NativeModules as { RustTranspiler?: RustTranspilerModule }

export async function initNativeRustTranspiler(): Promise<void> {
  if ((globalThis as any).__hook_transpile_jsx) {
    return
  }

  if (!RustTranspiler || typeof RustTranspiler.transpile !== 'function') {
    console.warn('[nativeRustTranspiler] Native module not linked; transpiler will stay disabled until native bridge is available')
    return
  }

  if (typeof RustTranspiler.initialize === 'function') {
    try {
      await RustTranspiler.initialize()
    } catch (initErr) {
      console.warn('[nativeRustTranspiler] Native module initialization failed', initErr)
    }
  }

  const version = await (async () => {
    if (typeof RustTranspiler.getVersion === 'function') {
      try {
        return await RustTranspiler.getVersion()
      } catch (err) {
        console.warn('[nativeRustTranspiler] getVersion() failed, falling back to version field', err)
      }
    }
    return RustTranspiler.version || 'native'
  })()

  const transpileFn = async (code: string, filename: string): Promise<string> => {
    const resolvedFilename = filename || 'module.tsx'
    const result = await RustTranspiler.transpile(code, resolvedFilename)
    if (typeof result !== 'string') {
      throw new Error('Rust transpiler native module returned non-string output')
    }
    return result
  }

  ;(globalThis as any).__hook_transpiler_version = version
  ;(globalThis as any).__hook_transpile_jsx = transpileFn
  console.log('[nativeRustTranspiler] Native hook transpiler bridge ready:', version)
}
