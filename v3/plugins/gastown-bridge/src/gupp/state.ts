/**
 * GUPP State Persistence
 *
 * State management for the Gastown Universal Propulsion Principle (GUPP).
 * GUPP principle: "If work is on your hook, YOU MUST RUN IT"
 *
 * This module provides:
 * - State interfaces for tracking active work
 * - Disk/AgentDB persistence for crash recovery
 * - State merging for conflict resolution
 *
 * @module gastown-bridge/gupp/state
 * @version 0.1.0
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Convoy, Formula, ConvoyProgress, ConvoyStatus } from '../types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default state file path
 */
export const DEFAULT_STATE_PATH = '.gupp/state.json';

/**
 * AgentDB namespace for GUPP state
 */
export const AGENTDB_NAMESPACE = 'gupp:state';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Work item status
 */
export type WorkItemStatus = 'pending' | 'active' | 'paused' | 'blocked' | 'completed' | 'failed';

/**
 * Work item on the hook
 */
export interface HookedWorkItem {
  /** Unique work item ID */
  readonly id: string;
  /** Associated bead ID (if any) */
  readonly beadId?: string;
  /** Associated convoy ID (if any) */
  readonly convoyId?: string;
  /** Work item title/description */
  readonly title: string;
  /** Current status */
  readonly status: WorkItemStatus;
  /** Priority (0 = highest) */
  readonly priority: number;
  /** When the work was hooked */
  readonly hookedAt: Date;
  /** When the work was last updated */
  readonly updatedAt: Date;
  /** Assigned agent */
  readonly assignee?: string;
  /** Formula applied to this work */
  readonly formula?: string;
  /** Progress percentage (0-100) */
  readonly progress: number;
  /** Error message if failed */
  readonly error?: string;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Session information
 */
export interface SessionInfo {
  /** Session ID */
  readonly id: string;
  /** When the session started */
  readonly startedAt: Date;
  /** When the session was last active */
  readonly lastActiveAt: Date;
  /** Whether the session is currently active */
  readonly active: boolean;
  /** Session owner/initiator */
  readonly owner?: string;
}

/**
 * GUPP State - Complete state for crash recovery
 */
export interface GuppState {
  /** State schema version */
  readonly version: number;
  /** Current session information */
  readonly session?: SessionInfo;
  /** Active convoys */
  readonly convoys: Convoy[];
  /** Active formulas (being executed) */
  readonly formulas: Array<{
    readonly name: string;
    readonly formula: Formula;
    readonly vars: Record<string, string>;
    readonly startedAt: Date;
    readonly status: 'cooking' | 'cooked' | 'executing' | 'completed' | 'failed';
  }>;
  /** Work items on the hook (GUPP principle) */
  readonly hookedWork: HookedWorkItem[];
  /** Last state update timestamp */
  readonly updatedAt: Date;
  /** State checksum for integrity verification */
  readonly checksum?: string;
  /** Recovery metadata */
  readonly recovery?: {
    readonly lastCrash?: Date;
    readonly crashCount: number;
    readonly autoRecoverEnabled: boolean;
  };
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Work item status schema
 */
const WorkItemStatusSchema = z.enum([
  'pending',
  'active',
  'paused',
  'blocked',
  'completed',
  'failed',
]);

/**
 * Hooked work item schema
 */
const HookedWorkItemSchema = z.object({
  id: z.string().min(1),
  beadId: z.string().optional(),
  convoyId: z.string().optional(),
  title: z.string().min(1),
  status: WorkItemStatusSchema,
  priority: z.number().int().min(0),
  hookedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  assignee: z.string().optional(),
  formula: z.string().optional(),
  progress: z.number().min(0).max(100),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Session info schema
 */
const SessionInfoSchema = z.object({
  id: z.string().min(1),
  startedAt: z.coerce.date(),
  lastActiveAt: z.coerce.date(),
  active: z.boolean(),
  owner: z.string().optional(),
});

/**
 * Leg schema (for formula legs)
 */
const LegSchema = z.object({
  id: z.string(),
  title: z.string(),
  focus: z.string(),
  description: z.string(),
  agent: z.string().optional(),
  order: z.number().optional(),
});

/**
 * Step schema (for formula steps)
 */
const StepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  needs: z.array(z.string()).optional(),
  duration: z.number().optional(),
  requires: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Var schema (for formula variables)
 */
const VarSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

/**
 * Formula state schema
 */
const FormulaStateSchema = z.object({
  name: z.string(),
  formula: z.object({
    name: z.string(),
    description: z.string(),
    type: z.enum(['convoy', 'workflow', 'expansion', 'aspect']),
    version: z.number(),
    legs: z.array(LegSchema).optional(),
    steps: z.array(StepSchema).optional(),
    vars: z.record(VarSchema).optional(),
  }),
  vars: z.record(z.string()),
  startedAt: z.coerce.date(),
  status: z.enum(['cooking', 'cooked', 'executing', 'completed', 'failed']),
});

/**
 * Recovery metadata schema
 */
const RecoveryMetadataSchema = z.object({
  lastCrash: z.coerce.date().optional(),
  crashCount: z.number().int().min(0),
  autoRecoverEnabled: z.boolean(),
});

/**
 * Convoy progress schema (for validation)
 */
const ConvoyProgressSchema = z.object({
  total: z.number().int().min(0),
  closed: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  blocked: z.number().int().min(0),
});

/**
 * Convoy schema (for validation)
 */
const ConvoySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trackedIssues: z.array(z.string()),
  status: z.enum(['active', 'landed', 'failed', 'paused']),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  progress: ConvoyProgressSchema,
  formula: z.string().optional(),
  description: z.string().optional(),
});

/**
 * GUPP state schema
 */
const GuppStateSchema = z.object({
  version: z.number().int().min(1),
  session: SessionInfoSchema.optional(),
  convoys: z.array(ConvoySchema),
  formulas: z.array(FormulaStateSchema),
  hookedWork: z.array(HookedWorkItemSchema),
  updatedAt: z.coerce.date(),
  checksum: z.string().optional(),
  recovery: RecoveryMetadataSchema.optional(),
});

// ============================================================================
// State Factory
// ============================================================================

/**
 * Create an empty GUPP state
 */
export function createEmptyState(): GuppState {
  return {
    version: 1,
    session: undefined,
    convoys: [],
    formulas: [],
    hookedWork: [],
    updatedAt: new Date(),
    recovery: {
      crashCount: 0,
      autoRecoverEnabled: true,
    },
  };
}

/**
 * Create a new session
 */
export function createSession(id: string, owner?: string): SessionInfo {
  const now = new Date();
  return {
    id,
    startedAt: now,
    lastActiveAt: now,
    active: true,
    owner,
  };
}

/**
 * Create a hooked work item
 */
export function createHookedWorkItem(
  id: string,
  title: string,
  options?: Partial<Omit<HookedWorkItem, 'id' | 'title' | 'hookedAt' | 'updatedAt'>>
): HookedWorkItem {
  const now = new Date();
  return {
    id,
    title,
    status: options?.status ?? 'pending',
    priority: options?.priority ?? 5,
    hookedAt: now,
    updatedAt: now,
    progress: options?.progress ?? 0,
    beadId: options?.beadId,
    convoyId: options?.convoyId,
    assignee: options?.assignee,
    formula: options?.formula,
    metadata: options?.metadata,
  };
}

// ============================================================================
// State Persistence - Disk
// ============================================================================

/**
 * Save state to disk
 *
 * @param state - State to save
 * @param statePath - Path to state file (default: .gupp/state.json)
 */
export async function saveState(
  state: GuppState,
  statePath: string = DEFAULT_STATE_PATH
): Promise<void> {
  // Update timestamp and calculate checksum
  const stateToSave: GuppState = {
    ...state,
    updatedAt: new Date(),
    checksum: calculateChecksum(state),
  };

  // Ensure directory exists
  const dir = path.dirname(statePath);
  await fs.mkdir(dir, { recursive: true });

  // Write state atomically (write to temp, then rename)
  const tempPath = `${statePath}.tmp`;
  const jsonContent = JSON.stringify(stateToSave, null, 2);

  await fs.writeFile(tempPath, jsonContent, 'utf-8');
  await fs.rename(tempPath, statePath);
}

/**
 * Load state from disk
 *
 * @param statePath - Path to state file (default: .gupp/state.json)
 * @returns Loaded state or empty state if not found
 */
export async function loadState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<GuppState> {
  try {
    const content = await fs.readFile(statePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate state structure
    const validated = GuppStateSchema.parse(parsed);

    // Verify checksum if present
    if (validated.checksum) {
      // Destructure to omit checksum for verification
      const { checksum: _, ...stateWithoutChecksum } = validated;
      const expectedChecksum = calculateChecksum(stateWithoutChecksum);
      if (validated.checksum !== expectedChecksum) {
        console.warn(
          '[GUPP] State checksum mismatch - possible corruption. Proceeding with caution.'
        );
      }
    }

    return validated as GuppState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist, return empty state
      return createEmptyState();
    }

    // Log error and return empty state
    console.error('[GUPP] Failed to load state:', error);
    return createEmptyState();
  }
}

/**
 * Delete state file
 *
 * @param statePath - Path to state file
 */
export async function deleteState(
  statePath: string = DEFAULT_STATE_PATH
): Promise<void> {
  try {
    await fs.unlink(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

// ============================================================================
// State Persistence - AgentDB
// ============================================================================

/**
 * AgentDB interface for state storage
 */
export interface AgentDBInterface {
  store(namespace: string, key: string, value: unknown): Promise<void>;
  retrieve(namespace: string, key: string): Promise<unknown | null>;
  delete(namespace: string, key: string): Promise<void>;
}

/**
 * Save state to AgentDB
 *
 * @param state - State to save
 * @param agentDB - AgentDB interface
 * @param key - Storage key (default: 'current')
 */
export async function saveStateToAgentDB(
  state: GuppState,
  agentDB: AgentDBInterface,
  key: string = 'current'
): Promise<void> {
  const stateToSave: GuppState = {
    ...state,
    updatedAt: new Date(),
    checksum: calculateChecksum(state),
  };

  await agentDB.store(AGENTDB_NAMESPACE, key, stateToSave);
}

/**
 * Load state from AgentDB
 *
 * @param agentDB - AgentDB interface
 * @param key - Storage key (default: 'current')
 * @returns Loaded state or empty state if not found
 */
export async function loadStateFromAgentDB(
  agentDB: AgentDBInterface,
  key: string = 'current'
): Promise<GuppState> {
  try {
    const state = await agentDB.retrieve(AGENTDB_NAMESPACE, key);

    if (!state) {
      return createEmptyState();
    }

    const validated = GuppStateSchema.parse(state);
    return validated as GuppState;
  } catch (error) {
    console.error('[GUPP] Failed to load state from AgentDB:', error);
    return createEmptyState();
  }
}

// ============================================================================
// State Merging
// ============================================================================

/**
 * Merge strategy for state conflicts
 */
export type MergeStrategy = 'local' | 'remote' | 'latest' | 'union';

/**
 * Merge two states on conflict
 *
 * Uses the following strategies:
 * - session: Keep the most recently active
 * - convoys: Union with latest status
 * - formulas: Union with latest status
 * - hookedWork: Union, prefer latest status for duplicates
 *
 * @param local - Local state
 * @param remote - Remote state
 * @param strategy - Merge strategy (default: 'latest')
 * @returns Merged state
 */
export function mergeStates(
  local: GuppState,
  remote: GuppState,
  strategy: MergeStrategy = 'latest'
): GuppState {
  // Determine base state based on strategy
  const useLocal =
    strategy === 'local' ||
    (strategy === 'latest' && local.updatedAt >= remote.updatedAt);

  // Merge session - keep the most recently active
  let session: SessionInfo | undefined;
  if (local.session && remote.session) {
    session =
      local.session.lastActiveAt >= remote.session.lastActiveAt
        ? local.session
        : remote.session;
  } else {
    session = local.session ?? remote.session;
  }

  // Merge convoys - union with latest status
  const mergedConvoys = mergeConvoys(local.convoys, remote.convoys);

  // Merge formulas - union with latest status
  const mergedFormulas = mergeFormulas(local.formulas, remote.formulas);

  // Merge hooked work - union with latest status
  const mergedHookedWork = mergeHookedWork(
    local.hookedWork,
    remote.hookedWork
  );

  // Merge recovery metadata
  const recovery = {
    lastCrash: local.recovery?.lastCrash ?? remote.recovery?.lastCrash,
    crashCount:
      (local.recovery?.crashCount ?? 0) + (remote.recovery?.crashCount ?? 0),
    autoRecoverEnabled:
      local.recovery?.autoRecoverEnabled ??
      remote.recovery?.autoRecoverEnabled ??
      true,
  };

  return {
    version: Math.max(local.version, remote.version),
    session,
    convoys: mergedConvoys,
    formulas: mergedFormulas,
    hookedWork: mergedHookedWork,
    updatedAt: new Date(),
    recovery,
  };
}

/**
 * Merge convoy lists
 */
function mergeConvoys(local: Convoy[], remote: Convoy[]): Convoy[] {
  const merged = new Map<string, Convoy>();

  // Add all local convoys
  for (const convoy of local) {
    merged.set(convoy.id, convoy);
  }

  // Merge with remote, prefer latest update
  for (const convoy of remote) {
    const existing = merged.get(convoy.id);
    if (!existing) {
      merged.set(convoy.id, convoy);
    } else {
      // Prefer the more recent update (compare completedAt or startedAt)
      const existingTime =
        existing.completedAt?.getTime() ?? existing.startedAt.getTime();
      const remoteTime =
        convoy.completedAt?.getTime() ?? convoy.startedAt.getTime();

      if (remoteTime > existingTime) {
        merged.set(convoy.id, convoy);
      }
    }
  }

  return Array.from(merged.values());
}

/**
 * Merge formula lists
 */
function mergeFormulas(
  local: GuppState['formulas'],
  remote: GuppState['formulas']
): GuppState['formulas'] {
  const merged = new Map<string, (typeof local)[0]>();

  // Add all local formulas
  for (const formula of local) {
    merged.set(formula.name, formula);
  }

  // Merge with remote, prefer latest
  for (const formula of remote) {
    const existing = merged.get(formula.name);
    if (!existing) {
      merged.set(formula.name, formula);
    } else if (formula.startedAt > existing.startedAt) {
      merged.set(formula.name, formula);
    }
  }

  return Array.from(merged.values());
}

/**
 * Merge hooked work lists
 */
function mergeHookedWork(
  local: HookedWorkItem[],
  remote: HookedWorkItem[]
): HookedWorkItem[] {
  const merged = new Map<string, HookedWorkItem>();

  // Add all local work items
  for (const work of local) {
    merged.set(work.id, work);
  }

  // Merge with remote, prefer latest update
  for (const work of remote) {
    const existing = merged.get(work.id);
    if (!existing) {
      merged.set(work.id, work);
    } else if (work.updatedAt > existing.updatedAt) {
      merged.set(work.id, work);
    }
  }

  return Array.from(merged.values());
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate a simple checksum for state integrity verification
 */
function calculateChecksum(state: Omit<GuppState, 'checksum'>): string {
  const content = JSON.stringify({
    version: state.version,
    convoyCount: state.convoys.length,
    formulaCount: state.formulas.length,
    workCount: state.hookedWork.length,
    timestamp: state.updatedAt.getTime(),
  });

  // Simple hash function (not cryptographic, just for integrity check)
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Validate state structure
 */
export function validateState(state: unknown): state is GuppState {
  try {
    GuppStateSchema.parse(state);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get pending work items (GUPP principle: must run these)
 */
export function getPendingWork(state: GuppState): HookedWorkItem[] {
  return state.hookedWork.filter(
    (work) => work.status === 'pending' || work.status === 'active'
  );
}

/**
 * Get work items that need resumption after crash
 */
export function getWorkNeedingResumption(state: GuppState): HookedWorkItem[] {
  return state.hookedWork.filter(
    (work) =>
      work.status === 'active' ||
      work.status === 'pending' ||
      work.status === 'paused'
  );
}

/**
 * Update session activity timestamp
 */
export function touchSession(state: GuppState): GuppState {
  if (!state.session) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      lastActiveAt: new Date(),
    },
    updatedAt: new Date(),
  };
}

/**
 * Mark session as ended
 */
export function endSession(state: GuppState): GuppState {
  if (!state.session) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      active: false,
      lastActiveAt: new Date(),
    },
    updatedAt: new Date(),
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  GuppStateSchema,
  HookedWorkItemSchema,
  SessionInfoSchema,
  WorkItemStatusSchema,
};
