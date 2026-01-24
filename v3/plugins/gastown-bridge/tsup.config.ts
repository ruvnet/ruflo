/**
 * tsup Configuration for Gas Town Bridge Plugin
 *
 * Ultra-optimized bundle configuration targeting:
 * - Total bundle: <100KB (gzipped)
 * - WASM modules: <50KB each
 * - Core JS: <30KB
 *
 * Features:
 * - Code splitting for lazy loading
 * - External WASM modules (loaded on demand)
 * - Tree shaking with sideEffects: false
 * - Minification with esbuild
 * - Source maps for debugging
 */

import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json
const pkg = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8')
);

const banner = `/**
 * @claude-flow/plugin-gastown-bridge v${pkg.version}
 *
 * WASM-accelerated Gas Town orchestration for Claude Flow V3
 * Bundle optimized: <100KB gzipped total
 *
 * @license MIT
 * @copyright 2024 rUv
 */`;

export default defineConfig([
  // Main entry points - dual format (ESM + CJS)
  {
    entry: {
      index: 'src/index.ts',
      bridges: 'src/bridges/index.ts',
      // These will be code-split if they exist
      // formula: 'src/formula/index.ts',
      // convoy: 'src/convoy/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: true,
    treeshake: {
      preset: 'recommended',
      moduleSideEffects: false,
    },
    minify: true,
    clean: true,
    sourcemap: true,
    target: 'node20',
    platform: 'node',
    banner: {
      js: banner,
    },
    external: [
      // Peer dependencies - not bundled
      '@claude-flow/memory',
      // WASM modules - loaded dynamically
      'gastown-formula-wasm',
      'ruvector-gnn-wasm',
      // Node built-ins
      'child_process',
      'util',
      'fs',
      'path',
      'events',
    ],
    esbuildOptions(options) {
      // Additional esbuild optimizations
      options.legalComments = 'none';
      options.charset = 'utf8';
      options.treeShaking = true;
      options.ignoreAnnotations = false;

      // Pure function annotations for better tree shaking
      options.pure = [
        'console.log',
        'console.debug',
        'console.info',
      ];

      // Metafile for bundle analysis
      options.metafile = true;
    },
    async onSuccess() {
      // Log bundle sizes after build
      console.log('\n[tsup] Bundle built successfully!');
      console.log('[tsup] Run "npm run size" to check bundle budget');
    },
  },

  // WASM loader - ESM only (browser/edge compatible)
  {
    entry: {
      'wasm-loader': 'src/wasm/loader.ts',
    },
    format: ['esm'],
    dts: true,
    minify: true,
    treeshake: true,
    sourcemap: true,
    target: ['node20', 'chrome100', 'firefox100', 'safari15'],
    platform: 'neutral',
    banner: {
      js: banner,
    },
    external: [
      // WASM files loaded at runtime
      '*.wasm',
      '*.wasm.gz',
    ],
    noExternal: [],
    esbuildOptions(options) {
      options.legalComments = 'none';
      options.treeShaking = true;
    },
  },
]);
