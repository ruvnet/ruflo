#!/usr/bin/env node

/**
 * Docker Execution Tests for Claude Flow Migration
 * Tests containerized execution and deployment
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Test configuration
const DOCKER_IMAGE = 'claude-flow:test';
const COMPOSE_FILE = path.resolve(__dirname, '../../../docker-compose.yml');

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
 * Execute command with output
 */
function exec(command, options = {}) {
  try {
    console.log(`  Executing: ${command}`);
    return execSync(command, { 
      encoding: 'utf8',
      stdio: 'pipe',
      ...options 
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

/**
 * Check if Docker is available
 */
function checkDocker() {
  try {
    exec('docker --version');
    exec('docker-compose --version || docker compose version');
    return true;
  } catch (error) {
    console.error(`${colors.red}Docker not available: ${error.message}${colors.reset}`);
    return false;
  }
}

/**
 * Wait for container to be healthy
 */
async function waitForContainer(containerName, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const output = exec(`docker inspect --format='{{.State.Health.Status}}' ${containerName}`);
      if (output.trim() === 'healthy') {
        return true;
      }
    } catch (error) {
      // Container might not exist yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Container ${containerName} did not become healthy`);
}

/**
 * Check HTTP endpoint
 */
async function checkHttpEndpoint(url, expectedStatus = 200) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode === expectedStatus) {
        resolve(true);
      } else {
        reject(new Error(`Expected status ${expectedStatus}, got ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

// Check Docker availability
if (!checkDocker()) {
  console.log(`${colors.yellow}Docker tests require Docker to be installed and running${colors.reset}`);
  process.exit(0);
}

// Test 1: Build Docker image
runTest('Build Docker image', () => {
  const buildCmd = `docker build -t ${DOCKER_IMAGE} -f Docker/Dockerfile .`;
  exec(buildCmd, { cwd: path.resolve(__dirname, '../../..') });
});

// Test 2: Run container with help command
runTest('Run container with help command', () => {
  const output = exec(`docker run --rm ${DOCKER_IMAGE} --help`);
  if (!output.includes('init') || !output.includes('start')) {
    throw new Error('Help output missing expected commands');
  }
});

// Test 3: Run container with version command
runTest('Run container with version command', () => {
  const output = exec(`docker run --rm ${DOCKER_IMAGE} --version`);
  if (!output.includes('claude-flow')) {
    throw new Error('Version output not found');
  }
});

// Test 4: Volume mounting works
runTest('Volume mounting works', () => {
  const testDir = path.join(__dirname, 'docker-test-mount');
  fs.mkdirSync(testDir, { recursive: true });
  
  try {
    // Create a test file
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello from host');
    
    // Run container with volume mount
    const output = exec(
      `docker run --rm -v ${testDir}:/workspace ${DOCKER_IMAGE} ls /workspace`
    );
    
    if (!output.includes('test.txt')) {
      throw new Error('Volume mount not working');
    }
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

// Test 5: Environment variables pass through
runTest('Environment variables pass through', () => {
  const output = exec(
    `docker run --rm -e GITHUB_TOKEN=test-docker-token ${DOCKER_IMAGE} config get github.token`
  );
  
  if (!output.includes('test-docker-token')) {
    throw new Error('Environment variables not passed to container');
  }
});

// Test 6: User permissions are correct
runTest('User permissions are correct', () => {
  const output = exec(`docker run --rm ${DOCKER_IMAGE} whoami`);
  if (!output.includes('claude')) {
    throw new Error('Container not running as claude user');
  }
});

// Test 7: Docker Compose stack starts
runTest('Docker Compose stack starts', () => {
  try {
    // Start services in detached mode
    exec(`docker-compose -f ${COMPOSE_FILE} up -d claude-flow mcp-server`, {
      cwd: path.resolve(__dirname, '../../..')
    });
    
    // Wait a moment for services to start
    execSync('sleep 5');
    
    // Check services are running
    const psOutput = exec(`docker-compose -f ${COMPOSE_FILE} ps`);
    if (!psOutput.includes('claude-flow') || !psOutput.includes('mcp-server')) {
      throw new Error('Services not running');
    }
  } finally {
    // Always try to stop services
    try {
      exec(`docker-compose -f ${COMPOSE_FILE} down`, {
        cwd: path.resolve(__dirname, '../../..')
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

// Test 8: Container networking works
runTest('Container networking works', () => {
  try {
    // Create a test network
    exec('docker network create test-claude-flow-net');
    
    // Run two containers on the same network
    exec(`docker run -d --name test-server --network test-claude-flow-net ${DOCKER_IMAGE} start --mode server`);
    execSync('sleep 2');
    
    const output = exec(
      `docker run --rm --network test-claude-flow-net ${DOCKER_IMAGE} config set mcp.server http://test-server:3000`
    );
    
    if (output.includes('error')) {
      throw new Error('Container networking failed');
    }
  } finally {
    // Cleanup
    try {
      exec('docker stop test-server');
      exec('docker rm test-server');
      exec('docker network rm test-claude-flow-net');
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

// Test 9: Multi-stage build optimization
runTest('Multi-stage build optimization', () => {
  // Check image size
  const output = exec(`docker images ${DOCKER_IMAGE} --format "{{.Size}}"`);
  console.log(`  Image size: ${output.trim()}`);
  
  // Parse size (e.g., "123MB" -> 123)
  const sizeMatch = output.match(/(\d+)MB/);
  if (sizeMatch) {
    const sizeMB = parseInt(sizeMatch[1]);
    if (sizeMB > 500) {
      console.log(`  Warning: Image size ${sizeMB}MB is larger than recommended`);
    }
  }
});

// Test 10: Health check works
runTest('Health check works', () => {
  try {
    // Run container with health check
    exec(`docker run -d --name test-health ${DOCKER_IMAGE} start --mode server`);
    
    // Wait for health check
    waitForContainer('test-health', 10).then(() => {
      console.log('  Container is healthy');
    }).catch(error => {
      throw error;
    });
  } finally {
    // Cleanup
    try {
      exec('docker stop test-health');
      exec('docker rm test-health');
    } catch (e) {
      // Ignore cleanup errors
    }
  }
});

// Summary
console.log(`\n${colors.blue}Test Summary:${colors.reset}`);
console.log(`${colors.green}Passed: ${testResults.passed}${colors.reset}`);
console.log(`${colors.red}Failed: ${testResults.failed}${colors.reset}`);

// Write results
const resultsPath = path.join(__dirname, 'docker-test-results.json');
fs.writeFileSync(resultsPath, JSON.stringify(testResults, null, 2));
console.log(`\nResults saved to: ${resultsPath}`);

// Exit with appropriate code
process.exit(testResults.failed > 0 ? 1 : 0);