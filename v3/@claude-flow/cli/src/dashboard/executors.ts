/** Maps each allowlisted command to fixed ruflo MCP tool calls. Arguments are passed as JSON values, never interpolated into argv text. */
import { MAX_SWARM_AGENTS, sanitize, type CommandName } from './protocol/index.js';
import type { Ruflo } from './exec.js';

export type ExecResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };
export interface ExecContext { ruflo: Ruflo; cid: string; publishNow: () => Promise<void> }
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const RESULT_CAP = 4000;

/** Keep results small and masked: sanitize, then drop detail until the JSON fits. */
export function capResult(r: Record<string, unknown>, cap = RESULT_CAP): Record<string, unknown> {
  const s = sanitize(r);
  if (JSON.stringify(s).length <= cap) return s;
  return { truncated: true, preview: JSON.stringify(s).slice(0, cap - 60) };
}
const fail = (error: string): ExecResult => ({ ok: false, error: error.slice(0, 200) });
const done = (result: Record<string, unknown>): ExecResult => ({ ok: true, result: capResult(result) });
function data(v: unknown): Obj {
  if (!isObj(v)) throw new Error('unexpected result');
  if (v.ok === false) throw new Error(`${String(v.code ?? 'error')}: ${String(v.message ?? '').slice(0, 120)}`);
  return isObj(v.data) ? v.data : v;
}

const MISSION_ACTION = { 'mission.pause': 'pause', 'mission.resume': 'resume', 'mission.stop': 'cancel' } as const;

export type Executor = (args: Obj, ctx: ExecContext) => Promise<ExecResult>;

export const EXECUTORS: Record<CommandName, Executor> = {
  async 'state.refresh'(_a, ctx) { await ctx.publishNow(); return done({ published: true }); },

  async 'memory.search'(a, ctx) {
    const r = data(await ctx.ruflo.mcp('memory_search', { query: String(a.query), limit: Number(a.limit ?? 5) }));
    const rows = (Array.isArray(r.results) ? r.results : []).filter(isObj).slice(0, 20).map(x => ({ key: x.key, namespace: x.namespace, score: x.similarity ?? x.score }));
    return done({ total: Number(r.total ?? rows.length), results: rows });
  },

  // DRAFT only: mission_create never starts execution; the idempotency key is the dashboard's requestId.
  async 'mission.create'(a, ctx) {
    const r = data(await ctx.ruflo.mcp('mission_create', { objective: String(a.objective), requestId: String(a.requestId) }));
    return done({ missionId: r.missionId, state: r.state, revision: r.revision, deduplicated: r.deduplicated });
  },

  async 'mission.pause'(a, ctx) { return missionAction('mission.pause', a, ctx); },
  async 'mission.resume'(a, ctx) { return missionAction('mission.resume', a, ctx); },
  async 'mission.stop'(a, ctx) { return missionAction('mission.stop', a, ctx); },

  async 'swarm.init'(a, ctx) {
    const maxAgents = Math.min(Number(a.maxAgents ?? MAX_SWARM_AGENTS), MAX_SWARM_AGENTS);
    const r = data(await ctx.ruflo.mcp('swarm_init', { topology: String(a.topology ?? 'hierarchical'), maxAgents }));
    return done({ swarmId: r.swarmId, topology: r.topology, maxAgents: r.maxAgents });
  },

  async 'agent.spawn'(a, ctx) {
    const sw = data(await ctx.ruflo.mcp('swarm_status', {}));
    if (sw.status === 'no_swarm' || typeof sw.swarmId !== 'string') return fail('no_active_swarm');
    const cap = Math.min(Number(sw.maxAgents ?? MAX_SWARM_AGENTS), MAX_SWARM_AGENTS);
    const list = data(await ctx.ruflo.mcp('agent_list', {}));
    if (Number(list.total ?? 0) >= cap) return fail('swarm_agent_cap_reached');
    const params: Obj = { agentType: String(a.type) };
    if (typeof a.name === 'string') params.agentId = a.name;
    const r = data(await ctx.ruflo.mcp('agent_spawn', params));
    return done({ agentId: r.agentId, agentType: r.agentType, status: r.status });
  },
};

async function missionAction(name: keyof typeof MISSION_ACTION, a: Obj, ctx: ExecContext): Promise<ExecResult> {
  const missionId = String(a.missionId);
  const g = data(await ctx.ruflo.mcp('mission_get', { missionId }));
  const rec = isObj(g.record) ? g.record : null;
  const revision = rec ? Number(rec.revision) : NaN;
  if (!Number.isInteger(revision)) return fail('mission_not_found');
  const r = data(await ctx.ruflo.mcp('mission_request_action', { missionId, action: MISSION_ACTION[name], expectedRevision: revision, requestId: ctx.cid, reason: 'requested from ruflo dashboard' }));
  return done({ missionId: r.missionId, state: r.state, revision: r.revision });
}
