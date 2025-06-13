#!/usr/bin/env -S deno run --allow-all
/**
 * Bundle the CLI for npm distribution using Deno's bundler
 */

import { bundle } from "https://deno.land/x/emit@0.32.0/mod.ts";

async function bundleForNpm() {
  console.log("📦 Bundling claude-flow for npm...");

  try {
    // Bundle the main CLI entry point
    const result = await bundle("./src/cli/simple-cli.ts", {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        allowJs: true,
      },
      minify: false,
      allowRemote: false,
    });

    // Write the bundled output
    await Deno.writeTextFile("./dist/claude-flow-bundle.js", result.code);
    console.log("✅ Bundle created at ./dist/claude-flow-bundle.js");

    // Create a simple wrapper for the bundle
    const wrapper = `#!/usr/bin/env node
// Auto-generated bundle wrapper for npm distribution
// This avoids TypeScript stripping issues in node_modules

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Check if Deno is installed
function checkDeno() {
  try {
    require('child_process').execSync('deno --version', { stdio: 'ignore' });
    return 'deno';
  } catch {
    console.error('Error: Deno is not installed.');
    console.error('Please install Deno first:');
    console.error('  curl -fsSL https://deno.land/x/install/install.sh | sh');
    process.exit(1);
  }
}

const denoPath = checkDeno();
const bundlePath = path.join(__dirname, 'claude-flow-bundle.js');

// Run the bundled CLI with Deno
const deno = spawn(denoPath, ['run', '--allow-all', '--no-check', bundlePath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});

deno.on('error', (err) => {
  console.error('Failed to start Claude-Flow:', err.message);
  process.exit(1);
});

deno.on('close', (code) => {
  process.exit(code || 0);
});
`;

    await Deno.writeTextFile("./dist/claude-flow", wrapper);
    await Deno.chmod("./dist/claude-flow", 0o755);
    console.log("✅ Wrapper created at ./dist/claude-flow");

  } catch (error) {
    console.error("❌ Bundle failed:", error);
    throw error;
  }
}

if (import.meta.main) {
  await bundleForNpm();
}