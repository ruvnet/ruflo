#!/usr/bin/env node

/**
 * Convert Remaining CommonJS Usage
 * Systematic conversion of remaining require() calls to proper ESM imports
 */

import { promises as fs } from 'fs';
import { glob } from 'glob';

class CommonJSConverter {
  constructor() {
    this.conversions = {
      safe: 0,
      warnings: 0,
      errors: 0,
      filesProcessed: 0
    };
  }

  async run() {
    console.log('🔧 Converting remaining CommonJS usage to ESM...\n');
    
    // Find TypeScript files with remaining require() statements
    const tsFiles = await glob('src/**/*.ts', { 
      ignore: ['src/**/*.test.ts', 'src/**/*.spec.ts'] 
    });
    
    for (const filePath of tsFiles) {
      await this.processFile(filePath);
    }
    
    this.printSummary();
  }

  async processFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const originalContent = content;
      
      // Skip files that don't have require() statements
      if (!content.includes('require(')) {
        return;
      }
      
      console.log(`📁 Processing: ${filePath}`);
      let modified = content;
      let hasChanges = false;
      
      // Safe conversions: Standard Node.js modules
      const nodeModules = {
        'readline': "import readline from 'readline';",
        'fs': "import fs from 'fs';",
        'path': "import path from 'path';",
        'crypto': "import crypto from 'crypto';",
        'url': "import { URL, fileURLToPath } from 'url';",
        'util': "import util from 'util';",
        'events': "import { EventEmitter } from 'events';",
        'stream': "import { Readable, Writable, Transform } from 'stream';",
        'child_process': "import { spawn, exec, fork } from 'child_process';",
        'os': "import os from 'os';",
      };
      
      // Convert standard Node.js modules
      for (const [module, replacement] of Object.entries(nodeModules)) {
        const patterns = [
          new RegExp(`const\\s+${module}\\s*=\\s*require\\(['"]${module}['"]\\);`, 'g'),
          new RegExp(`const\\s+\\{[^}]+\\}\\s*=\\s*require\\(['"]${module}['"]\\);`, 'g')
        ];
        
        for (const pattern of patterns) {
          if (pattern.test(modified)) {
            // Only convert if at the top level (not inside functions)
            const lines = modified.split('\n');
            const updatedLines = [];
            let inFunction = false;
            let braceDepth = 0;
            let addedImport = false;
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              
              // Track function/block depth
              braceDepth += (line.match(/{/g) || []).length;
              braceDepth -= (line.match(/}/g) || []).length;
              
              if (braceDepth > 0 && !line.trim().startsWith('//') && 
                  (line.includes('function') || line.includes('=>') || line.includes('async'))) {
                inFunction = true;
              }
              if (braceDepth === 0) {
                inFunction = false;
              }
              
              // Convert top-level requires only
              if (!inFunction && pattern.test(line)) {
                if (!addedImport) {
                  // Add import at the top after existing imports
                  const importIndex = this.findImportInsertionPoint(updatedLines);
                  updatedLines.splice(importIndex, 0, replacement);
                  addedImport = true;
                  hasChanges = true;
                  console.log(`  ✅ Converted ${module} to ESM import`);
                }
                // Remove the require line
                continue;
              }
              
              updatedLines.push(line);
            }
            
            if (hasChanges) {
              modified = updatedLines.join('\n');
            }
          }
        }
      }
      
      // Convert npm package requires (non-dynamic)
      const npmPackagePattern = /const\s+(\w+)\s*=\s*require\(['"]([^'"\/]+)['"]\);/g;
      let match;
      const packageImports = new Set();
      
      while ((match = npmPackagePattern.exec(modified)) !== null) {
        const [fullMatch, varName, packageName] = match;
        
        // Skip if already processed or if it's a dynamic/conditional require
        if (packageImports.has(packageName)) continue;
        
        const lineStart = modified.lastIndexOf('\n', match.index) + 1;
        const lineEnd = modified.indexOf('\n', match.index);
        const line = modified.substring(lineStart, lineEnd);
        
        // Only convert if it's not inside a function/conditional
        if (!this.isInsideFunction(modified, match.index)) {
          const importStatement = `import ${varName} from '${packageName}';`;
          packageImports.add(packageName);
          
          // Replace the require with empty line (import will be added at top)
          modified = modified.replace(fullMatch, `// Converted to import: ${packageName}`);
          
          // Add import at the top
          const lines = modified.split('\n');
          const importIndex = this.findImportInsertionPoint(lines);
          lines.splice(importIndex, 0, importStatement);
          modified = lines.join('\n');
          
          hasChanges = true;
          console.log(`  ✅ Converted package ${packageName} to ESM import`);
        }
      }
      
      if (hasChanges) {
        // Create backup
        await fs.writeFile(`${filePath}.backup`, originalContent);
        await fs.writeFile(filePath, modified);
        this.conversions.filesProcessed++;
        console.log(`  💾 Updated with backup\n`);
      }
      
    } catch (error) {
      this.conversions.errors++;
      console.log(`  ❌ Error: ${error.message}\n`);
    }
  }

  findImportInsertionPoint(lines) {
    let lastImportIndex = -1;
    
    // Find the last import statement
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('import ') && !line.includes('//')) {
        lastImportIndex = i;
      }
      // Stop at the first non-import, non-comment, non-empty line
      else if (line && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/**')) {
        break;
      }
    }
    
    return lastImportIndex + 1;
  }

  isInsideFunction(content, position) {
    // Simple heuristic: check if we're inside braces that aren't at root level
    const beforePosition = content.substring(0, position);
    const lines = beforePosition.split('\n');
    let braceDepth = 0;
    let inFunction = false;
    
    for (const line of lines) {
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;
      braceDepth += openBraces - closeBraces;
      
      if (braceDepth > 0 && (line.includes('function') || line.includes('=>'))) {
        inFunction = true;
      }
      if (braceDepth === 0) {
        inFunction = false;
      }
    }
    
    return inFunction || braceDepth > 0;
  }

  printSummary() {
    console.log('📊 COMMONJS CONVERSION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`Files processed: ${this.conversions.filesProcessed}`);
    console.log(`Safe conversions: ${this.conversions.safe}`);
    console.log(`Warnings: ${this.conversions.warnings}`);
    console.log(`Errors: ${this.conversions.errors}`);
    
    console.log('\n🎉 CommonJS conversion completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Test: npm run build:esbuild');
    console.log('2. Verify: npm run build');
    console.log('3. If successful, remove .backup files');
  }
}

// Run the converter
const converter = new CommonJSConverter();
converter.run().catch(console.error);