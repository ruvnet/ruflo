#!/usr/bin/env -S deno run --allow-all
/**
 * Build script for npm package
 * Transpiles TypeScript files to JavaScript for npm distribution
 */

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import { dirname, join, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const SRC_DIR = "./src";
const DIST_DIR = "./dist";

// Files to copy as-is (already JavaScript)
const JS_FILES_TO_COPY = [
  "src/cli/simple-cli.js",
  "src/cli/command-registry.js",
  "src/cli/utils.js",
  "src/cli/create-enhanced-task.js",
];

async function transpileTypeScript(content: string, filePath: string): Promise<string> {
  try {
    // Import and use our simple transpiler
    const { simpleTranspile } = await import('./simple-transpile.ts');
    return simpleTranspile(content);
  } catch (error) {
    console.warn(`Warning: Could not transpile ${filePath}, copying as-is:`, error.message);
    return content;
  }
}

async function processFile(srcPath: string, distPath: string) {
  const content = await Deno.readTextFile(srcPath);
  let outputContent = content;

  if (srcPath.endsWith('.ts')) {
    // Transpile TypeScript to JavaScript
    outputContent = await transpileTypeScript(content, srcPath);
    distPath = distPath.replace(/\.ts$/, '.js');
  }

  // Update import statements to use .js extensions
  outputContent = outputContent.replace(
    /from\s+['"]([^'"]+?)(?<!\.js)(?<!\.json)['"];?/g,
    (match, importPath) => {
      // Don't add .js to external modules or already .js files
      if (importPath.startsWith('.') && !importPath.endsWith('.js')) {
        return match.replace(importPath, `${importPath}.js`);
      }
      return match;
    }
  );

  // Update dynamic imports
  outputContent = outputContent.replace(
    /import\s*\(\s*['"]([^'"]+?)(?<!\.js)(?<!\.json)['"]\s*\)/g,
    (match, importPath) => {
      // Don't add .js to external modules or already .js files
      if (importPath.startsWith('.') && !importPath.endsWith('.js')) {
        return match.replace(importPath, `${importPath}.js`);
      }
      return match;
    }
  );

  await ensureDir(dirname(distPath));
  await Deno.writeTextFile(distPath, outputContent);
  console.log(`✓ Processed: ${relative(".", srcPath)} → ${relative(".", distPath)}`);
}

async function copyJavaScriptFiles() {
  for (const jsFile of JS_FILES_TO_COPY) {
    const srcPath = jsFile;
    const distPath = jsFile.replace(/^src\//, 'dist/');
    
    try {
      const content = await Deno.readTextFile(srcPath);
      await ensureDir(dirname(distPath));
      await Deno.writeTextFile(distPath, content);
      console.log(`✓ Copied: ${relative(".", srcPath)} → ${relative(".", distPath)}`);
    } catch (error) {
      console.warn(`Warning: Could not copy ${srcPath}:`, error.message);
    }
  }
}

async function copySimpleCommandsDir() {
  const simpleCommandsDir = join(SRC_DIR, "cli", "simple-commands");
  const distSimpleCommandsDir = join(DIST_DIR, "cli", "simple-commands");

  for await (const entry of walk(simpleCommandsDir, { 
    includeDirs: false,
    match: [/\.js$/]
  })) {
    const relPath = relative(SRC_DIR, entry.path);
    const distPath = join(DIST_DIR, relPath);
    
    const content = await Deno.readTextFile(entry.path);
    await ensureDir(dirname(distPath));
    await Deno.writeTextFile(distPath, content);
    console.log(`✓ Copied: ${relative(".", entry.path)} → ${relative(".", distPath)}`);
  }
}

async function build() {
  console.log("🔨 Building npm package...");
  console.log(`📁 Source: ${SRC_DIR}`);
  console.log(`📁 Output: ${DIST_DIR}`);
  console.log();

  // Clean dist directory
  try {
    await Deno.remove(DIST_DIR, { recursive: true });
  } catch {
    // Directory might not exist
  }

  // Copy JavaScript files first
  await copyJavaScriptFiles();
  await copySimpleCommandsDir();

  // Process TypeScript files
  for await (const entry of walk(SRC_DIR, { 
    includeDirs: false,
    match: [/\.ts$/],
    skip: [/\.test\.ts$/, /\.spec\.ts$/, /simple-cli\.ts$/]
  })) {
    const relPath = relative(SRC_DIR, entry.path);
    const distPath = join(DIST_DIR, relPath);
    
    await processFile(entry.path, distPath);
  }

  // Update bin/claude-flow to use dist instead of src
  const binPath = "./bin/claude-flow";
  const binContent = await Deno.readTextFile(binPath);
  const updatedBinContent = binContent.replace(
    "path.join(__dirname, '..', 'src', 'cli', 'simple-cli.js')",
    "path.join(__dirname, '..', 'dist', 'cli', 'simple-cli.js')"
  );
  
  // Create a temporary bin file for npm
  await Deno.writeTextFile("./bin/claude-flow.npm", updatedBinContent);
  console.log("✓ Created npm-specific bin file");

  console.log("\n✅ Build complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Test the package locally: npm pack && npm install -g *.tgz");
  console.log("2. Publish to npm: npm publish");
}

if (import.meta.main) {
  await build();
}