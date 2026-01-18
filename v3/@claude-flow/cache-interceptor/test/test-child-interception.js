/**
 * Test interceptor in a clean child process
 * This demonstrates the actual interception behavior
 */

const { spawn } = require('child_process');
const path = require('path');

// Colors
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

console.log(`
${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════╗
║  TEST: Interceptor via NODE_OPTIONS (Clean Child Process)        ║
╚════════════════════════════════════════════════════════════════╝${RESET}
`);

// The child script that will be run with the interceptor preloaded
const childScript = `
const fs = require('fs');
const path = require('path');
const os = require('os');

// Find the largest session
const claudeDir = path.join(os.homedir(), '.claude', 'projects');
let largestSession = null;
let largestSize = 0;

function findSessions(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSessions(fullPath);
    } else if (entry.name.endsWith('.jsonl')) {
      const stats = fs.statSync(fullPath);
      if (stats.size > largestSize) {
        largestSize = stats.size;
        largestSession = fullPath;
      }
    }
  }
}

findSessions(claudeDir);

if (!largestSession) {
  console.log(JSON.stringify({ error: 'No sessions found' }));
  process.exit(1);
}

// Read the file - this should be intercepted!
const content = fs.readFileSync(largestSession, 'utf8');
const lines = content.trim().split('\\n');

// Parse types
const types = {};
for (const line of lines) {
  try {
    const parsed = JSON.parse(line);
    types[parsed.type] = (types[parsed.type] || 0) + 1;
  } catch {}
}

// Output results
console.log(JSON.stringify({
  sessionPath: largestSession,
  originalSize: largestSize,
  interceptedSize: content.length,
  messageCount: lines.length,
  reduction: ((1 - content.length / largestSize) * 100).toFixed(1),
  types
}));
`;

// Write temp child script
const tempScript = path.join(__dirname, '_temp_child.js');
require('fs').writeFileSync(tempScript, childScript);

console.log(`${YELLOW}▶ Running child process with interceptor preloaded...${RESET}\n`);

// Run child with fs-shim preloaded (this patches Module.prototype.require)
const fsShimPath = path.join(__dirname, '..', 'dist', 'fs-shim.js');

const child = spawn('node', [tempScript], {
  env: {
    ...process.env,
    NODE_OPTIONS: `--require ${interceptorPath}`,
    CACHE_OPTIMIZE: 'true',
    CACHE_TARGET_SIZE: '500000',
    CACHE_INTERCEPTOR_DEBUG: 'true'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.stderr.on('data', (data) => {
  stderr += data.toString();
});

child.on('close', (code) => {
  // Show interceptor output
  if (stderr) {
    console.log(`${CYAN}[Interceptor Output]${RESET}`);
    stderr.split('\n').forEach(line => {
      if (line.includes('[CacheInterceptor]')) {
        console.log(`  ${line}`);
      }
    });
    console.log();
  }

  // Parse and show results
  try {
    // Find the JSON line in stdout
    const jsonLine = stdout.split('\n').find(l => l.startsWith('{'));
    if (!jsonLine) {
      console.log(`${YELLOW}No result JSON found. stdout:${RESET}`);
      console.log(stdout);
      process.exit(1);
    }

    const result = JSON.parse(jsonLine);

    if (result.error) {
      console.log(`Error: ${result.error}`);
      process.exit(1);
    }

    const originalMB = (result.originalSize / 1024 / 1024).toFixed(2);
    const interceptedMB = (result.interceptedSize / 1024 / 1024).toFixed(2);

    console.log(`${YELLOW}▶ Results:${RESET}`);
    console.log(`  Session: ${result.sessionPath}`);
    console.log(`  Original size: ${originalMB} MB`);
    console.log(`  Intercepted size: ${interceptedMB} MB`);
    console.log(`  Message count: ${result.messageCount}`);
    console.log(`  ${GREEN}Reduction: ${result.reduction}%${RESET}`);
    console.log();

    console.log(`  Type breakdown:`);
    for (const [type, count] of Object.entries(result.types).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${type}: ${count}`);
    }
    console.log();

    // Analyze
    if (parseFloat(result.reduction) > 50) {
      console.log(`${BOLD}${GREEN}
  ✓ INTERCEPTION WORKING - ${result.reduction}% reduction achieved!

  The interceptor successfully:
  1. Preloaded via NODE_OPTIONS
  2. Intercepted fs.readFileSync for Claude session
  3. Returned optimized content
${RESET}`);
    } else {
      console.log(`${YELLOW}
  ○ Interception may need debugging
  Reduction was only ${result.reduction}%
${RESET}`);
    }

  } catch (e) {
    console.log(`Failed to parse result: ${e}`);
    console.log(`stdout: ${stdout}`);
  }

  // Cleanup
  require('fs').unlinkSync(tempScript);
  process.exit(code);
});
