#!/usr/bin/env node

/**
 * Local Execution Tests for Claude Flow Migration
 * Tests all functionality works with pure Node.js/npm (no Deno)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Test configuration
const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-local-test-' + Date.now());
const CLAUDE_FLOW_BIN = path.resolve(__dirname, '../../../bin/claude-flow');

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
 * Execute command and return output
 */
function exec(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8', 
      cwd: TEST_DIR,
      ...options 
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

/**
 * Check if file exists
 */
function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}

/**
 * Check file contains content
 */
function assertFileContains(filePath, content) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  if (!fileContent.includes(content)) {
    throw new Error(`File ${filePath} does not contain: ${content}`);
  }
}

// Setup test environment
console.log(`${colors.yellow}Setting up test environment...${colors.reset}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
process.chdir(TEST_DIR);

// Test 1: CLI is executable without Deno
runTest('CLI is executable without Deno', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} --version`);
  if (!output.includes('claude-flow')) {
    throw new Error('Version output not found');
  }
});

// Test 2: Help command works
runTest('Help command works', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} --help`);
  if (!output.includes('init') || !output.includes('start')) {
    throw new Error('Help output missing expected commands');
  }
});

// Test 3: Init creates expected files
runTest('Init creates expected files', () => {
  exec(`node ${CLAUDE_FLOW_BIN} init -y`);
  
  // Check all expected files
  assertFileExists(path.join(TEST_DIR, 'CLAUDE.md'));
  assertFileExists(path.join(TEST_DIR, 'claude-flow'));
  assertFileExists(path.join(TEST_DIR, 'claude-flow.config.json'));
  
  // Check file contents
  assertFileContains(path.join(TEST_DIR, 'CLAUDE.md'), 'Claude Code Configuration');
  assertFileContains(path.join(TEST_DIR, 'claude-flow'), '#!/usr/bin/env node');
});

// Test 4: Config command works
runTest('Config command works', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} config list`);
  if (!output.includes('github') || !output.includes('swarm')) {
    throw new Error('Config list missing expected settings');
  }
});

// Test 5: GitHub integration functions
runTest('GitHub integration functions', () => {
  // Test without token (should show help)
  const output = exec(`node ${CLAUDE_FLOW_BIN} github --help`);
  if (!output.includes('setup') || !output.includes('issue')) {
    throw new Error('GitHub help missing expected commands');
  }
});

// Test 6: Swarm commands available
runTest('Swarm commands available', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} swarm --help`);
  if (!output.includes('init') || !output.includes('spawn')) {
    throw new Error('Swarm help missing expected commands');
  }
});

// Test 7: Task commands work
runTest('Task commands work', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} task --help`);
  if (!output.includes('create') || !output.includes('list')) {
    throw new Error('Task help missing expected commands');
  }
});

// Test 8: Memory commands work
runTest('Memory commands work', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} memory --help`);
  if (!output.includes('store') || !output.includes('list')) {
    throw new Error('Memory help missing expected commands');
  }
});

// Test 9: No Deno imports in generated files
runTest('No Deno imports in generated files', () => {
  const claudeFlowScript = fs.readFileSync(path.join(TEST_DIR, 'claude-flow'), 'utf8');
  if (claudeFlowScript.includes('deno') || claudeFlowScript.includes('Deno')) {
    throw new Error('Generated script contains Deno references');
  }
});

// Test 10: Cross-platform script execution
runTest('Cross-platform script execution', () => {
  const isWindows = process.platform === 'win32';
  const scriptPath = path.join(TEST_DIR, 'claude-flow');
  
  if (isWindows) {
    // Test Windows execution
    const output = exec(`node ${scriptPath} --version`);
    if (!output.includes('claude-flow')) {
      throw new Error('Windows script execution failed');
    }
  } else {
    // Test Unix execution
    fs.chmodSync(scriptPath, '755');
    const output = exec(`${scriptPath} --version`);
    if (!output.includes('claude-flow')) {
      throw new Error('Unix script execution failed');
    }
  }
});

// Test 11: Environment variable handling
runTest('Environment variable handling', () => {
  const output = exec(`node ${CLAUDE_FLOW_BIN} config get github.token`, {
    env: { ...process.env, GITHUB_TOKEN: 'test-token-123' }
  });
  if (!output.includes('test-token-123')) {
    throw new Error('Environment variable not properly read');
  }
});

// Test 12: Package.json scripts work
runTest('Package.json scripts generation', () => {
  // Create a test package.json
  const packageJson = {
    name: 'test-project',
    version: '1.0.0',
    scripts: {}
  };
  fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify(packageJson, null, 2));
  
  // Run init again to update package.json
  exec(`node ${CLAUDE_FLOW_BIN} init -y`);
  
  // Check scripts were added
  const updatedPackage = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'package.json'), 'utf8'));
  if (!updatedPackage.scripts['claude-flow']) {
    throw new Error('Claude Flow scripts not added to package.json');
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
const resultsPath = path.join(__dirname, 'local-test-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
console.log(`\nResults saved to: ${resultsPath}`);

// Exit with appropriate code
process.exit(testResults.failed > 0 ? 1 : 0);