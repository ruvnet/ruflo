import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
// Run from repository root, against source rather than stale built packages.
export default defineConfig({
  resolve: { alias: { '@claude-flow/security': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: [
      'v3/@claude-flow/security/__tests__/agentic-policy-engine.test.ts',
      'v3/@claude-flow/security/__tests__/authority*.test.ts',
      'v3/@claude-flow/security/__tests__/product-plane.test.ts',
      'v3/@claude-flow/security/__tests__/mcp-caller-identity.test.ts',
      'v3/@claude-flow/cli/__tests__/authority*.test.ts',
    ],
  },
});
