/**
 * @claude-flow/cache-optimizer - Hook Handlers
 * Integration with Claude Code hooks for real-time cache optimization
 */

import type {
  CacheOptimizerConfig,
  HookResult,
  HookAction,
  CacheEntryType,
  ScoringContext,
} from '../types.js';
import { CacheOptimizer } from '../core/orchestrator.js';

/**
 * Hook handler for UserPromptSubmit
 * Called when user submits a prompt - proactively optimize cache
 */
export async function handleUserPromptSubmit(
  optimizer: CacheOptimizer,
  prompt: string,
  sessionId: string = 'default'
): Promise<HookResult> {
  return optimizer.onUserPromptSubmit(prompt, sessionId);
}

/**
 * Hook handler for PreToolUse
 * Called before a tool is executed - track context
 */
export async function handlePreToolUse(
  optimizer: CacheOptimizer,
  toolName: string,
  toolInput: unknown,
  sessionId: string = 'default'
): Promise<HookResult> {
  const startTime = Date.now();
  const actions: HookAction[] = [];

  // Determine entry type based on tool
  const typeMap: Record<string, CacheEntryType> = {
    'Read': 'file_read',
    'Write': 'file_write',
    'Edit': 'file_write',
    'Bash': 'bash_output',
    'Task': 'tool_result',
    'Glob': 'tool_result',
    'Grep': 'tool_result',
  };

  const entryType = typeMap[toolName] || 'tool_result';

  // Extract file path if applicable
  let filePath: string | undefined;
  if (typeof toolInput === 'object' && toolInput !== null) {
    const input = toolInput as Record<string, unknown>;
    filePath = (input.file_path as string) || (input.path as string);
  }

  // Pre-score relevant entries to prepare for output
  const context: ScoringContext = {
    currentQuery: '',
    activeFiles: filePath ? [filePath] : [],
    activeTools: [toolName.toLowerCase()],
    sessionId,
    timestamp: startTime,
  };

  await optimizer.scoreAll(context);

  actions.push({
    type: 'score_update',
    details: `Pre-scored entries for ${toolName} tool use`,
  });

  return {
    success: true,
    actions,
    durationMs: Date.now() - startTime,
    compactionPrevented: false,
    tokensFreed: 0,
    newUtilization: optimizer.getUtilization(),
  };
}

/**
 * Hook handler for PostToolUse
 * Called after a tool is executed - add result to cache
 */
export async function handlePostToolUse(
  optimizer: CacheOptimizer,
  toolName: string,
  toolInput: unknown,
  toolOutput: string,
  success: boolean,
  sessionId: string = 'default'
): Promise<HookResult> {
  const startTime = Date.now();
  const actions: HookAction[] = [];

  if (!success || !toolOutput) {
    return {
      success: true,
      actions: [],
      durationMs: Date.now() - startTime,
      compactionPrevented: false,
      tokensFreed: 0,
      newUtilization: optimizer.getUtilization(),
    };
  }

  // Determine entry type
  const typeMap: Record<string, CacheEntryType> = {
    'Read': 'file_read',
    'Write': 'file_write',
    'Edit': 'file_write',
    'Bash': 'bash_output',
    'Task': 'tool_result',
    'Glob': 'tool_result',
    'Grep': 'tool_result',
  };

  const entryType = typeMap[toolName] || 'tool_result';

  // Extract metadata
  let filePath: string | undefined;
  if (typeof toolInput === 'object' && toolInput !== null) {
    const input = toolInput as Record<string, unknown>;
    filePath = (input.file_path as string) || (input.path as string);
  }

  // Add tool output to cache
  const entryId = await optimizer.add(toolOutput, entryType, {
    source: `tool:${toolName}`,
    toolName,
    filePath,
    sessionId,
    tags: ['tool_output', toolName.toLowerCase()],
  });

  actions.push({
    type: 'score_update',
    entryId,
    details: `Added ${toolName} output to cache (${toolOutput.length} chars)`,
  });

  // Check for proactive pruning
  const utilization = optimizer.getUtilization();
  let tokensFreed = 0;
  let compactionPrevented = false;

  if (utilization > 0.6) { // Soft threshold
    const context: ScoringContext = {
      currentQuery: '',
      activeFiles: filePath ? [filePath] : [],
      activeTools: [toolName.toLowerCase()],
      sessionId,
      timestamp: Date.now(),
    };

    const hookResult = await optimizer.onUserPromptSubmit('', sessionId);
    tokensFreed = hookResult.tokensFreed;
    compactionPrevented = hookResult.compactionPrevented;

    if (tokensFreed > 0) {
      actions.push(...hookResult.actions);
    }
  }

  return {
    success: true,
    actions,
    durationMs: Date.now() - startTime,
    compactionPrevented,
    tokensFreed,
    newUtilization: optimizer.getUtilization(),
  };
}

