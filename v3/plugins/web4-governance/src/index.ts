/**
 * Web4 Governance Plugin for claude-flow
 *
 * Integrates Web4 trust primitives with claude-flow's orchestration:
 * - T3 Trust Tensors for multi-dimensional trust
 * - Policy Entities with hash-tracked versions
 * - Witnessing Chains for trust attestation
 * - R6 Audit Chain for action logging
 *
 * ## Integration Points
 *
 * 1. **Claims System**: Extends authorization with trust scores
 * 2. **AIDefence**: Adds trust-weighted threat decisions
 * 3. **Official Hooks Bridge**: Policy enforcement at tool boundaries
 *
 * @module @claude-flow/governance
 */

export * from './policy.js';
export * from './trust.js';
export * from './hooks.js';
export * from './presets.js';
export * from './types.js';

// Re-export WASM loader
export { loadGovernanceWasm, type GovernanceWasm } from './wasm/loader.js';

/**
 * Quick start: Create a governance instance with defaults
 */
export { createGovernance, type GovernanceConfig } from './governance.js';
