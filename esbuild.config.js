#!/usr/bin/env node

/**
 * ESBuild Configuration - Emergency Build System Fallback
 * Based on recommendation from GitHub issue #560
 * 
 * This provides a fast build alternative when TypeScript compiler fails
 * due to mixed module system issues during the Deno → Node.js migration
 */

import * as esbuild from 'esbuild';
import { glob } from 'glob';
import path from 'path';
import fs from 'fs';

const isProduction = process.env.NODE_ENV === 'production';

// Build configuration
const config = {
  entryPoints: [], // Will be populated by glob
  bundle: false, // Keep individual files for library distribution
  outdir: 'dist',
  format: 'esm',
  target: 'node20',
  platform: 'node',
  splitting: false, // Not needed for Node.js library
  sourcemap: true,
  minify: isProduction,
  keepNames: true,
  external: [
    // Mark all dependencies as external (don't bundle them)
    '@modelcontextprotocol/sdk',
    'blessed',
    'chalk',
    'cli-table3',
    'commander',
    'cors',
    'figlet',
    'fs-extra',
    'glob',
    'gradient-string',
    'helmet',
    'inquirer',
    'nanoid',
    'ora',
    'p-queue',
    'ruv-swarm',
    'ws',
    'yaml',
    // Optional dependencies
    'better-sqlite3',
    'diskusage',
    'node-pty',
    // Node.js built-ins
    'fs',
    'path',
    'crypto',
    'http',
    'https',
    'url',
    'util',
    'events',
    'stream',
    'child_process',
    'os',
    'readline',
  ],
  loader: {
    '.js': 'js',
    '.ts': 'ts',
    '.json': 'json',
  },
  tsconfig: './tsconfig.json',
  logLevel: 'info',
  plugins: [
    {
      name: 'module-resolver',
      setup(build) {
        // Handle mixed module patterns during build
        build.onLoad({ filter: /\.ts$/ }, async (args) => {
          const contents = await fs.promises.readFile(args.path, 'utf8');
          
          // Skip transformation for files that already have proper imports
          if (!contents.includes('require(') && !contents.includes('module.exports')) {
            return null; // Let esbuild handle normally
          }
          
          // Simple transformations for mixed module patterns
          let transformed = contents
            // Fix dynamic require patterns
            .replace(/require\(['"]fs['"]\)\.promises/g, "(await import('fs')).promises")
            .replace(/require\(['"]fs['"]\)\.statSync/g, "(await import('fs')).statSync")
            // Comment out problematic module.exports (already done by our script)
            .replace(/^(\s*)module\.exports\s*=.*$/gm, '$1// COMMENTED: $&');
          
          return {
            contents: transformed,
            loader: 'ts',
          };
        });
      },
    }
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
};

async function buildESM() {
  try {
    console.log('🔧 ESBuild - Finding TypeScript entry points...');
    
    // Find all TypeScript files
    const tsFiles = await glob('src/**/*.ts', {
      ignore: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
      ]
    });
    
    console.log(`📁 Found ${tsFiles.length} TypeScript files`);
    
    // Update config with entry points
    config.entryPoints = tsFiles;
    
    console.log('🚀 Starting ESBuild compilation...');
    const result = await esbuild.build(config);
    
    console.log('✅ ESBuild compilation completed successfully!');
    
    if (result.warnings?.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach(warning => {
        console.log(`  • ${warning.text}`);
      });
    }
    
    // Copy package.json type declarations
    await copyPackageJson();
    
    console.log('📦 ESM build complete in ./dist/');
    
  } catch (error) {
    console.error('❌ ESBuild failed:', error);
    process.exit(1);
  }
}

async function buildCJS() {
  try {
    console.log('🔧 ESBuild CJS - Building CommonJS version...');
    
    const tsFiles = await glob('src/**/*.ts', {
      ignore: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
      ]
    });
    
    const cjsConfig = {
      ...config,
      outdir: 'dist-cjs',
      format: 'cjs',
      entryPoints: tsFiles,
    };
    
    const result = await esbuild.build(cjsConfig);
    
    console.log('✅ ESBuild CJS compilation completed successfully!');
    console.log('📦 CJS build complete in ./dist-cjs/');
    
  } catch (error) {
    console.error('❌ ESBuild CJS failed:', error);
    process.exit(1);
  }
}

async function copyPackageJson() {
  // Copy and modify package.json for dist
  const pkg = JSON.parse(await fs.promises.readFile('package.json', 'utf8'));
  
  // Create minimal package.json for dist
  const distPkg = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: 'cli/main.js',
    type: 'module',
    engines: pkg.engines,
    dependencies: pkg.dependencies,
    optionalDependencies: pkg.optionalDependencies,
  };
  
  await fs.promises.writeFile(
    path.join('dist', 'package.json'),
    JSON.stringify(distPkg, null, 2)
  );
}

// CLI handling
const command = process.argv[2];

switch (command) {
  case 'esm':
    await buildESM();
    break;
  case 'cjs':
    await buildCJS();
    break;
  case 'both':
  case undefined:
    await buildESM();
    await buildCJS();
    break;
  default:
    console.log('Usage: node esbuild.config.js [esm|cjs|both]');
    process.exit(1);
}