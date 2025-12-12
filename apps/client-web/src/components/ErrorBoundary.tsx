import React from 'react'

type ErrorBoundaryProps = {
  children: React.ReactNode
  initialError?: Error
}

type ErrorBoundaryState = { hasError: boolean; error?: any; info?: any }

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = props.initialError
      ? { hasError: true, error: props.initialError }
      : { hasError: false }
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, info: any) {
    // Store component stack for display
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.props.initialError && this.props.initialError !== prevProps.initialError) {
      this.setState({ hasError: true, error: this.props.initialError })
    }
  }

  render() {
    if (this.state.hasError) {
      const error = this.state.error ?? this.props.initialError
      const message = error?.message || String(error)
      const stack = error?.stack || this.state.info?.componentStack || ''
      const version = (globalThis as any).__hook_transpiler_version || 'unknown'
      const title = this.props.initialError
        ? 'Hook transpiler failed to initialize'
        : 'Render Error'
      const severityHint = this.props.initialError
        ? 'The async WASM loader failed before render was attempted. JSX transpilation will be unavailable until the issue is resolved.'
        : 'An error occurred while rendering the component tree.'

      // Try to extract line number from error message or stack
      const lineMatch = message.match(/line (\d+)|:(\d+)/) || stack.match(/line (\d+)|:(\d+)/)
      const lineNum = lineMatch ? (lineMatch[1] || lineMatch[2]) : null

      return (
        <div className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300 max-w-4xl">
          <h3 className="mt-0 text-lg font-bold">{title}</h3>
          <p className="font-semibold text-base">{message}</p>
          <p className="text-sm leading-relaxed opacity-80">{severityHint}</p>
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
                <pre className="mt-2 text-xs max-h-96 overflow-auto whitespace-pre-wrap bg-red-900 bg-opacity-20 p-3 rounded font-mono">
                  {stack}
                </pre>
              </details>
            </>
          )}

          <div className="mt-4 text-sm">
            <p className="font-semibold mb-2">Troubleshooting Tips:</p>
            <ul className="list-disc pl-5 space-y-1 opacity-90">
              <li>Check the browser console for initialization stack traces and wasm fetch timings</li>
              <li>Verify the hook-transpiler wasm bundle is present and up-to-date</li>
              <li>Ensure your JSX entry file is syntactically valid and references the correct hooks</li>
              <li>Restart the dev server to rehydrate the wasm loader if assets have changed</li>
            </ul>
          </div>
        </div>
      )
    }
    return this.props.children as any
  }
}

export default ErrorBoundary
