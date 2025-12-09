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
      return (
        <div className="p-8 bg-red-500/20 dark:bg-red-900/30 border border-red-400 dark:border-red-700 rounded-lg text-red-700 dark:text-red-300">
          <h3 className="mt-0">Render Error</h3>
          <p className="font-semibold">{message}</p>
          {stack && (
            <pre className="mt-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap opacity-80">{stack}</pre>
          )}
        </div>
      )
    }
    return this.props.children as any
  }
}

export default ErrorBoundary
