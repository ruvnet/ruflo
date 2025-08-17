import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'examples/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData.ts',
        '**/*.test.ts',
        '**/*.spec.ts'
      ],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    setupFiles: ['./test-setup.ts']
  }
});