/**
 * Hook handler for PreCompact
 * Called before compaction - last chance to prevent it
 */
export async function handlePreCompact(
  optimizer: CacheOptimizer,
  trigger: 'auto' | 'manual' = 'auto'
): Promise<HookResult> {
  return optimizer.onPreCompact(trigger);
}

/**
 * Hook handler for message completion
 * Called when assistant message is complete
 */
export async function handleMessageComplete(
  optimizer: CacheOptimizer,
  role: 'user' | 'assistant',
  content: string,
  sessionId: string = 'default'
): Promise<HookResult> {
  const startTime = Date.now();
  const actions: HookAction[] = [];

  const entryType: CacheEntryType = role === 'user' ? 'user_message' : 'assistant_message';

  // Add message to cache
  const entryId = await optimizer.add(content, entryType, {
    source: `message:${role}`,
    sessionId,
    tags: ['conversation', role],
  });

  actions.push({
    type: 'score_update',
    entryId,
    details: `Added ${role} message to cache`,
  });

  return {
    success: true,
    actions,
    durationMs: Date.now() - startTime,
    compactionPrevented: false,
    tokensFreed: 0,
    newUtilization: optimizer.getUtilization(),
  };
}

/**
 * Create hook configuration for .claude/settings.json
 */
export function createHookConfig(config?: Partial<CacheOptimizerConfig>): Record<string, unknown> {
  const timeouts = config?.hooks?.timeouts ?? {
    userPromptSubmit: 3000,
    preToolUse: 2000,
    postToolUse: 3000,
    preCompact: 5000,
  };

  return {
    hooks: {
      UserPromptSubmit: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: `npx @claude-flow/cache-optimizer hook user-prompt-submit --timeout ${timeouts.userPromptSubmit}`,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: '(Read|Write|Edit|Bash|Task|Glob|Grep)',
          hooks: [
            {
              type: 'command',
              command: `npx @claude-flow/cache-optimizer hook pre-tool-use --tool "$TOOL_NAME" --timeout ${timeouts.preToolUse}`,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: '(Read|Write|Edit|Bash|Task|Glob|Grep)',
          hooks: [
            {
              type: 'command',
              command: `npx @claude-flow/cache-optimizer hook post-tool-use --tool "$TOOL_NAME" --timeout ${timeouts.postToolUse}`,
            },
          ],
        },
      ],
      PreCompact: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: `npx @claude-flow/cache-optimizer hook pre-compact --timeout ${timeouts.preCompact}`,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Singleton optimizer instance for hook handlers
 */
let globalOptimizer: CacheOptimizer | null = null;

export function getGlobalOptimizer(config?: Partial<CacheOptimizerConfig>): CacheOptimizer {
  if (!globalOptimizer) {
    globalOptimizer = new CacheOptimizer(config);
  }
  return globalOptimizer;
}

export function resetGlobalOptimizer(): void {
  globalOptimizer = null;
}
