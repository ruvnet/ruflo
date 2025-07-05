#!/usr/bin/env node

/**
 * Quick validation script to check Claude Flow migration status
 * Runs basic checks to ensure no Deno dependencies remain
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

let hasErrors = false;

function checkFile(filePath, description) {
  console.log(`\n${colors.blue}Checking: ${description}${colors.reset}`);
  console.log(`File: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`${colors.yellow}⚠ File not found${colors.reset}`);
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  // Check for Deno references
  if (content.includes('Deno.') || content.includes('deno:')) {
    issues.push('Contains Deno references');
  }
  
  // Check for Cliffy imports
  if (content.includes('cliffy/')) {
    issues.push('Contains Cliffy imports');
  }
  
  // Check for .ts extensions in imports
  if (content.match(/from\s+['""].*\.ts['""]/) && !filePath.endsWith('.d.ts')) {
    issues.push('Contains .ts imports');
  }
  
  if (issues.length > 0) {
    hasErrors = true;
    issues.forEach(issue => {
      console.log(`${colors.red}✗ ${issue}${colors.reset}`);
    });
  } else {
    console.log(`${colors.green}✓ Clean${colors.reset}`);
  }
}

function checkCommand(command, description) {
  console.log(`\n${colors.blue}Testing: ${description}${colors.reset}`);
  console.log(`Command: ${command}`);
  
  try {
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    console.log(`${colors.green}✓ Success${colors.reset}`);
    return true;
  } catch (error) {
    console.log(`${colors.red}✗ Failed: ${error.message}${colors.reset}`);
    hasErrors = true;
    return false;
  }
}

console.log(`${colors.blue}Claude Flow Migration Validation${colors.reset}`);
console.log('='.repeat(40));

// Check key files
checkFile('package.json', 'Package configuration');
checkFile('bin/claude-flow', 'Main CLI script');
checkFile('cli.js', 'CLI entry point');
checkFile('src/cli/index.ts', 'CLI TypeScript source');

// Check for deno.json
if (fs.existsSync('deno.json')) {
  console.log(`\n${colors.yellow}⚠ deno.json still exists${colors.reset}`);
}

// Test basic commands
const binPath = path.resolve('bin/claude-flow');
checkCommand(`node ${binPath} --version`, 'Version command');
checkCommand(`node ${binPath} --help`, 'Help command');

// Check dependencies
console.log(`\n${colors.blue}Checking dependencies...${colors.reset}`);
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const denoRelated = ['deno', 'cliffy'].filter(dep => 
    Object.keys(pkg.dependencies || {}).some(d => d.includes(dep)) ||
    Object.keys(pkg.devDependencies || {}).some(d => d.includes(dep))
  );
  
  if (denoRelated.length > 0) {
    console.log(`${colors.red}✗ Found Deno-related dependencies: ${denoRelated.join(', ')}${colors.reset}`);
    hasErrors = true;
  } else {
    console.log(`${colors.green}✓ No Deno-related dependencies${colors.reset}`);
  }
} catch (error) {
  console.log(`${colors.red}✗ Could not check dependencies${colors.reset}`);
}

// Summary
console.log(`\n${colors.blue}Validation Summary${colors.reset}`);
console.log('='.repeat(40));

if (hasErrors) {
  console.log(`${colors.red}✗ Migration validation FAILED${colors.reset}`);
  console.log('Please address the issues above before proceeding.');
  process.exit(1);
} else {
  console.log(`${colors.green}✓ Migration validation PASSED${colors.reset}`);
  console.log('Claude Flow appears to be successfully migrated to pure npm/Node.js!');
  process.exit(0);
}