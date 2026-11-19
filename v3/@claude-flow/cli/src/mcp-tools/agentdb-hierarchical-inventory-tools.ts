/**
 * agentdb_hierarchical-list / agentdb_hierarchical-get (#4712).
 *
 * Read-only inventory over the persisted `tiered_memory` table behind
 * agentdb_hierarchical-store. agentdb_hierarchical-recall ranks by relevance
 * over a capped in-memory view, so it cannot enumerate what is stored or read
 * an entry back by id; these tools can. Needs @claude-flow/memory >= 3.3.0.
 *
 * @module v3/cli/mcp-tools/agentdb-hierarchical-inventory-tools
 */

import type { MCPTool } from './types.js';

const TIERS = ['working', 'episodic', 'semantic'] as const;
const STATUSES = ['active', 'expired', 'superseded', 'archived', 'all'] as const;
const MAX_LIMIT = 1000;
const CURSOR_MAX_LENGTH = 2048;
const ID_MAX_LENGTH = 1000;

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

export const agentdbHierarchicalList: MCPTool = {
  name: 'agentdb_hierarchical-list',
  description: 'Page through every persisted hierarchical-memory entry (the tiered_memory table behind agentdb_hierarchical-store), newest first, filtered by tier and status. Use when you need a complete inventory or audit of stored facts: agentdb_hierarchical-recall is wrong for that because it ranks by query relevance over an in-memory view capped at 5,000 entries per tier. status: active (default) = currently valid; expired = validity window closed or not yet open; superseded = invalidated by a newer fact; archived = archived without a superseding id; all = everything, each labelled. Pass nextCursor back as cursor for the next page; the cursor is opaque and only valid for the same tier and status. totalEstimate is an exact count for all/superseded/archived and is omitted for active/expired, which need a full scan. Read-only; refuses on a volatile (non-persistent) store.',
  inputSchema: {
    type: 'object',
    properties: {
      tier: { type: 'string', enum: [...TIERS], description: 'Only entries in this tier. Omit for all tiers.' },
      status: {
        type: 'string',
        enum: [...STATUSES],
        default: 'active',
        description: 'active = valid now; expired = window closed or not yet open; superseded = replaced by a newer fact; archived = archived without a superseding id; all = every row with its status.',
      },
      limit: { type: 'number', minimum: 1, maximum: MAX_LIMIT, default: 100, description: `Page size, clamped to 1..${MAX_LIMIT}.` },
      cursor: {
        type: 'string',
        maxLength: CURSOR_MAX_LENGTH,
        description: 'Opaque nextCursor from the previous page. Must be reused with the same tier and status; an altered or foreign cursor is rejected. Omit to start from the newest entry.',
      },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const tier = params.tier;
      if (tier !== undefined && !(typeof tier === 'string' && (TIERS as readonly string[]).includes(tier))) {
        return fail(`tier must be one of ${TIERS.join(', ')}`);
      }
      const status = params.status ?? 'active';
      if (!(typeof status === 'string' && (STATUSES as readonly string[]).includes(status))) {
        return fail(`status must be one of ${STATUSES.join(', ')}`);
      }
      const limit = params.limit;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit))) {
        return fail('limit must be a number');
      }
      const cursor = params.cursor;
      if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > CURSOR_MAX_LENGTH)) {
        return fail(`cursor must be a non-empty string of at most ${CURSOR_MAX_LENGTH} characters`);
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalList({
        tier: tier as string | undefined,
        status,
        limit: limit === undefined ? undefined : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit as number))),
        cursor: cursor as string | undefined,
      });
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbHierarchicalGet: MCPTool = {
  name: 'agentdb_hierarchical-get',
  description: 'Read one persisted hierarchical-memory entry by its stable id (the id returned by agentdb_hierarchical-store or listed by agentdb_hierarchical-list) together with its status. Use when you hold an id and need that exact record: agentdb_hierarchical-recall is wrong for this because it matches query text, not ids, and memory_retrieve reads a different store. By default only an active entry is returned; set includeInactive=true to also read expired, superseded or archived history. found=false means no row with that id, or an inactive row without includeInactive. Read-only; refuses on a volatile (non-persistent) store.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: ID_MAX_LENGTH, description: 'Stable entry id (e.g. tm_...). Keys are not accepted.' },
      includeInactive: {
        type: 'boolean',
        default: false,
        description: 'Also return expired, superseded or archived entries. Default false returns active entries only.',
      },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const id = params.id;
      if (typeof id !== 'string' || id.length === 0 || id.length > ID_MAX_LENGTH) {
        return fail(`id must be a non-empty string of at most ${ID_MAX_LENGTH} characters`);
      }
      if (params.includeInactive !== undefined && typeof params.includeInactive !== 'boolean') {
        return fail('includeInactive must be a boolean');
      }
      const bridge = await getBridge();
      const result = await bridge.bridgeHierarchicalGet({ id, includeInactive: params.includeInactive === true });
      return result ?? unavailable;
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  },
};

export const agentdbHierarchicalInventoryTools: MCPTool[] = [agentdbHierarchicalList, agentdbHierarchicalGet];
