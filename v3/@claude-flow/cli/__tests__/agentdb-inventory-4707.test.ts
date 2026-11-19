/**
 * agentdb_pattern-list / agentdb_skill-list / agentdb_skill-get /
 * agentdb_hierarchical-stats (#4707).
 *
 * The bridge registry is replaced with a mock whose controllers stand in for
 * agentdb's ReasoningBank / SkillLibrary and @claude-flow/memory's
 * TieredMemoryStore, so these tests pin the tool + bridge contract without
 * depending on which agentdb version is installed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setMemoryBridgeRegistryForTests } from '../src/memory/memory-bridge.js';
import { agentdbTools } from '../src/mcp-tools/agentdb-tools.js';
import {
  agentdbHierarchicalStats,
  agentdbPatternList,
  agentdbSkillGet,
  agentdbSkillList,
} from '../src/mcp-tools/agentdb-inventory-tools.js';

afterEach(() => __setMemoryBridgeRegistryForTests(null));

function withControllers(controllers: Record<string, unknown>, fallback: { reason: string } | null = { reason: 'agentdb-export-missing' }) {
  __setMemoryBridgeRegistryForTests({
    get: (n: string) => controllers[n] ?? null,
    getBackend: () => null,
    getHierarchicalFallback: () => fallback,
  });
}

/** Error shaped like agentdb's CrudValidationError (code CRUD_VALIDATION_ERROR, field). */
function crudError(message: string, field: string): Error {
  return Object.assign(new Error(message), { code: 'CRUD_VALIDATION_ERROR', field });
}

const NAMES = ['agentdb_pattern-list', 'agentdb_skill-list', 'agentdb_skill-get', 'agentdb_hierarchical-stats'];

describe('registration and schemas', () => {
  it('registers all four tools in agentdbTools without duplicate names', () => {
    const names = agentdbTools.map(t => t.name);
    for (const n of NAMES) expect(names).toContain(n);
    expect(names).toContain('agentdb_pattern-search');
    expect(new Set(names).size).toBe(names.length);
    // Appended after the existing tools, in this order.
    const at = NAMES.map(n => names.indexOf(n));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at[0]).toBeGreaterThan(names.indexOf('agentdb_graph-pathfinder'));
  });

  it('bounds every input and carries ADR-112 "Use when" guidance', () => {
    for (const tool of [agentdbPatternList, agentdbSkillList]) {
      const p = tool.inputSchema.properties as Record<string, any>;
      expect(p.limit).toMatchObject({ minimum: 1, maximum: 500, default: 50 });
      expect(p.offset).toMatchObject({ minimum: 0 });
      expect(typeof p.offset.maximum).toBe('number');
    }
    expect((agentdbPatternList.inputSchema.properties as any).taskType.maxLength).toBe(200);
    expect((agentdbSkillList.inputSchema.properties as any).minSuccessRate).toMatchObject({ minimum: 0, maximum: 1 });
    expect((agentdbSkillGet.inputSchema.properties as any).id).toMatchObject({ type: 'integer', minimum: 1 });
    expect(agentdbSkillGet.inputSchema.required).toEqual(['id']);
    expect(agentdbHierarchicalStats.inputSchema.properties).toEqual({});
    for (const tool of [agentdbPatternList, agentdbSkillList, agentdbSkillGet, agentdbHierarchicalStats]) {
      expect(tool.description).toMatch(/Use when/);
      expect(tool.description).toMatch(/Read-only/);
      expect(tool.description).toMatch(/unsupported/);
    }
    expect(agentdbHierarchicalStats.description).toMatch(/does not list entries/);
  });

  it('rejects out-of-schema arguments before touching the bridge', async () => {
    const listPatterns = vi.fn();
    const sk = { listSkills: vi.fn(), getSkill: vi.fn() };
    withControllers({ reasoningBank: { listPatterns }, skills: sk });
    for (const bad of [{ limit: 'ten' }, { offset: -1 }, { offset: Number.NaN }, { taskType: '' }, { taskType: 'x'.repeat(201) }]) {
      expect(await agentdbPatternList.handler(bad)).toMatchObject({ success: false, code: 'invalid-argument' });
    }
    for (const bad of [{ minSuccessRate: 1.5 }, { minSuccessRate: -0.1 }, { minSuccessRate: '0.5' }]) {
      expect(await agentdbSkillList.handler(bad)).toMatchObject({ success: false, code: 'invalid-argument' });
    }
    for (const bad of [{}, { id: 0 }, { id: 1.5 }, { id: 'deploy-skill' }, { id: -3 }]) {
      expect(await agentdbSkillGet.handler(bad)).toMatchObject({ success: false, code: 'invalid-argument' });
    }
    expect(listPatterns).not.toHaveBeenCalled();
    expect(sk.listSkills).not.toHaveBeenCalled();
    expect(sk.getSkill).not.toHaveBeenCalled();
  });
});

