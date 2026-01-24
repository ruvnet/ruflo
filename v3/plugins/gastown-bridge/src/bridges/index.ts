/**
 * Gas Town Bridge Layer Exports
 *
 * CLI bridge modules for Gas Town (gt) and Beads (bd) integration.
 * Provides secure command execution with input validation and
 * AgentDB synchronization.
 *
 * @module v3/plugins/gastown-bridge/bridges
 */

// Gas Town CLI Bridge
export {
  GtBridge,
  createGtBridge,
  GtBridgeError,
  // Types
  type GtBridgeConfig,
  type GasEstimate,
  type TxStatus,
  type NetworkStatus,
  type GtResult,
  type GtLogger,
  type GtErrorCode,
  // Schemas
  SafeStringSchema,
  IdentifierSchema,
  GasPriceSchema,
  GasLimitSchema,
  TxHashSchema,
  AddressSchema,
  NetworkSchema,
  GtArgumentSchema,
} from './gt-bridge.js';

// Beads CLI Bridge
export {
  BdBridge,
  createBdBridge,
  BdBridgeError,
  // Types
  type Bead,
  type BeadType,
  type BdBridgeConfig,
  type BeadQuery,
  type CreateBeadParams,
  type BdResult,
  type BdStreamResult,
  type BdLogger,
  type BdErrorCode,
  // Schemas
  BeadSchema,
  BeadIdSchema,
  BeadTypeSchema,
  BdArgumentSchema,
} from './bd-bridge.js';

// Sync Bridge
export {
  SyncBridge,
  createSyncBridge,
  SyncBridgeError,
  // Types
  type ConflictStrategy,
  type SyncDirection,
  type SyncStatus,
  type AgentDBEntry,
  type SyncBridgeConfig,
  type SyncResult,
  type SyncConflict,
  type SyncState,
  type IAgentDBService,
  type SyncLogger,
  type SyncErrorCode,
  // Schemas
  ConflictStrategySchema,
  SyncDirectionSchema,
  SyncStatusSchema,
  AgentDBEntrySchema,
} from './sync-bridge.js';
