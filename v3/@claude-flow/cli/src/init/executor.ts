/**
 * Init Executor
 * Main execution logic for V3 initialization
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { InitOptions, InitResult, PlatformInfo } from './types.js';
import { detectPlatform, DEFAULT_INIT_OPTIONS } from './types.js';
import { generateSettingsJson, generateSettings } from './settings-generator.js';
import { generateMCPJson } from './mcp-generator.js';
import { generateStatuslineScript, generateStatuslineHook } from './statusline-generator.js';
import {
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
} from './helpers-generator.js';
import { generateClaudeMd } from './claudemd-generator.js';

/**
 * Skills to copy based on configuration
 */
const SKILLS_MAP: Record<string, string[]> = {
  core: [
    'swarm-orchestration',
    'swarm-advanced',
    'sparc-methodology',
    'hooks-automation',
    'pair-programming',
    'verification-quality',
    'stream-chain',
    'skill-builder',
  ],
  browser: ['browser'],  // agent-browser integration
  dualMode: ['dual-mode'],  // Claude Code + Codex hybrid execution
  agentdb: [
    'agentdb-advanced',
    'agentdb-learning',
    'agentdb-memory-patterns',
    'agentdb-optimization',
    'agentdb-vector-search',
    'reasoningbank-agentdb',
    'reasoningbank-intelligence',
  ],
  github: [
    'github-code-review',
    'github-multi-repo',
    'github-project-management',
    'github-release-management',
    'github-workflow-automation',
  ],
  flowNexus: [
    'flow-nexus-neural',
    'flow-nexus-platform',
    'flow-nexus-swarm',
  ],
  v3: [
    'v3-cli-modernization',
    'v3-core-implementation',
    'v3-ddd-architecture',
    'v3-integration-deep',
    'v3-mcp-optimization',
    'v3-memory-unification',
    'v3-performance-optimization',
    'v3-security-overhaul',
    'v3-swarm-coordination',
  ],
};

/**
 * Commands to copy based on configuration
 */
const COMMANDS_MAP: Record<string, string[]> = {
  core: ['claude-flow-help.md', 'claude-flow-swarm.md', 'claude-flow-memory.md'],
  analysis: ['analysis'],
  automation: ['automation'],
  github: ['github'],
  hooks: ['hooks'],
  monitoring: ['monitoring'],
  optimization: ['optimization'],
  sparc: ['sparc'],
};

/**
 * Agents to copy based on configuration
 */
const AGENTS_MAP: Record<string, string[]> = {
  core: ['core'],
  consensus: ['voting'],
  github: ['github'],
  hiveMind: ['hive-mind'],
  sparc: ['sparc'],
  swarm: ['swarm'],
  browser: ['browser'],  // agent-browser integration
  dualMode: ['dual-mode'],  // Claude Code + Codex hybrid execution
  // V3-specific agents
  v3: ['v3'],
  optimization: ['optimization'],
  templates: ['templates'],
  testing: ['testing'],
  sublinear: ['sublinear'],
  flowNexus: ['flow-nexus'],
  analysis: ['analysis'],
  architecture: ['architecture'],
  development: ['development'],
  devops: ['devops'],
  documentation: ['documentation'],
  specialized: ['specialized'],
  goal: ['goal'],
  sona: ['sona'],
  payments: ['payments'],
  data: ['data'],
  custom: ['custom'],
};

/**
 * Directory structure to create
 */
const DIRECTORIES = {
  claude: [
    '.claude',
    '.claude/skills',
    '.claude/commands',
    '.claude/agents',
    '.claude/helpers',
  ],
  runtime: [
    '.claude-flow',
    '.claude-flow/data',
    '.claude-flow/logs',
    '.claude-flow/sessions',
    '.claude-flow/hooks',
    '.claude-flow/agents',
    '.claude-flow/workflows',
  ],
};

/**
 * Execute initialization
 */
