import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initHookTranspilerWasm } from './hookTranspilerWasm'

// Ensure the Rust hook-transpiler WASM is initialized before any runtime transpilation use
await initHookTranspilerWasm()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
