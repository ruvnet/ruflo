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
 * @module @claude-flow/agents
 */

// ===== Swarm Coordination =====
export * from './swarm/index.js';

// ===== Pattern Learning =====
export * from './patterns/index.js';

// ===== Lifecycle Hooks =====
export * from './hooks/index.js';
