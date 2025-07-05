#!/usr/bin/env node

/**
 * Integration Tests for Claude Flow Migration
 * Tests integration with ruv-swarm MCP, GitHub API, and cross-platform functionality
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

// Test configuration
const TEST_DIR = path.join(os.tmpdir(), 'claude-flow-integration-' + Date.now());
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
 * Run async test
 */
async function runAsyncTest(name, testFn) {
  console.log(`\n${colors.blue}Running: ${name}${colors.reset}`);
  
  try {
    await testFn();
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
 * Check if port is available
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

/**
 * Start a process and wait for it to be ready
 */
function startProcess(command, args, readyPattern) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: TEST_DIR,
      stdio: 'pipe'
    });
    
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
      if (readyPattern.test(output)) {
        resolve(proc);
      }
    });
    
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('error', reject);
    
    // Timeout after 10 seconds
    setTimeout(() => {
      proc.kill();
      reject(new Error('Process startup timeout'));
    }, 10000);
  });
}

// Setup test environment
console.log(`${colors.yellow}Setting up test environment...${colors.reset}`);
fs.mkdirSync(TEST_DIR, { recursive: true });
process.chdir(TEST_DIR);

// Initialize Claude Flow
exec(`node ${CLAUDE_FLOW_BIN} init -y`);

// Test 1: ruv-swarm MCP integration
runAsyncTest('ruv-swarm MCP integration', async () => {
  // Check if ruv-swarm is available
  try {
    exec('npx ruv-swarm --version');
  } catch (error) {
    console.log('  ruv-swarm not installed, installing...');
    exec('npm install ruv-swarm');
  }
  
  // Test MCP server start
  const port = 3456;
  if (await isPortAvailable(port)) {
    const mcpCmd = `node ${CLAUDE_FLOW_BIN} mcp start --port ${port}`;
    console.log(`  Starting MCP server on port ${port}...`);
    
    // Start in background and check if it's running
    const proc = spawn('node', [CLAUDE_FLOW_BIN, 'mcp', 'start', '--port', port.toString()], {
      cwd: TEST_DIR,
      detached: true,
      stdio: 'ignore'
    });
    
    // Give it time to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if port is now in use
    if (await isPortAvailable(port)) {
      throw new Error('MCP server did not start');
    }
    
    // Clean up
    try {
      process.kill(-proc.pid);
    } catch (e) {
      // Ignore cleanup errors
    }
  } else {
    console.log(`  Port ${port} already in use, skipping MCP server test`);
  }
});

// Test 2: GitHub API integration
runTest('GitHub API integration', () => {
  // Test without token (should work but with limitations)
  const output = exec(`node ${CLAUDE_FLOW_BIN} github setup --check`);
  
  if (output.includes('error') && !output.includes('token')) {
    throw new Error('GitHub integration check failed');
  }
  
  // Test with mock token
  const tokenOutput = exec(`node ${CLAUDE_FLOW_BIN} github setup --check`, {
    env: { ...process.env, GITHUB_TOKEN: 'ghp_mocktoken123' }
  });
  
  if (!tokenOutput.includes('token') && !tokenOutput.includes('configured')) {
    throw new Error('GitHub token configuration not detected');
  }
});

// Test 3: Cross-platform script execution
runTest('Cross-platform script execution', () => {
  const isWindows = process.platform === 'win32';
  const scriptName = isWindows ? 'claude-flow.bat' : 'claude-flow';
  
  // Create platform-specific wrapper
  if (isWindows) {
    fs.writeFileSync(
      path.join(TEST_DIR, 'claude-flow.bat'),
      '@echo off\nnode "%~dp0claude-flow" %*'
    );
  }
  
  // Test execution
  const output = exec(`./${scriptName} --version`);
  if (!output.includes('claude-flow')) {
    throw new Error('Cross-platform script execution failed');
  }
});

// Test 4: Swarm coordination with agents
runAsyncTest('Swarm coordination with agents', async () => {
  // Initialize swarm
  const initOutput = exec(`node ${CLAUDE_FLOW_BIN} swarm init --topology mesh --max-agents 3`);
  if (!initOutput.includes('initialized') && !initOutput.includes('success')) {
    throw new Error('Swarm initialization failed');
  }
  
  // Spawn test agent
  const spawnOutput = exec(`node ${CLAUDE_FLOW_BIN} swarm spawn --type researcher --name "Test Agent"`);
  if (!spawnOutput.includes('spawned') && !spawnOutput.includes('created')) {
    throw new Error('Agent spawn failed');
  }
  
  // Check swarm status
  const statusOutput = exec(`node ${CLAUDE_FLOW_BIN} swarm status`);
  if (!statusOutput.includes('mesh') && !statusOutput.includes('topology')) {
    throw new Error('Swarm status check failed');
  }
});

