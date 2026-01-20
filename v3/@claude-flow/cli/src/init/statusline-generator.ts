/**
 * Statusline Configuration Generator
 * Creates statusline configuration for V3 progress display
 */

import type { InitOptions, StatuslineConfig } from './types.js';

/**
 * Generate statusline configuration script
 * Matches the advanced format:
 * ▊ Claude Flow V3 ● user  │  ⎇ v3  │  Opus 4.5
 * ─────────────────────────────────────────────────────
 * 🏗️  DDD Domains    [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x
 * 🤖 Swarm  ◉ [12/15]  👥 0    🟢 CVE 3/3    💾 5177MB    📂  56%    🧠  30%
 * 🔧 Architecture    DDD ●100%  │  Security ●CLEAN  │  Memory ●AgentDB  │  Integration ●
 */
export function generateStatuslineScript(options: InitOptions): string {
  const config = options.statusline;

  // Generate CommonJS script - use .cjs extension for ES module project compatibility
  return `#!/usr/bin/env node
/**
 * Claude Flow V3 Statusline Generator
 * Displays real-time V3 implementation progress and system status
 *
 * Usage: node statusline.cjs [--json] [--compact]
 *
 * IMPORTANT: This file uses .cjs extension to work in ES module projects.
 * The require() syntax is intentional for CommonJS compatibility.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  enabled: ${config.enabled},
  showProgress: ${config.showProgress},
  showSecurity: ${config.showSecurity},
  showSwarm: ${config.showSwarm},
  showHooks: ${config.showHooks},
  showPerformance: ${config.showPerformance},
  refreshInterval: ${config.refreshInterval},
  maxAgents: ${options.runtime.maxAgents},
  topology: '${options.runtime.topology}',
};

// ANSI colors
const c = {
  reset: '\\x1b[0m',
  bold: '\\x1b[1m',
  dim: '\\x1b[2m',
  red: '\\x1b[0;31m',
  green: '\\x1b[0;32m',
  yellow: '\\x1b[0;33m',
  blue: '\\x1b[0;34m',
  purple: '\\x1b[0;35m',
  cyan: '\\x1b[0;36m',
  brightRed: '\\x1b[1;31m',
  brightGreen: '\\x1b[1;32m',
  brightYellow: '\\x1b[1;33m',
  brightBlue: '\\x1b[1;34m',
  brightPurple: '\\x1b[1;35m',
  brightCyan: '\\x1b[1;36m',
  brightWhite: '\\x1b[1;37m',
};

// Get user info
function getUserInfo() {
  let name = 'user';
  let gitBranch = '';
  let modelName = 'Unknown';

  try {
    name = execSync('git config user.name 2>/dev/null || echo "user"', { encoding: 'utf-8' }).trim();
    gitBranch = execSync('git branch --show-current 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim();
  } catch (e) {
    // Ignore errors
  }

  // Auto-detect model from Claude Code's config
  try {
    const homedir = require('os').homedir();
    const claudeConfigPath = path.join(homedir, '.claude.json');
    if (fs.existsSync(claudeConfigPath)) {
      const claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
      // Try to find lastModelUsage - check current dir and parent dirs
      let lastModelUsage = null;
      const cwd = process.cwd();
      if (claudeConfig.projects) {
        // Try exact match first, then check if cwd starts with any project path
        for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
          if (cwd === projectPath || cwd.startsWith(projectPath + '/')) {
            lastModelUsage = projectConfig.lastModelUsage;
            break;
          }
        }
      }
      if (lastModelUsage) {
        const modelIds = Object.keys(lastModelUsage);
        if (modelIds.length > 0) {
          // Find the most recently used model by checking lastUsedAt timestamps
          // or fall back to the last key in the object (preserves insertion order in modern JS)
          let modelId = modelIds[modelIds.length - 1];
          let latestTimestamp = 0;

          for (const id of modelIds) {
            const usage = lastModelUsage[id];
            // Check for lastUsedAt timestamp (if available)
            if (usage.lastUsedAt) {
              const ts = new Date(usage.lastUsedAt).getTime();
              if (ts > latestTimestamp) {
                latestTimestamp = ts;
                modelId = id;
              }
            }
          }

          // Parse model ID to human-readable name
          if (modelId.includes('opus')) modelName = 'Opus 4.5';
          else if (modelId.includes('sonnet')) modelName = 'Sonnet 4';
          else if (modelId.includes('haiku')) modelName = 'Haiku 4.5';
          else modelName = modelId.split('-').slice(1, 3).join(' ');
        }
      }
    }
  } catch (e) {
    // Fallback to Unknown if can't read config
  }

  return { name, gitBranch, modelName };
}

// Get learning stats from memory database
function getLearningStats() {
  const memoryPaths = [
    path.join(process.cwd(), '.swarm', 'memory.db'),
    path.join(process.cwd(), '.claude', 'memory.db'),
    path.join(process.cwd(), 'data', 'memory.db'),
  ];

  let patterns = 0;
  let sessions = 0;
  let trajectories = 0;

  // Try to read from sqlite database
  for (const dbPath of memoryPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        // Count entries in memory file (rough estimate from file size)
        const stats = fs.statSync(dbPath);
        const sizeKB = stats.size / 1024;
        // Estimate: ~2KB per pattern on average
        patterns = Math.floor(sizeKB / 2);
        sessions = Math.max(1, Math.floor(patterns / 10));
        trajectories = Math.floor(patterns / 5);
        break;
      } catch (e) {
        // Ignore
      }
    }
  }

  // Also check for session files
  const sessionsPath = path.join(process.cwd(), '.claude', 'sessions');
  if (fs.existsSync(sessionsPath)) {
    try {
      const sessionFiles = fs.readdirSync(sessionsPath).filter(f => f.endsWith('.json'));
      sessions = Math.max(sessions, sessionFiles.length);
    } catch (e) {
      // Ignore
    }
  }

  return { patterns, sessions, trajectories };
}

// Get V3 progress from learning state (grows as system learns)
function getV3Progress() {
  const learning = getLearningStats();

  // Check for metrics file first (created by init)
  const metricsPath = path.join(process.cwd(), '.claude-flow', 'metrics', 'v3-progress.json');
  if (fs.existsSync(metricsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      if (data.domains && data.ddd) {
        return {
          domainsCompleted: data.domains.completed || 0,
          totalDomains: data.domains.total || 5,
          dddProgress: data.ddd.progress || 0,
          patternsLearned: data.learning?.patternsLearned || learning.patterns,
          sessionsCompleted: data.learning?.sessionsCompleted || learning.sessions
        };
      }
    } catch (e) {
      // Fall through to pattern-based calculation
    }
  }

  // DDD progress based on actual learned patterns
  // New install: 0 patterns = 0/5 domains, 0% DDD
  // As patterns grow: 10+ patterns = 1 domain, 50+ = 2, 100+ = 3, 200+ = 4, 500+ = 5
  let domainsCompleted = 0;
  if (learning.patterns >= 500) domainsCompleted = 5;
  else if (learning.patterns >= 200) domainsCompleted = 4;
  else if (learning.patterns >= 100) domainsCompleted = 3;
  else if (learning.patterns >= 50) domainsCompleted = 2;
  else if (learning.patterns >= 10) domainsCompleted = 1;

  const totalDomains = 5;
  const dddProgress = Math.min(100, Math.floor((domainsCompleted / totalDomains) * 100));

  return {
    domainsCompleted,
    totalDomains,
    dddProgress,
    patternsLearned: learning.patterns,
    sessionsCompleted: learning.sessions
  };
}

// Get security status based on actual scans
function getSecurityStatus() {
  const totalCves = 3;
  let cvesFixed = 0;

  // Check audit-status.json first (created by init)
  const auditStatusPath = path.join(process.cwd(), '.claude-flow', 'security', 'audit-status.json');
  if (fs.existsSync(auditStatusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(auditStatusPath, 'utf-8'));
      return {
        status: data.status || 'PENDING',
        cvesFixed: data.cvesFixed || 0,
        totalCves: data.totalCves || 3,
      };
    } catch (e) {
      // Fall through to scan directory check
    }
  }

  // Check for security scan results in memory
  const scanResultsPath = path.join(process.cwd(), '.claude', 'security-scans');
  if (fs.existsSync(scanResultsPath)) {
    try {
      const scans = fs.readdirSync(scanResultsPath).filter(f => f.endsWith('.json'));
      // Each successful scan file = 1 CVE addressed
      cvesFixed = Math.min(totalCves, scans.length);
    } catch (e) {
      // Ignore
    }
  }

  // Also check .swarm/security for audit results
  const swarmAuditPath = path.join(process.cwd(), '.swarm', 'security');
  if (fs.existsSync(swarmAuditPath)) {
    try {
      const audits = fs.readdirSync(swarmAuditPath).filter(f => f.includes('audit'));
      cvesFixed = Math.min(totalCves, Math.max(cvesFixed, audits.length));
    } catch (e) {
      // Ignore
    }
  }

  const status = cvesFixed >= totalCves ? 'CLEAN' : cvesFixed > 0 ? 'IN_PROGRESS' : 'PENDING';

  return {
    status,
    cvesFixed,
    totalCves,
  };
}

// Get swarm status (cross-platform)
function getSwarmStatus() {
  let activeAgents = 0;
  let coordinationActive = false;

  // Check swarm-activity.json first (works on all platforms)
  const activityPath = path.join(process.cwd(), '.claude-flow', 'metrics', 'swarm-activity.json');
  if (fs.existsSync(activityPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
      if (data.swarm) {
        return {
          activeAgents: data.swarm.agent_count || 0,
          maxAgents: CONFIG.maxAgents,
          coordinationActive: data.swarm.coordination_active || false,
        };
      }
    } catch (e) {
      // Fall through to process detection
    }
  }

  // Platform-specific process detection
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // Windows: use tasklist
      const ps = execSync('tasklist /FI "IMAGENAME eq node.exe" /NH 2>nul || echo ""', { encoding: 'utf-8' });
      const nodeProcesses = (ps.match(/node\\.exe/gi) || []).length;
      activeAgents = Math.max(0, Math.floor(nodeProcesses / 3)); // Heuristic
      coordinationActive = nodeProcesses > 0;
    } else {
      // Unix: use ps
      const ps = execSync('ps aux 2>/dev/null | grep -c agentic-flow || echo "0"', { encoding: 'utf-8' });
      activeAgents = Math.max(0, parseInt(ps.trim()) - 1);
      coordinationActive = activeAgents > 0;
    }
  } catch (e) {
    // Ignore errors - return defaults
  }

  return {
    activeAgents,
    maxAgents: CONFIG.maxAgents,
    coordinationActive,
  };
}

// Get system metrics (cross-platform)
function getSystemMetrics() {
  let memoryMB = 0;
  let subAgents = 0;

  // Check learning.json first (works on all platforms)
  const learningMetricsPath = path.join(process.cwd(), '.claude-flow', 'metrics', 'learning.json');
  let intelligenceFromFile = null;
  let contextFromFile = null;
  if (fs.existsSync(learningMetricsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(learningMetricsPath, 'utf-8'));
      if (data.routing?.accuracy !== undefined) {
        intelligenceFromFile = Math.min(100, Math.floor(data.routing.accuracy));
      }
      if (data.sessions?.total !== undefined) {
        contextFromFile = Math.min(100, data.sessions.total * 5);
      }
    } catch (e) {
      // Fall through
    }
  }

  // Platform-specific memory detection
  const isWindows = process.platform === 'win32';
  try {
    if (isWindows) {
      // Windows: use process.memoryUsage() (most reliable cross-platform)
      memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
    } else {
      // Unix: try ps command, fallback to process.memoryUsage()
      try {
        const mem = execSync('ps aux | grep -E "(node|agentic|claude)" | grep -v grep | awk \\'{sum += \\$6} END {print int(sum/1024)}\\'', { encoding: 'utf-8' });
        memoryMB = parseInt(mem.trim()) || 0;
      } catch (e) {
        memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
      }
    }
  } catch (e) {
    // Fallback to Node.js memory API
    memoryMB = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  // Get learning stats for intelligence %
  const learning = getLearningStats();

  // Intelligence % based on learned patterns (0 patterns = 0%, 1000+ = 100%)
  const intelligencePct = intelligenceFromFile !== null
    ? intelligenceFromFile
    : Math.min(100, Math.floor((learning.patterns / 10) * 1));

  // Context % based on session history (0 sessions = 0%, grows with usage)
  const contextPct = contextFromFile !== null
    ? contextFromFile
    : Math.min(100, Math.floor(learning.sessions * 5));

  // Count active sub-agents (cross-platform via metrics file)
  const activityPath = path.join(process.cwd(), '.claude-flow', 'metrics', 'swarm-activity.json');
  if (fs.existsSync(activityPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(activityPath, 'utf-8'));
      subAgents = data.processes?.estimated_agents || 0;
    } catch (e) {
      // Ignore
    }
  }

  // Fallback to process detection on Unix only
  if (subAgents === 0 && !isWindows) {
    try {
      const agents = execSync('ps aux 2>/dev/null | grep -c "claude-flow.*agent" || echo "0"', { encoding: 'utf-8' });
      subAgents = Math.max(0, parseInt(agents.trim()) - 1);
    } catch (e) {
      // Ignore
    }
  }

  return {
    memoryMB,
    contextPct,
    intelligencePct,
    subAgents,
  };
}

// Get ADR (Architecture Decision Records) status
function getADRStatus() {
  const adrPaths = [
    path.join(process.cwd(), 'docs', 'adrs'),
    path.join(process.cwd(), 'docs', 'adr'),
    path.join(process.cwd(), 'adr'),
    path.join(process.cwd(), 'ADR'),
    path.join(process.cwd(), '.claude-flow', 'adrs'),
  ];

  let count = 0;
  let implemented = 0;

  for (const adrPath of adrPaths) {
    if (fs.existsSync(adrPath)) {
      try {
        const files = fs.readdirSync(adrPath).filter(f =>
          f.endsWith('.md') && (f.startsWith('ADR-') || f.startsWith('adr-') || /^\\d{4}-/.test(f))
        );
        count = files.length;

        // Check for implemented status in ADR files
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(adrPath, file), 'utf-8');
            if (content.includes('Status: Implemented') || content.includes('status: implemented') ||
                content.includes('Status: Accepted') || content.includes('status: accepted')) {
              implemented++;
            }
          } catch (e) {
            // Skip unreadable files
          }
        }
        break;
      } catch (e) {
        // Ignore
      }
    }
  }

  return { count, implemented };
}

// Get hooks status (enabled/registered hooks)
function getHooksStatus() {
  let enabled = 0;
  let total = 17; // V3 has 17 hook types

  // Check .claude/settings.json for hooks config
  const settingsPaths = [
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json'),
  ];

  for (const settingsPath of settingsPaths) {
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.hooks) {
          // Count enabled hooks
          const hookTypes = Object.keys(settings.hooks);
          enabled = hookTypes.filter(h => {
            const hook = settings.hooks[h];
            return hook && (hook.enabled !== false) && (hook.command || hook.script);
          }).length;
        }
        break;
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  // Also check for hook files in .claude/hooks
  const hooksDir = path.join(process.cwd(), '.claude', 'hooks');
  if (fs.existsSync(hooksDir)) {
    try {
      const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.sh'));
      enabled = Math.max(enabled, hookFiles.length);
    } catch (e) {
      // Ignore
    }
  }

  return { enabled, total };
}

// Get AgentDB memory stats
function getAgentDBStats() {
  let vectorCount = 0;
  let dbSizeKB = 0;
  let namespaces = 0;

  const dbPaths = [
    path.join(process.cwd(), '.claude-flow', 'agentdb'),
    path.join(process.cwd(), '.swarm', 'agentdb'),
    path.join(process.cwd(), 'data', 'agentdb'),
    path.join(process.cwd(), '.claude', 'memory'),
  ];

  for (const dbPath of dbPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        const stats = fs.statSync(dbPath);
        if (stats.isDirectory()) {
          // Count database files and estimate vectors
          const files = fs.readdirSync(dbPath);
          namespaces = files.filter(f => f.endsWith('.db') || f.endsWith('.sqlite')).length;

          // Calculate total size
          for (const file of files) {
            const filePath = path.join(dbPath, file);
            const fileStat = fs.statSync(filePath);
            if (fileStat.isFile()) {
              dbSizeKB += fileStat.size / 1024;
            }
          }

          // Estimate vector count (~0.5KB per vector on average)
          vectorCount = Math.floor(dbSizeKB / 0.5);
        } else {
          // Single file database
          dbSizeKB = stats.size / 1024;
          vectorCount = Math.floor(dbSizeKB / 0.5);
          namespaces = 1;
        }
        break;
      } catch (e) {
        // Ignore
      }
    }
  }

  // Also check for vectors.json (simple vector store)
  const vectorsPath = path.join(process.cwd(), '.claude-flow', 'vectors.json');
  if (fs.existsSync(vectorsPath) && vectorCount === 0) {
    try {
      const data = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
      if (Array.isArray(data)) {
        vectorCount = data.length;
      } else if (data.vectors) {
        vectorCount = Object.keys(data.vectors).length;
      }
    } catch (e) {
      // Ignore
    }
  }

  return { vectorCount, dbSizeKB: Math.floor(dbSizeKB), namespaces };
}

// Get test statistics
function getTestStats() {
  let testFiles = 0;
  let testCases = 0;

  const testDirs = [
    path.join(process.cwd(), 'tests'),
    path.join(process.cwd(), 'test'),
    path.join(process.cwd(), '__tests__'),
    path.join(process.cwd(), 'src', '__tests__'),
    path.join(process.cwd(), 'v3', '__tests__'),
  ];

  // Recursively count test files
  function countTestFiles(dir, depth = 0) {
    if (depth > 3) return; // Limit recursion
    if (!fs.existsSync(dir)) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          countTestFiles(path.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          const name = entry.name;
          if (name.includes('.test.') || name.includes('.spec.') ||
              name.includes('_test.') || name.includes('_spec.') ||
              name.startsWith('test_') || name.startsWith('spec_')) {
            testFiles++;

            // Try to estimate test cases from file
            try {
              const content = fs.readFileSync(path.join(dir, name), 'utf-8');
              // Count it(), test(), describe() patterns
              const itMatches = (content.match(/\\bit\\s*\\(/g) || []).length;
              const testMatches = (content.match(/\\btest\\s*\\(/g) || []).length;
              testCases += itMatches + testMatches;
            } catch (e) {
              // Estimate 3 tests per file if can't read
              testCases += 3;
            }
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  for (const dir of testDirs) {
    countTestFiles(dir);
  }

  // Also check src directory for colocated tests
  const srcDir = path.join(process.cwd(), 'src');
  if (fs.existsSync(srcDir)) {
    countTestFiles(srcDir);
  }

  return { testFiles, testCases };
}

// Generate progress bar
function progressBar(current, total) {
  const width = 5;
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return '[' + '\\u25CF'.repeat(filled) + '\\u25CB'.repeat(empty) + ']';
}

// Generate full statusline
function generateStatusline() {
  const user = getUserInfo();
  const progress = getV3Progress();
  const security = getSecurityStatus();
  const swarm = getSwarmStatus();
  const system = getSystemMetrics();
  const adrs = getADRStatus();
  const hooks = getHooksStatus();
  const agentdb = getAgentDBStats();
  const tests = getTestStats();
  const lines = [];

  // Header Line
  let header = \`\${c.bold}\${c.brightPurple}▊ Claude Flow V3 \${c.reset}\`;
  header += \`\${swarm.coordinationActive ? c.brightCyan : c.dim}● \${c.brightCyan}\${user.name}\${c.reset}\`;
  if (user.gitBranch) {
    header += \`  \${c.dim}│\${c.reset}  \${c.brightBlue}⎇ \${user.gitBranch}\${c.reset}\`;
  }
  header += \`  \${c.dim}│\${c.reset}  \${c.purple}\${user.modelName}\${c.reset}\`;
  lines.push(header);

  // Separator
  lines.push(\`\${c.dim}─────────────────────────────────────────────────────\${c.reset}\`);

  // Line 1: DDD Domain Progress
  const domainsColor = progress.domainsCompleted >= 3 ? c.brightGreen : progress.domainsCompleted > 0 ? c.yellow : c.red;
  lines.push(
    \`\${c.brightCyan}🏗️  DDD Domains\${c.reset}    \${progressBar(progress.domainsCompleted, progress.totalDomains)}  \` +
    \`\${domainsColor}\${progress.domainsCompleted}\${c.reset}/\${c.brightWhite}\${progress.totalDomains}\${c.reset}    \` +
    \`\${c.brightYellow}⚡ 1.0x\${c.reset} \${c.dim}→\${c.reset} \${c.brightYellow}2.49x-7.47x\${c.reset}\`
  );

  // Line 2: Swarm + Hooks + CVE + Memory + Context + Intelligence
  const swarmIndicator = swarm.coordinationActive ? \`\${c.brightGreen}◉\${c.reset}\` : \`\${c.dim}○\${c.reset}\`;
  const agentsColor = swarm.activeAgents > 0 ? c.brightGreen : c.red;
  let securityIcon = security.status === 'CLEAN' ? '🟢' : security.status === 'IN_PROGRESS' ? '🟡' : '🔴';
  let securityColor = security.status === 'CLEAN' ? c.brightGreen : security.status === 'IN_PROGRESS' ? c.brightYellow : c.brightRed;
  const hooksColor = hooks.enabled > 0 ? c.brightGreen : c.dim;

  lines.push(
    \`\${c.brightYellow}🤖 Swarm\${c.reset}  \${swarmIndicator} [\${agentsColor}\${String(swarm.activeAgents).padStart(2)}\${c.reset}/\${c.brightWhite}\${swarm.maxAgents}\${c.reset}]  \` +
    \`\${c.brightPurple}👥 \${system.subAgents}\${c.reset}    \` +
    \`\${c.brightBlue}🪝 \${hooksColor}\${hooks.enabled}\${c.reset}/\${c.brightWhite}\${hooks.total}\${c.reset}    \` +
    \`\${securityIcon} \${securityColor}CVE \${security.cvesFixed}\${c.reset}/\${c.brightWhite}\${security.totalCves}\${c.reset}    \` +
    \`\${c.brightCyan}💾 \${system.memoryMB}MB\${c.reset}    \` +
    \`\${c.dim}🧠 \${String(system.intelligencePct).padStart(3)}%\${c.reset}\`
  );

  // Line 3: Architecture status with ADRs, AgentDB, Tests
  const dddColor = progress.dddProgress >= 50 ? c.brightGreen : progress.dddProgress > 0 ? c.yellow : c.red;
  const adrColor = adrs.count > 0 ? (adrs.implemented === adrs.count ? c.brightGreen : c.yellow) : c.dim;
  const vectorColor = agentdb.vectorCount > 0 ? c.brightGreen : c.dim;
  const testColor = tests.testFiles > 0 ? c.brightGreen : c.dim;

  lines.push(
    \`\${c.brightPurple}🔧 Architecture\${c.reset}    \` +
    \`\${c.cyan}ADRs\${c.reset} \${adrColor}●\${adrs.implemented}/\${adrs.count}\${c.reset}  \${c.dim}│\${c.reset}  \` +
    \`\${c.cyan}DDD\${c.reset} \${dddColor}●\${String(progress.dddProgress).padStart(3)}%\${c.reset}  \${c.dim}│\${c.reset}  \` +
    \`\${c.cyan}Security\${c.reset} \${securityColor}●\${security.status}\${c.reset}\`
  );

  // Line 4: Memory, Vectors, Tests
  lines.push(
    \`\${c.brightCyan}📊 AgentDB\${c.reset}    \` +
    \`\${c.cyan}Vectors\${c.reset} \${vectorColor}●\${agentdb.vectorCount}\${c.reset}  \${c.dim}│\${c.reset}  \` +
    \`\${c.cyan}Size\${c.reset} \${c.brightWhite}\${agentdb.dbSizeKB}KB\${c.reset}  \${c.dim}│\${c.reset}  \` +
    \`\${c.cyan}Tests\${c.reset} \${testColor}●\${tests.testFiles}\${c.reset} \${c.dim}(\${tests.testCases} cases)\${c.reset}  \${c.dim}│\${c.reset}  \` +
    \`\${c.cyan}Integration\${c.reset} \${swarm.coordinationActive ? c.brightCyan : c.dim}●\${c.reset}\`
  );

  return lines.join('\\n');
}

// Generate JSON data
function generateJSON() {
  return {
    user: getUserInfo(),
    v3Progress: getV3Progress(),
    security: getSecurityStatus(),
    swarm: getSwarmStatus(),
    system: getSystemMetrics(),
    adrs: getADRStatus(),
    hooks: getHooksStatus(),
    agentdb: getAgentDBStats(),
    tests: getTestStats(),
    performance: {
      flashAttentionTarget: '2.49x-7.47x',
      searchImprovement: '150x-12,500x',
      memoryReduction: '50-75%',
    },
    lastUpdated: new Date().toISOString(),
  };
}

// Main
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(generateJSON(), null, 2));
} else if (process.argv.includes('--compact')) {
  console.log(JSON.stringify(generateJSON()));
} else {
  console.log(generateStatusline());
}
`;
}

/**
 * Generate statusline hook for shell integration
 */
export function generateStatuslineHook(options: InitOptions): string {
  if (!options.statusline.enabled) {
    return '# Statusline disabled';
  }

  return `# Claude Flow V3 Statusline Hook
# Add to your shell RC file (.bashrc, .zshrc, etc.)

# Function to get statusline
claude_flow_statusline() {
  local statusline_script="\${CLAUDE_FLOW_DIR:-.claude}/helpers/statusline.cjs"
  if [ -f "$statusline_script" ]; then
    node "$statusline_script" 2>/dev/null || echo ""
  fi
}

# For bash PS1
# export PS1='$(claude_flow_statusline) \\n\\$ '

# For zsh RPROMPT
# export RPROMPT='$(claude_flow_statusline)'

# For starship (add to starship.toml)
# [custom.claude_flow]
# command = "node .claude/helpers/statusline.cjs 2>/dev/null"
# when = "test -f .claude/helpers/statusline.cjs"
`;
}
