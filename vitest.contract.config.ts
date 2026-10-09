import { defineConfig } from 'vitest/config'

// Black-box contract tests: boot .output/server/index.mjs against fixture content.
// Requires a prior `npm run build`.
export default defineConfig({
  test: {
    include: ['test/contract/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
