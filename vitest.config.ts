import { defineConfig } from 'vitest/config'

// Unit tests for framework-free server code (server/utils). Tests that need a
// running Nitro server will live separately once the contract suite exists.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
