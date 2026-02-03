/**
 * Settings.json Generator
 * Creates .claude/settings.json with V3-optimized hook configurations
 */

import type { InitOptions, HooksConfig } from './types.js';

/**
 * Generate the complete settings.json content
 */
export function generateSettings(options: InitOptions): object {
  const settings: Record<string, unknown> = {};

  // Add hooks if enabled
  if (options.components.settings) {
    settings.hooks = generateHooksConfig(options.hooks);
  }

  // Add statusLine configuration if enabled
  if (options.statusline.enabled) {
    settings.statusLine = generateStatusLineConfig(options);
  }

  // Add permissions
  settings.permissions = {
    // Auto-allow claude-flow MCP tools
    // Note: Use ":*" for prefix matching (not just "*")
    allow: [
      'Bash(npx claude-flow:*)',
      'Bash(npx @claude-flow/cli:*)',
      'mcp__claude-flow__:*',
    ],
    // Auto-deny dangerous operations
    deny: [],
  };

  // Add claude-flow attribution for git commits and PRs
  settings.attribution = {
    commit: 'Co-Authored-By: claude-flow <ruv@ruv.net>',
    pr: '🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)',
  };

  // Note: Claude Code expects 'model' to be a string, not an object
  // Model preferences are stored in claudeFlow settings instead
  // settings.model = 'claude-sonnet-4-20250514'; // Uncomment if you want to set a default model

  // Add V3-specific settings
  settings.claudeFlow = {
    version: '3.0.0',
    enabled: true,
    modelPreferences: {
      default: 'claude-opus-4-5-20251101',
      routing: 'claude-3-5-haiku-20241022',
    },
    swarm: {
      topology: options.runtime.topology,
      maxAgents: options.runtime.maxAgents,
    },
    memory: {
      backend: options.runtime.memoryBackend,
      enableHNSW: options.runtime.enableHNSW,
    },
    neural: {
      enabled: options.runtime.enableNeural,
    },
    daemon: {
      autoStart: true,
      workers: [
        'map',           // Codebase mapping
        'audit',         // Security auditing (critical priority)
        'optimize',      // Performance optimization (high priority)
        'consolidate',   // Memory consolidation
        'testgaps',      // Test coverage gaps
        'ultralearn',    // Deep knowledge acquisition
        'deepdive',      // Deep code analysis
        'document',      // Auto-documentation for ADRs
        'refactor',      // Refactoring suggestions (DDD alignment)
        'benchmark',     // Performance benchmarking
      ],
      schedules: {
        audit: { interval: '1h', priority: 'critical' },
        optimize: { interval: '30m', priority: 'high' },
        consolidate: { interval: '2h', priority: 'low' },
        document: { interval: '1h', priority: 'normal', triggers: ['adr-update', 'api-change'] },
        deepdive: { interval: '4h', priority: 'normal', triggers: ['complex-change'] },
        ultralearn: { interval: '1h', priority: 'normal' },
      },
    },
    learning: {
      enabled: true,
      autoTrain: true,
      patterns: ['coordination', 'optimization', 'prediction'],
      retention: {
        shortTerm: '24h',
        longTerm: '30d',
      },
    },
    adr: {
      autoGenerate: true,
      directory: '/docs/adr',
      template: 'madr',
    },
    ddd: {
      trackDomains: true,
      validateBoundedContexts: true,
      directory: '/docs/ddd',
    },
    security: {
      autoScan: true,
      scanOnEdit: true,
      cveCheck: true,
      threatModel: true,
    },
  };

  return settings;
}

/**
 * Generate statusLine configuration for Claude Code
 * This configures the Claude Code status bar to show V3 metrics
 */
function generateStatusLineConfig(options: InitOptions): object {
  const config = options.statusline;

  // Build the command that generates the statusline
  // Uses npx @claude-flow/cli@latest (or @alpha) to run the hooks statusline command
  // Falls back to local helper script or simple "V3" if CLI not available
  // Default: full multi-line statusline with progress bars, metrics, and architecture status
  const statuslineCommand = 'npx @claude-flow/cli@latest hooks statusline 2>/dev/null || node .claude/helpers/statusline.cjs 2>/dev/null || echo "▊ Claude Flow V3"';

  return {
    // Type must be "command" for Claude Code validation
    type: 'command',
    // Command to execute for statusline content
    command: statuslineCommand,
    // Refresh interval in milliseconds (5 seconds default)
    refreshMs: config.refreshInterval,
    // Enable the statusline
    enabled: config.enabled,
  };
}

/**
 * Generate hooks configuration
 *
 * IMPORTANT: Claude Code passes hook context as JSON via stdin, NOT as shell
 * environment variables. The hook-bridge.sh script reads stdin JSON with jq
 * and forwards the extracted fields as proper CLI arguments.
 *
 * See .claude/hooks/hook-bridge.sh for the implementation.
 */
function generateHooksConfig(config: HooksConfig): object {
  const hooks: Record<string, unknown[]> = {};

  // PreToolUse hooks - use hook-bridge.sh to parse stdin JSON
  if (config.preToolUse) {
    hooks.PreToolUse = [
      // File edit hooks with intelligence routing
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh pre-edit',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Bash command hooks with safety validation
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh pre-command',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task/Agent hooks
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh pre-task',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // PostToolUse hooks - use hook-bridge.sh to parse stdin JSON
  if (config.postToolUse) {
    hooks.PostToolUse = [
      // File edit hooks with neural pattern training
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh post-edit',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Bash command hooks with metrics tracking
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh post-command',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task completion hooks
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh post-task',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // UserPromptSubmit for intelligent routing
  if (config.userPromptSubmit) {
    hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh route',
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // SessionStart for context loading and daemon auto-start
  if (config.sessionStart) {
    hooks.SessionStart = [
      {
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh daemon-start',
            timeout: 10000,
            continueOnError: true,
          },
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh session-restore',
            timeout: 15000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Stop hooks for task evaluation - always return ok by default
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh stop-check',
            timeout: 1000,
          },
        ],
      },
    ];
  }

  // Notification hooks - store notifications in memory for swarm awareness
  if (config.notification) {
    hooks.Notification = [
      {
        hooks: [
          {
            type: 'command',
            command: '.claude/hooks/hook-bridge.sh notify',
            timeout: 5000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Note: PermissionRequest is NOT a valid Claude Code hook type
  // Auto-allow behavior is configured via settings.permissions.allow instead

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
