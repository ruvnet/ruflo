#!/usr/bin/env node

/**
 * Module System Converter
 * Fixes mixed CommonJS/ESM patterns in TypeScript files
 * Based on analysis in GitHub issue #560
 */

import { promises as fs } from 'fs';
import { glob } from 'glob';
import path from 'path';

class ModuleSystemFixer {
  constructor() {
    this.fixes = {
      requireToImport: 0,
      moduleExportsToExport: 0,
      filesProcessed: 0,
      errors: []
    };
  }

  async run() {
    console.log('🔧 Starting Module System Conversion...\n');
    
    // Find all TypeScript files in src directory
    const tsFiles = await glob('src/**/*.ts', { 
      ignore: ['src/**/*.test.ts', 'src/**/*.spec.ts'] 
    });
    
    console.log(`Found ${tsFiles.length} TypeScript files to check\n`);
    
    for (const filePath of tsFiles) {
      await this.processFile(filePath);
    }
    
    this.printSummary();
  }

  async processFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      let modified = content;
      let hasChanges = false;
      
      // Check for CommonJS patterns
      const hasRequire = /require\s*\(/g.test(content);
      const hasModuleExports = /module\.exports\s*=|exports\./g.test(content);
      
      if (hasRequire || hasModuleExports) {
        console.log(`📁 Processing: ${filePath}`);
        
        if (hasRequire) {
          modified = this.convertRequireToImport(modified, filePath);
          hasChanges = true;
        }
        
        if (hasModuleExports) {
          modified = this.convertModuleExportsToExport(modified, filePath);
          hasChanges = true;
        }
        
        if (hasChanges) {
          // Create backup
          await fs.writeFile(`${filePath}.backup`, content);
          await fs.writeFile(filePath, modified);
          this.fixes.filesProcessed++;
          console.log(`  ✅ Fixed and backed up\n`);
        }
      }
    } catch (error) {
      this.fixes.errors.push({ file: filePath, error: error.message });
      console.log(`  ❌ Error processing ${filePath}: ${error.message}\n`);
    }
  }

  convertRequireToImport(content, filePath) {
    let modified = content;
    
    // Pattern 1: const fs = require('fs').promises
    modified = modified.replace(
      /const\s+fs\s*=\s*require\(['"]fs['"]\)\.promises/g,
      "import { promises as fs } from 'fs'"
    );
    
    // Pattern 2: require('fs').statSync()
    modified = modified.replace(
      /require\(['"]fs['"]\)\.statSync\(/g,
      "import('fs').then(fs => fs.statSync("
    );
    
    // Pattern 3: require('fs').promises.stat()
    modified = modified.replace(
      /require\(['"]fs['"]\)\.promises\./g,
      "(await import('fs')).promises."
    );
    
    // Pattern 4: await require('fs').promises
    modified = modified.replace(
      /await\s+require\(['"]fs['"]\)\.promises\./g,
      "(await import('fs')).promises."
    );
    
    // Generic require patterns for other modules
    modified = modified.replace(
      /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g,
      "import $1 from '$2'"
    );
    
    if (modified !== content) {
      this.fixes.requireToImport++;
      console.log(`    🔄 Converted require() statements`);
    }
    
    return modified;
  }

  convertModuleExportsToExport(content, filePath) {
    let modified = content;
    
    // Remove stray module.exports from template code inside functions
    // These appear to be template strings that should not be converted
    const lines = modified.split('\n');
    const filteredLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip module.exports that are:
      // 1. Inside template literals or strings
      // 2. Part of generated code examples
      // 3. In comments or documentation
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        this.isInsideTemplateOrString(lines, i) ||
        this.isGeneratedCodeExample(lines, i)
      ) {
        filteredLines.push(line);
        continue;
      }
      
      // Convert actual module.exports to export statements
      if (trimmed.includes('module.exports =')) {
        // For now, comment out problematic module.exports rather than convert
        // to avoid breaking template generation
        const commented = line.replace(/^(\s*)(.*)$/, '$1// FIXME: Remove CommonJS export - $2');
        filteredLines.push(commented);
        console.log(`    🔄 Commented out module.exports: ${trimmed}`);
        this.fixes.moduleExportsToExport++;
      } else {
        filteredLines.push(line);
      }
    }
    
    return filteredLines.join('\n');
  }

  isInsideTemplateOrString(lines, currentIndex) {
    // Simple heuristic: check if line is indented significantly (likely inside a function)
    // and surrounded by other template-like content
    const line = lines[currentIndex];
    const indent = line.match(/^\s*/)[0].length;
    
    // If heavily indented (8+ spaces) and looks like template code
    if (indent >= 8 && line.includes('module.exports')) {
      // Check surrounding context for template indicators
      for (let i = Math.max(0, currentIndex - 3); i < Math.min(lines.length, currentIndex + 3); i++) {
        const contextLine = lines[i].toLowerCase();
        if (contextLine.includes('template') || 
            contextLine.includes('generated') ||
            contextLine.includes('code') ||
            contextLine.includes('example')) {
          return true;
        }
      }
    }
    
    return false;
  }

  isGeneratedCodeExample(lines, currentIndex) {
    // Check if this is part of a code generation template
    const searchRange = 10;
    for (let i = Math.max(0, currentIndex - searchRange); 
         i < Math.min(lines.length, currentIndex + searchRange); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('createrestapi') || 
          line.includes('generated code') ||
          line.includes('template') ||
          line.includes('swarm execution')) {
        return true;
      }
    }
    return false;
  }

  printSummary() {
    console.log('📊 CONVERSION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`Files processed: ${this.fixes.filesProcessed}`);
    console.log(`require() → import: ${this.fixes.requireToImport}`);
    console.log(`module.exports commented: ${this.fixes.moduleExportsToExport}`);
    
    if (this.fixes.errors.length > 0) {
      console.log(`\n❌ Errors encountered: ${this.fixes.errors.length}`);
      this.fixes.errors.forEach(error => {
        console.log(`  • ${error.file}: ${error.error}`);
      });
    }
    
    console.log('\n🎉 Module system conversion completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Run: npm run build');
    console.log('2. Test functionality');
    console.log('3. If successful, remove .backup files');
    console.log('4. If failed, restore from backups');
  }
}

// Run the converter
const fixer = new ModuleSystemFixer();
fixer.run().catch(console.error);