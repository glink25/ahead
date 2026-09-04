import { offlinePlugin } from './offline-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const packagesDir = path.resolve(rootDir, '../../packages')

export default defineConfig({
  plugins: [react(), tailwindcss(), offlinePlugin()],
  resolve: {
    alias: {
      '@ahead/sync': path.join(packagesDir, 'sync/src'),
      '@ahead/core': path.join(packagesDir, 'core/src'),
      '@ahead/editor': path.join(packagesDir, 'editor/src'),
      '@ahead/github': path.join(packagesDir, 'github/src'),
      '@ahead/market': path.join(packagesDir, 'market/src'),
      '@ahead/protocol': path.join(packagesDir, 'protocol/src'),
      '@ahead/recommendation': path.join(packagesDir, 'recommendation/src'),
      '@ahead/resolver': path.join(packagesDir, 'resolver/src'),
      '@ahead/schema': path.join(packagesDir, 'schema/src'),
      '@ahead/ui': path.join(packagesDir, 'ui/src'),
    },
  },
  server: {
    port: 4455,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            if (/\/(react|react-dom|react-router|scheduler)\//u.test(id)) return 'react-vendor'
            if (id.includes('/@octokit/')) return 'github-vendor'
            if (/\/(ajv|ajv-formats|yaml)\//u.test(id)) return 'protocol-vendor'
          }
        },
      },
    },
  },
})
