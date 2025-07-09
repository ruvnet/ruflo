#!/usr/bin/env node

/**
 * Simple CI dependency test script
 * Validates that all critical dependencies are available
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Testing CI dependencies...\n');

// Check Node version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
console.log(`✓ Node.js version: ${nodeVersion}`);

if (majorVersion < 18) {
  console.error('❌ Node.js version must be >= 18');
  process.exit(1);
}

// Check npm version
try {
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  console.log(`✓ npm version: ${npmVersion}`);
} catch (error) {
  console.error('❌ npm not found');
  process.exit(1);
}

// Check package.json exists
const packageJsonPath = path.join(__dirname, '..', 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  console.error('❌ package.json not found');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
console.log(`✓ Package: ${packageJson.name}@${packageJson.version}\n`);

// Test critical non-native dependencies
const criticalDeps = [
  'commander',
  'chalk',
  'ora',
  'inquirer',
  'express',
  'ws'
];

console.log('Testing critical dependencies:');
let hasErrors = false;

for (const dep of criticalDeps) {
  try {
    require.resolve(dep);
    console.log(`  ✓ ${dep}`);
  } catch (error) {
    console.error(`  ❌ ${dep} - ${error.message}`);
    hasErrors = true;
  }
}

// Test native dependencies with fallback info
console.log('\nTesting native dependencies:');
const nativeDeps = ['better-sqlite3', 'blessed'];

for (const dep of nativeDeps) {
  try {
    require.resolve(dep);
    console.log(`  ✓ ${dep} (available)`);
  } catch (error) {
    console.log(`  ⚠️  ${dep} (not available - will use fallback)`);
  }
}

// Test npm ci
console.log('\nTesting npm ci:');
try {
  execSync('npm ci --dry-run', { stdio: 'pipe' });
  console.log('  ✓ npm ci validation passed');
} catch (error) {
  console.error('  ❌ npm ci validation failed');
  hasErrors = true;
}

// Final result
console.log('\n' + '='.repeat(50));
if (hasErrors) {
  console.error('❌ CI dependency test FAILED');
  process.exit(1);
} else {
  console.log('✅ CI dependency test PASSED');
  console.log('All critical dependencies are available.');
  console.log('Native modules will use fallbacks if not available.');
}