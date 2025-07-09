#!/usr/bin/env node
/**
 * CI Test Runner
 * Handles platform-specific test execution and error handling
 */

const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  timeout: 300000, // 5 minutes total timeout
  retries: 2,
  platforms: {
    win32: {
      shell: true,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLAUDE_FLOW_ENV: 'test',
        CI: 'true',
        NODE_OPTIONS: '--max-old-space-size=2048'
      }
    },
    darwin: {
      shell: '/bin/bash',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLAUDE_FLOW_ENV: 'test',
        CI: 'true'
      }
    },
    linux: {
      shell: '/bin/sh',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        CLAUDE_FLOW_ENV: 'test',
        CI: 'true'
      }
    }
  }
};

// Get platform-specific options
function getPlatformOptions() {
  const platform = os.platform();
  return config.platforms[platform] || config.platforms.linux;
}

// Run command with timeout and retries
async function runCommand(command, args = [], options = {}) {
  const platformOptions = getPlatformOptions();
  const spawnOptions = {
    ...platformOptions,
    ...options,
    stdio: 'inherit'
  };

  console.log(`Running: ${command} ${args.join(' ')}`);
  console.log(`Platform: ${os.platform()}`);
  console.log(`Node version: ${process.version}`);

  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, spawnOptions);
        let killed = false;

        // Set timeout
        const timeout = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
          reject(new Error(`Command timed out after ${config.timeout}ms`));
        }, config.timeout);

        child.on('exit', (code, signal) => {
          clearTimeout(timeout);
          if (killed) return;
          
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Command failed with code ${code} (signal: ${signal})`));
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      console.log('✅ Command completed successfully');
      return true;
    } catch (error) {
      console.error(`❌ Attempt ${attempt}/${config.retries} failed:`, error.message);
      
      if (attempt < config.retries) {
        console.log(`Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw error;
      }
    }
  }
}

// Setup CI environment
async function setupEnvironment() {
  console.log('Setting up CI environment...');

  // Create necessary directories
  const dirs = ['coverage', 'test-results', 'logs', '.claude'];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create minimal CI config if needed
  const claudeConfigPath = '.claude/settings.json';
  if (!fs.existsSync(claudeConfigPath)) {
    const config = {
      version: '2.0.0',
      environment: 'ci',
      testMode: true,
      hooks: { enabled: false },
      memory: {
        backend: 'json',
        path: './memory/test-memory.json'
      }
    };
    fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
  }
}

// Main test runner
async function main() {
  const args = process.argv.slice(2);
  const testType = args[0] || 'unit';

  console.log('=================================');
  console.log('Claude Flow CI Test Runner');
  console.log('=================================');

  try {
    // Setup environment
    await setupEnvironment();

    // Install dependencies if needed
    if (!fs.existsSync('node_modules')) {
      console.log('Installing dependencies...');
      await runCommand('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    }

    // Determine test command based on type
    let testCommand;
    let testArgs;

    switch (testType) {
      case 'unit':
        testCommand = 'npm';
        testArgs = ['run', 'test:unit', '--', '--config=jest.config.ci.js'];
        break;
      case 'integration':
        testCommand = 'npm';
        testArgs = ['run', 'test:integration', '--', '--config=jest.config.ci.js'];
        break;
      case 'e2e':
        testCommand = 'npm';
        testArgs = ['run', 'test:e2e', '--', '--config=jest.config.ci.js'];
        break;
      case 'all':
        testCommand = 'npm';
        testArgs = ['run', 'test:ci'];
        break;
      default:
        console.error(`Unknown test type: ${testType}`);
        process.exit(1);
    }

    // Run tests
    console.log(`\nRunning ${testType} tests...`);
    await runCommand(testCommand, testArgs);

    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test runner failed:', error.message);
    
    // Try to provide helpful error messages
    if (error.message.includes('timed out')) {
      console.error('\nTests timed out. This might be due to:');
      console.error('- Hanging async operations');
      console.error('- Infinite loops');
      console.error('- Missing test timeouts');
    } else if (error.message.includes('ENOENT')) {
      console.error('\nCommand not found. Make sure all dependencies are installed.');
    }

    process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Run main function
if (require.main === module) {
  main();
}