/**
 * Debug Tab Component
 * Diagnostic tests for SSL, fetch, transpilation, and hook execution
 */

import React, { useState, useRef, useCallback } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import * as Babel from '@babel/standalone'
import { HookLoader, RNModuleLoader, transpileCode, type HookContext, ES6ImportHandler, buildPeerUrl } from '../../../shared/src'

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  testButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginVertical: 8,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  testButtonDisabled: {
    backgroundColor: '#ccc',
  },
  resultBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: 6,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  resultBoxError: {
    borderLeftColor: '#ff3b30',
    backgroundColor: '#fff5f5',
  },
  resultBoxSuccess: {
    borderLeftColor: '#34c759',
    backgroundColor: '#f5fff5',
  },
  resultText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  loadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: '#666',
  },
})

interface TestResult {
  status: 'pending' | 'success' | 'error'
  message: string
  details?: string
}

export default function DebugTab() {
  const [results, setResults] = useState<Record<string, TestResult>>({})
  const [loading, setLoading] = useState<string | null>(null)

  // Log when DebugTab renders
  React.useEffect(() => {
    console.log('[DebugTab] Rendered')
  }, [])

  const updateResult = (testName: string, result: TestResult) => {
    setResults(prev => ({ ...prev, [testName]: result }))
  }

  // Test 1: SSL/HTTPS Certificate Check
  const testSSL = useCallback(async () => {
    const testName = 'ssl'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Testing SSL/HTTPS...' })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch('https://node-dfw1.relaynet.online/', {
          method: 'HEAD',
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        updateResult(testName, {
          status: 'success',
          message: 'SSL certificate verified',
          details: `Status: ${response.status}, Headers: ${response.headers.get('content-type')}`,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e: any) {
      updateResult(testName, {
        status: 'error',
        message: 'SSL certificate check failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  // Test 2: Fetch with Timeout
  const testFetch = useCallback(async () => {
    const testName = 'fetch'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Testing fetch with timeout...' })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch('https://node-dfw1.relaynet.online/hooks/client/get-client.jsx', {
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const text = await response.text()
        updateResult(testName, {
          status: 'success',
          message: 'Fetch successful',
          details: `Status: ${response.status}, Content-Length: ${text.length} bytes`,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e: any) {
      updateResult(testName, {
        status: 'error',
        message: 'Fetch failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  // Test 3A: Local Hook Transpile (SWC)
  const testTranspileLocalHookSWC = useCallback(async () => {
    const testName = 'transpileLocalSWC'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Transpiling local hook with SWC...' })

    try {
      const localHookCode = `
        import React from 'react'
        export default function Test() {
          return <div>SWC Hello</div>
        }
      `

      console.log('[DebugTab][SWC] Starting transpile for local-hook.jsx')
      const output = await transpileCode(localHookCode, { filename: 'local-hook.jsx' })
      // Post-process to match RN executor expectations
      let patched = output
        // route dynamic import() to our injected __import__ shim
        .replace(/\bimport\(/g, '__import__(')
        // convert ESM exports to CommonJS
        .replace(/export\s+default\s+/g, 'module.exports.default = ')
        .replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')

      console.log('[DebugTab][SWC] Transpile complete', {
        inputLen: localHookCode.length,
        swcOutLen: output.length,
        patchedLen: patched.length,
        preview: String(patched).slice(0, 160),
      })
      updateResult(testName, {
        status: 'success',
        message: 'SWC transpilation successful',
        details: `SWC: ${output.length} bytes; Patched: ${patched.length} bytes`,
      })
    } catch (e: any) {
      console.log('[DebugTab][SWC] Transpile failed', {
        message: e?.message || String(e),
        stack: e?.stack,
      })
      updateResult(testName, {
        status: 'error',
        message: 'SWC transpilation failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  // Test 3B: Local Hook Transpile (Babel)
  const testTranspileLocalHookBabel = useCallback(async () => {
    const testName = 'transpileLocalBabel'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Transpiling local hook with Babel...' })

    try {
      const localHookCode = `
        import React from 'react'
        export default function Test() {
          return <div>Babel Hello</div>
        }
      `

      console.log('[DebugTab][Babel] Starting transpile for local-hook.jsx')
      const result = Babel.transform(localHookCode, {
        filename: 'local-hook.jsx',
        presets: ['react', ['env', { modules: 'commonjs' }]],
      }).code
      console.log('[DebugTab][Babel] Transpile complete', {
        inputLen: localHookCode.length,
        outLen: result?.length ?? 0,
        preview: String(result).slice(0, 160),
      })
      updateResult(testName, {
        status: 'success',
        message: 'Babel transpilation successful',
        details: `Output length: ${result?.length ?? 0} chars`,
      })
    } catch (e: any) {
      console.log('[DebugTab][Babel] Transpile failed', {
        message: e?.message || String(e),
        stack: e?.stack,
      })
      updateResult(testName, {
        status: 'error',
        message: 'Babel transpilation failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  // Test 4: Local Hook Execution (Bypasses fetch)
  const testLocalHook = useCallback(async () => {
    const testName = 'localHook'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Testing local hook execution...' })

    try {
      // Create a simple hook that doesn't depend on external resources
      const localHookCode = `
        export default async function getClient(context) {
          console.log('[DebugHook] Hook called')
          console.log('[DebugHook] Context keys:', Object.keys(context))
          
          // Just return some test data
          return {
            type: 'success',
            message: 'Local hook executed successfully!',
            timestamp: new Date().toISOString(),
          }
        }
      `

      // Create module loader
      const requireShim = (spec: string) => {
        if (spec === 'react') return require('react')
        return {}
      }

      const transpileWrapper = async (code: string, filename: string): Promise<string> => {
        let sanitized = code
          .replace(/ΓÇö/g, '--')
          .replace(/ΓÇ£/g, '"')
          .replace(/ΓÇ¥/g, '"')
          .replace(/ΓÇÖ/g, "'")

        let transpiled = Babel.transform(sanitized, {
          filename,
        }).code

        // Convert ES6 to CommonJS
        transpiled = transpiled.replace(/export\s+default\s+/g, 'module.exports.default = ')
        transpiled = transpiled.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')

        return transpiled
      }

      const moduleLoader = new RNModuleLoader({
        requireShim,
        host: 'localhost',
        transpiler: transpileWrapper,
        onDiagnostics: () => {},
      })

      const importHandler = new ES6ImportHandler({
        host: 'localhost',
        baseUrl: '/hooks',
        transpiler: transpileWrapper,
        onDiagnostics: () => {},
      })
      moduleLoader.setImportHandler(importHandler)

      // Create minimal hook context
      const context: HookContext = {
        React: require('react'),
        createElement: require('react').createElement,
        FileRenderer: () => null as any,
        params: {},
        helpers: {
          navigate: () => {},
          buildPeerUrl: (path: string) => `https://localhost${path}`,
          loadModule: async () => ({}),
          setBranch: () => {},
          buildRepoHeaders: () => ({}),
        },
      }

      // Execute the hook
      const mod = await moduleLoader.executeModule(localHookCode, '/hooks/client/test-local.jsx', context)
      const result = await mod.default(context)

      updateResult(testName, {
        status: 'success',
        message: 'Local hook executed successfully',
        details: JSON.stringify(result, null, 2),
      })
    } catch (e: any) {
      updateResult(testName, {
        status: 'error',
        message: 'Local hook execution failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  // Test 5: Remote Hook Fetch and Transpile (Full test)
  const testRemoteHook = useCallback(async () => {
    const testName = 'remoteHook'
    setLoading(testName)
    updateResult(testName, { status: 'pending', message: 'Fetching and transpiling remote hook...' })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      try {
        const response = await fetch('https://node-dfw1.relaynet.online/hooks/client/get-client.jsx', {
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Fetch failed: ${response.status}`)
        }

        let code = await response.text()

        // Sanitize encoding
        code = code
          .replace(/ΓÇö/g, '--')
          .replace(/ΓÇ£/g, '"')
          .replace(/ΓÇ¥/g, '"')
          .replace(/ΓÇÖ/g, "'")

        // Try transpilation
        let transpiled = await transpileCode(code, { filename: 'get-client.jsx' }, false)

        // Convert to CommonJS
        transpiled = transpiled.replace(/export\s+default\s+/g, 'module.exports.default = ')
        transpiled = transpiled.replace(/export\s+(const|let|var|function|class)\s+/g, '$1 ')

        updateResult(testName, {
          status: 'success',
          message: 'Remote hook fetch and transpile successful',
          details: `Fetched: ${code.length} bytes, Transpiled: ${transpiled.length} bytes`,
        })
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (e: any) {
      updateResult(testName, {
        status: 'error',
        message: 'Remote hook test failed',
        details: e?.message || String(e),
      })
    } finally {
      setLoading(null)
    }
  }, [])

  const TestResult = ({ testName, result }: { testName: string; result: TestResult }) => {
    const isSuccess = result.status === 'success'
    const isError = result.status === 'error'

    return (
      <View
        style={[
          styles.resultBox,
          isSuccess && styles.resultBoxSuccess,
          isError && styles.resultBoxError,
        ]}
      >
        <Text style={[styles.resultText, { fontWeight: 'bold', marginBottom: 4 }]}>
          {result.message}
        </Text>
        {result.details && (
          <Text style={styles.resultText}>{result.details}</Text>
        )}
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* SSL Test */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔒 SSL/HTTPS Test</Text>
        <Text style={styles.resultText}>
          Verify SSL certificate is trusted and HTTPS connection works
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'ssl' && styles.testButtonDisabled]}
          onPress={testSSL}
          disabled={loading === 'ssl'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'ssl' ? 'Testing...' : 'Test SSL Certificate'}
          </Text>
        </TouchableOpacity>
        {loading === 'ssl' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#007AFF" />
            <Text style={styles.loadingText}>Testing SSL...</Text>
          </View>
        )}
        {results.ssl && <TestResult testName="ssl" result={results.ssl} />}
      </View>

      {/* Fetch Test */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📡 Fetch Test</Text>
        <Text style={styles.resultText}>
          Test fetching the hook file with 5 second timeout
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'fetch' && styles.testButtonDisabled]}
          onPress={testFetch}
          disabled={loading === 'fetch'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'fetch' ? 'Testing...' : 'Test Fetch'}
          </Text>
        </TouchableOpacity>
        {loading === 'fetch' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#007AFF" />
            <Text style={styles.loadingText}>Fetching...</Text>
          </View>
        )}
        {results.fetch && <TestResult testName="fetch" result={results.fetch} />}
      </View>

      {/* Transpilation Tests (Local Hook) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⚙️ Transpilation Tests (Local Hook)</Text>
        <Text style={styles.resultText}>
          Compare SWC and Babel transpiling using a small local JSX hook.
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'transpileLocalSWC' && styles.testButtonDisabled]}
          onPress={testTranspileLocalHookSWC}
          disabled={loading === 'transpileLocalSWC'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'transpileLocalSWC' ? 'Transpiling...' : 'Transpile with SWC'}
          </Text>
        </TouchableOpacity>
        {results.transpileLocalSWC && (
          <TestResult testName="transpileLocalSWC" result={results.transpileLocalSWC} />
        )}

        <TouchableOpacity
          style={[styles.testButton, loading === 'transpileLocalBabel' && styles.testButtonDisabled]}
          onPress={testTranspileLocalHookBabel}
          disabled={loading === 'transpileLocalBabel'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'transpileLocalBabel' ? 'Transpiling...' : 'Transpile with Babel'}
          </Text>
        </TouchableOpacity>
        {results.transpileLocalBabel && (
          <TestResult testName="transpileLocalBabel" result={results.transpileLocalBabel} />
        )}
      </View>

      {/* Dynamic import() wrapper test */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🧩 Dynamic import() Wrapper</Text>
        <Text style={styles.resultText}>
          Validate that ES6 import() can be delegated to a custom loader (helpers.loadModule).
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'dynamicImport' && styles.testButtonDisabled]}
          onPress={async () => {
            const testName = 'dynamicImport'
            setLoading(testName)
            updateResult(testName, { status: 'pending', message: 'Testing dynamic import() delegation...' })
            let transpiled = ''  // Declare here so catch block can access it
            try {
              const requireShim = (spec: string) => (spec === 'react' ? require('react') : {})
              // Provide a transpiler that converts ESM to CJS and rewrites dynamic import()
              const transpileForTest = (code: string, filename: string): string => {
                // Use Babel already imported at component level
                const presets: any[] = [['env', { modules: 'commonjs' }]]
                const out = Babel.transform(code, { filename, presets }).code || code
                return out.replace(/\bimport\(/g, '__import__(')
              }

              const moduleLoader = new RNModuleLoader({ requireShim, host: 'localhost', transpiler: async (c: string, f: string) => transpileForTest(c, f) })
              const importHandler = new ES6ImportHandler({ host: 'localhost', baseUrl: '/hooks' })
              // Delegate import() to a fake helpers.loadModule to verify wiring
              importHandler.setLoadModuleDelegate(async (modulePath: string) => {
                if (modulePath.endsWith('dummy.mjs')) {
                  return { default: () => 'dummy-loaded', value: 42 }
                }
                throw new Error('Delegate received unexpected path: ' + modulePath)
              })
              moduleLoader.setImportHandler(importHandler)

              const code = `
                export default async function(ctx){
                  const mod = await import('./dummy.mjs')
                  return mod.default()
                }
              `
              console.log('[DebugTab][Import] Executing test module with dynamic import')
              const ctx: HookContext = {
                React: require('react'),
                createElement: require('react').createElement,
                FileRenderer: () => null as any,
                params: {},
                helpers: {
                  navigate: () => {},
                  buildPeerUrl: (p: string) => p,
                  loadModule: async () => ({}),
                  setBranch: () => {},
                  buildRepoHeaders: () => ({}),
                },
              }
              // Pre-transpile before execution to eliminate ESM export syntax
              transpiled = transpileForTest(code, '/hooks/client/test-dynamic.jsx')
              console.log('[DebugTab][Import] Transpiled code length:', transpiled.length)
              console.log('[DebugTab][Import] Transpiled code (first 500 chars):', transpiled.substring(0, 500))
              const mod = await moduleLoader.executeModule(transpiled, '/hooks/client/test-dynamic.jsx', ctx)
              const def = mod && (mod as any).default
              console.log('[DebugTab][Import] typeof default =', typeof def, 'keys:', Object.keys(mod || {}))
              console.log('[DebugTab][Import] mod.default direct access:', def)
              console.log('[DebugTab][Import] Full module object:', JSON.stringify(mod, null, 2))
              console.log('[DebugTab][Import] module.exports:', (mod as any).exports)
              console.log('[DebugTab][Import] Object.getOwnPropertyNames(mod):', Object.getOwnPropertyNames(mod || {}))
              console.log('[DebugTab][Import] module.exports.default:', (mod as any).exports?.default)
              
              if (typeof def !== 'function') {
                const detailedErr = `Default export is not a function (got ${typeof def}). 
Exports keys: ${Object.keys(mod || {}).join(',')}
Module.exports: ${JSON.stringify((mod as any).exports || {}, null, 2)}
Transpiled snippet: ${transpiled.substring(0, 300)}`
                throw new Error(detailedErr)
              }
              const res = await def(ctx)
              console.log('[DebugTab][Import] Dynamic import delegation success', { result: res })
              updateResult(testName, { 
                status: 'success', 
                message: 'Dynamic import delegated successfully', 
                details: `Result: ${String(res)}\nTranspiled length: ${transpiled.length}` 
              })
            } catch (e: any) {
              console.log('[DebugTab][Import] Dynamic import delegation failed', {
                message: e?.message || String(e),
                stack: e?.stack,
              })
              const detailedMsg = `${e?.message || String(e)}

Stack: ${e?.stack?.split('\n').slice(0, 5).join('\n') || 'N/A'}

Transpiled Code (first 1000 chars):
${transpiled?.substring(0, 1000) || 'N/A'}`
              updateResult('dynamicImport', { 
                status: 'error', 
                message: 'Dynamic import delegation failed', 
                details: detailedMsg 
              })
            } finally {
              setLoading(null)
            }
          }}
          disabled={loading === 'dynamicImport'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'dynamicImport' ? 'Running...' : 'Test dynamic import()'}
          </Text>
        </TouchableOpacity>
        {results.dynamicImport && (
          <TestResult testName="dynamicImport" result={results.dynamicImport} />
        )}
      </View>

      {/* Local Hook Test */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>✅ Local Hook Test</Text>
        <Text style={styles.resultText}>
          Execute a local hook (bypasses fetch) to test transpilation and module execution
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'localHook' && styles.testButtonDisabled]}
          onPress={testLocalHook}
          disabled={loading === 'localHook'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'localHook' ? 'Executing...' : 'Test Local Hook'}
          </Text>
        </TouchableOpacity>
        {loading === 'localHook' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#007AFF" />
            <Text style={styles.loadingText}>Executing hook...</Text>
          </View>
        )}
        {results.localHook && <TestResult testName="localHook" result={results.localHook} />}
      </View>

      {/* Remote Hook Test */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🌐 Remote Hook Test</Text>
        <Text style={styles.resultText}>
          Fetch, encode-fix, and transpile the actual hook file
        </Text>
        <TouchableOpacity
          style={[styles.testButton, loading === 'remoteHook' && styles.testButtonDisabled]}
          onPress={testRemoteHook}
          disabled={loading === 'remoteHook'}
        >
          <Text style={styles.testButtonText}>
            {loading === 'remoteHook' ? 'Testing...' : 'Test Remote Hook'}
          </Text>
        </TouchableOpacity>
        {loading === 'remoteHook' && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#007AFF" />
            <Text style={styles.loadingText}>Testing remote hook...</Text>
          </View>
        )}
        {results.remoteHook && <TestResult testName="remoteHook" result={results.remoteHook} />}
      </View>
    </ScrollView>
  )
}
