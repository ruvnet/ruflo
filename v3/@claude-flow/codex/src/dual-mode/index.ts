/**
 * Dual-Mode Module
 * Collaborative execution of Claude Code + Codex workers
 */

export {
  DualModeOrchestrator,
  DualModeConfig,
  WorkerConfig,
  WorkerResult,
  CollaborationResult,
  CollaborationTemplates,
} from './orchestrator.js';

export { createDualModeCommand } from './cli.js';
