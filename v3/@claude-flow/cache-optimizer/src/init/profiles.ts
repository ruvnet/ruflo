/**
 * @claude-flow/cache-optimizer - Configuration Profiles
 *
 * Pre-configured profiles for different implementation requirements.
 * Each profile optimizes for specific use cases.
 */

import type { CacheOptimizerConfig, HandoffConfig } from '../types.js';

/**
 * Profile identifier
 */
export type ProfileId =
  | 'single-agent'
  | 'multi-agent'
  | 'aggressive'
  | 'conservative'
  | 'memory-constrained'
  | 'performance'
  | 'development'
  | 'production';

/**
 * Profile definition with metadata
 */
export interface Profile {
  id: ProfileId;
  name: string;
  description: string;
  cacheConfig: Partial<CacheOptimizerConfig>;
  handoffConfig?: Partial<HandoffConfig>;
  hooks: HookConfiguration;
  recommended: string[];
}

/**
 * Hook configuration for settings.json
 */
export interface HookConfiguration {
  UserPromptSubmit?: HookEntry[];
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
  PreCompact?: HookEntry[];
  MessageComplete?: HookEntry[];
}

export interface HookEntry {
  command: string;
  description?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Single-Agent Profile
 * Optimized for single Claude instance with maximum caching
 */
const singleAgentProfile: Profile = {
  id: 'single-agent',
  name: 'Single Agent',
  description: 'Optimized for single Claude instance with maximum caching efficiency',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.80,
    pruning: {
      strategy: 'adaptive',
      aggressiveness: 0.3,
      minRetention: 0.2,
    },
    temporal: {
      enabled: true,
      hotDuration: 300000,     // 5 min
      warmDuration: 1800000,   // 30 min
      coldDuration: 3600000,   // 1 hour
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT"',
        description: 'Pre-load relevant context and prevent compaction',
        timeout: 5000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact',
        description: 'Attempt to prevent compaction via intelligent pruning',
        timeout: 10000,
      },
    ],
    PostToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer post-tool "$TOOL_NAME" "$TOOL_INPUT"',
        description: 'Cache tool results for future use',
        timeout: 3000,
      },
    ],
  },
  recommended: ['Development', 'Research', 'Single-task workflows'],
};

/**
 * Multi-Agent Profile
 * Optimized for concurrent Claude instances with session isolation
 */
const multiAgentProfile: Profile = {
  id: 'multi-agent',
  name: 'Multi-Agent Swarm',
  description: 'Session-isolated caching for concurrent Claude instances',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.70,
    pruning: {
      strategy: 'adaptive',
      aggressiveness: 0.5,
      minRetention: 0.15,
    },
    temporal: {
      enabled: true,
      hotDuration: 180000,     // 3 min (faster cycling for swarms)
      warmDuration: 600000,    // 10 min
      coldDuration: 1800000,   // 30 min
    },
    sessionIsolation: true,
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --session "$SESSION_ID"',
        description: 'Session-isolated context loading',
        timeout: 5000,
        env: { CACHE_SESSION_ISOLATED: 'true' },
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact --session "$SESSION_ID"',
        description: 'Session-aware compaction prevention',
        timeout: 10000,
      },
    ],
    PostToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer post-tool "$TOOL_NAME" "$TOOL_INPUT" --session "$SESSION_ID"',
        description: 'Session-isolated tool caching',
        timeout: 3000,
      },
    ],
    MessageComplete: [
      {
        command: 'npx @claude-flow/cache-optimizer sync-session "$SESSION_ID"',
        description: 'Sync session state across agents',
        timeout: 5000,
      },
    ],
  },
  recommended: ['Swarm orchestration', 'Parallel task execution', 'Multi-agent workflows'],
};

/**
 * Aggressive Profile
 * Maximum cache retention, minimal pruning
 */
const aggressiveProfile: Profile = {
  id: 'aggressive',
  name: 'Aggressive Caching',
  description: 'Maximum context retention with minimal pruning',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.85,
    pruning: {
      strategy: 'minimal',
      aggressiveness: 0.1,
      minRetention: 0.4,
    },
    temporal: {
      enabled: true,
      hotDuration: 600000,     // 10 min
      warmDuration: 3600000,   // 1 hour
      coldDuration: 7200000,   // 2 hours
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --aggressive',
        description: 'Aggressive context pre-loading',
        timeout: 8000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact --force',
        description: 'Force compaction prevention',
        timeout: 15000,
      },
    ],
  },
  recommended: ['Long-running sessions', 'Complex codebases', 'Deep context requirements'],
};

