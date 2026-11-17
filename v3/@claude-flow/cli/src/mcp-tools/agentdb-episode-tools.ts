/**
 * agentdb_episode-get / -list / -update / -delete (ADR-520).
 *
 * Episodes are the records session ends and `memory distill` write and that
 * agentdb_episode-recall searches. Needs agentdb >= 3.3.0 (in-place update that keeps the id
 * and re-indexes); older builds get a clear error instead of a partial operation.
 *
 * @module v3/cli/mcp-tools/agentdb-episode-tools
 */

import type { MCPTool } from './types.js';
import { validateText } from './validate-input.js';

const TEXT_MAX = 50_000;
const METADATA_MAX_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

let crud: typeof import('../memory/episode-crud.js') | null = null;
async function episodeCrud() {
  crud ??= await import('../memory/episode-crud.js');
  return crud;
}

const unavailable = { success: false as const, error: 'AgentDB ReflexionMemory not available. Use memory_* tools instead.' };

function idOf(value: unknown, parse: (v: unknown) => number | null): number | { error: string } {
  const id = parse(value);
  return id ?? { error: 'id must be a positive integer' };
}

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 16) return true;
  if (!value || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k) || hasForbiddenKey(v, depth + 1)) return true;
  }
  return false;
}

/** Optional text field: undefined = leave alone, null = clear, string = set. */
function optionalText(value: unknown, name: string, nullable: boolean): { value?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return nullable ? { value: null } : { error: `${name} cannot be null` };
  const v = validateText(value, name, TEXT_MAX);
  if (!v.valid) return { error: v.error };
  if (!nullable && !v.sanitized.trim()) return { error: `${name} cannot be empty` };
  return { value: v.sanitized };
}

export const agentdbEpisodeGet: MCPTool = {
  name: 'agentdb_episode-get',
  description: 'Get one past episode (a session summary or distilled trajectory) by id. Use when you already have an episode id from agentdb_episode-recall or agentdb_episode-list and need its full record; memory_retrieve is wrong here because episodes are not key-value entries. Returns episode: null when missing. Needs agentdb >= 3.3.0.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Episode id' } },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const m = await episodeCrud();
      const id = idOf(params.id, m.parseEpisodeId);
      if (typeof id !== 'number') return { success: false, ...id };
      return (await m.bridgeGetEpisode(id)) ?? unavailable;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Internal error' };
    }
  },
};

export const agentdbEpisodeList: MCPTool = {
  name: 'agentdb_episode-list',
  description: 'Page through past episodes, newest first, optionally for one session or only successes/failures, with a total count. Use when you need to browse or audit what was recorded (e.g. every episode from one session); use agentdb_episode-recall instead when you want the episodes most relevant to a task. Needs agentdb >= 3.3.0.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Only episodes from this session' },
      success: { type: 'boolean', description: 'Only successes (true) or failures (false)' },
      limit: { type: 'number', description: 'Page size (1-100)', default: 20 },
      offset: { type: 'number', description: 'Episodes to skip', default: 0 },
      order: { type: 'string', enum: ['newest', 'oldest'], default: 'newest' },
    },
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      if (params.sessionId !== undefined) {
        const v = validateText(params.sessionId, 'sessionId', 256);
        if (!v.valid) return { success: false, error: v.error };
      }
      if (params.success !== undefined && typeof params.success !== 'boolean') {
        return { success: false, error: 'success must be a boolean' };
      }
      const limit = params.limit === undefined ? 20 : Number(params.limit);
      const offset = params.offset === undefined ? 0 : Number(params.offset);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { success: false, error: 'limit must be an integer 1-100' };
      if (!Number.isInteger(offset) || offset < 0) return { success: false, error: 'offset must be a non-negative integer' };
      if (params.order !== undefined && params.order !== 'newest' && params.order !== 'oldest') {
        return { success: false, error: 'order must be "newest" or "oldest"' };
      }
      const m = await episodeCrud();
      return (await m.bridgeListEpisodes({
        sessionId: params.sessionId as string | undefined,
        success: params.success as boolean | undefined,
        limit,
        offset,
        order: (params.order as 'newest' | 'oldest' | undefined) ?? 'newest',
      })) ?? unavailable;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Internal error' };
    }
  },
};

