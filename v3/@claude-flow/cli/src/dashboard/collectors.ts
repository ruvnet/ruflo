/** Read-only state collection through ruflo's own MCP surface (`ruflo mcp exec`), plus ADR files on disk. Failures become health notes. */
import { existsSync, lstatSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { arch, platform } from 'node:os';
import { DigestSchema, MAX_ITEMS, sanitize, type Digest, type Level } from './protocol/index.js';
import type { Ruflo } from './exec.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n: number): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const nat = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const ms = (v: unknown): number | undefined => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) && t > 0 ? t : undefined; };
/** mission_* tools wrap results as {ok, data}. */
const unwrap = (v: unknown): Obj => { if (!isObj(v)) throw new Error('unexpected result shape'); if (v.ok === false) throw new Error(`tool refused: ${str(v.code, 40)}`); return isObj(v.data) ? v.data : v; };

export const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisions', 'v3/docs/adr'] as const;

export function isRufloProject(dir: string): boolean {
  return ['.claude-flow', '.swarm'].some(d => existsSync(join(dir, d)));
}

function readHead(path: string, bytes: number): string {
  const fd = openSync(path, 'r');
  try { const b = Buffer.alloc(bytes); const n = readSync(fd, b, 0, bytes, 0); return b.subarray(0, n).toString('utf8'); } finally { closeSync(fd); }
}

/** Title + status from the first 4 KiB of each ADR markdown file. Regular files only (symlinks are skipped). */
export function collectAdrs(projectDir: string): Digest['adrs'] {
  const out: Digest['adrs'] = [];
  for (const rel of ADR_DIRS) {
    const dir = join(projectDir, rel);
    let names: string[];
    try { if (!lstatSync(dir).isDirectory()) continue; names = readdirSync(dir).filter(n => /\.md$/i.test(n)).sort().reverse(); } catch { continue; }
    for (const n of names) {
      if (out.length >= MAX_ITEMS) return out;
      const p = join(dir, n);
      try {
        if (!lstatSync(p).isFile()) continue;
        const head = readHead(p, 4096);
        const title = /^#\s+(.+)$/m.exec(head)?.[1] ?? n;
        const status = /^\s*(?:[-*]\s*)?\**status\**\s*[:=]\s*\**\s*([A-Za-z][A-Za-z -]{0,22})/im.exec(head)?.[1] ?? 'unknown';
        const id = /^(adr[-_ ]?\d+|\d{3,5})/i.exec(n)?.[1] ?? n.replace(/\.md$/i, '');
        out.push({ id: str(id, 40), title: str(title, 200), status: str(status.trim().toLowerCase(), 24) });
      } catch { /* unreadable ADR: skip */ }
    }
  }
  return out;
}

export interface CollectOpts { ruflo: Ruflo; projectDir: string; level: Level; now?: () => number }

/** Build a digest. Never throws: each collector that fails adds a note instead. */
export async function collectDigest(o: CollectOpts): Promise<Digest> {
  const notes: string[] = [];
  let errors = 0;
  const note = (label: string, e: unknown) => { errors++; notes.push(`${label}: ${(e as Error)?.message ?? 'failed'}`.slice(0, 200)); };
  const attempt = async <T>(label: string, f: () => Promise<T>): Promise<T | undefined> => { try { return await f(); } catch (e) { note(label, e); return undefined; } };
  const now = (o.now ?? Date.now)();
  const project = isRufloProject(o.projectDir);
  if (!project) notes.push('project dir has no .claude-flow/.swarm; run `ruflo init` there');

  const call = (tool: string, params: Obj = {}) => o.ruflo.mcp(tool, params);
  const [info, sys, missions, tasks, swarm, agents, mem] = project
    ? await Promise.all([
      attempt('system_info', () => call('system_info')), attempt('system_health', () => call('system_health')),
      attempt('mission_get', () => call('mission_get')), attempt('task_summary', () => call('task_summary')),
      attempt('swarm_status', () => call('swarm_status')), attempt('agent_list', () => call('agent_list')),
      attempt('memory_stats', () => call('memory_stats')),
    ])
    : [undefined, undefined, undefined, undefined, undefined, undefined, undefined];

  const d: Record<string, unknown> = {
    collectedAt: now,
    ruflo: { version: isObj(info) ? str(info.version, 40) || 'unknown' : 'unknown', node: isObj(info) ? str(info.nodeVersion, 40) || undefined : undefined, os: `${platform()}-${arch()}` },
    level: o.level, adrs: collectAdrs(o.projectDir), missions: [], events: [],
  };
  let healthy = project;
  if (isObj(sys)) {
    healthy = sys.overall === 'healthy';
    if (Array.isArray(sys.checks)) for (const c of sys.checks) if (isObj(c) && c.status !== 'healthy') notes.push(`${str(c.name, 40)}: ${str(c.status, 24)}`);
  }

  const missionRows = await attempt('missions', async () => {
    const list = isObj(missions) && Array.isArray(unwrap(missions).missions) ? (unwrap(missions).missions as unknown[]) : [];
    return list.filter(isObj).slice(0, MAX_ITEMS).map(m => ({ id: str(m.missionId, 40), objective: str(m.objective, 300), state: str(m.state, 24), revision: nat(m.revision), updatedAt: ms(m.updatedAt) }));
  });
  if (missionRows) d.missions = missionRows;

  if (isObj(tasks)) d.tasks = { total: nat(tasks.total), pending: nat(tasks.pending), running: nat(tasks.running), done: nat(tasks.completed) };
  if (isObj(swarm) && swarm.status !== 'no_swarm' && typeof swarm.swarmId === 'string') {
    const list = isObj(agents) && Array.isArray(agents.agents) ? agents.agents.filter(isObj) : [];
    d.swarm = {
      id: str(swarm.swarmId, 80), topology: str(swarm.topology, 32) || undefined, maxAgents: nat(swarm.maxAgents) || undefined,
      agents: list.slice(0, MAX_ITEMS).map(a => ({ id: str(a.agentId, 80), type: str(a.agentType, 40), state: str(a.status, 24) })),
    };
  }
  if (isObj(mem)) d.memory = { entries: nat(mem.totalEntries), namespaces: isObj(mem.namespaces) ? Object.keys(mem.namespaces).length : undefined, backend: str(mem.backend, 40) || undefined };

  // Recent mission events (3 newest missions, 5 events each): kind + mission id only, no payloads.
  if (missionRows && missionRows.length) {
    const recent = [...missionRows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, 3);
    const evs: { at: number; kind: string; text: string }[] = [];
    await Promise.all(recent.map(m => attempt('mission_events', async () => {
      const data = unwrap(await call('mission_events', { missionId: m.id, limit: 5 }));
      for (const e of Array.isArray(data.events) ? data.events.filter(isObj) : []) evs.push({ at: ms(e.at) ?? now, kind: str(e.type, 40), text: `${m.id} seq ${nat(e.seq)}` });
    })));
    d.events = evs.sort((a, b) => b.at - a.at).slice(0, 20);
  }

  d.health = { ok: healthy && errors === 0, notes: notes.slice(0, 20) };
  const parsed = DigestSchema.safeParse(sanitize(d));
  if (parsed.success) return parsed.data;
  return DigestSchema.parse({ collectedAt: now, ruflo: { version: 'unknown' }, level: o.level, health: { ok: false, notes: ['digest failed local validation'] } });
}
