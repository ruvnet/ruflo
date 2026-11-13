/**
 * agentdb_pattern-list / agentdb_skill-list / agentdb_skill-get /
 * agentdb_hierarchical-stats (#4707).
 *
 * Read-only bindings over inventory APIs AgentDB already ships
 * (ReasoningBank.listPatterns, SkillLibrary.listSkills/getSkill, agentdb >= 3.3.0)
 * and the tiered store's counts (TieredMemoryStore.getTierStats/countPersisted).
 * They go through the existing memory-bridge registry, so they read the same
 * stores the write tools use. A controller or method the installed agentdb
 * does not have comes back as `success: false, code: 'unsupported'`, never as
 * an empty list.
 *
 * @module v3/cli/mcp-tools/agentdb-inventory-tools
 */

import type { MCPTool } from './types.js';

/** agentdb's MAX_LIST_LIMIT; a larger limit is rejected natively. */
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;
const MAX_OFFSET = 1_000_000_000;
const TASK_TYPE_MAX_LENGTH = 200;

let bridgeModule: typeof import('../memory/memory-bridge.js') | null = null;
async function getBridge() {
  bridgeModule ??= await import('../memory/memory-bridge.js');
  return bridgeModule;
}

const unavailable = { success: false as const, error: 'AgentDB bridge not available. Use memory_list/memory_retrieve instead.' };

function fail(error: string) {
  return { success: false as const, code: 'invalid-argument', error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\/[^\s:]+\//g, '<path>/').slice(0, 500) : 'Internal error';
}

/** Validate limit/offset; returns an error message or the clamped page. */
function readPage(params: Record<string, unknown>): string | { limit: number; offset: number } {
  const { limit, offset } = params;
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit))) return 'limit must be a number';
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0)) {
    return 'offset must be a non-negative number';
  }
  return {
    limit: limit === undefined ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit as number))),
    offset: offset === undefined ? 0 : Math.min(MAX_OFFSET, Math.floor(offset as number)),
  };
}

const pageProperties = {
  limit: { type: 'number', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT, description: `Page size, clamped to 1..${MAX_LIMIT} (agentdb's own maximum).` },
  offset: { type: 'number', minimum: 0, maximum: MAX_OFFSET, default: 0, description: 'Number of records to skip. For the next page pass offset + limit; stop when offset >= total.' },
};

export const agentdbPatternList: MCPTool = {
  name: 'agentdb_pattern-list',
  description: 'Page through every ReasoningBank pattern (the store agentdb_pattern-store writes), newest first, optionally filtered by exact taskType. Use when you need a complete inventory or audit of stored patterns: agentdb_pattern-search is wrong for that because it returns only the top-k most similar to a query. Returns the native page {items, total, limit, offset}; total counts every matching pattern, so page with offset until offset >= total. Pages are live reads, not a snapshot. Read-only. code=unsupported means the active ReasoningBank has no listPatterns (agentdb < 3.3.0 or the local fallback bank), which is not the same as an empty store.',
  inputSchema: {
    type: 'object',
    properties: {
      taskType: { type: 'string', minLength: 1, maxLength: TASK_TYPE_MAX_LENGTH, description: 'Only patterns with exactly this task type. Omit for all.' },
      ...pageProperties,
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const taskType = params.taskType;
      if (taskType !== undefined && (typeof taskType !== 'string' || taskType.length === 0 || taskType.length > TASK_TYPE_MAX_LENGTH)) {
        return fail(`taskType must be a non-empty string of at most ${TASK_TYPE_MAX_LENGTH} characters`);
      }
      const page = readPage(params);
      if (typeof page === 'string') return fail(page);
      const bridge = await getBridge();
      const result = await bridge.bridgeListPatterns({ taskType: taskType as string | undefined, ...page });
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbSkillList: MCPTool = {
  name: 'agentdb_skill-list',
  description: 'Page through every skill in the AgentDB SkillLibrary, newest first, optionally only those with successRate >= minSuccessRate. Use when you need the full set of learned skills or their ids for agentdb_skill-get; semantic retrieval is wrong for an inventory because it returns only the closest matches. Returns the native page {items, total, limit, offset}; total counts every matching skill, so page with offset until offset >= total. Pages are live reads, not a snapshot. Read-only. code=unsupported means no SkillLibrary or no listSkills (agentdb < 3.3.0); a graph-backed library refuses with its own error.',
  inputSchema: {
    type: 'object',
    properties: {
      minSuccessRate: { type: 'number', minimum: 0, maximum: 1, description: 'Only skills whose successRate is at least this value (0..1). Omit for all.' },
      ...pageProperties,
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const min = params.minSuccessRate;
      if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min) || min < 0 || min > 1)) {
        return fail('minSuccessRate must be a number between 0 and 1');
      }
      const page = readPage(params);
      if (typeof page === 'string') return fail(page);
      const bridge = await getBridge();
      const result = await bridge.bridgeListSkills({ minSuccessRate: min as number | undefined, ...page });
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbSkillGet: MCPTool = {
  name: 'agentdb_skill-get',
  description: 'Read one AgentDB SkillLibrary skill by its numeric id (as listed by agentdb_skill-list). Use when you hold a skill id and need that exact record; a similarity search is wrong for this because it can return a different skill. found=false with skill=null means no skill has that id. Names are not accepted: AgentDB has no exact lookup by name, so list and pick the id. Read-only. code=unsupported means no SkillLibrary or no getSkill (agentdb < 3.3.0).',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Positive integer skill id.' },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const raw = params.id;
      const id = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
        return fail('id must be a positive integer skill id (names are not accepted)');
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeGetSkill({ id });
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbHierarchicalStats: MCPTool = {
  name: 'agentdb_hierarchical-stats',
  description: 'Count-only view of the hierarchical memory store behind agentdb_hierarchical-store: tiers = in-memory entry counts per tier plus superseded (getTierStats), persistedRows = rows in the tiered_memory table (countPersisted, null on a volatile store). The two measure different things and need not agree. Use when you need to know how much hierarchical memory exists or whether writes are persisted; agentdb_hierarchical-recall is wrong for that because it ranks by relevance and returns no totals. Also reports controller, durable and persistence. It does not list entries. Read-only. code=unsupported means the active store has no such counts.',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => {
    try {
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalStats();
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbInventoryTools: MCPTool[] = [
  agentdbPatternList,
  agentdbSkillList,
  agentdbSkillGet,
  agentdbHierarchicalStats,
];
