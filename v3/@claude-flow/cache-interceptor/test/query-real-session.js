/**
 * Query REAL Claude session data to prove the interceptor can read it
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Colors
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

console.log(`
${BOLD}${CYAN}╔════════════════════════════════════════════════════════════════╗
║  QUERY: Real Claude Code Session Data                          ║
╚════════════════════════════════════════════════════════════════╝${RESET}
`);

async function main() {
  const interceptor = require('../dist/interceptor');

  // Find current Claude session
  console.log(`${YELLOW}▶ Discovering Claude sessions...${RESET}`);

  const sessions = interceptor.discoverSessionsFromFilesystem();

  console.log(`  Found ${sessions.length} sessions on filesystem\n`);

  // Show first few sessions
  console.log(`${YELLOW}▶ Recent sessions:${RESET}`);
  for (let i = 0; i < Math.min(5, sessions.length); i++) {
    const s = sessions[i];
    const sizeKB = (s.size / 1024).toFixed(1);
    console.log(`  ${i+1}. ${s.sessionId.slice(0,8)}... (${sizeKB} KB) - ${s.projectName}`);
  }
  console.log();

  // If we have sessions, sync the most recent one
  if (sessions.length > 0) {
    const latest = sessions[0];
    console.log(`${YELLOW}▶ Syncing latest session: ${latest.sessionId.slice(0,8)}...${RESET}`);

    await interceptor.initDatabase();
    const result = interceptor.CacheQuery.syncFromFilesystem(latest.sessionId);

    console.log(`  Synced ${result.synced} messages\n`);

    // Query messages
    const messages = interceptor.CacheQuery.getSession(latest.sessionId);

    // Count by type
    const typeCounts = {};
    for (const m of messages) {
      typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
    }

    console.log(`${YELLOW}▶ Message type breakdown:${RESET}`);
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log();

    // Show a sample message
    const userMsgs = messages.filter(m => m.type === 'user');
    if (userMsgs.length > 0) {
      console.log(`${YELLOW}▶ Sample user message:${RESET}`);
      const sample = userMsgs[userMsgs.length - 1];
      console.log(`  ${DIM}${JSON.stringify(sample.message?.content || sample).slice(0, 100)}...${RESET}`);
    }
    console.log();

    // Show summaries
    const summaryMsgs = messages.filter(m => m.type === 'summary');
    if (summaryMsgs.length > 0) {
      console.log(`${YELLOW}▶ Preserved summaries (${summaryMsgs.length} total):${RESET}`);
      for (let i = 0; i < Math.min(3, summaryMsgs.length); i++) {
        console.log(`  ${DIM}${(summaryMsgs[i].summary || '').slice(0, 80)}...${RESET}`);
      }
    }
    console.log();

    interceptor.persistDatabase();
  }

  console.log(`${GREEN}${BOLD}✓ Real session data accessible via interceptor${RESET}\n`);
}

main().catch(console.error);
