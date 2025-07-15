/**
 * Basic integration test to ensure test infrastructure works
 */

const { existsSync } = require('fs');
const { join } = require('path');

describe('Basic Integration Test Suite', () => {
  test('should verify project structure', () => {
    // Check key directories exist
    expect(existsSync('src')).toBe(true);
    expect(existsSync('tests')).toBe(true);
    expect(existsSync('package.json')).toBe(true);
  });

  test('should verify CLI entry points exist', () => {
    expect(existsSync('bin/claude-flow')).toBe(true);
    expect(existsSync('src/cli/simple-cli.js')).toBe(true);
  });

  test('should have valid configuration files', () => {
    expect(existsSync('jest.config.js')).toBe(true);
    expect(existsSync('tsconfig.json')).toBe(true);
  });

  test('should load without errors', () => {
    // This just ensures basic module loading works
    const pkg = require('../../package.json');
    expect(pkg.version).toBeDefined();
    expect(typeof pkg.version).toBe('string');
  });
});

describe('Environment Check', () => {
  test('should have required Node.js version', () => {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    expect(majorVersion).toBeGreaterThanOrEqual(20);
  });

  test('should have required environment', () => {
    expect(process.env).toBeDefined();
    expect(process.platform).toBeDefined();
  });
});