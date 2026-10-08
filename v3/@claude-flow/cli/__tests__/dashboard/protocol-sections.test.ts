import { describe, expect, it } from 'vitest';
import {
  buildSectionFrame, fitToBudget, isSectionName, legacyDigestToSections, parseSectionFrame, parseWatch, READ_TOOLS, SECTION_BUDGET_BYTES, SECTION_CADENCE_S,
  SECTION_NAMES, SECTION_TTL_S, SECTION_VERSIONS, sectionHash, SectionSchemas, parseDigest, type SectionName,
} from '../../src/dashboard/protocol/index.js';

const SAMPLES: Record<SectionName, Record<string, unknown>> = {
  meta: { ruflo: { version: '3.55.0', node: 'v22', os: 'linux-x64' }, project: true, cli: 'ruflo', connector: '1' },
  health: { ok: true, notes: ['x'], areas: [{ name: 'memory', status: 'healthy' }] },
  alerts: { alerts: [{ level: 'warn', key: 'budget', text: 'near budget', go: 'cost' }] },
  control: { level: 'read', autoApprove: false, classBudgets: [{ class: 'plan', limit: 3 }] },
  missions: { missions: [{ id: 'msn_1', source: 'ruflo', objective: 'o', state: 'draft', revision: 1, detail: { plan: { taskCount: 1, tasks: [{ id: 't', title: 'T', status: 'todo' }] }, evidence: { count: 1, verified: 0 }, executor: null, blockedReason: null, budget: null } }] },
  mission_events: { events: [{ missionId: 'msn_1', seq: 1, type: 'mission.created', at: 1 }] },
  tasks: { total: 1, pending: 1, running: 0, done: 0, failed: 0, items: [{ id: 't1', title: 'x', status: 'pending' }] },
  swarm: { swarm: { id: 's', topology: 'hierarchical', maxAgents: 6 }, agents: [{ id: 'a', type: 'coder', state: 'idle' }] },
  approvals: { items: [{ kind: 'confirm', text: 'Run it?', ageS: 4 }] },
  memory: { entries: 3, namespaceCount: 1, namespaces: [{ name: 'default', count: 3 }], backend: 'sqlite', flags: [] },
  cost: { available: false, reason: 'ledger not installed', byModel: [], advice: [], perMission: [] },
  events: { events: [{ at: 1, kind: 'mission', level: 'info', src: 'ruflo', text: 't' }] },
  notices: { notices: [{ at: 1, level: 'info', text: 'hi', key: 'k' }], toastMode: 'all' },
  adrs: { folder: 'docs/adr', counts: { accepted: 1 }, items: [{ id: 'ADR-1', title: 'T', status: 'accepted', date: '2026-10-08' }], lint: [] },
  whatsnew: { plugins: [{ name: 'p', entries: [{ version: '1.0.0', changes: ['a'] }] }], breaking: [] },
  settings: { options: [{ key: 'k', value: 'v' }] },
};