/**
 * Conservative Profile
 * Minimal footprint, aggressive pruning
 */
const conservativeProfile: Profile = {
  id: 'conservative',
  name: 'Conservative',
  description: 'Minimal memory footprint with aggressive pruning',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.60,
    pruning: {
      strategy: 'aggressive',
      aggressiveness: 0.7,
      minRetention: 0.1,
    },
    temporal: {
      enabled: true,
      hotDuration: 120000,     // 2 min
      warmDuration: 300000,    // 5 min
      coldDuration: 600000,    // 10 min
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --minimal',
        description: 'Minimal context loading',
        timeout: 3000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer allow-compact --controlled',
        description: 'Allow controlled compaction when necessary',
        timeout: 5000,
      },
    ],
  },
  recommended: ['Memory-limited environments', 'Simple tasks', 'Quick operations'],
};

/**
 * Memory-Constrained Profile
 * For environments with limited RAM
 */
const memoryConstrainedProfile: Profile = {
  id: 'memory-constrained',
  name: 'Memory Constrained',
  description: 'Optimized for environments with limited RAM',
  cacheConfig: {
    maxContextTokens: 100000,
    targetUtilization: 0.50,
    pruning: {
      strategy: 'aggressive',
      aggressiveness: 0.8,
      minRetention: 0.05,
    },
    temporal: {
      enabled: true,
      hotDuration: 60000,      // 1 min
      warmDuration: 180000,    // 3 min
      coldDuration: 300000,    // 5 min
    },
    compression: {
      enabled: true,
      level: 'high',
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --low-memory',
        description: 'Low-memory context handling',
        timeout: 3000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer gc --aggressive',
        description: 'Aggressive garbage collection',
        timeout: 5000,
      },
    ],
  },
  recommended: ['CI/CD pipelines', 'Docker containers', 'Resource-limited VMs'],
};

/**
 * Performance Profile
 * Optimized for speed over memory
 */
const performanceProfile: Profile = {
  id: 'performance',
  name: 'Performance',
  description: 'Optimized for speed with larger memory footprint',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.75,
    pruning: {
      strategy: 'adaptive',
      aggressiveness: 0.4,
      minRetention: 0.25,
    },
    temporal: {
      enabled: true,
      hotDuration: 300000,
      warmDuration: 1200000,
      coldDuration: 2400000,
    },
    intelligence: {
      flashAttention: true,
      sona: true,
      moe: true,
    },
  },
  handoffConfig: {
    enabled: true,
    retryAttempts: 3,
    retryDelay: 500,
    background: {
      enabled: true,
      maxConcurrent: 5,
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --prefetch',
        description: 'Prefetch related context for speed',
        timeout: 8000,
      },
    ],
    PreToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer pre-tool "$TOOL_NAME" --cache-check',
        description: 'Check cache before tool execution',
        timeout: 1000,
      },
    ],
    PostToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer post-tool "$TOOL_NAME" "$TOOL_INPUT" --index',
        description: 'Index tool results for fast retrieval',
        timeout: 3000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact',
        description: 'Prevent compaction for performance',
        timeout: 10000,
      },
    ],
  },
  recommended: ['High-throughput workflows', 'Real-time applications', 'Performance-critical tasks'],
};

/**
 * Development Profile
 * Verbose logging, debugging enabled
 */
