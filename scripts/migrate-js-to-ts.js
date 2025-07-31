#!/usr/bin/env node

/**
 * JavaScript to TypeScript Migration Script
 * Converts JS files to TypeScript with proper typing
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class JSToTSMigrator {
  constructor() {
    this.typeImports = new Set();
    this.interfaceDefinitions = new Map();
  }

  async migrateFile(inputPath, outputPath) {
    console.log(`🔄 Migrating ${path.basename(inputPath)} to TypeScript...`);
    
    const content = await fs.readFile(inputPath, 'utf8');
    let tsContent = content;

    // Step 1: Update file extension imports
    tsContent = this.fixImportExtensions(tsContent);

    // Step 2: Add type imports
    tsContent = this.addTypeImports(tsContent);

    // Step 3: Convert function parameters and returns
    tsContent = this.addFunctionTypes(tsContent);

    // Step 4: Add interface definitions
    tsContent = this.addInterfaces(tsContent);

    // Step 5: Fix class properties
    tsContent = this.addClassPropertyTypes(tsContent);

    // Step 6: Convert variable declarations
    tsContent = this.addVariableTypes(tsContent);

    // Step 7: Fix object literals
    tsContent = this.fixObjectLiterals(tsContent);

    // Write the TypeScrit file
    await fs.writeFile(outputPath, tsContent);
    console.log(`✅ Created ${path.basename(outputPath)}`);
  }

  fixImportExtensions(content) {
    // Change .js imports to .js (keep for TypeScript)
    return content.replace(
      /from\s+['"]([^'"]+)\.js['"]/g,
      "from '$1.js'"
    ).replace(
      /import\s*\(\s*['"]([^'"]+)\.js['"]\s*\)/g,
      "import('$1.js')"
    );
  }

  addTypeImports(content) {
    let imports = [];
    
    // Add common type imports based on usage
    if (content.includes('EventEmitter')) {
      imports.push("import { EventEmitter } from 'events';");
    }
    
    if (content.includes('chalk')) {
      // Keep chalk import as is
    }

    // Add swarm types if used
    if (content.includes('AgentCapability') || content.includes('TaskSubmitOptions')) {
      imports.push("import type { AgentCapability, TaskSubmitOptions } from '../hive-mind/types.js';");
    }

    // Add logger types
    if (content.includes('createLogger')) {
      imports.push("import type { ILogger } from '../core/logger.js';");
      imports.push("import type { IEventBus } from '../core/event-bus.js';");
    }

    if (imports.length > 0) {
      const importSection = imports.join('\n') + '\n\n';
      // Add after existing imports
      return content.replace(
        /(import[^;]+;\s*\n)+/,
        `$&${importSection}`
      );
    }

    return content;
  }

  addFunctionTypes(content) {
    // Add types to async functions
    content = content.replace(
      /async\s+function\s+(\w+)\s*\(([^)]*)\)\s*{/g,
      (match, name, params) => {
        const typedParams = this.addParameterTypes(params);
        return `async function ${name}(${typedParams}): Promise<any> {`;
      }
    );

    // Add types to class methods
    content = content.replace(
      /async\s+(\w+)\s*\(([^)]*)\)\s*{/g,
      (match, name, params) => {
        const typedParams = this.addParameterTypes(params);
        return `async ${name}(${typedParams}): Promise<any> {`;
      }
    );

    // Add types to arrow functions in class properties
    content = content.replace(
      /(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*{/g,
      (match, name, params) => {
        const typedParams = this.addParameterTypes(params);
        return `${name} = (${typedParams}): any => {`;
      }
    );

    return content;
  }

  addParameterTypes(params) {
    if (!params.trim()) return params;
    
    return params.split(',').map(param => {
      const trimmed = param.trim();
      if (!trimmed) return trimmed;
      
      // Skip if already typed
      if (trimmed.includes(':')) return trimmed;
      
      // Add basic types based on common patterns
      if (trimmed.includes('config') || trimmed.includes('options')) {
        return `${trimmed}: any`;
      }
      if (trimmed.includes('name') || trimmed.includes('id') || trimmed.includes('path')) {
        return `${trimmed}: string`;
      }
      if (trimmed.includes('count') || trimmed.includes('timeout') || trimmed.includes('size')) {
        return `${trimmed}: number`;
      }
      if (trimmed.includes('enabled') || trimmed.includes('flag')) {
        return `${trimmed}: boolean`;
      }
      
      return `${trimmed}: any`;
    }).join(', ');
  }

  addClassPropertyTypes(content) {
    // Add types to class properties
    content = content.replace(
      /^(\s+)(\w+)\s*=\s*(new\s+\w+|\[\]|\{\}|null|false|true|\d+|"[^"]*"|'[^']*');?\s*$/gm,
      (match, indent, name, value) => {
        let type = 'any';
        
        if (value.startsWith('new ')) {
          const className = value.match(/new\s+(\w+)/)?.[1];
          type = className || 'any';
        } else if (value === '[]') {
          type = 'any[]';
        } else if (value === '{}') {
          type = 'Record<string, any>';
        } else if (value === 'null') {
          type = 'any | null';
        } else if (value === 'false' || value === 'true') {
          type = 'boolean';
        } else if (/^\d+$/.test(value)) {
          type = 'number';
        } else if (value.startsWith('"') || value.startsWith("'")) {
          type = 'string';
        }
        
        return `${indent}private ${name}: ${type} = ${value};`;
      }
    );

    return content;
  }

  addVariableTypes(content) {
    // Add types to variable declarations where obvious
    content = content.replace(
      /^(\s*)(const|let)\s+(\w+)\s*=\s*(new\s+Map\(\)|new\s+Set\(\)|\[\]|\{\});?\s*$/gm,
      (match, indent, keyword, name, value) => {
        let type = 'any';
        
        if (value === 'new Map()') {
          type = 'Map<string, any>';
        } else if (value === 'new Set()') {
          type = 'Set<any>';
        } else if (value === '[]') {
          type = 'any[]';
        } else if (value === '{}') {
          type = 'Record<string, any>';
        }
        
        return `${indent}${keyword} ${name}: ${type} = ${value};`;
      }
    );

    return content;
  }

  addInterfaces(content) {
    // Add interface definitions at the top
    let interfaces = '';
    
    // Add common interfaces based on usage patterns
    if (content.includes('PerformanceMonitor')) {
      interfaces += `
interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: number;
  memoryUsage?: number;
  error?: string;
}

`;
    }

    if (content.includes('config')) {
      interfaces += `
interface MaestroConfig {
  enablePerformanceMonitoring?: boolean;
  initializationTimeout?: number;
  cacheEnabled?: boolean;
  logLevel?: string;
  enableSwarmCoordination?: boolean;
  enableConsensusValidation?: boolean;
}

`;
    }

    if (interfaces) {
      // Add interfaces after imports
      content = content.replace(
        /(import[^;]+;\s*\n)+/,
        `$&${interfaces}`
      );
    }

    return content;
  }

  fixObjectLiterals(content) {
    // Fix object literals by adding 'as any' where needed for complex objects
    content = content.replace(
      /(\w+):\s*{([^}]+)}/g,
      (match, key, value) => {
        // Only add 'as any' if the object is complex
        if (value.includes(':') && value.includes(',')) {
          return `${key}: {${value}} as any`;
        }
        return match;
      }
    );

    return content;
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 1) {
    console.log('Usage: node migrate-js-to-ts.js <input-file.js>');
    console.log('Output will be created as <input-file>.ts');
    process.exit(1);
  }

  const inputFile = args[0];
  const outputFile = inputFile.replace(/\.js$/, '.ts');

  if (!inputFile.endsWith('.js')) {
    console.error('❌ Input file must have .js extension');
    process.exit(1);
  }

  if (inputFile === outputFile) {
    console.error('❌ Input file must have .js extension to generate .ts output');
    process.exit(1);
  }

  try {
    const migrator = new JSToTSMigrator();
    await migrator.migrateFile(inputFile, outputFile);
    
    console.log(`\n✅ Migration complete!`);
    console.log(`📂 Input:  ${inputFile}`);
    console.log(`📂 Output: ${outputFile}`);
    console.log(`\n🔍 Next steps:`);
    console.log(`   1. Review the generated TypeScript file`);
    console.log(`   2. Fix any remaining type errors`);
    console.log(`   3. Test with: npx tsx ${outputFile}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);