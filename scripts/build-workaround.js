#!/usr/bin/env node
/**
 * Workaround build script for TypeScript compiler bug
 * Uses esbuild to transpile TypeScript files when tsc fails with internal errors
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

async function buildProject() {
  console.log('🔨 Building with esbuild (TypeScript compiler workaround)...');

  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  try {
    // Find all TypeScript files (excluding declaration files)
    const entryPoints = glob.sync('src/**/*.ts', {
      ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts', '**/test/**']
    });

    // Build all files
    await build({
      entryPoints,
      outdir: 'dist',
      platform: 'node',
      target: 'node18',
      format: 'esm',
      sourcemap: true,
      keepNames: true,
      bundle: false,
      logLevel: 'info',
      loader: {
        '.ts': 'ts',
        '.js': 'js'
      }
    });

    console.log('✅ Build completed successfully with esbuild');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Run the build
buildProject();
