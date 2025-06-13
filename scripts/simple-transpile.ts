#!/usr/bin/env -S deno run --allow-all
/**
 * Simple TypeScript to JavaScript transpiler
 * Removes TypeScript syntax for npm compatibility
 */

export function simpleTranspile(content: string): string {
  // Remove type imports
  content = content.replace(/^import\s+type\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  
  // Remove interface declarations
  content = content.replace(/^export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  content = content.replace(/^interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  
  // Remove type declarations
  content = content.replace(/^export\s+type\s+\w+\s*=[\s\S]*?;$/gm, '');
  content = content.replace(/^type\s+\w+\s*=[\s\S]*?;$/gm, '');
  
  // Remove type annotations from function parameters
  content = content.replace(/(\w+)\s*:\s*[\w\[\]<>,\s|&{}]+(\s*[,\)])/g, '$1$2');
  
  // Remove type annotations from function return types
  content = content.replace(/\)\s*:\s*[\w\[\]<>,\s|&{}]+\s*\{/g, ') {');
  content = content.replace(/\)\s*:\s*[\w\[\]<>,\s|&{}]+\s*=>/g, ') =>');
  
  // Remove type annotations from variable declarations
  content = content.replace(/:\s*[\w\[\]<>,\s|&{}]+(\s*=)/g, '$1');
  
  // Remove type assertions
  content = content.replace(/\s+as\s+[\w\[\]<>,\s|&{}]+/g, '');
  
  // Remove generic type parameters from function declarations
  content = content.replace(/function\s+(\w+)\s*<[^>]+>/g, 'function $1');
  content = content.replace(/(\w+)\s*<[^>]+>\s*\(/g, '$1(');
  
  // Remove readonly modifiers
  content = content.replace(/\breadonly\s+/g, '');
  
  // Remove public/private/protected modifiers
  content = content.replace(/\b(public|private|protected)\s+/g, '');
  
  // Remove declare statements
  content = content.replace(/^declare\s+.*$/gm, '');
  
  // Fix .ts extensions in imports
  content = content.replace(/from\s+['"]([^'"]+?)\.ts['"]/g, "from '$1.js'");
  
  // Remove empty lines created by removals
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  return content;
}

// If run directly, transpile a file
if (import.meta.main) {
  const [inputFile] = Deno.args;
  if (!inputFile) {
    console.error("Usage: simple-transpile.ts <input-file>");
    Deno.exit(1);
  }
  
  const content = await Deno.readTextFile(inputFile);
  const transpiled = simpleTranspile(content);
  console.log(transpiled);
}