describe('agentdb_pattern-list', () => {
  it('passes clamped page and taskType to ReasoningBank.listPatterns and returns its page with total', async () => {
    const page = { items: [{ id: 7, taskType: 'deploy', approach: 'blue/green' }], total: 23, limit: 500, offset: 20 };
    const listPatterns = vi.fn().mockReturnValue(page);
    withControllers({ reasoningBank: { listPatterns } });

    const r = await agentdbPatternList.handler({ taskType: 'deploy', limit: 9999.9, offset: 20.7 });

    expect(listPatterns).toHaveBeenCalledWith({ taskType: 'deploy', limit: 500, offset: 20 });
    expect(r).toEqual({ success: true, controller: 'reasoningBank', ...page });
  });

  it('defaults to limit 50, offset 0', async () => {
    const listPatterns = vi.fn().mockReturnValue({ items: [], total: 0, limit: 50, offset: 0 });
    withControllers({ reasoningBank: { listPatterns } });
    await agentdbPatternList.handler({});
    expect(listPatterns).toHaveBeenCalledWith({ taskType: undefined, limit: 50, offset: 0 });
  });

  it('pages: a page past the end is empty but still reports total', async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: 5 - i }));
    const listPatterns = vi.fn(({ limit, offset }) => ({ items: all.slice(offset, offset + limit), total: all.length, limit, offset }));
    withControllers({ reasoningBank: { listPatterns } });

    const p1 = await agentdbPatternList.handler({ limit: 2 });
    const p3 = await agentdbPatternList.handler({ limit: 2, offset: 4 });
    const past = await agentdbPatternList.handler({ limit: 2, offset: 6 });

    expect(p1).toMatchObject({ success: true, items: [{ id: 5 }, { id: 4 }], total: 5, offset: 0 });
    expect(p3).toMatchObject({ success: true, items: [{ id: 1 }], total: 5, offset: 4 });
    expect(past).toMatchObject({ success: true, items: [], total: 5 });
  });

  it('an empty store is success with no items, not unsupported', async () => {
    withControllers({ reasoningBank: { listPatterns: () => ({ items: [], total: 0, limit: 50, offset: 0 }) } });
    const r = await agentdbPatternList.handler({});
    expect(r).toEqual({ success: true, controller: 'reasoningBank', items: [], total: 0, limit: 50, offset: 0 });
  });

  it('a ReasoningBank without listPatterns (LocalReasoningBank / agentdb < 3.3.0) is unsupported, never an empty list', async () => {
    withControllers({ reasoningBank: { store: vi.fn(), findSimilar: vi.fn(), getAll: vi.fn().mockReturnValue([]) } });
    const r: any = await agentdbPatternList.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported', controller: 'reasoningBank' });
    expect(r.error).toMatch(/listPatterns/);
    expect(r).not.toHaveProperty('items');
  });

  it('a missing reasoningBank controller is unsupported', async () => {
    withControllers({});
    const r: any = await agentdbPatternList.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported' });
    expect(r.error).toMatch(/listPatterns/);
    expect(r).not.toHaveProperty('items');
  });

  it('surfaces a native validation error with its code and field', async () => {
    withControllers({ reasoningBank: { listPatterns: () => { throw crudError('limit must be an integer between 1 and 500', 'limit'); } } });
    const r = await agentdbPatternList.handler({ limit: 10 });
    expect(r).toMatchObject({ success: false, code: 'CRUD_VALIDATION_ERROR', field: 'limit', error: 'limit must be an integer between 1 and 500' });
  });

  it('returns the unavailable error when the bridge has no registry', async () => {
    const prev = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
    __setMemoryBridgeRegistryForTests(null);
    process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
    try {
      const r: any = await agentdbPatternList.handler({});
      expect(r).toEqual({ success: false, error: expect.stringMatching(/AgentDB bridge not available/) });
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
      else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = prev;
    }
  });
});

describe('agentdb_skill-list', () => {
  it('passes minSuccessRate and page to SkillLibrary.listSkills and returns its page', async () => {
    const page = { items: [{ id: 3, name: 'deploy', successRate: 0.9 }], total: 1, limit: 10, offset: 0 };
    const listSkills = vi.fn().mockReturnValue(page);
    withControllers({ skills: { listSkills, getSkill: vi.fn() } });

    const r = await agentdbSkillList.handler({ minSuccessRate: 0.8, limit: 10 });

    expect(listSkills).toHaveBeenCalledWith({ minSuccessRate: 0.8, limit: 10, offset: 0 });
    expect(r).toEqual({ success: true, controller: 'skills', ...page });
  });

  it('an empty library is success with total 0; a missing SkillLibrary is unsupported', async () => {
    withControllers({ skills: { listSkills: () => ({ items: [], total: 0, limit: 50, offset: 0 }), getSkill: vi.fn() } });
    expect(await agentdbSkillList.handler({})).toMatchObject({ success: true, items: [], total: 0 });

    withControllers({});
    const r: any = await agentdbSkillList.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported', controller: 'skills' });
    expect(r.error).toMatch(/listSkills/);
    expect(r).not.toHaveProperty('items');
  });

  it('a SkillLibrary without listSkills is unsupported', async () => {
    withControllers({ skills: { retrieveSkills: vi.fn() } });
    const r: any = await agentdbSkillList.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported' });
    expect(r.error).toMatch(/listSkills\(\)/);
  });

  it('keeps the graph-adapter refusal as the native error, not unsupported or an empty page', async () => {
    const refuse = () => { throw crudError('listSkills addresses skills by SQL id and is not available with a graph adapter', 'id'); };
    withControllers({ skills: { listSkills: refuse, getSkill: refuse } });
    const r: any = await agentdbSkillList.handler({});
    expect(r).toMatchObject({ success: false, code: 'CRUD_VALIDATION_ERROR' });
    expect(r.error).toMatch(/graph adapter/);
    expect(r).not.toHaveProperty('items');
  });
});