describe('sections', () => {
  it('has the 16 P0 sections with budget, cadence, ttl and version for each', () => {
    expect(SECTION_NAMES).toHaveLength(16);
    for (const n of SECTION_NAMES) { expect(SECTION_BUDGET_BYTES[n]).toBeGreaterThan(0); expect(SECTION_CADENCE_S[n]).toBeGreaterThan(0); expect(SECTION_TTL_S[n]).toBeGreaterThanOrEqual(30); expect(SECTION_VERSIONS[n]).toBe(1); }
    expect(isSectionName('missions')).toBe(true); expect(isSectionName('timeline')).toBe(false);
  });
  it.each(SECTION_NAMES)('%s: sample is valid, unknown field is rejected (strict)', n => {
    expect(SectionSchemas[n].safeParse(SAMPLES[n]).success).toBe(true);
    expect(SectionSchemas[n].safeParse({ ...SAMPLES[n], extra: 1 }).success).toBe(false);
  });
  it.each(SECTION_NAMES)('%s: builds a frame that round-trips through parseSectionFrame', n => {
    const f = buildSectionFrame(n, SAMPLES[n] as never, { rev: 2, at: Date.now() });
    expect(f).toMatchObject({ v: 2, section: n, rev: 2, sv: 1, truncated: false });
    const r = parseSectionFrame(JSON.parse(JSON.stringify(f)));
    expect(r.ok).toBe(true);
  });
  it('rejects unknown sections, extra frame fields, wrong version and bad ttl', () => {
    const f = buildSectionFrame('meta', SAMPLES.meta as never, { rev: 0, at: 1 });
    expect(parseSectionFrame({ ...f, section: 'timeline' })).toEqual({ ok: false, reason: 'unknown_section' });
    expect(parseSectionFrame({ ...f, extra: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, v: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, ttlS: 1 })).toEqual({ ok: false, reason: 'malformed' });
    expect(parseSectionFrame({ ...f, body: { ...f.body, nope: 1 } })).toEqual({ ok: false, reason: 'invalid_body' });
    expect(parseSectionFrame('garbage')).toEqual({ ok: false, reason: 'malformed' });
  });
  it('enforces the 64 KiB cap and per-section budgets on receipt', () => {
    const f = buildSectionFrame('meta', SAMPLES.meta as never, { rev: 0, at: 1 });
    const big = { ...f, section: 'swarm', body: { swarm: null, agents: Array.from({ length: 100 }, (_, i) => ({ id: 'a' + i, type: 't', state: 's', task: 'x'.repeat(120) })) } };
    expect(JSON.stringify(big.body).length).toBeGreaterThan(SECTION_BUDGET_BYTES.meta);
    expect(parseSectionFrame(big).ok).toBe(true); // within the swarm budget
    expect(parseSectionFrame({ ...f, body: { ...f.body, cli: 'x'.repeat(5000) } })).toMatchObject({ ok: false });
    expect(parseSectionFrame({ ...f, body: { filler: 'x'.repeat(70_000) } })).toEqual({ ok: false, reason: 'too_large' });
    const over = { ...f, section: 'health', body: { ok: true, notes: Array.from({ length: 20 }, () => 'n'.repeat(200)), areas: Array.from({ length: 40 }, () => ({ name: 'x'.repeat(40), status: 's'.repeat(24) })) } };
    expect(parseSectionFrame(over)).toEqual({ ok: false, reason: 'over_budget' });
  });
  it('sanitizes: strips control chars and masks secrets before validation', () => {
    const f = buildSectionFrame('events', { events: [{ at: 1, kind: 'k', level: 'info', src: 's', text: 'a\u001b[31m token=supersecret123 b' }] }, { rev: 0, at: 1 });
    const t = JSON.stringify(f);
    expect(t).not.toContain('\\u001b'); expect(t).not.toContain('supersecret123'); expect(t).toContain('[masked]');
  });
  it('trims over-budget bodies from the tail and flags truncated', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ at: i, kind: 'k', level: 'info', src: 's', text: 'x'.repeat(200) }));
    const fit = fitToBudget('events', { events });
    expect(fit.truncated).toBe(false); // 100 * ~260 B = 26 KiB < 40 KiB
    const heavy = Array.from({ length: 30 }, (_, i) => ({ at: i, level: 'warn', text: 'y'.repeat(200), key: 'k' + i, go: 'z' }));
    const notices = fitToBudget('alerts', { alerts: heavy.map(h => ({ level: 'warn' as const, key: h.key, text: h.text, go: h.go })) });
    expect(JSON.stringify(notices.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.alerts);
    const mission = Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i, source: 'ruflo', objective: 'o'.repeat(300), state: 'draft', revision: i, detail: { plan: { taskCount: 40, tasks: Array.from({ length: 40 }, (_, j) => ({ id: 't' + j, title: 'T'.repeat(120), status: 'todo' })) } } }));
    const f = buildSectionFrame('missions', { missions: mission }, { rev: 1, at: 1 });
    expect(f.truncated).toBe(true); expect(JSON.stringify(f.body).length).toBeLessThanOrEqual(SECTION_BUDGET_BYTES.missions);
    expect(parseSectionFrame(f).ok).toBe(true);
  });
  it('hash ignores key order and undefined, changes with content', () => {
    expect(sectionHash({ a: 1, b: [1, 2], c: undefined })).toBe(sectionHash({ b: [1, 2], a: 1 }));
    expect(sectionHash({ a: 1 })).not.toBe(sectionHash({ a: 2 }));
  });
  it('parseWatch keeps known, unique names, capped', () => {
    expect(parseWatch({ watch: ['missions', 'missions', 'bogus', 'swarm'] })).toEqual(['missions', 'swarm']);
    expect(parseWatch({})).toEqual([]); expect(parseWatch(null)).toEqual([]);
  });
  it('READ_TOOLS contains no write tools', () => {
    for (const w of ['mission_create', 'swarm_init', 'agent_spawn', 'memory_store', 'terminal_execute', 'task_create', 'config_set', 'swarm_shutdown']) expect(READ_TOOLS.has(w)).toBe(false);
    expect(READ_TOOLS.has('mission_get')).toBe(true);
  });
  it('maps a legacy v1 Digest onto valid section frames', () => {
    const p = parseDigest({ collectedAt: 5, ruflo: { version: '3.55.0' }, level: 'read', health: { ok: true, notes: [] }, missions: [{ id: 'm', objective: 'o', state: 'draft', revision: 1 }],
      tasks: { total: 1, pending: 1, running: 0, done: 0 }, swarm: { id: 's', agents: [{ id: 'a', type: 'coder', state: 'idle' }] }, memory: { entries: 2, namespaces: 1 }, cost: { currency: 'USD', totalMinor: 5 },
      adrs: [{ id: 'ADR-1', title: 'T', status: 'accepted' }], events: [{ at: 1, kind: 'k', text: 't' }] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const mapped = legacyDigestToSections(p.digest);
    expect(mapped.map(m => m.section).sort()).toEqual(['adrs', 'cost', 'events', 'health', 'memory', 'meta', 'missions', 'swarm', 'tasks']);
    for (const m of mapped) expect(parseSectionFrame(buildSectionFrame(m.section, m.body as never, { rev: 0, at: 1 })).ok).toBe(true);
  });
});
