import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

// Scripts may only come from our own origin. 'wasm-unsafe-eval' lets hash-wasm compile its Argon2id module; it
// does not allow eval() or inline scripts. Keep in sync with the header in nginx.conf.
const CONTENT_SECURITY_POLICY = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'"

// The meta tag goes in at build time only: Vite's dev server injects an inline script (React fast refresh) that
// this policy would block.
function cspMetaTag(): Plugin {
  return {
    name: 'atpass-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspMetaTag()],
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
