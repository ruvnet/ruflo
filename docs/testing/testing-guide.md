# Claude Flow v2.0.0 - Test Suite Documentation

## Overview

This document provides comprehensive information about the test suite for Claude Flow v2.0.0, including how to run tests, test coverage, and testing patterns.

## Test Structure

```
src/
├── __tests__/
│   ├── unit/                    # Unit tests
│   │   └── performance.test.js  # Performance benchmarks
│   ├── integration/             # Integration tests
│   │   └── cli-integration.test.js
│   └── utils/
│       └── test-helpers.js      # Test utilities and mocks
├── cli/
│   ├── __tests__/              # CLI component tests
│   │   ├── simple-cli.test.js
│   │   ├── command-registry.test.js
│   │   └── utils.test.js
│   └── simple-commands/
│       └── __tests__/          # Command-specific tests
│           ├── agent.test.js
│           ├── memory.test.js
│           ├── swarm.test.js
│           └── task.test.js
```

## Available Test Scripts

### Basic Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test suites
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:cli           # CLI tests only
```

### Coverage Testing
```bash
# Generate coverage report
npm run test:coverage

# Unit test coverage only
npm run test:coverage:unit

# CI-optimized test run
npm run test:ci
```

### Specialized Testing
```bash
# Performance benchmarks
npm run test:performance

# Debug mode with Node inspector
npm run test:debug

# Deno compatibility tests
npm run test:deno
```

## Test Categories

### 1. Unit Tests
- **Location**: `src/__tests__/unit/`
- **Purpose**: Test individual functions and utilities
- **Coverage**: Core utilities, helpers, formatters
- **Example**: `performance.test.js` - Tests for utility functions performance

### 2. CLI Tests  
- **Location**: `src/cli/__tests__/`
- **Purpose**: Test CLI interfaces and command parsing
- **Coverage**: Command line interface, argument parsing, help systems
- **Example**: `simple-cli.test.js` - Tests main CLI entry point

### 3. Command Tests
- **Location**: `src/cli/simple-commands/__tests__/`
- **Purpose**: Test individual CLI commands
- **Coverage**: Agent management, memory operations, swarm coordination, task management
- **Examples**: 
  - `agent.test.js` - Agent spawn, status, management
  - `memory.test.js` - Memory storage, retrieval, search
  - `swarm.test.js` - Swarm initialization, coordination
  - `task.test.js` - Task creation, assignment, tracking

### 4. Integration Tests
- **Location**: `src/__tests__/integration/`
- **Purpose**: Test end-to-end workflows
- **Coverage**: CLI initialization, command sequences, file operations
- **Example**: `cli-integration.test.js` - Full CLI workflow testing

### 5. Performance Tests
- **Location**: `src/__tests__/unit/performance.test.js`
- **Purpose**: Benchmark critical operations
- **Coverage**: Command execution speed, memory usage, large dataset handling
- **Benchmarks**:
  - CLI startup time: < 100ms
  - Memory operations: < 1000ms for 10k entries
  - Swarm initialization: < 200ms

## Test Configuration

### Jest Configuration
- **File**: `jest.config.js`
- **Environment**: Node.js with ES module support
- **Timeout**: 30 seconds per test
- **Setup**: `jest.setup.js` for global test configuration

### Key Settings
```javascript
{
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.ts', '**/__tests__/**/*.js'],
  collectCoverageFrom: ['src/**/*.{ts,js}'],
  coverageThresholds: {
    global: {
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80
    }
  }
}
```

## Test Utilities

### Test Helpers (`src/__tests__/utils/test-helpers.js`)

**Mock Creation:**
```javascript
import { createMockSwarmData, createMockAgent, mockConsole } from './test-helpers.js';

const mockSwarm = createMockSwarmData({ status: 'active' });
const mockAgent = createMockAgent({ type: 'researcher' });
const { mocks, restore } = mockConsole();
```

**Temporary Directories:**
```javascript
import { createTempDir, cleanupTempDir } from './test-helpers.js';

const tempDir = await createTempDir();
// ... test operations
await cleanupTempDir(tempDir);
```

**Test Environment:**
```javascript
import { createTestEnvironment } from './test-helpers.js';

const { setup, cleanup } = createTestEnvironment();
const { tempDir, consoleMocks, fsMocks } = await setup();
// ... tests
await cleanup();
```

## Mocking Strategy

### File System Operations
```javascript
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(),
  readJson: jest.fn(),
  writeJson: jest.fn(),
  ensureDir: jest.fn(),
  remove: jest.fn()
}));
```

### External Dependencies
```javascript
jest.mock('ora', () => () => ({
  start: jest.fn().mockReturnThis(),
  succeed: jest.fn().mockReturnThis(),
  fail: jest.fn().mockReturnThis()
}));

