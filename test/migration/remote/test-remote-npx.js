#!/usr/bin/env node

/**
 * Remote NPX Execution Tests for Claude Flow Migration
 * Tests that 'npx claude-flow@latest' works correctly
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test configuration
const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-npx-test-' + Date.now());
const NPM_REGISTRY = process.env.NPM_REGISTRY || 'https://registry.npmjs.org';

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

// Test results tracker
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Run a test and track results
 */
function runTest(name, testFn) {
  console.log(`\n${colors.blue}Running: ${name}${colors.reset}`);
  
  try {
    testFn();
    console.log(`${colors.green}✓ PASSED${colors.reset}`);
    testResults.passed++;
    testResults.tests.push({ name, status: 'passed' });
  } catch (error) {
    console.log(`${colors.red}✗ FAILED${colors.reset}`);
    console.error(`  Error: ${error.message}`);
    testResults.failed++;
    testResults.tests.push({ name, status: 'failed', error: error.message });
  }
}

/**
 * Execute command with timeout
 */
function exec(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      cwd: TEST_DIR,
      timeout: 60000, // 60 second timeout for npx commands
      ...options 
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

/**
 * Check if package exists on npm
 */
async function checkNpmPackage() {
  try {
    const output = exec(`npm view claude-flow version`, { cwd: process.cwd() });
    return output.trim();
  } catch (error) {
    return null;
  }
}

// Setup test environment
console.log(`${colors.yellow}Setting up test environment...${colors.reset}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
process.chdir(TEST_DIR);

// Check if package is published
console.log(`${colors.yellow}Checking npm registry...${colors.reset}`);
const npmVersion = checkNpmPackage();
if (!npmVersion) {
  console.log(`${colors.yellow}Warning: claude-flow not found on npm registry${colors.reset}`);
  console.log('These tests require the package to be published');
}

// Test 1: NPX executes without install
runTest('NPX executes without install', () => {
  // This will use the local package in development
  const output = exec('npx claude-flow --version', { cwd: process.cwd() });
  if (!output.includes('claude-flow')) {
    throw new Error('NPX execution failed');
  }
});

// Test 2: NPX help command works
runTest('NPX help command works', () => {
  const output = exec('npx claude-flow --help', { cwd: process.cwd() });
  if (!output.includes('init') || !output.includes('start')) {
    throw new Error('Help output missing expected commands');
  }
});

// Test 3: NPX init creates files
runTest('NPX init creates files', () => {
  exec('npx claude-flow init -y');
  
  // Check files were created
  if (!fs.existsSync(path.join(TEST_DIR, 'CLAUDE.md'))) {
    throw new Error('CLAUDE.md not created');
  }
  if (!fs.existsSync(path.join(TEST_DIR, 'claude-flow'))) {
    throw new Error('claude-flow script not created');
  }
});

// Test 4: Cross-platform NPX execution
runTest('Cross-platform NPX execution', () => {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'npx.cmd' : 'npx';
  
  const output = exec(`${command} claude-flow --version`, { cwd: process.cwd() });
  if (!output.includes('claude-flow')) {
    throw new Error('Cross-platform NPX execution failed');
  }
});

// Test 5: NPX with specific version
runTest('NPX with specific version (if published)', () => {
  if (!npmVersion) {
    console.log('  Skipped: Package not published');
    return;
  }
  
  const output = exec(`npx claude-flow@${npmVersion} --version`);
  if (!output.includes(npmVersion)) {
    throw new Error('Specific version execution failed');
  }
});

// Test 6: NPX in subdirectory
runTest('NPX in subdirectory', () => {
  const subdir = path.join(TEST_DIR, 'subproject');
  fs.mkdirSync(subdir, { recursive: true });
  
  const output = exec('npx claude-flow --help', { cwd: subdir });
  if (!output.includes('init')) {
    throw new Error('NPX in subdirectory failed');
  }
});

// Test 7: NPX with environment variables
runTest('NPX with environment variables', () => {
  const output = exec('npx claude-flow config get github.token', {
    env: { ...process.env, GITHUB_TOKEN: 'test-npx-token' }
  });
  if (!output.includes('test-npx-token')) {
    throw new Error('Environment variables not passed to NPX');
  }
});

// Test 8: NPX cache behavior
runTest('NPX cache behavior', () => {
  // Run twice to test caching
  const start1 = Date.now();
  exec('npx claude-flow --version', { cwd: process.cwd() });
  const time1 = Date.now() - start1;
  
  const start2 = Date.now();
  exec('npx claude-flow --version', { cwd: process.cwd() });
  const time2 = Date.now() - start2;
  
  console.log(`  First run: ${time1}ms, Second run: ${time2}ms`);
  
  // Second run should be faster due to caching
  if (time2 > time1) {
    console.log('  Warning: Cache may not be working optimally');
  }
});

// Test 9: NPX with npm scripts
runTest('NPX with npm scripts', () => {
  const packageJson = {
    name: 'npx-test-project',
    version: '1.0.0',
    scripts: {
      'test-claude': 'npx claude-flow --version'
    }
  };
  
  fs.writeFileSync(
    path.join(TEST_DIR, 'package.json'), 
    JSON.stringify(packageJson, null, 2)
  );
  
  const output = exec('npm run test-claude');
  if (!output.includes('claude-flow')) {
    throw new Error('NPX in npm script failed');
  }
});

// Test 10: Global vs local precedence
runTest('Global vs local precedence', () => {
  // Create a local package.json with claude-flow
  const packageJson = {
    name: 'local-test',
    version: '1.0.0',
    devDependencies: {
      'claude-flow': 'file:' + path.resolve(__dirname, '../../..')
    }
  };
  
  fs.writeFileSync(
    path.join(TEST_DIR, 'package.json'), 
    JSON.stringify(packageJson, null, 2)
  );
  
  // NPX should prefer local version
  const output = exec('npx claude-flow --version');
  if (!output.includes('claude-flow')) {
    throw new Error('Local precedence test failed');
  }
});

// Cleanup
console.log(`\n${colors.yellow}Cleaning up test environment...${colors.reset}`);
fs.rmSync(TEST_DIR, { recursive: true, force: true });

// Summary
console.log(`\n${colors.blue}Test Summary:${colors.reset}`);
console.log(`${colors.green}Passed: ${testResults.passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${testResults.failed}${colors.reset}`);

// Write results
const resultsPath = path.join(__dirname, 'remote-npx-test-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
console.log(`\nResults saved to: ${resultsPath}`);

// Exit with appropriate code
process.exit(testResults.failed > 0 ? 1 : 0);