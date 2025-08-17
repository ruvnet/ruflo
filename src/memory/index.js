/**
 * Memory Module - Unified memory persistence for ruv-swarm
 *
 * Provides both generic SharedMemory and MCP-specific SwarmMemory implementations
 *
 * @module memory
 */

import SharedMemory from './shared-memory.js';
import { SwarmMemory, createSwarmMemory } from './swarm-memory.js';

export { SharedMemory, SwarmMemory, createSwarmMemory };

// Re-export swarm namespaces for convenience
export const SWARM_NAMESPACES = {
  AGENTS: 'swarm:agents',
  TASKS: 'swarm:tasks',
  COMMUNICATIONS: 'swarm:communications',
  CONSENSUS: 'swarm:consensus',
  PATTERNS: 'swarm:patterns',
  METRICS: 'swarm:metrics',
  COORDINATION: 'swarm:coordination',
};

/**
 * Create memory instance based on context
 * @param {Object} options - Configuration options
 * @returns {SharedMemory|SwarmMemory} Memory instance
 */
export function createMemory(options = {}) {
  if (options.type === 'swarm' || options.swarmId) {
    return new SwarmMemory(options);
  }
  return new SharedMemory(options);
}

// Default export for backwards compatibility
export default { SharedMemory, SwarmMemory, createMemory, SWARM_NAMESPACES };
