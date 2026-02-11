/**
 * Pattern Coordination Bridges Index
 *
 * Exports all WASM bridges for neural coordination.
 */

export {
  NervousSystemBridge,
  createNervousSystemBridge,
  type WasmModuleStatus,
  type NervousSystemConfig,
  type NeuralSignal,
  type CoordinationResult,
} from './nervous-system-bridge.js';

export {
  AttentionBridge,
  createAttentionBridge,
  type AttentionConfig,
  type AttentionOutput,
} from './attention-bridge.js';
