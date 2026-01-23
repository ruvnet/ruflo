import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    globals: true,
    // Performance tests need longer timeout
    testTimeout: 30000,
    // Coverage configuration
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/__tests__/**',
      ],
    },
    // Performance benchmarks
    benchmark: {
      include: ['__tests__/**/*.bench.ts'],
    },
  },
});