export const agentdbEpisodeUpdate: MCPTool = {
  name: 'agentdb_episode-update',
  description: 'Correct a past episode in place, keeping its id: task/critique/output text, reward, success flag, tags or metadata. Use when an outcome has been verified or an episode turned out wrong (e.g. success=false with a critique); deleting and re-recording is wrong because it changes the id. Text changes are re-embedded and re-indexed so recall sees them; metadata merges unless replaceMetadata is true. Needs agentdb >= 3.3.0.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Episode id' },
      task: { type: 'string', description: 'New task text' },
      critique: { type: ['string', 'null'], description: 'New critique, or null to clear' },
      output: { type: ['string', 'null'], description: 'New output, or null to clear' },
      reward: { type: 'number', description: 'New reward (0-1)' },
      success: { type: 'boolean', description: 'New success flag' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' },
      metadata: { type: 'object', description: 'Metadata patch' },
      replaceMetadata: { type: 'boolean', description: 'Replace metadata instead of merging', default: false },
    },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const allowed = new Set(['id', 'task', 'critique', 'output', 'reward', 'success', 'tags', 'metadata', 'replaceMetadata']);
      const unknown = Object.keys(params).filter(k => !allowed.has(k));
      if (unknown.length) return { success: false, error: `unknown field(s): ${unknown.join(', ')}` };
      const m = await episodeCrud();
      const id = idOf(params.id, m.parseEpisodeId);
      if (typeof id !== 'number') return { success: false, ...id };

      const patch: import('../memory/episode-crud.js').EpisodePatch = {};
      for (const [field, nullable] of [['task', false], ['critique', true], ['output', true]] as const) {
        const r = optionalText(params[field], field, nullable);
        if (r.error) return { success: false, error: r.error };
        if (r.value !== undefined) patch[field] = r.value as string;
      }
      if (params.reward !== undefined) {
        if (typeof params.reward !== 'number' || !Number.isFinite(params.reward) || params.reward < 0 || params.reward > 1) {
          return { success: false, error: 'reward must be a number between 0 and 1' };
        }
        patch.reward = params.reward;
      }
      if (params.success !== undefined) {
        if (typeof params.success !== 'boolean') return { success: false, error: 'success must be a boolean' };
        patch.success = params.success;
      }
      if (params.tags !== undefined) {
        if (!Array.isArray(params.tags) || params.tags.length > 64 || params.tags.some(t => typeof t !== 'string' || t.length > 128)) {
          return { success: false, error: 'tags must be up to 64 strings of at most 128 characters' };
        }
        patch.tags = params.tags as string[];
      }
      if (params.metadata !== undefined) {
        const md = params.metadata;
        if (md !== null && (typeof md !== 'object' || Array.isArray(md))) return { success: false, error: 'metadata must be an object or null' };
        if (md && hasForbiddenKey(md)) return { success: false, error: 'metadata contains a forbidden key (__proto__, constructor, prototype) or is nested too deeply' };
        if (md && Buffer.byteLength(JSON.stringify(md), 'utf8') > METADATA_MAX_BYTES) return { success: false, error: 'metadata exceeds 64 KB' };
        patch.metadata = md as Record<string, unknown> | null;
      }
      if (Object.keys(patch).length === 0) return { success: false, error: 'nothing to update' };
      return (await m.bridgeUpdateEpisode(id, patch, { replaceMetadata: params.replaceMetadata === true })) ?? unavailable;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Internal error' };
    }
  },
};

export const agentdbEpisodeDelete: MCPTool = {
  name: 'agentdb_episode-delete',
  description: 'Delete a past episode by id, with its embedding and index entries, so recall stops returning it. Use when an episode must not be recalled at all (wrong, duplicate or sensitive); prefer agentdb_episode-update over deleting when it only needs correcting. Irreversible. Needs agentdb >= 3.3.0.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'number', description: 'Episode id' } },
    required: ['id'],
  },
  handler: async (params: Record<string, unknown>) => {
    try {
      const m = await episodeCrud();
      const id = idOf(params.id, m.parseEpisodeId);
      if (typeof id !== 'number') return { success: false, ...id };
      return (await m.bridgeDeleteEpisode(id)) ?? unavailable;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message.slice(0, 500) : 'Internal error' };
    }
  },
};

export const agentdbEpisodeCrudTools: MCPTool[] = [
  agentdbEpisodeGet,
  agentdbEpisodeList,
  agentdbEpisodeUpdate,
  agentdbEpisodeDelete,
];
