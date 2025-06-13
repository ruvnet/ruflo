#!/usr/bin/env -S deno run --allow-all
/**
 * Build script for npm package using TypeScript compiler
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

async function transpileWithTsc() {
  console.log("📦 Transpiling TypeScript files with tsc...");
  
  // Create a temporary tsconfig for the build
  const tsConfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      lib: ["ES2022"],
      outDir: DIST_DIR,
      rootDir: SRC_DIR,
      allowJs: true,
      checkJs: false,
      strict: false,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      allowSyntheticDefaultImports: true,
      removeComments: false,
      sourceMap: false,
      declaration: false,
      moduleResolution: "node",
    },
    include: ["src/**/*.ts"],
    exclude: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "src/cli/simple-cli.ts",
      "src/ui/**/*"
    ]
  };

  await Deno.writeTextFile("tsconfig.build.json", JSON.stringify(tsConfig, null, 2));

  try {
    // Run tsc
    const tsc = new Deno.Command("npx", {
      args: ["tsc", "-p", "tsconfig.build.json"],
      stdout: "piped",
      stderr: "piped"
    });

    const { code, stdout, stderr } = await tsc.output();

    if (code !== 0) {
      console.error("TypeScript compilation failed:");
      console.error(new TextDecoder().decode(stderr));
      throw new Error("TypeScript compilation failed");
    }

    console.log("✓ TypeScript compilation successful");
  } finally {
    // Clean up temporary tsconfig
    await Deno.remove("tsconfig.build.json").catch(() => {});
  }
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

async function fixImports() {
  console.log("🔧 Fixing import paths...");
  
  // Walk through all JS files in dist and fix imports
  for await (const entry of walk(DIST_DIR, {
    includeDirs: false,
    match: [/\.js$/]
  })) {
    let content = await Deno.readTextFile(entry.path);
    let modified = false;

    // Remove .ts extensions from imports
    content = content.replace(/from\s+['"]([^'"]+?)\.ts\.js['"]/g, (match, importPath) => {
      modified = true;
      return `from '${importPath}.js'`;
    });

    // Fix relative imports without extensions
    content = content.replace(
      /from\s+['"](\.[^'"]+?)(?<!\.js)(?<!\.json)['"]/g,
      (match, importPath) => {
        // Skip if it's a directory import
        if (importPath.endsWith('/')) return match;
        modified = true;
        return `from '${importPath}.js'`;
      }
    );

    // Fix dynamic imports
    content = content.replace(
      /import\s*\(\s*['"](\.[^'"]+?)(?<!\.js)(?<!\.json)['"]\s*\)/g,
      (match, importPath) => {
        if (importPath.endsWith('/')) return match;
        modified = true;
        return `import('${importPath}.js')`;
      }
    );

    // Remove TypeScript type imports
    content = content.replace(/^import\s+type\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
    
    // Remove type annotations from function parameters
    content = content.replace(/(\w+)\s*:\s*\w+(\s*[,\)])/g, '$1$2');
    
    // Remove type annotations from variable declarations
    content = content.replace(/:\s*\w+(\s*=)/g, '$1');

    if (modified || content !== await Deno.readTextFile(entry.path)) {
      await Deno.writeTextFile(entry.path, content);
      console.log(`✓ Fixed imports: ${relative(".", entry.path)}`);
    }
  }
}

async function build() {
  console.log("🔨 Building npm package with TypeScript compiler...");
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

  // Transpile TypeScript files
  await transpileWithTsc();

  // Fix import paths
  await fixImports();

  // Copy deno.json to dist
  try {
    const denoConfig = await Deno.readTextFile("deno.json");
    await Deno.writeTextFile(join(DIST_DIR, "deno.json"), denoConfig);
    console.log("✓ Copied deno.json");
  } catch {
    // Ignore if deno.json doesn't exist
  }

  console.log("\n✅ Build complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Test the package locally: npm pack && npm install -g *.tgz");
  console.log("2. Publish to npm: npm publish");
}

if (import.meta.main) {
  await build();
}