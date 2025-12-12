import React from 'react'

type ErrorBoundaryState = { hasError: boolean; error?: any; info?: any }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, info: any) {
    // Store component stack for display
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || String(this.state.error)
      const stack = this.state.error?.stack || this.state.info?.componentStack || ''
      const version = (globalThis as any).__hook_transpiler_version || 'unknown'
      
      // Try to extract line number from error message or stack
      const lineMatch = message.match(/line (\d+)|:(\d+)/) || stack.match(/line (\d+)|:(\d+)/)
      const lineNum = lineMatch ? (lineMatch[1] || lineMatch[2]) : null
      
      return (
        <div className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300 max-w-4xl">
          <h3 className="mt-0 text-lg font-bold">Render Error</h3>
          <p className="font-semibold text-base">{message}</p>
          <p className="text-sm opacity-80">Hook Transpiler v{version}</p>
          
          {lineNum && (
            <div className="mt-2 text-sm bg-red-100 dark:bg-red-900 p-2 rounded">
              Error Location: Line {lineNum}
            </div>
          )}
          
          {stack && (
            <>
              <details className="mt-4">
                <summary className="cursor-pointer font-semibold text-sm hover:underline">
                  Stack Trace ({stack.split('\n').length} lines)
                </summary>
                <pre className="mt-2 text-xs max-h-96 overflow-auto whitespace-pre-wrap bg-red-900 bg-opacity-20 p-3 rounded font-mono">{stack}</pre>
              </details>
            </>
          )}
          
          <div className="mt-4 text-sm">
            <p className="font-semibold mb-2">Troubleshooting Tips:</p>
            <ul className="list-disc pl-5 space-y-1 opacity-90">
              <li>Check browser console (F12) for more detailed error information</li>
              <li>Look for JSX transpiler error messages with version info</li>
              <li>Verify JSX syntax in the source file is valid</li>
              <li>Check that arrow functions and expressions are properly formatted</li>
            </ul>
          </div>
        </div>
      )
    }
    return this.props.children as any
  }
}

export default ErrorBoundary
