/**
 * Memory Module - Unified memory persistence for ruv-swarm
 *
 * Provides both generic SharedMemory and MCP-specific SwarmMemory implementations
 * Now with AgentDB v1.3.9 vector database integration
 *
 * @module memory
 */

import SharedMemory from './shared-memory.js';
import { SwarmMemory, createSwarmMemory } from './swarm-memory.js';
import { AgentDBMemoryAdapter } from './agentdb-adapter.js';
import { AgentDBBackend } from './backends/agentdb.js';
import { LegacyDataBridge } from './migration/legacy-bridge.js';

export {
  SharedMemory,
  SwarmMemory,
  createSwarmMemory,
  AgentDBMemoryAdapter,
  AgentDBBackend,
  LegacyDataBridge,
};

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
 * @param {string} options.type - Memory type: 'swarm', 'agentdb', or default
 * @param {string} options.mode - AgentDB mode: 'hybrid', 'agentdb', or 'legacy'
 * @returns {SharedMemory|SwarmMemory|AgentDBMemoryAdapter} Memory instance
 */
export function createMemory(options = {}) {
  // Create AgentDB-enhanced memory if requested
  if (options.type === 'agentdb' || options.mode) {
    return new AgentDBMemoryAdapter(options);
  }

  // Create swarm-specific memory
  if (options.type === 'swarm' || options.swarmId) {
    return new SwarmMemory(options);
  }

  // Default to SharedMemory
  return new SharedMemory(options);
}

// Default export for backwards compatibility
export default {
  SharedMemory,
  SwarmMemory,
  createMemory,
  SWARM_NAMESPACES,
  AgentDBMemoryAdapter,
  AgentDBBackend,
  LegacyDataBridge,
};
