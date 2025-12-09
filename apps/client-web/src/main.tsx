import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { preloadSwc } from './swcBridge'

// Ensure SWC wasm is initialized before any runtime transpilation use
await preloadSwc()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
