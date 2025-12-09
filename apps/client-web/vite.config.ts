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
  build: {
    minify: false, // Keep bundles readable for debugging
    // Disable sourcemaps by default to keep Docker/CI builds memory-light.
    // Enable by setting VITE_SOURCEMAP=true when needed locally.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    rollupOptions: {
      external: ['@babel/standalone'],
    },
  },
  // Configure server to serve template folder
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@relay/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
})
