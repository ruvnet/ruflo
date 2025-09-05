#!/usr/bin/env node

/**
 * Fix ESLint errors systematically for Issue #726
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Function to fix unused variables by prefixing with underscore
function fixUnusedVariables(filePath, line, variable) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  // Fix the specific line
  if (lines[line - 1]) {
    lines[line - 1] = lines[line - 1].replace(
      new RegExp(`\\b${variable}\\b`, 'g'),
      `_${variable}`
    );
    
    writeFileSync(filePath, lines.join('\n'));
    console.log(`Fixed ${variable} in ${filePath}:${line}`);
  }
}

// Function to remove unused imports
function removeUnusedImport(filePath, line, importName) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  if (lines[line - 1]) {
    const lineContent = lines[line - 1];
    
    // Remove entire line if it's a single import
    if (lineContent.includes(`import { ${importName} }`) && lineContent.includes('from')) {
      lines.splice(line - 1, 1);
      console.log(`Removed import ${importName} from ${filePath}:${line}`);
    } else {
      // Remove from multi-import line
      lines[line - 1] = lineContent.replace(new RegExp(`\\b${importName},?\\s*`, 'g'), '');
      console.log(`Removed ${importName} from import in ${filePath}:${line}`);
    }
    
    writeFileSync(filePath, lines.join('\n'));
  }
}

// Common unused variable fixes based on error patterns
const fixes = [
  // Unused variables to prefix with _
  {
    file: 'src/cli/agents/analyst.ts',
    fixes: [
      { line: 638, type: 'variable', name: 'data' },
      { line: 696, type: 'variable', name: 'data' },
      { line: 767, type: 'variable', name: 'data' },
      { line: 836, type: 'variable', name: 'data' },
      { line: 965, type: 'variable', name: 'benchmark' }
    ]
  },
  {
    file: 'src/cli/agents/architect.ts', 
    fixes: [
      { line: 36, type: 'variable', name: 'MicroserviceComponent' },
      { line: 56, type: 'variable', name: 'InfrastructureComponent' }
    ]
  },
  {
    file: 'src/cli/agents/index.ts',
    fixes: [
      { line: 21, type: 'import', name: 'generateId' }
    ]
  },
  {
    file: 'src/agents/agent-manager.ts',
    fixes: [
      { line: 814, type: 'variable', name: 'startTime' }
    ]
  }
];

// Apply fixes
for (const fileInfo of fixes) {
  for (const fix of fileInfo.fixes) {
    const fullPath = fileInfo.file;
    
    if (fix.type === 'variable') {
      fixUnusedVariables(fullPath, fix.line, fix.name);
    } else if (fix.type === 'import') {
      removeUnusedImport(fullPath, fix.line, fix.name);
    }
  }
}

console.log('\n✅ ESLint error fixes applied!');

// Run lint again to check progress
try {
  const result = execSync('npm run lint', { encoding: 'utf8', cwd: process.cwd() });
  console.log('\n🎉 ESLint check passed!');
} catch (error) {
  const errorCount = (error.stdout.match(/error/g) || []).length;
  console.log(`\n📊 ${errorCount} ESLint errors remaining`);
  console.log('Run npm run lint to see details');
}