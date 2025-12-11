import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Serve /template folder as static assets
    middlewareMode: false,
  },
  optimizeDeps: {
    include: ['@swc/wasm-web', '@babel/standalone'],
  },
  build: {
    minify: false, // Keep bundles readable for debugging
    // Disable sourcemaps by default to keep Docker/CI builds memory-light.
    // Enable by setting VITE_SOURCEMAP=true when needed locally.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    rollupOptions: {
      external: ['@babel/standalone'],
    },
  },
  // Ensure React dev build can be selected for debug dist builds
  // Use VITE_NODE_ENV to force development mode when needed
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.VITE_NODE_ENV || process.env.NODE_ENV || 'production'),
  },
  // Configure server to serve template folder
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@relay/shared': path.resolve(__dirname, '../shared/src'),
      // Provide a shim alias for Babel-standalone so shared code can import a stable name
      '@babel-standalone-shim': '@babel/standalone',
    },
  },
})
