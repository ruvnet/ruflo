/**
 * @claude-flow/embeddings Vitest Configuration
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10000,
    // Run in single thread to avoid memory issues
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
