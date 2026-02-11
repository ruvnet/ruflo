/**
 * Coordination Components
 * Agent registry, task orchestration, and swarm hub
 */

export {
  AgentRegistry,
  createAgentRegistry,
  type IAgentRegistry,
} from './agent-registry.js';

export {
  TaskOrchestrator,
  createTaskOrchestrator,
  type ITaskOrchestrator,
  type TaskSpec,
} from './task-orchestrator.js';

export {
  SwarmHub,
  createSwarmHub,
  type ISwarmHub,
} from './swarm-hub.js';