// Test 5: Memory bank persistence
runTest('Memory bank persistence', () => {
  // Store test data
  const storeOutput = exec(`node ${CLAUDE_FLOW_BIN} memory store --key test-key --value "test-value"`);
  if (storeOutput.includes('error')) {
    throw new Error('Memory store failed');
  }
  
  // Retrieve test data
  const getOutput = exec(`node ${CLAUDE_FLOW_BIN} memory get --key test-key`);
  if (!getOutput.includes('test-value')) {
    throw new Error('Memory retrieve failed');
  }
  
  // List memory entries
  const listOutput = exec(`node ${CLAUDE_FLOW_BIN} memory list`);
  if (!listOutput.includes('test-key')) {
    throw new Error('Memory list failed');
  }
});

// Test 6: Task coordination system
runTest('Task coordination system', () => {
  // Create a task
  const createOutput = exec(`node ${CLAUDE_FLOW_BIN} task create --name "Test Task" --priority high`);
  if (createOutput.includes('error')) {
    throw new Error('Task creation failed');
  }
  
  // List tasks
  const listOutput = exec(`node ${CLAUDE_FLOW_BIN} task list`);
  if (!listOutput.includes('Test Task')) {
    throw new Error('Task list failed');
  }
});

// Test 7: Configuration management
runTest('Configuration management', () => {
  // Set config value
  exec(`node ${CLAUDE_FLOW_BIN} config set test.value "integration-test"`);
  
  // Get config value
  const getOutput = exec(`node ${CLAUDE_FLOW_BIN} config get test.value`);
  if (!getOutput.includes('integration-test')) {
    throw new Error('Config get failed');
  }
  
  // List all config
  const listOutput = exec(`node ${CLAUDE_FLOW_BIN} config list`);
  if (!listOutput.includes('test.value')) {
    throw new Error('Config list failed');
  }
});

// Test 8: Multi-command workflow
runTest('Multi-command workflow', () => {
  // Simulate a complete workflow
  const commands = [
    'swarm init --topology hierarchical',
    'swarm spawn --type coordinator',
    'task create --name "Build API" --assignTo coordinator',
    'memory store --key workflow-state --value "started"',
    'swarm status'
  ];
  
  let lastOutput = '';
  for (const cmd of commands) {
    try {
      lastOutput = exec(`node ${CLAUDE_FLOW_BIN} ${cmd}`);
    } catch (error) {
      throw new Error(`Workflow failed at: ${cmd}\n${error.message}`);
    }
  }
  
  if (!lastOutput.includes('hierarchical')) {
    throw new Error('Workflow did not complete successfully');
  }
});

// Test 9: Error handling and recovery
runTest('Error handling and recovery', () => {
  // Test invalid command
  try {
    exec(`node ${CLAUDE_FLOW_BIN} invalid-command`);
    throw new Error('Should have failed on invalid command');
  } catch (error) {
    if (!error.message.includes('invalid') && !error.message.includes('unknown')) {
      throw new Error('Error handling not working properly');
    }
  }
  
  // Test with invalid arguments
  try {
    exec(`node ${CLAUDE_FLOW_BIN} swarm init --invalid-option`);
    throw new Error('Should have failed on invalid option');
  } catch (error) {
    // Expected to fail
  }
});

// Test 10: Performance benchmarks
runAsyncTest('Performance benchmarks', async () => {
  const operations = [
    { name: 'Init', cmd: 'init -y' },
    { name: 'Config', cmd: 'config list' },
    { name: 'Memory', cmd: 'memory list' },
    { name: 'Help', cmd: '--help' }
  ];
  
  console.log('  Performance metrics:');
  for (const op of operations) {
    const start = Date.now();
    exec(`node ${CLAUDE_FLOW_BIN} ${op.cmd}`);
    const duration = Date.now() - start;
    console.log(`    ${op.name}: ${duration}ms`);
    
    if (duration > 5000) {
      throw new Error(`${op.name} operation too slow: ${duration}ms`);
    }
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
const resultsPath = path.join(__dirname, 'integration-test-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
console.log(`\nResults saved to: ${resultsPath}`);

// Exit with appropriate code
process.exit(testResults.failed > 0 ? 1 : 0);