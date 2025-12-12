import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initHookTranspilerWasm } from './hookTranspilerWasm'
import ErrorBoundary from './components/ErrorBoundary'

async function bootstrap() {
  let initError: Error | undefined
  try {
    // Ensure the Rust hook-transpiler WASM is initialized before any runtime transpilation use
    await initHookTranspilerWasm()
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error))
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary initialError={initError}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

bootstrap()
