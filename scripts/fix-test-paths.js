#!/usr/bin/env node

/**
 * Fix test paths in package.json to match actual test directory structure
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

// Update test scripts to use correct paths
const testScriptUpdates = {
  "test": "NODE_OPTIONS='--experimental-vm-modules' jest",
  "test:watch": "NODE_OPTIONS='--experimental-vm-modules' jest --watch",
  "test:unit": "NODE_OPTIONS='--experimental-vm-modules' jest tests/unit",
  "test:integration": "NODE_OPTIONS='--experimental-vm-modules' jest tests/integration",
  "test:e2e": "NODE_OPTIONS='--experimental-vm-modules' jest tests/e2e",
  "test:performance": "NODE_OPTIONS='--experimental-vm-modules' jest tests/performance",
  "test:cli": "NODE_OPTIONS='--experimental-vm-modules' jest tests/cli",
  "test:coverage": "NODE_OPTIONS='--experimental-vm-modules' jest --coverage",
  "test:coverage:unit": "NODE_OPTIONS='--experimental-vm-modules' jest tests/unit --coverage",
  "test:coverage:integration": "NODE_OPTIONS='--experimental-vm-modules' jest tests/integration --coverage",
  "test:coverage:e2e": "NODE_OPTIONS='--experimental-vm-modules' jest tests/e2e --coverage",
  "test:ci": "NODE_OPTIONS='--experimental-vm-modules' jest --ci --coverage --maxWorkers=2 --testPathPattern=tests/",
  "test:debug": "NODE_OPTIONS='--experimental-vm-modules --inspect-brk' jest --runInBand --no-cache",
  "test:health": "NODE_OPTIONS='--experimental-vm-modules' jest tests/integration/system-integration.test.ts --testNamePattern='Health'",
  "test:swarm": "NODE_OPTIONS='--experimental-vm-modules' jest tests/integration/workflow-engine.test.ts",
  "test:benchmark": "NODE_OPTIONS='--experimental-vm-modules' jest tests/performance"
};

// Update the scripts
Object.entries(testScriptUpdates).forEach(([key, value]) => {
  packageJson.scripts[key] = value;
});

// Remove non-existent test:deno script
delete packageJson.scripts['test:deno'];

// Write back to package.json
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log('✅ Updated test paths in package.json');
console.log('📝 Changes made:');
console.log('  - Updated all test paths from src/__tests__/* to tests/*');
console.log('  - Removed non-existent test:deno script');
console.log('  - Fixed specific test file references');