/**
 * Basic smoke test to ensure test infrastructure works
 */

describe('Basic Test Suite', () => {
  test('should pass basic assertion', () => {
    expect(true).toBe(true);
  });

  test('should perform basic math', () => {
    expect(1 + 1).toBe(2);
  });

  test('should handle strings', () => {
    expect('claude-flow').toContain('claude');
  });

  test('should handle arrays', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });

  test('should handle objects', () => {
    const obj = { name: 'claude-flow', version: '2.0.0' };
    expect(obj).toHaveProperty('name');
    expect(obj.name).toBe('claude-flow');
  });
});

describe('Package Information', () => {
  test('should have valid package.json', () => {
    const pkg = require('../../package.json');
    expect(pkg).toBeDefined();
    expect(pkg.name).toBe('claude-flow');
    expect(pkg.version).toBeDefined();
  });

  test('should have required scripts', () => {
    const pkg = require('../../package.json');
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
    expect(pkg.scripts.build).toBeDefined();
  });
});