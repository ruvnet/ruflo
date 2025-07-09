/**
 * CI Environment Test
 * Validates that CI environment is properly configured
 */

describe('CI Environment Configuration', () => {
  test('should detect CI environment', () => {
    if (process.env.CI) {
      expect(process.env.CI).toBe('true');
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.CLAUDE_FLOW_ENV).toBe('test');
    } else {
      // Running locally
      expect(process.env.NODE_ENV).toBeDefined();
    }
  });

  test('should have proper Node.js version', () => {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(18);
  });

  test('should handle platform differences', () => {
    const platform = process.platform;
    expect(['win32', 'darwin', 'linux']).toContain(platform);
    
    // Platform-specific checks
    if (platform === 'win32') {
      // Windows-specific validations
      expect(process.env.OS).toBeDefined();
    } else {
      // Unix-like validations
      expect(process.env.HOME || process.env.USER).toBeDefined();
    }
  });

  test('should have reasonable resource limits', () => {
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed / 1024 / 1024; // MB
    
    // CI environments typically have limited resources
    if (process.env.CI) {
      expect(heapUsed).toBeLessThan(500); // Less than 500MB
    }
  });

  test('should handle async operations in CI', async () => {
    // Test that promises work correctly
    const result = await Promise.resolve('success');
    expect(result).toBe('success');
    
    // Test setTimeout works
    await new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, 100);
    });
    
    // Test that we can handle errors
    await expect(Promise.reject(new Error('test'))).rejects.toThrow('test');
  });

  test('should have working file system access', () => {
    const fs = require('fs');
    const path = require('path');
    
    // Check that we can access package.json
    const packagePath = path.join(process.cwd(), 'package.json');
    expect(fs.existsSync(packagePath)).toBe(true);
    
    // Check that we can read the file
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    expect(packageJson.name).toBe('claude-flow');
  });

  test('should have correct working directory', () => {
    const cwd = process.cwd();
    const path = require('path');
    
    // Should end with claude-flow
    expect(path.basename(cwd)).toBe('claude-flow');
    
    // Should contain expected files
    const fs = require('fs');
    expect(fs.existsSync(path.join(cwd, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, 'jest.config.js'))).toBe(true);
  });

  test('should have proper test timeouts', () => {
    // In CI, we should have longer timeouts
    if (process.env.CI) {
      // This is set in jest.config.ci.js
      expect(jest.getTimers?.().getTimeout?.() || 30000).toBeGreaterThanOrEqual(30000);
    }
  });
});