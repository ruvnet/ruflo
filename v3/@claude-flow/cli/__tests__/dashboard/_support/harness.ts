/** Shared test fixtures: temp state dir, temp ruflo project, stub ruflo, and a linked device against the fake dashboard. */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approver } from '../../../src/dashboard/approver.js';
import type { Ruflo } from '../../../src/dashboard/exec.js';
import { link } from '../../../src/dashboard/link.js';
import { runConnector, type RunEnd } from '../../../src/dashboard/run.js';
import { loadConfig, saveConfig, type Config } from '../../../src/dashboard/state.js';
import { FakeDashboard, type FakeServerOpts } from './fake-server.js';
import type { Level } from '../../../src/dashboard/protocol/index.js';

export interface StubRuflo extends Ruflo { calls: { tool: string; params: Record<string, unknown> }[]; fail: Set<string>; overrides: Record<string, unknown> }

/** Canned results shaped like the real `ruflo mcp exec` output captured from @claude-flow/cli 3.55.0. */
export function stubRuflo(): StubRuflo {
  const s: StubRuflo = {
    calls: [], fail: new Set(), overrides: {},
    async mcp(tool, params = {}) {
      s.calls.push({ tool, params });
      if (s.fail.has(tool)) throw new Error(`${tool} failed`);
      if (tool in s.overrides) return s.overrides[tool];
      switch (tool) {
        case 'system_info': return { version: '3.55.0', nodeVersion: 'v22.23.2', platform: 'linux' };
        case 'system_health': return { overall: 'healthy', score: 100, checks: [{ name: 'memory', status: 'healthy' }] };
        case 'mission_get': return { ok: true, data: { missions: [{ missionId: 'msn_' + 'a'.repeat(24), objective: 'Ship the report, key sk-abcdefghijklmnopqrstuv', state: 'draft', revision: 1, updatedAt: '2026-10-08T03:11:19.776Z' }] } };
        case 'mission_events': return { ok: true, data: { events: [{ seq: 1, type: 'mission.created', at: '2026-10-08T03:11:19.776Z' }] } };
        case 'task_summary': return { total: 3, pending: 1, running: 1, completed: 1, failed: 0 };
        case 'swarm_status': return { swarmId: 'swarm-1', status: 'running', topology: 'hierarchical', maxAgents: 6, agentCount: 1 };
        case 'agent_list': return { agents: [{ agentId: 'agent-1', agentType: 'coder', status: 'idle' }], total: 1 };
        case 'memory_stats': return { totalEntries: 12, namespaces: { a: 1, b: 2 }, backend: 'sqlite (bridge)' };
        case 'memory_search': return { query: String(params.query), results: [{ key: 'k1', namespace: 'n', similarity: 0.9 }], total: 1 };
        case 'mission_create': return { ok: true, data: { missionId: 'msn_' + 'b'.repeat(24), revision: 1, state: 'draft', deduplicated: false } };
        case 'mission_request_action': return { ok: true, data: { missionId: params.missionId, revision: 2, state: 'paused' } };
        case 'swarm_init': return { success: true, swarmId: 'swarm-2', topology: params.topology, maxAgents: params.maxAgents };
        case 'agent_spawn': return { success: true, agentId: String(params.agentId ?? 'agent-new'), agentType: params.agentType, status: 'registered' };
        default: throw new Error(`unexpected tool ${tool}`);
      }
    },
  };
  return s;
}

export class Rig {
  srv!: FakeDashboard; home = ''; project = ''; root = '';
  ruflo = stubRuflo(); cfg!: Config;
  logs: string[] = [];
  static async create(opts: FakeServerOpts = {}, level: Level = 'read'): Promise<Rig> {
    const r = new Rig();
    r.root = mkdtempSync(join(tmpdir(), 'rfdash-'));
    r.home = join(r.root, 'home'); r.project = join(r.root, 'proj');
    mkdirSync(join(r.project, '.claude-flow'), { recursive: true });
    r.srv = await new FakeDashboard(opts).start();
    r.cfg = await link({ home: r.home, baseUrl: r.srv.baseUrl, name: 'test box', level, projectDir: r.project, sleep: async () => undefined });
    return r;
  }
  setConfig(patch: Partial<Config>): void { this.cfg = { ...loadConfig(this.home)!, ...patch }; saveConfig(this.home, this.cfg); }
  start(approver?: Approver, intervalMs = 60_000): { done: Promise<RunEnd>; stop: () => void } {
    const ac = new AbortController();
    const done = runConnector({ home: this.home, projectDir: this.project, ruflo: this.ruflo, approver, intervalMs, signal: ac.signal, log: l => this.logs.push(l), sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 30))) });
    return { done, stop: () => ac.abort() };
  }
  async cleanup(): Promise<void> { await this.srv.stop(); rmSync(this.root, { recursive: true, force: true }); }
}