describe('agentdb_skill-get', () => {
  it('returns found=true with the native record', async () => {
    const skill = { id: 3, name: 'deploy', successRate: 0.9, createdAt: 1 };
    const getSkill = vi.fn().mockReturnValue(skill);
    withControllers({ skills: { listSkills: vi.fn(), getSkill } });

    const r = await agentdbSkillGet.handler({ id: 3 });

    expect(getSkill).toHaveBeenCalledWith(3);
    expect(r).toEqual({ success: true, controller: 'skills', found: true, skill });
  });

  it('returns found=false, skill=null when no skill has the id', async () => {
    withControllers({ skills: { listSkills: vi.fn(), getSkill: vi.fn().mockReturnValue(null) } });
    expect(await agentdbSkillGet.handler({ id: 999 })).toEqual({ success: true, controller: 'skills', found: false, skill: null });
  });

  it('accepts a numeric-string id', async () => {
    const getSkill = vi.fn().mockReturnValue(null);
    withControllers({ skills: { getSkill } });
    await agentdbSkillGet.handler({ id: '42' });
    expect(getSkill).toHaveBeenCalledWith(42);
  });

  it('is unsupported when the SkillLibrary has no getSkill', async () => {
    withControllers({ skills: { listSkills: vi.fn() } });
    const r: any = await agentdbSkillGet.handler({ id: 1 });
    expect(r).toMatchObject({ success: false, code: 'unsupported' });
    expect(r.error).toMatch(/getSkill/);
    expect(r).not.toHaveProperty('found');
  });
});

describe('agentdb_hierarchical-stats', () => {
  function tieredStore(over: Record<string, unknown> = {}) {
    return {
      isDurable: () => true,
      getPersistence: () => 'sqlite',
      store: vi.fn(),
      recall: vi.fn(),
      getTierStats: vi.fn().mockReturnValue({ working: 2, episodic: 1, semantic: 4, superseded: 3 }),
      countPersisted: vi.fn().mockReturnValue(10),
      ...over,
    };
  }

  it('reports tier counts, persisted rows and store durability, counts only', async () => {
    withControllers({ hierarchicalMemory: tieredStore() });
    const r = await agentdbHierarchicalStats.handler({});
    expect(r).toEqual({
      success: true,
      controller: 'tieredMemoryStore',
      fallbackFrom: 'agentdb-export-missing',
      durable: true,
      persistence: 'sqlite',
      tiers: { working: 2, episodic: 1, semantic: 4, superseded: 3 },
      persistedRows: 10,
    });
    expect(r).not.toHaveProperty('entries');
  });

  it('passes a volatile store through with persistedRows null and durable false', async () => {
    withControllers({ hierarchicalMemory: tieredStore({ isDurable: () => false, getPersistence: () => 'memory', countPersisted: () => null }) });
    expect(await agentdbHierarchicalStats.handler({})).toMatchObject({ success: true, durable: false, persistence: 'memory', persistedRows: null });
  });

  it('is unsupported on the native agentdb HierarchicalMemory', async () => {
    withControllers({ hierarchicalMemory: { getStats: vi.fn(), promote: vi.fn(), store: vi.fn() } });
    const r: any = await agentdbHierarchicalStats.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported', controller: 'hierarchicalMemory' });
    expect(r.error).toMatch(/getTierStats/);
  });

  it('is unsupported when countPersisted is missing, naming it', async () => {
    withControllers({ hierarchicalMemory: tieredStore({ countPersisted: undefined }) });
    const r: any = await agentdbHierarchicalStats.handler({});
    expect(r).toMatchObject({ success: false, code: 'unsupported' });
    expect(r.error).toMatch(/countPersisted/);
    expect(r.error).not.toMatch(/getTierStats/);
  });

  it('is unsupported when there is no hierarchical controller', async () => {
    withControllers({});
    expect(await agentdbHierarchicalStats.handler({})).toMatchObject({ success: false, code: 'unsupported' });
  });
});
