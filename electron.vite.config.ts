import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const PRODUCTION_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'"
const DEVELOPMENT_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: http://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'"

function devContentSecurityPolicy(): Plugin {
  return {
    name: 'dev-content-security-policy',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace(PRODUCTION_CSP, DEVELOPMENT_CSP)
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@renderer': resolve(__dirname, 'src/renderer') } }
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@renderer': resolve(__dirname, 'src/renderer') } },
    plugins: [react(), devContentSecurityPolicy()]
  }
})
