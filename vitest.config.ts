import { defineConfig } from 'vitest/config'

// Unit tests for framework-free server code (server/utils).
// Contract tests that boot the built server live in vitest.contract.config.ts.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
})
