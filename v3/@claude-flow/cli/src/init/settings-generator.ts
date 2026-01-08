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
    allow: [
      'Bash(npx claude-flow*)',
      'Bash(npx @claude-flow/*)',
      'mcp__claude-flow__*',
    ],
    // Auto-deny dangerous operations
    deny: [],
  };

  // Note: Claude Code expects 'model' to be a string, not an object
  // Model preferences are stored in claudeFlow settings instead
  // settings.model = 'claude-sonnet-4-20250514'; // Uncomment if you want to set a default model

  // Add V3-specific settings
  settings.claudeFlow = {
    version: '3.0.0',
    enabled: true,
    modelPreferences: {
      default: 'claude-sonnet-4-20250514',
      routing: 'claude-haiku',
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
      workers: ['map', 'audit', 'optimize', 'consolidate', 'testgaps'],
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
  const statuslineCommand = 'npx @claude-flow/hooks statusline 2>/dev/null || node .claude/helpers/statusline.js 2>/dev/null || echo "▊ V3"';

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
 */
function generateHooksConfig(config: HooksConfig): object {
  const hooks: Record<string, unknown[]> = {};

  // PreToolUse hooks
  if (config.preToolUse) {
    hooks.PreToolUse = [
      // File edit hooks
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_INPUT_file_path" ]; then npx claude-flow@v3alpha hooks pre-edit --file "$TOOL_INPUT_file_path" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
          },
        ],
      },
      // Bash command hooks
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_INPUT_command" ]; then npx claude-flow@v3alpha hooks pre-command --command "$TOOL_INPUT_command" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
          },
        ],
      },
      // Task/Agent hooks
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_INPUT_prompt" ]; then npx claude-flow@v3alpha hooks pre-task --task-id "task-$(date +%s)" --description "$TOOL_INPUT_prompt" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
          },
        ],
      },
    ];
  }

  // PostToolUse hooks
  if (config.postToolUse) {
    hooks.PostToolUse = [
      // File edit hooks with learning
      {
        matcher: '^(Write|Edit|MultiEdit)$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_INPUT_file_path" ]; then npx claude-flow@v3alpha hooks post-edit --file "$TOOL_INPUT_file_path" --success "${TOOL_SUCCESS:-true}" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
          },
        ],
      },
      // Bash command hooks with metrics
      {
        matcher: '^Bash$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_INPUT_command" ]; then npx claude-flow@v3alpha hooks post-command --command "$TOOL_INPUT_command" --success "${TOOL_SUCCESS:-true}" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
          },
        ],
      },
      // Task completion hooks
      {
        matcher: '^Task$',
        hooks: [
          {
            type: 'command',
            command: 'if [ -n "$TOOL_RESULT_agent_id" ]; then npx claude-flow@v3alpha hooks post-task --task-id "$TOOL_RESULT_agent_id" --success "${TOOL_SUCCESS:-true}" 2>/dev/null; fi; exit 0',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
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
            // Only run route if PROMPT is non-empty; use shell test to skip gracefully
            command: '[ -n "$PROMPT" ] && npx claude-flow@v3alpha hooks route --task "$PROMPT" --intelligence || true',
            timeout: config.timeout,
            continueOnError: config.continueOnError,
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
            // Start daemon quietly in background
            command: 'npx claude-flow@v3alpha daemon start --quiet 2>/dev/null || true',
            timeout: 5000,
            continueOnError: true,
          },
          {
            type: 'command',
            // Restore previous session context if available
            command: '[ -n "$SESSION_ID" ] && npx claude-flow@v3alpha hooks session-restore --session-id "$SESSION_ID" 2>/dev/null || true',
            timeout: 10000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // Stop hooks for task evaluation
  if (config.stop) {
    hooks.Stop = [
      {
        hooks: [
          {
            type: 'prompt',
            prompt: `Evaluate task completion. Consider:
1. Were all requested changes made?
2. Did builds/tests pass?
3. Is follow-up work needed?

Respond with {"decision": "stop"} if complete, or {"decision": "continue", "reason": "..."} if more work is needed.`,
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
            // Store notification in memory for agents to see
            command: '[ -n "$NOTIFICATION_MESSAGE" ] && npx claude-flow@v3alpha memory store -k "notify:$(date +%s)" -v "$NOTIFICATION_MESSAGE" -n notifications --ttl 300 2>/dev/null || true',
            timeout: 3000,
            continueOnError: true,
          },
        ],
      },
    ];
  }

  // PermissionRequest for auto-allowing claude-flow tools
  if (config.permissionRequest) {
    hooks.PermissionRequest = [
      {
        matcher: '^mcp__claude-flow__.*$',
        hooks: [
          {
            type: 'command',
            command: 'echo \'{"decision": "allow", "reason": "claude-flow MCP tool auto-approved"}\'',
            timeout: 1000,
          },
        ],
      },
      {
        matcher: '^Bash\\(npx @?claude-flow.*\\)$',
        hooks: [
          {
            type: 'command',
            command: 'echo \'{"decision": "allow", "reason": "claude-flow CLI auto-approved"}\'',
            timeout: 1000,
          },
        ],
      },
    ];
  }

  return hooks;
}

/**
 * Generate settings.json as formatted string
 */
export function generateSettingsJson(options: InitOptions): string {
  const settings = generateSettings(options);
  return JSON.stringify(settings, null, 2);
}
