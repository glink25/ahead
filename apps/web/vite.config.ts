import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const packagesDir = path.resolve(rootDir, '../../packages')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@ahead/core': path.join(packagesDir, 'core/src'),
      '@ahead/editor': path.join(packagesDir, 'editor/src'),
      '@ahead/github': path.join(packagesDir, 'github/src'),
      '@ahead/recommendation': path.join(packagesDir, 'recommendation/src'),
      '@ahead/schema': path.join(packagesDir, 'schema/src'),
      '@ahead/ui': path.join(packagesDir, 'ui/src'),
    },
  },
  server: {
    port: 4455,
  },
})
