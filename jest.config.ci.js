// CI-specific Jest configuration
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/tests/**/*.spec.js',
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.spec.ts'
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      isolatedModules: true,
      tsconfig: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'node',
        allowSyntheticDefaultImports: true,
        esModuleInterop: true
      }
    }]
  },
  moduleFileExtensions: ['js', 'ts', 'json'],
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/bin/',
    '<rootDir>/node_modules/',
    '<rootDir>/coverage/',
    '<rootDir>/tmp/',
    '<rootDir>/.claude/'
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(es-module-needs-transform)/)'
  ],
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{js,ts}',
    '!src/**/*.spec.{js,ts}',
    '!src/types/**/*'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  
  // CI-specific settings
  testTimeout: 30000, // 30 seconds for CI
  verbose: false, // Less verbose in CI
  silent: true, // Suppress console output in CI
  maxWorkers: 2, // Limit parallel execution in CI
  forceExit: true, // Force exit after tests
  detectOpenHandles: false, // Disable in CI to avoid hanging
  bail: 1, // Stop on first test failure
  
  // Relaxed coverage thresholds for CI
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 50,
      lines: 50,
      statements: 50
    }
  },
  
  testPathIgnorePatterns: [
    'node_modules/',
    'dist/',
    'bin/',
    'examples/',
    'benchmark/',
    'docs/',
    'infrastructure/',
    'archive/',
    'coverage/',
    '.claude/',
    'tmp/'
  ],
  
  // CI reporters - simplified for dependency compatibility
  reporters: [
    'default'
  ],
  
  globalSetup: undefined,
  globalTeardown: undefined,
  testEnvironmentOptions: {
    url: 'http://localhost'
  },
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@std/(.*)$': '<rootDir>/tests/mocks/std/$1'
  }
};