/**
 * @claude-flow/agents
 *
 * Agent coordination module consolidating swarm orchestration,
 * pattern learning, and lifecycle hooks.
 *
 * Consolidated from:
 * - @claude-flow/swarm (coordination, voting, topologies)
 * - @claude-flow/patterns (pattern extraction, matching, caching)
 * - @claude-flow/hooks (lifecycle hooks, daemons, statusline)
 *
 * Sub-modules are also available as namespaced imports:
 *   import { patterns, hooks } from '@claude-flow/agents';
 *
 * @module @claude-flow/agents
 */

// ===== Swarm Coordination (primary — no conflicts) =====
export * from './swarm/index.js';

// ===== Pattern Learning (namespaced to avoid conflicts) =====
import * as patterns from './patterns/index.js';
export { patterns };

// ===== Lifecycle Hooks (namespaced to avoid conflicts) =====
import * as hooks from './hooks/index.js';
export { hooks };

// Re-export non-conflicting, commonly-used items from patterns
export {
  PatternManager,
  createPatternManager,
  PatternLearningSystem,
  createPatternLearningSystem,
  PatternLearningEngine,
  createPatternLearningEngine,
  PatternLearner,
  createPatternLearner,
} from './patterns/index.js';

export type {
  PatternMode,
  PatternModeConfig,
  Trajectory,
  TrajectoryStep,
  Pattern,
  PatternMatch,
  PatternStats,
  PatternEvent,
  PatternEventListener,
  PatternLearnerConfig,
} from './patterns/index.js';

// Re-export non-conflicting, commonly-used items from hooks
export {
  HookRegistry,
  HookExecutor,
  defaultRegistry,
  defaultExecutor,
  registerHook,
  unregisterHook,
  executeHooks,
  initializeHooks,
  DaemonManager,
  StatuslineGenerator,
  OfficialHooksBridge,
  SwarmCommunication,
  swarmComm,
  WorkerManager,
  createWorkerManager,
  onSessionStart,
  onSessionEnd,
} from './hooks/index.js';

export type {
  HookEvent,
  HookPriority,
  HookContext,
  HookResult,
  SwarmMessage,
  SwarmConfig,
  SessionHookConfig,
  SessionHookResult,
} from './hooks/index.js';
