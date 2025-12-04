import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve /template folder as static assets
    middlewareMode: false,
    middlewares: [],
  },
  // Configure server to serve template folder
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
