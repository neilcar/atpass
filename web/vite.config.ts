import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('../src/core', import.meta.url)),
    },
  },
  server: {
    fs: {
      // core/ lives one level up, outside this package's root.
      allow: ['..'],
    },
  },
})