jest.mock('chalk', () => ({
  blue: jest.fn(str => str),
  green: jest.fn(str => str),
  red: jest.fn(str => str)
}));
```

### Process Operations
```javascript
jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockSpawnProcess()),
  exec: jest.fn((cmd, callback) => callback(null, '', ''))
}));
```

## Coverage Requirements

### Minimum Thresholds
- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 75%
- **Statements**: 80%

### Coverage Reports
```bash
npm run test:coverage
```

**Generated Reports:**
- `coverage/lcov.info` - LCOV format for CI tools
- `coverage/html/index.html` - HTML report for browser viewing
- Terminal output with summary

## CI/CD Integration

### GitHub Actions
**File**: `.github/workflows/test.yml`

**Test Matrix:**
- Node.js versions: 18.x, 20.x, 21.x
- Operating systems: Ubuntu, Windows, macOS
- Test types: Unit, Integration, Performance, E2E

**Workflow Steps:**
1. Setup environment
2. Install dependencies  
3. Run linting and type checking
4. Execute test suites
5. Generate coverage reports
6. Upload artifacts

### Performance Benchmarks
- **CLI startup**: Must complete in < 100ms
- **Memory operations**: < 1s for 10k entries  
- **Memory usage**: < 100MB increase during tests
- **Swarm coordination**: < 200ms initialization

## Writing New Tests

### Test File Naming
- Unit tests: `*.test.js` in `__tests__` directories
- Integration tests: `*-integration.test.js`
- Performance tests: `*-performance.test.js`

### Test Structure Template
```javascript
/**
 * Tests for [component-name]
 */

import { jest } from '@jest/globals';
import { functionToTest } from '../component.js';

describe('Component Name', () => {
  let consoleMocks;

  beforeEach(() => {
    consoleMocks = mockConsole();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleMocks.restore();
  });

  describe('specific functionality', () => {
    test('should behave correctly', () => {
      // Arrange
      const input = 'test input';
      
      // Act
      const result = functionToTest(input);
      
      // Assert
      expect(result).toBeDefined();
    });
  });
});
```

### Async Test Patterns
```javascript
test('should handle async operations', async () => {
  const mockData = { test: 'data' };
  fs.readJson.mockResolvedValue(mockData);

  const result = await asyncFunction();
  
  expect(result).toEqual(mockData);
  expect(fs.readJson).toHaveBeenCalled();
});
```

### Error Handling Tests
```javascript
test('should handle errors gracefully', async () => {
  fs.readJson.mockRejectedValue(new Error('File not found'));

  await expect(functionThatReads()).rejects.toThrow('File not found');
});
```

## Debugging Tests

### Debug Mode
```bash
npm run test:debug -- --testNamePattern="specific test"
```

### Verbose Output
```bash
SHOW_CONSOLE=true npm test -- --verbose
```

### Single Test Execution
```bash
npm test -- --testPathPattern="utils.test.js" --testNamePattern="parseFlags"
```

## Common Issues and Solutions

### ES Module Import Errors
**Problem**: `SyntaxError: The requested module does not provide an export`
**Solution**: Check export names match imports exactly

### Mock Configuration
**Problem**: Mocks not applying correctly
**Solution**: Ensure mocks are set up before imports

### Timeout Issues
**Problem**: Tests timing out
**Solution**: Increase timeout or optimize async operations

### Coverage Gaps
**Problem**: Low test coverage
**Solution**: Add tests for uncovered branches and functions

## Test Data Management

### Test Fixtures
- Store test data in `__fixtures__` directories
- Use factory functions for generating test data
- Keep test data minimal and focused

### Environment Variables
```bash
# Test environment flags
CLAUDE_FLOW_ENV=test
NODE_ENV=test
SHOW_CONSOLE=true  # Show console output during tests
JEST_VERBOSE=true  # Verbose Jest output
```

## Performance Monitoring

### Benchmark Tracking
- Track performance regression with each release
- Monitor memory usage during test execution
- Validate CLI startup time requirements

### Test Performance
- Keep individual tests under 1 second
- Use appropriate mocking to avoid slow operations
- Profile tests that exceed time limits

## Contributing to Tests

### Before Submitting
1. Run full test suite: `npm test`
2. Check coverage: `npm run test:coverage`
3. Run performance tests: `npm run test:performance`
4. Verify CI compatibility: `npm run test:ci`

### Test Requirements
- All new features must have tests
- Bug fixes must include regression tests
- Tests must pass on all supported Node.js versions
- Coverage must not decrease below thresholds

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ES Modules in Jest](https://jestjs.io/docs/ecmascript-modules)
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [GitHub Actions Testing](https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs)

---

**Last Updated**: July 2025  
**Test Suite Version**: 2.0.0  
**Maintainer**: Claude Flow Test Engineering Team