const developmentProfile: Profile = {
  id: 'development',
  name: 'Development',
  description: 'Development mode with verbose logging and debugging',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.75,
    pruning: {
      strategy: 'adaptive',
      aggressiveness: 0.3,
      minRetention: 0.2,
    },
    temporal: {
      enabled: true,
      hotDuration: 300000,
      warmDuration: 1800000,
      coldDuration: 3600000,
    },
    debug: true,
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT" --verbose',
        description: 'Verbose prompt handling with debug output',
        timeout: 10000,
        env: { DEBUG: 'cache-optimizer:*' },
      },
    ],
    PreToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer pre-tool "$TOOL_NAME" --debug',
        description: 'Debug pre-tool hook',
        timeout: 5000,
        env: { DEBUG: 'cache-optimizer:*' },
      },
    ],
    PostToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer post-tool "$TOOL_NAME" "$TOOL_INPUT" --verbose',
        description: 'Verbose post-tool caching',
        timeout: 5000,
        env: { DEBUG: 'cache-optimizer:*' },
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact --dry-run',
        description: 'Dry-run compaction prevention (logs only)',
        timeout: 10000,
        env: { DEBUG: 'cache-optimizer:*' },
      },
    ],
  },
  recommended: ['Local development', 'Debugging', 'Testing'],
};

/**
 * Production Profile
 * Optimized for stability and reliability
 */
const productionProfile: Profile = {
  id: 'production',
  name: 'Production',
  description: 'Production-optimized for stability and reliability',
  cacheConfig: {
    maxContextTokens: 200000,
    targetUtilization: 0.72,
    pruning: {
      strategy: 'adaptive',
      aggressiveness: 0.4,
      minRetention: 0.2,
    },
    temporal: {
      enabled: true,
      hotDuration: 300000,
      warmDuration: 1200000,
      coldDuration: 2400000,
    },
    persistence: {
      enabled: true,
      path: './data/cache-optimizer',
    },
  },
  handoffConfig: {
    enabled: true,
    retryAttempts: 5,
    retryDelay: 1000,
    timeout: 60000,
    circuitBreaker: {
      enabled: true,
      threshold: 5,
      resetTimeout: 30000,
    },
    background: {
      enabled: true,
      maxConcurrent: 3,
    },
  },
  hooks: {
    UserPromptSubmit: [
      {
        command: 'npx @claude-flow/cache-optimizer handle-prompt "$PROMPT"',
        description: 'Production prompt handling',
        timeout: 5000,
      },
    ],
    PostToolUse: [
      {
        command: 'npx @claude-flow/cache-optimizer post-tool "$TOOL_NAME" "$TOOL_INPUT"',
        description: 'Production tool caching',
        timeout: 3000,
      },
    ],
    PreCompact: [
      {
        command: 'npx @claude-flow/cache-optimizer prevent-compact',
        description: 'Production compaction prevention',
        timeout: 10000,
      },
    ],
  },
  recommended: ['Production deployments', 'Stable environments', 'Enterprise use'],
};

/**
 * All available profiles
 */
export const PROFILES: Record<ProfileId, Profile> = {
  'single-agent': singleAgentProfile,
  'multi-agent': multiAgentProfile,
  'aggressive': aggressiveProfile,
  'conservative': conservativeProfile,
  'memory-constrained': memoryConstrainedProfile,
  'performance': performanceProfile,
  'development': developmentProfile,
  'production': productionProfile,
};

/**
 * Get profile by ID
 */
export function getProfile(id: ProfileId): Profile {
  const profile = PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown profile: ${id}. Available: ${Object.keys(PROFILES).join(', ')}`);
  }
  return profile;
}

/**
 * List all available profiles
 */
export function listProfiles(): Profile[] {
  return Object.values(PROFILES);
}

/**
 * Get recommended profile based on environment detection
 */
export function detectRecommendedProfile(): ProfileId {
  // Check environment variables
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isCI = process.env.CI === 'true';
  const isDocker = process.env.DOCKER === 'true';
  const maxMemory = process.env.CACHE_MAX_MEMORY;

  // CI/CD or Docker with constraints
  if (isCI || isDocker) {
    return 'memory-constrained';
  }

  // Memory-limited
  if (maxMemory && parseInt(maxMemory, 10) < 512) {
    return 'memory-constrained';
  }

  // Production
  if (nodeEnv === 'production') {
    return 'production';
  }

  // Development
  if (nodeEnv === 'development') {
    return 'development';
  }

  // Default to single-agent
  return 'single-agent';
}

/**
 * Merge custom config with profile
 */
export function mergeWithProfile(
  profileId: ProfileId,
  customConfig?: Partial<CacheOptimizerConfig>
): CacheOptimizerConfig {
  const profile = getProfile(profileId);
  return {
    ...profile.cacheConfig,
    ...customConfig,
  } as CacheOptimizerConfig;
}
