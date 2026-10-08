/** Sectioned digest (v2): one `SectionFrame` per section, strict zod bodies, per-section budgets/cadence, read-tool allowlist. */
import { z } from 'zod';
import { canonicalize } from './canonical.js';
import { sha256b64u } from './crypto.js';
import { sanitize, type Digest } from './digest.js';

export const SECTION_NAMES = ['meta', 'health', 'alerts', 'control', 'missions', 'mission_events', 'tasks', 'swarm', 'approvals', 'memory', 'cost', 'events', 'notices', 'adrs', 'whatsnew', 'settings'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const isSectionName = (n: unknown): n is SectionName => typeof n === 'string' && (SECTION_NAMES as readonly string[]).includes(n);

/** Hard cap on any serialized section body, whatever its own budget. */
export const MAX_SECTION_BODY_BYTES = 64 * 1024;
const KiB = 1024;
export const SECTION_BUDGET_BYTES: Record<SectionName, number> = {
  meta: 2 * KiB, health: 6 * KiB, alerts: 8 * KiB, control: 1 * KiB, missions: 64 * KiB, mission_events: 24 * KiB, tasks: 16 * KiB, swarm: 24 * KiB,
  approvals: 8 * KiB, memory: 8 * KiB, cost: 16 * KiB, events: 40 * KiB, notices: 8 * KiB, adrs: 48 * KiB, whatsnew: 48 * KiB, settings: 8 * KiB,
};
/** Default collection cadence in seconds (missions is 5 s while a mission is running; the connector decides). */
export const SECTION_CADENCE_S: Record<SectionName, number> = {
  meta: 60, health: 10, alerts: 10, control: 30, missions: 10, mission_events: 10, tasks: 10, swarm: 10, approvals: 10, memory: 60, cost: 300, events: 10, notices: 10, adrs: 120, whatsnew: 600, settings: 120,
};
/** Heartbeat lifetime: a section is re-sent at half its ttl even if unchanged. */
export const SECTION_TTL_S: Record<SectionName, number> = Object.fromEntries(SECTION_NAMES.map(n => [n, Math.min(3600, Math.max(30, SECTION_CADENCE_S[n] * 3))])) as Record<SectionName, number>;
/** Supported schema version per section (announced in `hello.sections`). Additive changes bump it. */
export const SECTION_VERSIONS: Record<SectionName, number> = Object.fromEntries(SECTION_NAMES.map(n => [n, 1])) as Record<SectionName, number>;
/** Cadence multiplier for sections no browser is watching. */
export const UNWATCHED_CADENCE_FACTOR = 4;
export const MAX_WATCH = 40;

/** ruflo MCP tools the connector may call to COLLECT state. Anything else is refused by the collection client. */
export const READ_TOOLS: ReadonlySet<string> = new Set([
  'system_info', 'system_health', 'mission_get', 'mission_events', 'task_summary', 'task_list', 'swarm_status', 'swarm_health', 'agent_list',
  'memory_stats', 'memory_detailed-stats', 'memory_list', 'config_get', 'config_list', 'hooks_model-stats', 'policy_status', 'progress_summary',
]);

const S = (n: number) => z.string().max(n);
/** Safe integers only: 1e308 is an integer to zod but not a value any counter can hold. */
const nat = z.number().int().safe().nonnegative();
const int = z.number().int().safe();
/** 2100-01-01 in ms: no honest frame is dated beyond it. */
export const MAX_FRAME_AT_MS = 4_102_444_800_000;
export const MAX_FRAME_REV = 1_000_000_000_000;
const level = z.enum(['info', 'warn', 'error']);
const lvl5 = z.enum(['off', 'read', 'write', 'manage', 'full']);

const detail = z.object({
  plan: z.object({ taskCount: nat, tasks: z.array(z.object({ id: S(60), title: S(120), status: S(24) }).strict()).max(40) }).strict().optional(),
  evidence: z.object({ count: nat, verified: nat }).strict().optional(),
  executor: S(80).nullable().optional(), blockedReason: S(200).nullable().optional(),
  budget: z.object({ currency: S(8).optional(), limitMinor: nat.optional(), spentMinor: nat.optional() }).strict().nullable().optional(),
}).strict();

export const SectionSchemas = {
  meta: z.object({ ruflo: z.object({ version: S(40), node: S(40).optional(), os: S(40).optional() }).strict(), consoleVersion: S(40).optional(), pluginVersion: S(40).optional(),
    project: z.boolean(), cli: S(40).optional(), updateAvailable: S(40).optional(), connector: S(10).optional() }).strict(),
  health: z.object({ ok: z.boolean(), notes: z.array(S(200)).max(20), areas: z.array(z.object({ name: S(40), status: S(24) }).strict()).max(40) }).strict(),
  alerts: z.object({ alerts: z.array(z.object({ level, key: S(60), text: S(200), go: S(60).optional() }).strict()).max(30) }).strict(),
  control: z.object({ level: lvl5, autoApprove: z.boolean(), modelControl: S(24).optional(), modelConfirm: S(24).optional(),
    classBudgets: z.array(z.object({ class: S(24), limit: nat }).strict()).max(10).optional() }).strict(),
  missions: z.object({ missions: z.array(z.object({ id: S(40), source: S(24), objective: S(300), state: S(24), revision: nat, executionMode: S(24).optional(), updatedAt: int.optional(), detail: detail.optional() }).strict()).max(100) }).strict(),
  mission_events: z.object({ events: z.array(z.object({ missionId: S(40), seq: nat, type: S(60), status: S(24).optional(), at: int, evidenceKind: S(24).optional() }).strict()).max(100) }).strict(),
  tasks: z.object({ total: nat, pending: nat, running: nat, done: nat, failed: nat, items: z.array(z.object({ id: S(60), title: S(120), status: S(24), agent: S(60).optional() }).strict()).max(50) }).strict(),
  swarm: z.object({ swarm: z.object({ id: S(80), topology: S(32).optional(), maxAgents: nat.optional(), health: S(24).optional(), status: S(24).optional() }).strict().nullable(),
    agents: z.array(z.object({ id: S(80), type: S(40), state: S(24), task: S(120).optional(), lastActiveAt: int.optional() }).strict()).max(100) }).strict(),
  approvals: z.object({ items: z.array(z.object({ kind: S(40), text: S(200), ageS: nat }).strict()).max(30) }).strict(),
  memory: z.object({ entries: nat, namespaceCount: nat.optional(), namespaces: z.array(z.object({ name: S(60), count: nat }).strict()).max(50), backend: S(60).optional(), vectors: nat.optional(), flags: z.array(S(60)).max(10) }).strict(),
  cost: z.object({ available: z.boolean(), reason: S(160).optional(), windowDays: nat.optional(),
    totals: z.object({ currency: S(8), totalMinor: nat, todayMinor: nat.optional() }).strict().optional(),
    byModel: z.array(z.object({ provider: S(24), model: S(60), minor: nat, unit: z.enum(['usd', 'credits']).optional(), tokens: nat.optional() }).strict()).max(20),
    creditsTotal: nat.optional(), unpriced: z.array(S(60)).max(20).optional(),
    cacheHitRatio: z.number().min(0).max(1).optional(), budget: z.object({ currency: S(8), limitMinor: nat, spentMinor: nat }).strict().optional(),
    advice: z.array(S(200)).max(10), perMission: z.array(z.object({ missionId: S(40), minor: nat }).strict()).max(20) }).strict(),
  events: z.object({ events: z.array(z.object({ at: int, kind: S(40), level: S(12), src: S(40), text: S(200) }).strict()).max(100) }).strict(),
  notices: z.object({ notices: z.array(z.object({ at: int, level: S(12), text: S(200), key: S(60) }).strict()).max(30), toastMode: S(24).optional() }).strict(),
  adrs: z.object({ folder: S(100), convention: S(40).optional(), counts: z.record(S(24), nat).refine(r => Object.keys(r).length <= 16, 'too many statuses'),
    items: z.array(z.object({ id: S(40), title: S(160), status: S(24), date: S(24).optional(), supersedes: S(40).optional(), supersededBy: S(40).optional() }).strict()).max(200), lint: z.array(S(200)).max(40) }).strict(),
  whatsnew: z.object({ plugins: z.array(z.object({ name: S(60), entries: z.array(z.object({ version: S(24), date: S(24).optional(), changes: z.array(S(160)).max(6) }).strict()).max(3) }).strict()).max(10), breaking: z.array(S(160)).max(10) }).strict(),
  settings: z.object({ options: z.array(z.object({ key: S(60), value: S(160) }).strict()).max(60) }).strict(),
} as const satisfies Record<SectionName, z.ZodTypeAny>;
export type SectionBody<N extends SectionName> = z.infer<(typeof SectionSchemas)[N]>;

export const SectionFrameSchema = z.object({
  v: z.literal(2), section: z.enum(SECTION_NAMES), rev: nat.max(MAX_FRAME_REV), sv: int.min(1).max(1000), at: int.positive().max(MAX_FRAME_AT_MS),
  ttlS: int.min(5).max(3600), truncated: z.boolean(), body: z.record(z.unknown()),
}).strict();
export type SectionFrame = z.infer<typeof SectionFrameSchema>;

/** Largest array(s) per section, dropped from the tail (oldest/lowest priority last) when a body exceeds its budget. */
const TRIM: Record<SectionName, string[]> = {
  meta: [], health: ['areas', 'notes'], alerts: ['alerts'], control: [], missions: ['missions'], mission_events: ['events'], tasks: ['items'], swarm: ['agents'], approvals: ['items'],
  memory: ['namespaces'], cost: ['byModel', 'perMission', 'advice'], events: ['events'], notices: ['notices'], adrs: ['items', 'lint'], whatsnew: ['plugins'], settings: ['options'],
};
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const budgetOf = (n: SectionName) => Math.min(SECTION_BUDGET_BYTES[n], MAX_SECTION_BODY_BYTES);

/** Drop tail items until the body fits its budget. Returns the (possibly cut) body and whether anything was dropped. Never splits across frames. */
export function fitToBudget<N extends SectionName>(name: N, body: SectionBody<N>): { body: SectionBody<N>; truncated: boolean } {
  const cap = budgetOf(name);
  const out = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  let truncated = false;
  for (const key of TRIM[name]) {
    const arr = out[key];
    if (!Array.isArray(arr)) continue;
    while (size(out) > cap && arr.length > 0) {
      const drop = Math.max(1, Math.floor(arr.length / 10));
      arr.splice(arr.length - drop, drop); truncated = true;
    }
    if (size(out) <= cap) break;
  }
  return { body: out as SectionBody<N>, truncated };
}

/** Stable content hash used for change detection (key order and undefined do not matter). */
export const sectionHash = (body: unknown): string => sha256b64u(canonicalize(JSON.parse(JSON.stringify(body))));

export interface FrameMeta { rev: number; at: number; ttlS?: number; sv?: number; truncated?: boolean }
/** Validate a body against its schema and wrap it. Throws if the body is invalid or still over budget after trimming. */
export function buildSectionFrame<N extends SectionName>(name: N, body: SectionBody<N>, m: FrameMeta): SectionFrame {
  const fit = fitToBudget(name, SectionSchemas[name].parse(sanitize(body)) as SectionBody<N>);
  if (size(fit.body) > budgetOf(name)) throw new Error(`section ${name} exceeds its budget`);
  return SectionFrameSchema.parse({ v: 2, section: name, rev: m.rev, sv: m.sv ?? SECTION_VERSIONS[name], at: m.at, ttlS: m.ttlS ?? SECTION_TTL_S[name], truncated: m.truncated === true || fit.truncated, body: fit.body });
}

export type SectionParse = { ok: true; frame: SectionFrame & { section: SectionName } } | { ok: false; reason: 'too_large' | 'malformed' | 'unknown_section' | 'invalid_body' | 'over_budget' };
/** Server-side and test-side parse: size cap, sanitize, strict frame, strict per-section body, per-section budget. */
export function parseSectionFrame(raw: unknown): SectionParse {
  let s = 0;
  try { s = Buffer.byteLength(JSON.stringify(raw)); } catch { return { ok: false, reason: 'malformed' }; }
  if (s > MAX_SECTION_BODY_BYTES + 1024) return { ok: false, reason: 'too_large' };
  const clean = sanitize(raw);
  if (clean && typeof clean === 'object' && !Array.isArray(clean) && (clean as { v?: unknown }).v === 2 && !isSectionName((clean as { section?: unknown }).section)) return { ok: false, reason: 'unknown_section' };
  const f = SectionFrameSchema.safeParse(clean);
  if (!f.success) return { ok: false, reason: 'malformed' };
  const name = f.data.section;
  if (size(f.data.body) > MAX_SECTION_BODY_BYTES) return { ok: false, reason: 'too_large' };
  if (size(f.data.body) > SECTION_BUDGET_BYTES[name]) return { ok: false, reason: 'over_budget' };
  const b = SectionSchemas[name].safeParse(f.data.body);
  if (!b.success) return { ok: false, reason: 'invalid_body' };
  return { ok: true, frame: { ...f.data, section: name, body: b.data as Record<string, unknown> } };
}

/** Watch hint carried in a signed server `ping` body: `{watch: [...]}`. Unknown names are dropped, at most MAX_WATCH kept. */
export function parseWatch(body: unknown): SectionName[] {
  const w = body && typeof body === 'object' ? (body as { watch?: unknown }).watch : undefined;
  if (!Array.isArray(w)) return [];
  return [...new Set(w.filter(isSectionName))].slice(0, MAX_WATCH);
}

/** Map a legacy v1 Digest (bare or {digest}) onto section bodies so old connectors keep working. */
export function legacyDigestToSections(d: Digest): Array<{ section: SectionName; body: Record<string, unknown> }> {
  return legacyRaw(d).flatMap(x => {
    const r = SectionSchemas[x.section].safeParse(sanitize(x.body));
    return r.success && size(r.data) <= budgetOf(x.section) ? [{ section: x.section, body: r.data as Record<string, unknown> }] : [];
  });
}
function legacyRaw(d: Digest): Array<{ section: SectionName; body: Record<string, unknown> }> {
  const tally = new Map<string, number>();
  for (const a of d.adrs) tally.set(a.status, (tally.get(a.status) ?? 0) + 1);
  const counts = Object.fromEntries([...tally].sort((x, y) => y[1] - x[1]).slice(0, 16));
  const out: Array<{ section: SectionName; body: Record<string, unknown> }> = [
    { section: 'meta', body: { ruflo: d.ruflo, project: true, cli: 'legacy', connector: '1' } },
    { section: 'health', body: { ok: d.health.ok, notes: d.health.notes, areas: [] } },
    { section: 'missions', body: { missions: d.missions.map(m => ({ id: m.id, source: 'ruflo', objective: m.objective, state: m.state, revision: m.revision, ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}) })) } },
    { section: 'adrs', body: { folder: 'docs/adr', counts, items: d.adrs.slice(0, 200).map(a => ({ id: a.id.slice(0, 40), title: a.title.slice(0, 160), status: a.status.slice(0, 24) })), lint: [] } },
    { section: 'events', body: { events: d.events.map(e => ({ at: e.at, kind: e.kind, level: 'info', src: 'mission', text: e.text })) } },
  ];
  if (d.tasks) out.push({ section: 'tasks', body: { ...d.tasks, failed: 0, items: [] } });
  if (d.swarm) out.push({ section: 'swarm', body: { swarm: d.swarm.id ? { id: d.swarm.id, ...(d.swarm.topology ? { topology: d.swarm.topology } : {}), ...(d.swarm.maxAgents !== undefined ? { maxAgents: d.swarm.maxAgents } : {}) } : null, agents: d.swarm.agents } });
  if (d.memory) out.push({ section: 'memory', body: { entries: d.memory.entries, ...(d.memory.namespaces !== undefined ? { namespaceCount: d.memory.namespaces } : {}), namespaces: [], ...(d.memory.backend ? { backend: d.memory.backend } : {}), flags: [] } });
  out.push({ section: 'cost', body: d.cost ? { available: true, totals: d.cost, byModel: [], advice: [], perMission: [] } : { available: false, reason: 'not reported by this connector', byModel: [], advice: [], perMission: [] } });
  return out;
}
