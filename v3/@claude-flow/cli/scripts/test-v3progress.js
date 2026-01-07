#!/usr/bin/env node
/**
 * Test script for V3 progress calculation
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '../../..');
const v3Path = path.join(projectRoot, 'v3');
const cliPath = path.join(v3Path, '@claude-flow', 'cli', 'src');

console.log('Project root:', projectRoot);
console.log('V3 path:', v3Path);

// Count CLI commands
const commandsPath = path.join(cliPath, 'commands');
const cmdFiles = fs.readdirSync(commandsPath);
const cliCommands = cmdFiles.filter(f => f.endsWith('.ts') && f !== 'index.ts').length;
console.log('CLI Commands:', cliCommands);

// Count @claude-flow packages
const packagesPath = path.join(v3Path, '@claude-flow');
const dirs = fs.readdirSync(packagesPath, { withFileTypes: true });
const packages = dirs.filter(d => d.isDirectory()).length;
const packageDirs = dirs.filter(d => d.isDirectory()).map(d => d.name);
console.log('Packages:', packages, packageDirs);

// Count DDD layers
let packagesWithDDD = 0;
for (const pkg of packageDirs) {
  try {
    const srcPath = path.join(v3Path, '@claude-flow', pkg, 'src');
    const srcDirs = fs.readdirSync(srcPath, { withFileTypes: true });
    const hasDomain = srcDirs.some(d => d.isDirectory() && d.name === 'domain');
    const hasApp = srcDirs.some(d => d.isDirectory() && d.name === 'application');
    if (hasDomain || hasApp) {
      packagesWithDDD++;
      console.log(`  ${pkg}: has DDD layers`);
    }
  } catch {}
}
console.log('Packages with DDD:', packagesWithDDD);

// Count MCP tools
let mcpTools = 0;
const toolsPath = path.join(cliPath, 'mcp-tools');
const toolFiles = fs.readdirSync(toolsPath);
const toolModules = toolFiles.filter(f => f.endsWith('-tools.ts'));
for (const toolFile of toolModules) {
  const content = fs.readFileSync(path.join(toolsPath, toolFile), 'utf-8');
  const matches = content.match(/name:\s*['"][^'"]+['"]/g);
  if (matches) {
    mcpTools += matches.length;
    console.log(`  ${toolFile}: ${matches.length} tools`);
  }
}
console.log('MCP Tools:', mcpTools);

// Count hooks (from hooks.ts subcommands)
let hooksSubcommands = 20; // Fallback
try {
  const hooksPath = path.join(cliPath, 'commands', 'hooks.ts');
  const content = fs.readFileSync(hooksPath, 'utf-8');
  // Count lines with 'name:' in subcommands context
  const lines = content.split('\n');
  let inSubcommands = false;
  let count = 0;
  for (const line of lines) {
    if (line.includes('subcommands:')) inSubcommands = true;
    if (inSubcommands && line.includes("name: '")) count++;
    if (inSubcommands && line.includes('],')) break;
  }
  if (count > 0) hooksSubcommands = count;
} catch {}
console.log('Hooks Subcommands:', hooksSubcommands);

// Calculate progress
const cliProgress = Math.min(100, (cliCommands / 28) * 100);
const mcpProgress = Math.min(100, (mcpTools / 100) * 100);
const hooksProgress = Math.min(100, (hooksSubcommands / 20) * 100);
const pkgProgress = Math.min(100, (packages / 16) * 100);
const dddProgress = Math.min(100, (packagesWithDDD / 16) * 100);

const overallProgress = Math.round(
  (cliProgress * 0.25) +
  (mcpProgress * 0.25) +
  (hooksProgress * 0.20) +
  (pkgProgress * 0.15) +
  (dddProgress * 0.15)
);

console.log('\n=== Progress Breakdown ===');
console.log(`CLI Progress:   ${Math.round(cliProgress)}% (${cliCommands}/28)`);
console.log(`MCP Progress:   ${Math.round(mcpProgress)}% (${mcpTools}/100)`);
console.log(`Hooks Progress: ${Math.round(hooksProgress)}% (${hooksSubcommands}/20)`);
console.log(`Pkg Progress:   ${Math.round(pkgProgress)}% (${packages}/16)`);
console.log(`DDD Progress:   ${Math.round(dddProgress)}% (${packagesWithDDD}/16)`);
console.log('========================');
console.log(`OVERALL: ${overallProgress}%`);

// Write to v3-progress.json
const metricsDir = path.join(projectRoot, '.claude-flow', 'metrics');
fs.mkdirSync(metricsDir, { recursive: true });
const metrics = {
  domains: { completed: packagesWithDDD, total: packages },
  ddd: { progress: overallProgress, modules: packages },
  cli: { commands: cliCommands, progress: Math.round(cliProgress) },
  mcp: { tools: mcpTools, progress: Math.round(mcpProgress) },
  hooks: { subcommands: hooksSubcommands, progress: Math.round(hooksProgress) },
  packages: { total: packages, withDDD: packagesWithDDD, list: packageDirs },
  swarm: { activeAgents: 0, totalAgents: 15 },
  lastUpdated: new Date().toISOString(),
  source: 'test-v3progress-script'
};

fs.writeFileSync(
  path.join(metricsDir, 'v3-progress.json'),
  JSON.stringify(metrics, null, 2)
);
console.log('\n✅ Written to .claude-flow/metrics/v3-progress.json');
