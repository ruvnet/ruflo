import { defineConfig } from 'vitest/config';

/**
 * The real-binary tier (ADR-504): the real `claude` binary against a scripted mock model. It needs the binary, so it
 * is excluded from the default `vitest run` (vitest.config.ts) and runs only through `npm run test:real-binary` and
 * the `mods-real-binary` CI job. Files run one after another: each test is a whole Claude Code process.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/real-binary/**/*.test.ts'],
    globals: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
