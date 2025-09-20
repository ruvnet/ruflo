/**
 * Vitest Configuration for AIME Testing Framework
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment configuration
    environment: 'node',
    
    // Global test configuration
    globals: true,
    
    // Test file patterns
    include: [
      'unit/**/*.test.js',
      'integration/**/*.test.js',
      'performance/**/*.test.js',
      'deployment/**/*.test.js'
    ],
    
    // Exclude patterns
    exclude: [
      'node_modules/**',
      'dist/**',
      '**/*.d.ts'
    ],
    
    // Timeout configuration
    testTimeout: 30000,        // 30 seconds for regular tests
    hookTimeout: 10000,        // 10 seconds for setup/teardown
    teardownTimeout: 10000,    // 10 seconds for cleanup
    
    // Retry configuration
    retry: {
      // Retry failed tests once in CI environments
      ci: 1,
      // No retries in local development
      local: 0
    },
    
    // Reporter configuration
    reporter: [
      'verbose',      // Detailed console output
      'json',         // JSON output for programmatic processing
      'html'          // HTML report generation
    ],
    
    // Output configuration
    outputFile: {
      json: './test-results/results.json',
      html: './test-results/report.html'
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './test-results/coverage',
      
      // Coverage thresholds
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      },
      
      // Include/exclude patterns
      include: [
        'src/aime/**/*.js'
      ],
      exclude: [
        'tests/**',
        'node_modules/**',
        '**/*.test.js',
        '**/*.spec.js'
      ]
    },
    
    // Setup files
    setupFiles: [
      './test-setup.js'
    ],
    
    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    
    // Parallelization
    maxConcurrency: 5,      // Limit concurrent test files
    minWorkers: 1,          // Minimum worker processes
    maxWorkers: '50%',      // Maximum worker processes (50% of CPU cores)
    
    // Watch mode configuration
    watch: false,           // Disable watch mode by default
    
    // Pool configuration for better isolation
    pool: 'threads',        // Use worker threads for better performance
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true
      }
    }
  },
  
  // Module resolution
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      '@aime': path.resolve(__dirname, '../../src/aime'),
      '@tests': path.resolve(__dirname)
    }
  },
  
  // Define global constants
  define: {
    __TEST_ENV__: true,
    __AIME_VERSION__: '"2.0.0"'
  },
  
  // ESBuild configuration for better performance
  esbuild: {
    target: 'node18'
  }
});