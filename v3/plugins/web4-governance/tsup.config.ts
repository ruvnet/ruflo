import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/wasm/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  external: ['@claude-flow/cli'],
});
