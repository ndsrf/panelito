/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// When running from a worktree, node_modules lives in the main repo.
const MAIN_NODE_MODULES = '/home/jgm/dev/projects/web-projects/panelito/apps/web/node_modules'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, '.') },
      // Route bare module specifiers through the main project's node_modules
      {
        find: /^([^./].*)$/,
        replacement: path.join(MAIN_NODE_MODULES, '$1'),
      },
    ],
  },
})
