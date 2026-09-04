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
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: fileURLToPath(new URL('./src/background.ts', import.meta.url)),
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
      },
      output: {
        // manifest.json hardcodes "background.js" — everything else can keep
        // Vite's normal hashed asset names since only popup.html refers to them.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