export async function executeInit(options: InitOptions): Promise<InitResult> {
  // Detect platform
  const platform = detectPlatform();

  const result: InitResult = {
    success: true,
    platform,
    created: {
      directories: [],
      files: [],
    },
    skipped: [],
    errors: [],
    summary: {
      skillsCount: 0,
      commandsCount: 0,
      agentsCount: 0,
      hooksEnabled: 0,
    },
  };

  const targetDir = options.targetDir;

  try {
    // Create directory structure
    await createDirectories(targetDir, options, result);

    // Generate and write settings.json
    if (options.components.settings) {
      await writeSettings(targetDir, options, result);
    }

    // Generate and write .mcp.json
    if (options.components.mcp) {
      await writeMCPConfig(targetDir, options, result);
    }

    // Copy skills
    if (options.components.skills) {
      await copySkills(targetDir, options, result);
    }

    // Copy commands
    if (options.components.commands) {
      await copyCommands(targetDir, options, result);
    }

    // Copy agents
    if (options.components.agents) {
      await copyAgents(targetDir, options, result);
    }

    // Generate helpers
    if (options.components.helpers) {
      await writeHelpers(targetDir, options, result);
    }

    // Generate statusline
    if (options.components.statusline) {
      await writeStatusline(targetDir, options, result);
    }

    // Generate runtime config
    if (options.components.runtime) {
      await writeRuntimeConfig(targetDir, options, result);
    }

    // Create initial metrics for statusline (prevents "all zeros" display)
    if (options.components.statusline) {
      await writeInitialMetrics(targetDir, options, result);
    }

    // Generate CLAUDE.md
    if (options.components.claudeMd) {
      await writeClaudeMd(targetDir, options, result);
    }

    // Count enabled hooks
    result.summary.hooksEnabled = countEnabledHooks(options);

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Upgrade result interface
 */
export interface UpgradeResult {
  success: boolean;
  updated: string[];
  created: string[];
  preserved: string[];
  errors: string[];
  /** Added by --add-missing flag */
  addedSkills?: string[];
  addedAgents?: string[];
  addedCommands?: string[];
  /** Added by --settings flag */
  settingsUpdated?: string[];
}

/**
 * Merge new settings into existing settings.json
 * Preserves user customizations while adding new features like Agent Teams
 * Uses platform-specific commands for Mac, Linux, and Windows
 */
function mergeSettingsForUpgrade(existing: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...existing };
  const platform = detectPlatform();
  const isWindows = platform.os === 'windows';

  // Platform-specific command wrappers
  // Windows: Use PowerShell-compatible commands
  // Mac/Linux: Use bash-compatible commands with 2>/dev/null
  const teammateIdleCmd = isWindows
    ? 'npx @claude-flow/cli@latest hooks teammate-idle --auto-assign true 2>$null; exit 0'
    : 'npx @claude-flow/cli@latest hooks teammate-idle --auto-assign true 2>/dev/null || true';

  const taskCompletedCmd = isWindows
    ? 'if ($env:TASK_ID) { npx @claude-flow/cli@latest hooks task-completed --task-id $env:TASK_ID --train-patterns true 2>$null }; exit 0'
    : '[ -n "$TASK_ID" ] && npx @claude-flow/cli@latest hooks task-completed --task-id "$TASK_ID" --train-patterns true 2>/dev/null || true';

  // 1. Merge env vars (preserve existing, add new)
  const existingEnv = (existing.env as Record<string, string>) || {};
  merged.env = {
    ...existingEnv,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    CLAUDE_FLOW_V3_ENABLED: existingEnv.CLAUDE_FLOW_V3_ENABLED || 'true',
    CLAUDE_FLOW_HOOKS_ENABLED: existingEnv.CLAUDE_FLOW_HOOKS_ENABLED || 'true',
  };

  // 2. Merge hooks (preserve existing, add new Agent Teams hooks)
  const existingHooks = (existing.hooks as Record<string, unknown[]>) || {};
  merged.hooks = { ...existingHooks };

  // Add TeammateIdle hook if not present
  if (!existingHooks.TeammateIdle) {
    (merged.hooks as Record<string, unknown[]>).TeammateIdle = [
      {
        hooks: [
          {
            type: 'command',
            command: teammateIdleCmd,
            timeout: 5000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Add TaskCompleted hook if not present
  if (!existingHooks.TaskCompleted) {
    (merged.hooks as Record<string, unknown[]>).TaskCompleted = [
      {
        hooks: [
          {
            type: 'command',
            command: taskCompletedCmd,
            timeout: 5000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // 3. Merge claudeFlow settings (preserve existing, add agentTeams)
  const existingClaudeFlow = (existing.claudeFlow as Record<string, unknown>) || {};
  merged.claudeFlow = {
    ...existingClaudeFlow,
    version: existingClaudeFlow.version || '3.0.0',
    enabled: existingClaudeFlow.enabled !== false,
    agentTeams: {
      enabled: true,
      teammateMode: 'auto',
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        autoAssignOnIdle: true,
        trainPatternsOnComplete: true,
        notifyLeadOnComplete: true,
        sharedMemoryNamespace: 'agent-teams',
      },
      hooks: {
        teammateIdle: { enabled: true, autoAssign: true, checkTaskList: true },
        taskCompleted: { enabled: true, trainPatterns: true, notifyLead: true },
      },
    },
  };

  return merged;
}

/**
 * Execute upgrade - updates helpers and creates missing metrics without losing data
 * This is safe for existing users who want the latest statusline fixes
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgrade(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  const result: UpgradeResult = {
    success: true,
    updated: [],
    created: [],
    preserved: [],
    errors: [],
    settingsUpdated: [],
  };

  try {
    // Ensure required directories exist
    const dirs = [
      '.claude/helpers',
      '.claude-flow/metrics',
      '.claude-flow/security',
      '.claude-flow/learning',
    ];

    for (const dir of dirs) {
      const fullPath = path.join(targetDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // 1. ALWAYS update statusline helper (force overwrite)
    const statuslinePath = path.join(targetDir, '.claude', 'helpers', 'statusline.cjs');
    // Use default options with statusline config
    const upgradeOptions: InitOptions = {
      ...DEFAULT_INIT_OPTIONS,
      targetDir,
      force: true,
      statusline: {
        ...DEFAULT_INIT_OPTIONS.statusline,
        refreshInterval: 5000,
      },
    };
    const statuslineContent = generateStatuslineScript(upgradeOptions);

    if (fs.existsSync(statuslinePath)) {
      result.updated.push('.claude/helpers/statusline.cjs');
    } else {
      result.created.push('.claude/helpers/statusline.cjs');
    }
    fs.writeFileSync(statuslinePath, statuslineContent, 'utf-8');

    // 2. Create MISSING metrics files only (preserve existing data)
    const metricsDir = path.join(targetDir, '.claude-flow', 'metrics');
    const securityDir = path.join(targetDir, '.claude-flow', 'security');

    // v3-progress.json
    const progressPath = path.join(metricsDir, 'v3-progress.json');
    if (!fs.existsSync(progressPath)) {
      const progress = {
        version: '3.0.0',
        initialized: new Date().toISOString(),
        domains: { completed: 0, total: 5, status: 'INITIALIZING' },
        ddd: { progress: 0, modules: 0, totalFiles: 0, totalLines: 0 },
        swarm: { activeAgents: 0, maxAgents: 15, topology: 'hierarchical-mesh' },
        learning: { status: 'READY', patternsLearned: 0, sessionsCompleted: 0 },
        _note: 'Metrics will update as you use Claude Flow'
      };
      fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/v3-progress.json');
    } else {
      result.preserved.push('.claude-flow/metrics/v3-progress.json');
    }

    // swarm-activity.json
    const activityPath = path.join(metricsDir, 'swarm-activity.json');
    if (!fs.existsSync(activityPath)) {
      const activity = {
        timestamp: new Date().toISOString(),
        processes: { agentic_flow: 0, mcp_server: 0, estimated_agents: 0 },
        swarm: { active: false, agent_count: 0, coordination_active: false },
        integration: { agentic_flow_active: false, mcp_active: false },
        _initialized: true
      };
      fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/swarm-activity.json');
    } else {
      result.preserved.push('.claude-flow/metrics/swarm-activity.json');
    }

    // learning.json
    const learningPath = path.join(metricsDir, 'learning.json');
    if (!fs.existsSync(learningPath)) {
      const learning = {
        initialized: new Date().toISOString(),
        routing: { accuracy: 0, decisions: 0 },
        patterns: { shortTerm: 0, longTerm: 0, quality: 0 },
        sessions: { total: 0, current: null },
        _note: 'Intelligence grows as you use Claude Flow'
      };
      fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
      result.created.push('.claude-flow/metrics/learning.json');
    } else {
      result.preserved.push('.claude-flow/metrics/learning.json');
    }

    // audit-status.json
    const auditPath = path.join(securityDir, 'audit-status.json');
    if (!fs.existsSync(auditPath)) {
      const audit = {
        initialized: new Date().toISOString(),
        status: 'PENDING',
        cvesFixed: 0,
        totalCves: 3,
        lastScan: null,
        _note: 'Run: npx @claude-flow/cli@latest security scan'
      };
      fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
      result.created.push('.claude-flow/security/audit-status.json');
    } else {
      result.preserved.push('.claude-flow/security/audit-status.json');
    }

    // 3. Merge settings if requested
    if (upgradeSettings) {
      const settingsPath = path.join(targetDir, '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          const mergedSettings = mergeSettingsForUpgrade(existingSettings);
          fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
          result.updated.push('.claude/settings.json');
          result.settingsUpdated = [
            'env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
            'hooks.TeammateIdle',
            'hooks.TaskCompleted',
            'claudeFlow.agentTeams',
          ];
        } catch (settingsError) {
          result.errors.push(`Settings merge failed: ${settingsError instanceof Error ? settingsError.message : String(settingsError)}`);
        }
      } else {
        // Create new settings.json with defaults
        const defaultSettings = generateSettings(DEFAULT_INIT_OPTIONS);
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf-8');
        result.created.push('.claude/settings.json');
        result.settingsUpdated = ['Created new settings.json with Agent Teams'];
      }
    }

  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
  }

  return result;
}

/**
 * Execute upgrade with --add-missing flag
 * Adds any new skills, agents, and commands that don't exist yet
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export async function executeUpgradeWithMissing(targetDir: string, upgradeSettings = false): Promise<UpgradeResult> {
  // First do the normal upgrade (pass through upgradeSettings)
  const result = await executeUpgrade(targetDir, upgradeSettings);

  if (!result.success) {
    return result;
  }

  // Initialize tracking arrays
  result.addedSkills = [];
  result.addedAgents = [];
  result.addedCommands = [];

  try {
    // Ensure target directories exist
    const skillsDir = path.join(targetDir, '.claude', 'skills');
    const agentsDir = path.join(targetDir, '.claude', 'agents');
    const commandsDir = path.join(targetDir, '.claude', 'commands');

    for (const dir of [skillsDir, agentsDir, commandsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Find source directories
    const sourceSkillsDir = findSourceDir('skills');
    const sourceAgentsDir = findSourceDir('agents');
    const sourceCommandsDir = findSourceDir('commands');

    // Debug: Log source directories found
    if (process.env.DEBUG || process.env.CLAUDE_FLOW_DEBUG) {
      console.log('[DEBUG] Source directories:');
      console.log(`  Skills: ${sourceSkillsDir || 'NOT FOUND'}`);
      console.log(`  Agents: ${sourceAgentsDir || 'NOT FOUND'}`);
      console.log(`  Commands: ${sourceCommandsDir || 'NOT FOUND'}`);
    }

    // Add missing skills
    if (sourceSkillsDir) {
      const allSkills = Object.values(SKILLS_MAP).flat();
      const debugMode = process.env.DEBUG || process.env.CLAUDE_FLOW_DEBUG;
      if (debugMode) {
        console.log(`[DEBUG] Checking ${allSkills.length} skills from SKILLS_MAP`);
      }
      for (const skillName of [...new Set(allSkills)]) {
        const sourcePath = path.join(sourceSkillsDir, skillName);
        const targetPath = path.join(skillsDir, skillName);
        const sourceExists = fs.existsSync(sourcePath);
        const targetExists = fs.existsSync(targetPath);

        if (debugMode) {
          console.log(`[DEBUG] Skill '${skillName}': source=${sourceExists}, target=${targetExists}`);
        }

        if (sourceExists && !targetExists) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedSkills.push(skillName);
          result.created.push(`.claude/skills/${skillName}`);
        }
      }
    }

    // Add missing agents
    if (sourceAgentsDir) {
      const allAgents = Object.values(AGENTS_MAP).flat();
      for (const agentCategory of [...new Set(allAgents)]) {
        const sourcePath = path.join(sourceAgentsDir, agentCategory);
        const targetPath = path.join(agentsDir, agentCategory);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          copyDirRecursive(sourcePath, targetPath);
          result.addedAgents.push(agentCategory);
          result.created.push(`.claude/agents/${agentCategory}`);
        }
      }
    }

    // Add missing commands
    if (sourceCommandsDir) {
      const allCommands = Object.values(COMMANDS_MAP).flat();
      for (const cmdName of [...new Set(allCommands)]) {
        const sourcePath = path.join(sourceCommandsDir, cmdName);
        const targetPath = path.join(commandsDir, cmdName);

        if (fs.existsSync(sourcePath) && !fs.existsSync(targetPath)) {
          if (fs.statSync(sourcePath).isDirectory()) {
            copyDirRecursive(sourcePath, targetPath);
          } else {
            fs.copyFileSync(sourcePath, targetPath);
          }
          result.addedCommands.push(cmdName);
          result.created.push(`.claude/commands/${cmdName}`);
        }
      }
    }

  } catch (error) {
    result.errors.push(`Add missing failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

/**
 * Create directory structure
 */
async function createDirectories(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const dirs = [
    ...DIRECTORIES.claude,
    ...(options.components.runtime ? DIRECTORIES.runtime : []),
  ];

  for (const dir of dirs) {
    const fullPath = path.join(targetDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      result.created.directories.push(dir);
    }
  }
}

/**
 * Write settings.json
 */
async function writeSettings(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');

  if (fs.existsSync(settingsPath) && !options.force) {
    result.skipped.push('.claude/settings.json');
    return;
  }

  const content = generateSettingsJson(options);
  fs.writeFileSync(settingsPath, content, 'utf-8');
  result.created.files.push('.claude/settings.json');
}

/**
 * Write .mcp.json
 */
async function writeMCPConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const mcpPath = path.join(targetDir, '.mcp.json');

  if (fs.existsSync(mcpPath) && !options.force) {
    result.skipped.push('.mcp.json');
    return;
  }

  const content = generateMCPJson(options);
  fs.writeFileSync(mcpPath, content, 'utf-8');
  result.created.files.push('.mcp.json');
}

/**
 * Copy skills from source
 */
async function copySkills(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const skillsConfig = options.skills;
  const targetSkillsDir = path.join(targetDir, '.claude', 'skills');

  // Determine which skills to copy
  const skillsToCopy: string[] = [];

  if (skillsConfig.all) {
    // Copy all available skills
    Object.values(SKILLS_MAP).forEach(skills => skillsToCopy.push(...skills));
  } else {
    if (skillsConfig.core) skillsToCopy.push(...SKILLS_MAP.core);
    if (skillsConfig.agentdb) skillsToCopy.push(...SKILLS_MAP.agentdb);
    if (skillsConfig.github) skillsToCopy.push(...SKILLS_MAP.github);
    if (skillsConfig.flowNexus) skillsToCopy.push(...SKILLS_MAP.flowNexus);
    if (skillsConfig.browser) skillsToCopy.push(...SKILLS_MAP.browser);
    if (skillsConfig.v3) skillsToCopy.push(...SKILLS_MAP.v3);
    if (skillsConfig.dualMode) skillsToCopy.push(...SKILLS_MAP.dualMode);
  }

  // Find source skills directory
  const sourceSkillsDir = findSourceDir('skills', options.sourceBaseDir);
  if (!sourceSkillsDir) {
    result.errors.push('Could not find source skills directory');
    return;
  }

  // Copy each skill
  for (const skillName of [...new Set(skillsToCopy)]) {
    const sourcePath = path.join(sourceSkillsDir, skillName);
    const targetPath = path.join(targetSkillsDir, skillName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        result.created.files.push(`.claude/skills/${skillName}`);
        result.summary.skillsCount++;
      } else {
        result.skipped.push(`.claude/skills/${skillName}`);
      }
    }
  }
}

/**
 * Copy commands from source
 */
async function copyCommands(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const commandsConfig = options.commands;
  const targetCommandsDir = path.join(targetDir, '.claude', 'commands');

  // Determine which commands to copy
  const commandsToCopy: string[] = [];

  if (commandsConfig.all) {
    Object.values(COMMANDS_MAP).forEach(cmds => commandsToCopy.push(...cmds));
  } else {
    if (commandsConfig.core) commandsToCopy.push(...COMMANDS_MAP.core);
    if (commandsConfig.analysis) commandsToCopy.push(...COMMANDS_MAP.analysis);
    if (commandsConfig.automation) commandsToCopy.push(...COMMANDS_MAP.automation);
    if (commandsConfig.github) commandsToCopy.push(...COMMANDS_MAP.github);
    if (commandsConfig.hooks) commandsToCopy.push(...COMMANDS_MAP.hooks);
    if (commandsConfig.monitoring) commandsToCopy.push(...COMMANDS_MAP.monitoring);
    if (commandsConfig.optimization) commandsToCopy.push(...COMMANDS_MAP.optimization);
    if (commandsConfig.sparc) commandsToCopy.push(...COMMANDS_MAP.sparc);
  }

  // Find source commands directory
  const sourceCommandsDir = findSourceDir('commands', options.sourceBaseDir);
  if (!sourceCommandsDir) {
    result.errors.push('Could not find source commands directory');
    return;
  }

  // Copy each command/directory
  for (const cmdName of [...new Set(commandsToCopy)]) {
    const sourcePath = path.join(sourceCommandsDir, cmdName);
    const targetPath = path.join(targetCommandsDir, cmdName);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        if (fs.statSync(sourcePath).isDirectory()) {
          copyDirRecursive(sourcePath, targetPath);
        } else {
          fs.copyFileSync(sourcePath, targetPath);
        }
        result.created.files.push(`.claude/commands/${cmdName}`);
        result.summary.commandsCount++;
      } else {
        result.skipped.push(`.claude/commands/${cmdName}`);
      }
    }
  }
}

/**
 * Copy agents from source
 */
async function copyAgents(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const agentsConfig = options.agents;
  const targetAgentsDir = path.join(targetDir, '.claude', 'agents');

  // Determine which agents to copy
  const agentsToCopy: string[] = [];

  if (agentsConfig.all) {
    Object.values(AGENTS_MAP).forEach(agents => agentsToCopy.push(...agents));
  } else {
    if (agentsConfig.core) agentsToCopy.push(...AGENTS_MAP.core);
    if (agentsConfig.voting) agentsToCopy.push(...AGENTS_MAP.voting);
    if (agentsConfig.github) agentsToCopy.push(...AGENTS_MAP.github);
    if (agentsConfig.hiveMind) agentsToCopy.push(...AGENTS_MAP.hiveMind);
    if (agentsConfig.sparc) agentsToCopy.push(...AGENTS_MAP.sparc);
    if (agentsConfig.swarm) agentsToCopy.push(...AGENTS_MAP.swarm);
    if (agentsConfig.browser) agentsToCopy.push(...AGENTS_MAP.browser);
    // V3-specific agent categories
    if (agentsConfig.v3) agentsToCopy.push(...(AGENTS_MAP.v3 || []));
    if (agentsConfig.optimization) agentsToCopy.push(...(AGENTS_MAP.optimization || []));
    if (agentsConfig.testing) agentsToCopy.push(...(AGENTS_MAP.testing || []));
    // Dual-mode agents (Claude Code + Codex hybrid)
    if (agentsConfig.dualMode) agentsToCopy.push(...(AGENTS_MAP.dualMode || []));
  }

  // Find source agents directory
  const sourceAgentsDir = findSourceDir('agents', options.sourceBaseDir);
  if (!sourceAgentsDir) {
    result.errors.push('Could not find source agents directory');
    return;
  }

  // Copy each agent category
  for (const agentCategory of [...new Set(agentsToCopy)]) {
    const sourcePath = path.join(sourceAgentsDir, agentCategory);
    const targetPath = path.join(targetAgentsDir, agentCategory);

    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(targetPath) || options.force) {
        copyDirRecursive(sourcePath, targetPath);
        // Count agent files (.yaml and .md)
        const yamlFiles = countFiles(sourcePath, '.yaml');
        const mdFiles = countFiles(sourcePath, '.md');
        result.summary.agentsCount += yamlFiles + mdFiles;
        result.created.files.push(`.claude/agents/${agentCategory}`);
      } else {
        result.skipped.push(`.claude/agents/${agentCategory}`);
      }
    }
  }
}

/**
 * Find source helpers directory
 */
function findSourceHelpersDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', 'helpers'));
  }

  // IMPORTANT: Check the package's own .claude/helpers directory
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@claude-flow/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageHelpers = path.join(packageRoot, '.claude', 'helpers');
  if (fs.existsSync(packageHelpers)) {
    possiblePaths.unshift(packageHelpers); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const helpersPath = path.join(parentDir, '.claude', 'helpers');
    if (fs.existsSync(helpersPath)) {
      possiblePaths.push(helpersPath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', 'helpers'),
    path.join(process.cwd(), '..', '.claude', 'helpers'),
    path.join(process.cwd(), '..', '..', '.claude', 'helpers'),
  ];
  possiblePaths.push(...cwdBased);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Write helper scripts
 */
async function writeHelpers(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source helpers directory (works for npm package and local dev)
  const sourceHelpersDir = findSourceHelpersDir(options.sourceBaseDir);

  // Try to copy existing helpers from source first
  if (sourceHelpersDir && fs.existsSync(sourceHelpersDir)) {
    const helperFiles = fs.readdirSync(sourceHelpersDir);
    let copiedCount = 0;

    for (const file of helperFiles) {
      const sourcePath = path.join(sourceHelpersDir, file);
      const destPath = path.join(helpersDir, file);

      // Skip directories and only copy files
      if (!fs.statSync(sourcePath).isFile()) continue;

      if (!fs.existsSync(destPath) || options.force) {
        fs.copyFileSync(sourcePath, destPath);

        // Make shell scripts and mjs files executable
        if (file.endsWith('.sh') || file.endsWith('.mjs')) {
          fs.chmodSync(destPath, '755');
        }

        result.created.files.push(`.claude/helpers/${file}`);
        copiedCount++;
      } else {
        result.skipped.push(`.claude/helpers/${file}`);
      }
    }

    if (copiedCount > 0) {
      return; // Skip generating if we copied from source
    }
  }

  // Fall back to generating helpers if source not available
  const helpers: Record<string, string> = {
    'pre-commit': generatePreCommitHook(),
    'post-commit': generatePostCommitHook(),
    'session.js': generateSessionManager(),
    'router.js': generateAgentRouter(),
    'memory.js': generateMemoryHelper(),
  };

  for (const [name, content] of Object.entries(helpers)) {
    const filePath = path.join(helpersDir, name);

    if (!fs.existsSync(filePath) || options.force) {
      fs.writeFileSync(filePath, content, 'utf-8');

      // Make shell scripts executable
      if (!name.endsWith('.js')) {
        fs.chmodSync(filePath, '755');
      }

      result.created.files.push(`.claude/helpers/${name}`);
    } else {
      result.skipped.push(`.claude/helpers/${name}`);
    }
  }
}

/**
 * Find source .claude directory for statusline files
 */
function findSourceClaudeDir(sourceBaseDir?: string): string | null {
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, check it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude'));
  }

  // IMPORTANT: Check the package's own .claude directory
  // Go up 3 levels: dist/src/init -> dist/src -> dist -> root
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageClaude = path.join(packageRoot, '.claude');
  if (fs.existsSync(packageClaude)) {
    possiblePaths.unshift(packageClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  let currentDir = __dirname;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const claudePath = path.join(parentDir, '.claude');
    if (fs.existsSync(claudePath)) {
      possiblePaths.push(claudePath);
    }
    currentDir = parentDir;
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Write statusline configuration
 */
async function writeStatusline(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeDir = path.join(targetDir, '.claude');
  const helpersDir = path.join(targetDir, '.claude', 'helpers');

  // Find source .claude directory (works for npm package and local dev)
  const sourceClaudeDir = findSourceClaudeDir(options.sourceBaseDir);

  // Try to copy existing advanced statusline files from source
  const advancedStatuslineFiles = [
    { src: 'statusline.sh', dest: 'statusline.sh', dir: claudeDir },
    { src: 'statusline.mjs', dest: 'statusline.mjs', dir: claudeDir },
  ];

  let copiedAdvanced = false;
  if (sourceClaudeDir) {
    for (const file of advancedStatuslineFiles) {
      const sourcePath = path.join(sourceClaudeDir, file.src);
      const destPath = path.join(file.dir, file.dest);

      if (fs.existsSync(sourcePath)) {
        if (!fs.existsSync(destPath) || options.force) {
          fs.copyFileSync(sourcePath, destPath);
          // Make shell scripts and mjs executable
          if (file.src.endsWith('.sh') || file.src.endsWith('.mjs')) {
            fs.chmodSync(destPath, '755');
          }
          result.created.files.push(`.claude/${file.dest}`);
          copiedAdvanced = true;
        } else {
          result.skipped.push(`.claude/${file.dest}`);
        }
      }
    }
  }

  // Fall back to generating simple statusline if advanced files not available
  if (!copiedAdvanced) {
    const statuslineScript = generateStatuslineScript(options);
    const statuslineHook = generateStatuslineHook(options);

    const files: Record<string, string> = {
      'statusline.cjs': statuslineScript,  // .cjs for ES module project compatibility
      'statusline-hook.sh': statuslineHook,
    };

    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(helpersDir, name);

      if (!fs.existsSync(filePath) || options.force) {
        fs.writeFileSync(filePath, content, 'utf-8');
        result.created.files.push(`.claude/helpers/${name}`);
      } else {
        result.skipped.push(`.claude/helpers/${name}`);
      }
    }
  }
}

/**
 * Write runtime configuration (.claude-flow/)
 */
async function writeRuntimeConfig(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const configPath = path.join(targetDir, '.claude-flow', 'config.yaml');

  if (fs.existsSync(configPath) && !options.force) {
    result.skipped.push('.claude-flow/config.yaml');
    return;
  }

  const config = `# Claude Flow V3 Runtime Configuration
# Generated: ${new Date().toISOString()}

version: "3.0.0"

swarm:
  topology: ${options.runtime.topology}
  maxAgents: ${options.runtime.maxAgents}
  autoScale: true
  coordinationStrategy: consensus

memory:
  backend: ${options.runtime.memoryBackend}
  enableHNSW: ${options.runtime.enableHNSW}
  persistPath: .claude-flow/data
  cacheSize: 100

neural:
  enabled: ${options.runtime.enableNeural}
  modelPath: .claude-flow/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: ${options.mcp.autoStart}
  port: ${options.mcp.port}
`;

  fs.writeFileSync(configPath, config, 'utf-8');
  result.created.files.push('.claude-flow/config.yaml');

  // Write .gitignore
  const gitignorePath = path.join(targetDir, '.claude-flow', '.gitignore');
  const gitignore = `# Claude Flow runtime files
data/
logs/
sessions/
neural/
*.log
*.tmp
`;

  if (!fs.existsSync(gitignorePath) || options.force) {
    fs.writeFileSync(gitignorePath, gitignore, 'utf-8');
    result.created.files.push('.claude-flow/.gitignore');
  }

  // Write CAPABILITIES.md with full system overview
  await writeCapabilitiesDoc(targetDir, options, result);
}

/**
 * Write initial metrics files for statusline
 * Creates baseline data so statusline shows meaningful state instead of all zeros
 */
async function writeInitialMetrics(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const metricsDir = path.join(targetDir, '.claude-flow', 'metrics');
  const learningDir = path.join(targetDir, '.claude-flow', 'learning');
  const securityDir = path.join(targetDir, '.claude-flow', 'security');

  // Ensure directories exist
  for (const dir of [metricsDir, learningDir, securityDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create initial v3-progress.json
  const progressPath = path.join(metricsDir, 'v3-progress.json');
  if (!fs.existsSync(progressPath) || options.force) {
    const progress = {
      version: '3.0.0',
      initialized: new Date().toISOString(),
      domains: {
        completed: 0,
        total: 5,
        status: 'INITIALIZING'
      },
      ddd: {
        progress: 0,
        modules: 0,
        totalFiles: 0,
        totalLines: 0
      },
      swarm: {
        activeAgents: 0,
        maxAgents: options.runtime.maxAgents,
        topology: options.runtime.topology
      },
      learning: {
        status: 'READY',
        patternsLearned: 0,
        sessionsCompleted: 0
      },
      _note: 'Metrics will update as you use Claude Flow. Run: npx @claude-flow/cli@latest daemon start'
    };
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/v3-progress.json');
  }

  // Create initial swarm-activity.json
  const activityPath = path.join(metricsDir, 'swarm-activity.json');
  if (!fs.existsSync(activityPath) || options.force) {
    const activity = {
      timestamp: new Date().toISOString(),
      processes: {
        agentic_flow: 0,
        mcp_server: 0,
        estimated_agents: 0
      },
      swarm: {
        active: false,
        agent_count: 0,
        coordination_active: false
      },
      integration: {
        agentic_flow_active: false,
        mcp_active: false
      },
      _initialized: true
    };
    fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/swarm-activity.json');
  }

  // Create initial learning.json
  const learningPath = path.join(metricsDir, 'learning.json');
  if (!fs.existsSync(learningPath) || options.force) {
    const learning = {
      initialized: new Date().toISOString(),
      routing: {
        accuracy: 0,
        decisions: 0
      },
      patterns: {
        shortTerm: 0,
        longTerm: 0,
        quality: 0
      },
      sessions: {
        total: 0,
        current: null
      },
      _note: 'Intelligence grows as you use Claude Flow'
    };
    fs.writeFileSync(learningPath, JSON.stringify(learning, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/metrics/learning.json');
  }

  // Create initial audit-status.json
  const auditPath = path.join(securityDir, 'audit-status.json');
  if (!fs.existsSync(auditPath) || options.force) {
    const audit = {
      initialized: new Date().toISOString(),
      status: 'PENDING',
      cvesFixed: 0,
      totalCves: 3,
      lastScan: null,
      _note: 'Run: npx @claude-flow/cli@latest security scan'
    };
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf-8');
    result.created.files.push('.claude-flow/security/audit-status.json');
  }
}

/**
 * Write CAPABILITIES.md - comprehensive overview of all Claude Flow features
 */
async function writeCapabilitiesDoc(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const capabilitiesPath = path.join(targetDir, '.claude-flow', 'CAPABILITIES.md');

  if (fs.existsSync(capabilitiesPath) && !options.force) {
    result.skipped.push('.claude-flow/CAPABILITIES.md');
    return;
  }

  const capabilities = `# Claude Flow V3 - Complete Capabilities Reference
> Generated: ${new Date().toISOString()}
> Full documentation: https://github.com/ruvnet/claude-flow

## 📋 Table of Contents

1. [Overview](#overview)
2. [Swarm Orchestration](#swarm-orchestration)
3. [Available Agents (60+)](#available-agents)
4. [CLI Commands (26 Commands, 140+ Subcommands)](#cli-commands)
5. [Hooks System (27 Hooks + 12 Workers)](#hooks-system)
6. [Memory & Intelligence (RuVector)](#memory--intelligence)
7. [Hive-Mind Consensus](#hive-mind-consensus)
8. [Performance Targets](#performance-targets)
9. [Integration Ecosystem](#integration-ecosystem)

---

## Overview

Claude Flow V3 is a domain-driven design architecture for multi-agent AI coordination with:

- **15-Agent Swarm Coordination** with hierarchical and mesh topologies
- **HNSW Vector Search** - optimized pattern retrieval
- **Pattern Pattern Learning** - Self-optimizing with pattern caching
- **Byzantine Fault Tolerance** - Queen-led voting mechanisms
- **MCP Server Integration** - Model Context Protocol support

### Current Configuration
| Setting | Value |
|---------|-------|
| Topology | ${options.runtime.topology} |
| Max Agents | ${options.runtime.maxAgents} |
| Memory Backend | ${options.runtime.memoryBackend} |
| HNSW Indexing | ${options.runtime.enableHNSW ? 'Enabled' : 'Disabled'} |
| Pattern Learning | ${options.runtime.enableNeural ? 'Enabled' : 'Disabled'} |

---

## Swarm Orchestration

### Topologies
| Topology | Description | Best For |
|----------|-------------|----------|
| \`hierarchical\` | Queen controls workers directly | Anti-drift, tight control |
| \`mesh\` | Fully connected peer network | Distributed tasks |
| \`hierarchical-mesh\` | V3 hybrid (recommended) | 10+ agents |
| \`ring\` | Circular communication | Sequential workflows |
| \`star\` | Central coordinator | Simple coordination |
| \`adaptive\` | Dynamic based on load | Variable workloads |

### Strategies
- \`balanced\` - Even distribution across agents
- \`specialized\` - Clear roles, no overlap (anti-drift)
- \`adaptive\` - Dynamic task routing

### Quick Commands
\`\`\`bash
# Initialize swarm
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Check status
npx @claude-flow/cli@latest swarm status

# Monitor activity
npx @claude-flow/cli@latest swarm monitor
\`\`\`

---

## Available Agents

### Core Development (5)
\`coder\`, \`reviewer\`, \`tester\`, \`planner\`, \`researcher\`

### V3 Specialized (4)
\`security-architect\`, \`security-auditor\`, \`memory-specialist\`, \`performance-engineer\`

### Swarm Coordination (5)
\`hierarchical-coordinator\`, \`mesh-coordinator\`, \`adaptive-coordinator\`, \`collective-intelligence-coordinator\`, \`swarm-memory-manager\`

### Consensus & Distributed (7)
\`byzantine-coordinator\`, \`raft-manager\`, \`gossip-coordinator\`, \`consensus-builder\`, \`crdt-synchronizer\`, \`quorum-manager\`, \`security-manager\`

### Performance & Optimization (5)
\`perf-analyzer\`, \`performance-benchmarker\`, \`task-orchestrator\`, \`memory-coordinator\`, \`smart-agent\`

### GitHub & Repository (9)
\`github-modes\`, \`pr-manager\`, \`code-review-swarm\`, \`issue-tracker\`, \`release-manager\`, \`workflow-automation\`, \`project-board-sync\`, \`repo-architect\`, \`multi-repo-swarm\`

### SPARC Methodology (6)
\`sparc-coord\`, \`sparc-coder\`, \`specification\`, \`pseudocode\`, \`architecture\`, \`refinement\`

### Specialized Development (8)
\`backend-dev\`, \`mobile-dev\`, \`ml-developer\`, \`cicd-engineer\`, \`api-docs\`, \`system-architect\`, \`code-analyzer\`, \`base-template-generator\`

### Testing & Validation (2)
\`tdd-london-swarm\`, \`production-validator\`

### Agent Routing by Task
| Task Type | Recommended Agents | Topology |
|-----------|-------------------|----------|
| Bug Fix | researcher, coder, tester | mesh |
| New Feature | coordinator, architect, coder, tester, reviewer | hierarchical |
| Refactoring | architect, coder, reviewer | mesh |
| Performance | researcher, perf-engineer, coder | hierarchical |
| Security | security-architect, auditor, reviewer | hierarchical |
| Docs | researcher, api-docs | mesh |

---

## CLI Commands

### Core Commands (12)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`init\` | 4 | Project initialization |
| \`agent\` | 8 | Agent lifecycle management |
| \`swarm\` | 6 | Multi-agent coordination |
| \`memory\` | 11 | AgentDB with HNSW search |
| \`mcp\` | 9 | MCP server management |
| \`task\` | 6 | Task assignment |
| \`session\` | 7 | Session persistence |
| \`config\` | 7 | Configuration |
| \`status\` | 3 | System monitoring |
| \`workflow\` | 6 | Workflow templates |
| \`hooks\` | 17 | Self-learning hooks |
| \`hive-mind\` | 6 | Consensus coordination |

### Advanced Commands (14)
| Command | Subcommands | Description |
|---------|-------------|-------------|
| \`daemon\` | 5 | Background workers |
| \`neural\` | 5 | Pattern training |
| \`security\` | 6 | Security scanning |
| \`performance\` | 5 | Profiling & benchmarks |
| \`providers\` | 5 | AI provider config |
| \`plugins\` | 5 | Plugin management |
| \`deployment\` | 5 | Deploy management |
| \`embeddings\` | 4 | Vector embeddings |
| \`claims\` | 4 | Authorization |
| \`migrate\` | 5 | V2→V3 migration |
| \`process\` | 4 | Process management |
| \`doctor\` | 1 | Health diagnostics |
| \`completions\` | 4 | Shell completions |

### Example Commands
\`\`\`bash
# Initialize
npx @claude-flow/cli@latest init --wizard

# Spawn agent
npx @claude-flow/cli@latest agent spawn -t coder --name my-coder

# Memory operations
npx @claude-flow/cli@latest memory store --key "pattern" --value "data" --namespace patterns
npx @claude-flow/cli@latest memory search --query "authentication"

# Diagnostics
npx @claude-flow/cli@latest doctor --fix
\`\`\`

---

## Hooks System

### 27 Available Hooks

#### Core Hooks (6)
| Hook | Description |
|------|-------------|
| \`pre-edit\` | Context before file edits |
| \`post-edit\` | Record edit outcomes |
| \`pre-command\` | Risk assessment |
| \`post-command\` | Command metrics |
| \`pre-task\` | Task start + agent suggestions |
| \`post-task\` | Task completion learning |

#### Session Hooks (4)
| Hook | Description |
|------|-------------|
| \`session-start\` | Start/restore session |
| \`session-end\` | Persist state |
| \`session-restore\` | Restore previous |
| \`notify\` | Cross-agent notifications |

#### Intelligence Hooks (5)
| Hook | Description |
|------|-------------|
| \`route\` | Optimal agent routing |
| \`explain\` | Routing decisions |
| \`pretrain\` | Bootstrap intelligence |
| \`build-agents\` | Generate configs |
| \`transfer\` | Pattern transfer |

#### Coverage Hooks (3)
| Hook | Description |
|------|-------------|
| \`coverage-route\` | Coverage-based routing |
| \`coverage-suggest\` | Improvement suggestions |
| \`coverage-gaps\` | Gap analysis |

### 12 Background Workers
| Worker | Priority | Purpose |
|--------|----------|---------|
| \`ultralearn\` | normal | Deep knowledge |
| \`optimize\` | high | Performance |
| \`consolidate\` | low | Memory consolidation |
| \`predict\` | normal | Predictive preload |
| \`audit\` | critical | Security |
| \`map\` | normal | Codebase mapping |
| \`preload\` | low | Resource preload |
| \`deepdive\` | normal | Deep analysis |
| \`document\` | normal | Auto-docs |
| \`refactor\` | normal | Suggestions |
| \`benchmark\` | normal | Benchmarking |
| \`testgaps\` | normal | Coverage gaps |

---

## Memory & Intelligence

### RuVector Intelligence System
- **Pattern**: Self-Optimizing Pattern Architecture (sub-ms)
- **MoE**: Mixture of Experts routing
- **HNSW**: optimized search
- **EWC++**: Prevents catastrophic forgetting
- **Flash Attention**: CPU-optimized
- **Int8 Quantization**: memory-efficient

### 4-Step Intelligence Pipeline
1. **RETRIEVE** - HNSW pattern search
2. **JUDGE** - Success/failure verdicts
3. **DISTILL** - LoRA learning extraction
4. **CONSOLIDATE** - EWC++ preservation

### Memory Commands
\`\`\`bash
# Store pattern
npx @claude-flow/cli@latest memory store --key "name" --value "data" --namespace patterns

# Semantic search
npx @claude-flow/cli@latest memory search --query "authentication"

# List entries
npx @claude-flow/cli@latest memory list --namespace patterns

# Initialize database
npx @claude-flow/cli@latest memory init --force
\`\`\`

---

## Hive-Mind Consensus

### Queen Types
| Type | Role |
|------|------|
| Strategic Queen | Long-term planning |
| Tactical Queen | Execution coordination |
| Adaptive Queen | Dynamic optimization |

### Worker Types (8)
\`researcher\`, \`coder\`, \`analyst\`, \`tester\`, \`architect\`, \`reviewer\`, \`optimizer\`, \`documenter\`

### Consensus Mechanisms
| Mechanism | Fault Tolerance | Use Case |
|-----------|-----------------|----------|
| \`byzantine\` | f < n/3 faulty | Adversarial |
| \`raft\` | f < n/2 failed | Leader-based |
| \`gossip\` | Eventually consistent | Large scale |
| \`crdt\` | Conflict-free | Distributed |
| \`quorum\` | Configurable | Flexible |

### Hive-Mind Commands
\`\`\`bash
# Initialize
npx @claude-flow/cli@latest hive-mind init --queen-type strategic

# Status
npx @claude-flow/cli@latest hive-mind status

# Spawn workers
npx @claude-flow/cli@latest hive-mind spawn --count 5 --type worker

# Consensus
npx @claude-flow/cli@latest hive-mind consensus --propose "task"
\`\`\`

---

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | optimized | ✅ Implemented |
| Memory Reduction | 50-75% | ✅ Implemented (3.92x) |
| Pattern Integration | Pattern learning | ✅ Implemented |
| Flash Attention | CPU-optimized | 🔄 In Progress |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |
| Pattern Adaptation | sub-ms | 🔄 In Progress |

---

## Integration Ecosystem

### Integrated Packages
| Package | Version | Purpose |
|---------|---------|---------|
| agentic-flow | 2.0.1-alpha | Core coordination |
| agentdb | 2.0.0-alpha.3.4 | Vector database |
| @ruvector/attention | 0.1.3 | Flash attention |
| @ruvector/sona | 0.1.5 | Neural learning |

### Optional Integrations
| Package | Command |
|---------|---------|
| ruv-swarm | \`npx ruv-swarm mcp start\` |
| flow-nexus | \`npx flow-nexus@latest mcp start\` |
| agentic-jujutsu | \`npx agentic-jujutsu@latest\` |

### MCP Server Setup
\`\`\`bash
# Add Claude Flow MCP
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest

# Optional servers
claude mcp add ruv-swarm -- npx -y ruv-swarm mcp start
claude mcp add flow-nexus -- npx -y flow-nexus@latest mcp start
\`\`\`

---

## Quick Reference

### Essential Commands
\`\`\`bash
# Setup
npx @claude-flow/cli@latest init --wizard
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix

# Swarm
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8
npx @claude-flow/cli@latest swarm status

# Agents
npx @claude-flow/cli@latest agent spawn -t coder
npx @claude-flow/cli@latest agent list

# Memory
npx @claude-flow/cli@latest memory search --query "patterns"

# Hooks
npx @claude-flow/cli@latest hooks pre-task --description "task"
npx @claude-flow/cli@latest hooks worker dispatch --trigger optimize
\`\`\`

### File Structure
\`\`\`
.claude-flow/
├── config.yaml      # Runtime configuration
├── CAPABILITIES.md  # This file
├── data/            # Memory storage
├── logs/            # Operation logs
├── sessions/        # Session state
├── hooks/           # Custom hooks
├── agents/          # Agent configs
└── workflows/       # Workflow templates
\`\`\`

---

**Full Documentation**: https://github.com/ruvnet/claude-flow
**Issues**: https://github.com/ruvnet/claude-flow/issues
`;

  fs.writeFileSync(capabilitiesPath, capabilities, 'utf-8');
  result.created.files.push('.claude-flow/CAPABILITIES.md');
}

/**
 * Write CLAUDE.md with swarm guidance
 */
async function writeClaudeMd(
  targetDir: string,
  options: InitOptions,
  result: InitResult
): Promise<void> {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(claudeMdPath) && !options.force) {
    result.skipped.push('CLAUDE.md');
    return;
  }

  // Determine template: explicit option > infer from components > 'standard'
  const inferredTemplate = (!options.components.commands && !options.components.agents) ? 'minimal' : undefined;
  const content = generateClaudeMd(options, inferredTemplate);

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
  result.created.files.push('CLAUDE.md');
}

/**
 * Find source directory for skills/commands/agents
 */
function findSourceDir(type: 'skills' | 'commands' | 'agents', sourceBaseDir?: string): string | null {
  // Build list of possible paths to check
  const possiblePaths: string[] = [];

  // If explicit source base directory is provided, use it first
  if (sourceBaseDir) {
    possiblePaths.push(path.join(sourceBaseDir, '.claude', type));
  }

  // IMPORTANT: Check the package's own .claude directory first
  // This is the primary path when running as an npm package
  // __dirname is typically /path/to/node_modules/@claude-flow/cli/dist/src/init
  // We need to go up 3 levels to reach the package root (dist/src/init -> dist/src -> dist -> root)
  const packageRoot = path.resolve(__dirname, '..', '..', '..');
  const packageDotClaude = path.join(packageRoot, '.claude', type);
  if (fs.existsSync(packageDotClaude)) {
    possiblePaths.unshift(packageDotClaude); // Add to beginning (highest priority)
  }

  // From dist/src/init -> go up to project root
  const distPath = __dirname;

  // Try to find the project root by looking for .claude directory
  let currentDir = distPath;
  for (let i = 0; i < 10; i++) {
    const parentDir = path.dirname(currentDir);
    const dotClaudePath = path.join(parentDir, '.claude', type);
    if (fs.existsSync(dotClaudePath)) {
      possiblePaths.push(dotClaudePath);
    }
    currentDir = parentDir;
  }

  // Also check relative to process.cwd() for development
  const cwdBased = [
    path.join(process.cwd(), '.claude', type),
    path.join(process.cwd(), '..', '.claude', type),
    path.join(process.cwd(), '..', '..', '.claude', type),
  ];
  possiblePaths.push(...cwdBased);

  // Check v2 directory for agents
  if (type === 'agents') {
    possiblePaths.push(
      path.join(process.cwd(), 'v2', '.claude', type),
      path.join(process.cwd(), '..', 'v2', '.claude', type),
    );
  }

  // Plugin directory
  possiblePaths.push(
    path.join(process.cwd(), 'plugin', type),
    path.join(process.cwd(), '..', 'plugin', type),
  );

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Count files with extension in directory
 */
function countFiles(dir: string, ext: string): number {
  let count = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += countFiles(fullPath, ext);
    } else if (entry.name.endsWith(ext)) {
      count++;
    }
  }

  return count;
}

/**
 * Count enabled hooks
 */
function countEnabledHooks(options: InitOptions): number {
  const hooks = options.hooks;
  let count = 0;

  if (hooks.preToolUse) count++;
  if (hooks.postToolUse) count++;
  if (hooks.userPromptSubmit) count++;
  if (hooks.sessionStart) count++;
  if (hooks.stop) count++;
  if (hooks.notification) count++;

  return count;
}

export default executeInit;
