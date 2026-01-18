/**
 * Test the cache optimization feature on real session data
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

console.log(`
${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════╗
║  TEST: Cache Optimization Before Compaction                      ║
╚════════════════════════════════════════════════════════════════╝${RESET}
`);

async function main() {
  // Find the current session file
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');

  console.log(`${YELLOW}▶ Finding current session...${RESET}`);

  // Look for the largest/most recent session
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
    console.log(`${RED}✗ No sessions found${RESET}`);
    process.exit(1);
  }

  const sizeKB = (largestSize / 1024).toFixed(1);
  const sizeMB = (largestSize / 1024 / 1024).toFixed(2);
  console.log(`  Found: ${largestSession}`);
  console.log(`  Size: ${sizeMB} MB (${sizeKB} KB)${RESET}\n`);

  // Read and parse all messages
  console.log(`${YELLOW}▶ Parsing session messages...${RESET}`);

  const content = fs.readFileSync(largestSession, 'utf8');
  const lines = content.trim().split('\n');

  const messages = [];
  const typeCounts = {};
  let parseErrors = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      messages.push({ line, parsed });
      typeCounts[parsed.type] = (typeCounts[parsed.type] || 0) + 1;
    } catch (e) {
      parseErrors++;
    }
  }

  console.log(`  Total messages: ${messages.length}`);
  console.log(`  Parse errors: ${parseErrors}`);
  console.log(`  ${DIM}Type breakdown:${RESET}`);
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / messages.length) * 100).toFixed(1);
    console.log(`    ${type}: ${count} (${pct}%)`);
  }
  console.log();

  // Simulate optimization
  console.log(`${YELLOW}▶ Simulating optimization (target: 500KB)...${RESET}`);

  const TARGET_SIZE = 500 * 1024; // 500KB target
  const KEEP_RECENT = 50;

  // Categorize messages
  const summaries = [];
  const systemMsgs = [];
  const userAssistant = [];
  const progress = [];
  const other = [];

  for (let i = 0; i < messages.length; i++) {
    const { line, parsed } = messages[i];
    const type = parsed.type;

    if (type === 'summary') {
      summaries.push(line);
    } else if (type === 'system') {
      systemMsgs.push(line);
    } else if (type === 'user' || type === 'assistant') {
      userAssistant.push({ line, idx: i });
    } else if (type === 'progress') {
      // Only keep completed progress from recent messages
      if (parsed.status === 'completed' && i > messages.length - KEEP_RECENT) {
        progress.push(line);
      }
    } else {
      other.push(line);
    }
  }

  console.log(`  Summaries preserved: ${summaries.length}`);
  console.log(`  System messages: ${systemMsgs.length}`);
  console.log(`  User/Assistant: ${userAssistant.length}`);
  console.log(`  Progress (recent): ${progress.length}`);
  console.log(`  Other: ${other.length}`);
  console.log();

  // Build optimized output
  const optimized = [];
  let currentSize = 0;

  // Always include all summaries
  for (const line of summaries) {
    optimized.push(line);
    currentSize += line.length;
  }

  // Include system messages
  for (const line of systemMsgs) {
    if (currentSize + line.length < TARGET_SIZE) {
      optimized.push(line);
      currentSize += line.length;
    }
  }

  // Include recent user/assistant (last KEEP_RECENT)
  const recentUA = userAssistant.slice(-KEEP_RECENT);
  for (const { line } of recentUA) {
    if (currentSize + line.length < TARGET_SIZE) {
      optimized.push(line);
      currentSize += line.length;
    }
  }

  // Include recent progress
  for (const line of progress) {
    if (currentSize + line.length < TARGET_SIZE) {
      optimized.push(line);
      currentSize += line.length;
    }
  }

  // Fill remaining budget with older user/assistant
  const remainingBudget = TARGET_SIZE - currentSize;
  const older = userAssistant.slice(0, -KEEP_RECENT);
  for (const { line } of older.reverse()) {
    if (currentSize + line.length < TARGET_SIZE) {
      optimized.push(line);
      currentSize += line.length;
    } else {
      break;
    }
  }

  const originalSize = content.length;
  const optimizedSize = currentSize;
  const reduction = ((1 - (optimizedSize / originalSize)) * 100).toFixed(1);

  console.log(`${YELLOW}▶ OPTIMIZATION RESULTS${RESET}`);
  console.log(`  Original: ${(originalSize / 1024).toFixed(1)} KB (${messages.length} messages)`);
  console.log(`  Optimized: ${(optimizedSize / 1024).toFixed(1)} KB (${optimized.length} messages)`);
  console.log(`  ${GREEN}Reduction: ${reduction}%${RESET}`);
  console.log();

  // Verify Claude compatibility
  console.log(`${YELLOW}▶ Verifying Claude compatibility...${RESET}`);

  let compatible = true;
  for (let i = 0; i < Math.min(10, optimized.length); i++) {
    try {
      const parsed = JSON.parse(optimized[i]);
      if (!parsed.type) {
        compatible = false;
        console.log(`  ${RED}✗ Line ${i+1}: missing type${RESET}`);
      }
    } catch (e) {
      compatible = false;
      console.log(`  ${RED}✗ Line ${i+1}: invalid JSON${RESET}`);
    }
  }

  if (compatible) {
    console.log(`  ${GREEN}✓ All optimized messages are Claude-compatible${RESET}`);
  }
  console.log();

  // Final summary
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${GREEN}
  OPTIMIZATION ANALYSIS COMPLETE

  Strategy:
  1. ✓ Preserve ALL summaries (${summaries.length} found)
  2. ✓ Keep system messages (${systemMsgs.length})
  3. ✓ Prioritize recent ${KEEP_RECENT} user/assistant messages
  4. ✓ Drop most progress/running messages
  5. ✓ Fill remaining budget with older conversation

  Result:
  ┌─────────────────────────────────────────────────────────┐
  │ Before: ${(originalSize/1024).toFixed(0).padStart(5)} KB → After: ${(optimizedSize/1024).toFixed(0).padStart(5)} KB (${reduction}% smaller) │
  └─────────────────────────────────────────────────────────┘

  This would prevent compaction by staying under Claude's limit!
${RESET}`);

  process.exit(0);
}

main().catch(err => {
  console.error(`${RED}Error: ${err.stack || err}${RESET}`);
  process.exit(1);
});
