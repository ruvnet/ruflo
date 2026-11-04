/**
 * Episode get / list / update / delete over agentdb 3.3's ReflexionMemory (ADR-520).
 *
 * Episodes are what session ends and `memory distill` record, and what
 * `agentdb_episode-recall` searches. agentdb 3.3 keeps the id on update and moves the row,
 * embedding, vector entry and keyword index together; this module only validates, bounds
 * what goes back over MCP, and feature-detects older agentdb builds.
 *
 * @module v3/cli/memory/episode-crud
 */

import { withReflexionController } from './memory-bridge.js';

const TEXT_OUT_MAX = 4_000;
const LIST_MAX = 100;

export const EPISODE_CRUD_UNAVAILABLE =
  'Episode get/list/update/delete needs agentdb >= 3.3.0 with ReflexionMemory available.';

export interface EpisodeView {
  id: number;
  sessionId: string;
  task: string;
  input?: string;
  output?: string;
  critique?: string;
  reward: number;
  success: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ts?: number;
}

export interface EpisodePatch {
  task?: string;
  input?: string | null;
  output?: string | null;
  critique?: string | null;
  reward?: number;
  success?: boolean;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export type CrudResult<T> = { success: true } & T | { success: false; error: string };

/** Strict positive integer id. "12-notes" must never reach a delete as 12. */
export function parseEpisodeId(value: unknown): number | null {
  const n = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim())
    : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const clip = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, TEXT_OUT_MAX) : undefined;

/** Bound what goes back over MCP and drop the embedding. */
function view(e: any): EpisodeView {
  return {
    id: Number(e.id),
    sessionId: String(e.sessionId ?? ''),
    task: String(e.task ?? '').slice(0, TEXT_OUT_MAX),
    ...(clip(e.input) !== undefined ? { input: clip(e.input) } : {}),
    ...(clip(e.output) !== undefined ? { output: clip(e.output) } : {}),
    ...(clip(e.critique) !== undefined ? { critique: clip(e.critique) } : {}),
    reward: Number(e.reward ?? 0),
    success: !!e.success,
    ...(typeof e.latencyMs === 'number' ? { latencyMs: e.latencyMs } : {}),
    ...(typeof e.tokensUsed === 'number' ? { tokensUsed: e.tokensUsed } : {}),
    ...(Array.isArray(e.tags) ? { tags: e.tags.slice(0, 64) } : {}),
    ...(e.metadata && typeof e.metadata === 'object' ? { metadata: e.metadata } : {}),
    ...(typeof e.ts === 'number' ? { ts: e.ts } : {}),
  };
}

const supports = (r: any, method: string) => typeof r?.[method] === 'function';

/** agentdb throws ValidationError subclasses for bad input; pass their message through, bounded. */
function failure(error: unknown): { success: false; error: string } {
  const msg = error instanceof Error ? error.message : String(error);
  return { success: false, error: msg.replace(/\/[^\s:]+\//g, '<path>/').slice(0, 500) };
}

export async function bridgeGetEpisode(
  id: number,
  dbPath?: string,
): Promise<CrudResult<{ episode: EpisodeView | null }> | null> {
  return withReflexionController(dbPath, async (r) => {
    if (!supports(r, 'getEpisode')) return { success: false, error: EPISODE_CRUD_UNAVAILABLE };
    try {
      const e = r.getEpisode(id);
      return { success: true, episode: e ? view(e) : null };
    } catch (err) { return failure(err); }
  });
}

export async function bridgeListEpisodes(
  options: { sessionId?: string; success?: boolean; limit?: number; offset?: number; order?: 'newest' | 'oldest' },
  dbPath?: string,
): Promise<CrudResult<{ episodes: EpisodeView[]; total: number; limit: number; offset: number }> | null> {
  return withReflexionController(dbPath, async (r) => {
    if (!supports(r, 'listEpisodes')) return { success: false, error: EPISODE_CRUD_UNAVAILABLE };
    try {
      const page = r.listEpisodes({ ...options, limit: Math.min(options.limit ?? 20, LIST_MAX) });
      return {
        success: true,
        episodes: (page.items as any[]).map(view),
        total: Number(page.total),
        limit: Number(page.limit),
        offset: Number(page.offset),
      };
    } catch (err) { return failure(err); }
  });
}

export async function bridgeUpdateEpisode(
  id: number,
  patch: EpisodePatch,
  options: { replaceMetadata?: boolean } = {},
  dbPath?: string,
): Promise<CrudResult<{ episode: EpisodeView | null; reembedded: boolean; changedFields: string[] }> | null> {
  return withReflexionController(dbPath, async (r) => {
    if (!supports(r, 'updateEpisode')) return { success: false, error: EPISODE_CRUD_UNAVAILABLE };
    try {
      const res = await r.updateEpisode(id, patch, { replaceMetadata: options.replaceMetadata === true });
      if (!res) return { success: true, episode: null, reembedded: false, changedFields: [] };
      return {
        success: true,
        episode: view(res.episode),
        reembedded: !!res.reembedded,
        changedFields: Array.isArray(res.changedFields) ? res.changedFields : [],
      };
    } catch (err) { return failure(err); }
  });
}

export async function bridgeDeleteEpisode(
  id: number,
  dbPath?: string,
): Promise<CrudResult<{ deleted: boolean }> | null> {
  return withReflexionController(dbPath, async (r) => {
    // deleteEpisode predates 3.3, but before 3.3 it parsed ids with parseInt and never removed
    // the vector entry; gate on getEpisode so only the fixed implementation is used.
    if (!supports(r, 'getEpisode') || !supports(r, 'deleteEpisode')) {
      return { success: false, error: EPISODE_CRUD_UNAVAILABLE };
    }
    try {
      return { success: true, deleted: (await r.deleteEpisode(id)) === true };
    } catch (err) { return failure(err); }
  });
}
