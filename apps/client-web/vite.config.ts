import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Load environment variables from .env file
  envPrefix: 'VITE_',
  build: {
    // Output static assets for deployment
    outDir: 'dist',
    assetsDir: 'assets',
    // Generate source maps for debugging
    sourcemap: true,
    rollupOptions: {
      output: {
        // Ensure consistent chunk naming
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  // Server config for development
  server: {
    port: 3000,
    // Proxy API requests to the Relay server
    proxy: {
      '/api': {
        target: 'http://localhost:8088',
        changeOrigin: true,
      },
    },
  },
})
