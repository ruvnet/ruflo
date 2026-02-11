/**
 * Settings.json Generator
 * Creates .claude/settings.json with V3-optimized hook configurations
 */

import type { InitOptions, HooksConfig } from './types.js';
import { detectPlatform } from './types.js';

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
  // settings.model = 'claude-sonnet-4-5-20250929'; // Uncomment if you want to set a default model

  // Add Agent Teams configuration (experimental feature)
  settings.env = {
    // Enable Claude Code Agent Teams for multi-agent coordination
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Claude Flow specific environment
    CLAUDE_FLOW_V3_ENABLED: 'true',
    CLAUDE_FLOW_HOOKS_ENABLED: 'true',
  };

  // Add V3-specific settings
  settings.claudeFlow = {
    version: '3.0.0',
    enabled: true,
    modelPreferences: {
      default: 'claude-opus-4-6',
      routing: 'claude-haiku-4-5-20251001',
    },
    agentTeams: {
      enabled: true,
      teammateMode: 'auto', // 'auto' | 'in-process' | 'tmux'
      taskListEnabled: true,
      mailboxEnabled: true,
      coordination: {
        autoAssignOnIdle: true,       // Auto-assign pending tasks when teammate is idle
        trainPatternsOnComplete: true, // Train patterns when tasks complete
        notifyLeadOnComplete: true,   // Notify team lead when tasks complete
        sharedMemoryNamespace: 'agent-teams', // Memory namespace for team coordination
      },
      hooks: {
        teammateIdle: {
          enabled: true,
          autoAssign: true,
          checkTaskList: true,
        },
        taskCompleted: {
          enabled: true,
          trainPatterns: true,
          notifyLead: true,
        },
      },
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
 * Detects platform and generates appropriate commands for Mac, Linux, and Windows
 */
function generateHooksConfig(config: HooksConfig): object {
  const hooks: Record<string, unknown[]> = {};
  const platform = detectPlatform();
  const isWindows = platform.os === 'windows';

  // Platform-specific command helpers
  // Windows: PowerShell syntax with 2>$null and ; exit 0
  // Mac/Linux: Bash syntax with 2>/dev/null || true
  const cmd = {
    // Check if variable is set and run command
    ifVar: (varName: string, command: string) => isWindows
      ? `if ($env:${varName}) { ${command} 2>$null }; exit 0`
      : `[ -n "$${varName}" ] && ${command} 2>/dev/null || true`,
    // Simple command with error suppression
    simple: (command: string) => isWindows
      ? `${command} 2>$null; exit 0`
      : `${command} 2>/dev/null || true`,
    // Echo JSON (different quote escaping)
    echoJson: (json: string) => isWindows
      ? `Write-Output '${json}'`
      : `echo '${json}'`,
    // Generate timestamp (for unique keys)
    timestamp: () => isWindows
      ? '$(Get-Date -UFormat %s)'
      : '$(date +%s)',
  };

  // PreToolUse hooks - cross-platform via npx with defensive guards
  if (config.preToolUse) {
    hooks.PreToolUse = [
      // File edit hooks with intelligence routing
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: cmd.ifVar('TOOL_INPUT_file_path',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks pre-edit --file $env:TOOL_INPUT_file_path'
                : 'npx @claude-flow/cli@latest hooks pre-edit --file "$TOOL_INPUT_file_path"'),
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
            command: cmd.ifVar('TOOL_INPUT_command',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks pre-command --command $env:TOOL_INPUT_command'
                : 'npx @claude-flow/cli@latest hooks pre-command --command "$TOOL_INPUT_command"'),
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task/Agent hooks - require task-id for tracking
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: cmd.ifVar('TOOL_INPUT_prompt',
              isWindows
                ? `npx @claude-flow/cli@latest hooks pre-task --task-id "task-${cmd.timestamp()}" --description $env:TOOL_INPUT_prompt`
                : `npx @claude-flow/cli@latest hooks pre-task --task-id "task-${cmd.timestamp()}" --description "$TOOL_INPUT_prompt"`),
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // PostToolUse hooks - cross-platform via npx with defensive guards
  if (config.postToolUse) {
    hooks.PostToolUse = [
      // File edit hooks with pattern training
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: cmd.ifVar('TOOL_INPUT_file_path',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks post-edit --file $env:TOOL_INPUT_file_path --success $($env:TOOL_SUCCESS ?? "true")'
                : 'npx @claude-flow/cli@latest hooks post-edit --file "$TOOL_INPUT_file_path" --success "${TOOL_SUCCESS:-true}"'),
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
            command: cmd.ifVar('TOOL_INPUT_command',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks post-command --command $env:TOOL_INPUT_command --success $($env:TOOL_SUCCESS ?? "true")'
                : 'npx @claude-flow/cli@latest hooks post-command --command "$TOOL_INPUT_command" --success "${TOOL_SUCCESS:-true}"'),
            timeout: config.timeout,
            continueOnError: true,
          },
        ],
      },
      // Task completion hooks - use task-id
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: cmd.ifVar('TOOL_RESULT_agent_id',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks post-task --task-id $env:TOOL_RESULT_agent_id --success $($env:TOOL_SUCCESS ?? "true")'
                : 'npx @claude-flow/cli@latest hooks post-task --task-id "$TOOL_RESULT_agent_id" --success "${TOOL_SUCCESS:-true}"'),
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
            command: cmd.ifVar('PROMPT',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks route --task $env:PROMPT'
                : 'npx @claude-flow/cli@latest hooks route --task "$PROMPT"'),
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
            command: cmd.simple('npx @claude-flow/cli@latest daemon start --quiet'),
            timeout: 5000,
            continueOnError: true,
          },
          {
            type: 'command',
            command: cmd.ifVar('SESSION_ID',
              isWindows
                ? 'npx @claude-flow/cli@latest hooks session-restore --session-id $env:SESSION_ID'
                : 'npx @claude-flow/cli@latest hooks session-restore --session-id "$SESSION_ID"'),
            timeout: 10000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Stop hooks for task evaluation - always return ok by default
  // The hook outputs JSON that Claude Code validates
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: cmd.echoJson('{"ok": true}'),
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
            command: cmd.ifVar('NOTIFICATION_MESSAGE',
              isWindows
                ? `npx @claude-flow/cli@latest memory store --namespace notifications --key "notify-${cmd.timestamp()}" --value $env:NOTIFICATION_MESSAGE`
                : `npx @claude-flow/cli@latest memory store --namespace notifications --key "notify-${cmd.timestamp()}" --value "$NOTIFICATION_MESSAGE"`),
            timeout: 3000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Note: PermissionRequest is NOT a valid Claude Code hook type
  // Auto-allow behavior is configured via settings.permissions.allow instead

  // Agent Teams hooks - TeammateIdle for task assignment, TaskCompleted for coordination
  hooks.TeammateIdle = [
    {
      hooks: [
        {
          type: 'command',
          command: cmd.simple('npx @claude-flow/cli@latest hooks teammate-idle --auto-assign true'),
          timeout: 5000,
          continueOnError: true,
        },
      ],
    },
  ];

  hooks.TaskCompleted = [
    {
      hooks: [
        {
          type: 'command',
          command: cmd.ifVar('TASK_ID',
            isWindows
              ? 'npx @claude-flow/cli@latest hooks task-completed --task-id $env:TASK_ID --train-patterns true'
              : 'npx @claude-flow/cli@latest hooks task-completed --task-id "$TASK_ID" --train-patterns true'),
          timeout: 5000,
          continueOnError: true,
        },
      ],
    },
  ];

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
