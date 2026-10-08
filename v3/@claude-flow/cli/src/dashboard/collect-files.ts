/** Section collectors that read bounded local files (events log, ADR folders, changelogs) and the cost-tracker ledger script. */
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readRegular, listDir, confine } from './read.js';
import { isObj, ms, nat, str, type CollectCtx, type Collector } from './collect-core.js';

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------------------------- events
export const EVENTS_FILE = '.claude-flow/console/events.jsonl';
export const EVENTS_TAIL_BYTES = 128 * 1024;
/** Newest console events (masked at write; sanitized again before send), merged with recent mission events. */
export const events: Collector = async c => {
  const out: Obj[] = [];
  const f = readRegular(c.projectDir, EVENTS_FILE, EVENTS_TAIL_BYTES, true);
  if (f) {
    const lines = f.text.split('\n'); if (f.size > EVENTS_TAIL_BYTES) lines.shift();
    for (const line of lines) {
      if (line.length < 2 || line.length > 3000 || line[0] !== '{') continue;
      try {
        const r = JSON.parse(line) as Obj;
        if (r.v !== 1 || typeof r.text !== 'string' || typeof r.kind !== 'string') continue;
        const at = ms(r.t); if (!at) continue;
        out.push({ at, kind: str(r.kind, 40), level: str(r.level ?? 'info', 12), src: str(r.src ?? 'console', 40), text: str(r.text, 200) });
      } catch { /* skip bad line */ }
    }
  }
  const me = c.cache.mission_events as { events?: Obj[] } | undefined;
  for (const e of me?.events ?? []) out.push({ at: e.at, kind: str(e.type, 40), level: 'info', src: 'mission', text: `${str(e.missionId, 40)} seq ${nat(e.seq)}${e.status ? ` ${str(e.status, 24)}` : ''}` });
  return { events: out.sort((a, b) => (b.at as number) - (a.at as number)).slice(0, 100) };
};

// ---------------------------------------------------------------------------------------------------------------- adrs
export const ADR_DIRS = ['docs/adr', 'docs/adrs', 'docs/decisions', 'docs/architecture/decisions', 'docs/architecture/adr', 'adr', 'adrs', 'decisions', 'v3/docs/adr', 'doc/adr', 'architecture/decisions'] as const;
const STATUS_RES = [/^\s*(?:[-*]\s*)?\**status\**\s*[:=]\s*\**\s*([A-Za-z][A-Za-z -]{0,22})/im, /^##\s*status\s*\n+\s*([A-Za-z][A-Za-z -]{0,22})/im];
const first = (re: RegExp, s: string) => re.exec(s)?.[1];

export const adrs: Collector = async c => {
  let best: { rel: string; names: string[] } | null = null;
  for (const rel of ADR_DIRS) {
    const names = listDir(c.projectDir, rel).filter(e => !e.isDir && /\.md$/i.test(e.name) && !/^readme|^index/i.test(e.name)).map(e => e.name);
    if (names.length > (best?.names.length ?? 0)) best = { rel, names };
  }
  if (!best) return { folder: 'none', counts: {}, items: [], lint: [] };
  const items: Obj[] = []; const lint: string[] = []; const ids = new Map<string, number>(); const counts: Record<string, number> = {};
  for (const n of best.names.sort().reverse()) {
    const head = readRegular(c.projectDir, `${best.rel}/${n}`, 4096)?.text; if (head === undefined) continue;
    const title = first(/^#\s+(.+)$/m, head) ?? n;
    let status = ''; for (const re of STATUS_RES) { status = first(re, head)?.trim().toLowerCase() ?? ''; if (status) break; }
    const id = (/^(adr[-_ ]?\d+|\d{3,5})/i.exec(n)?.[1] ?? n.replace(/\.md$/i, '')).toUpperCase().replace(/^ADR[-_ ]?0*/, 'ADR-');
    const date = first(/^\s*(?:[-*]\s*)?\**date\**\s*[:=]\s*\**\s*(\d{4}-\d{2}-\d{2})/im, head);
    const sup = first(/supersedes\**\s*[:=]\s*\**\s*(ADR[- ]?\d+|\d{3,5})/i, head); const supBy = first(/superseded[ -]by\**\s*[:=]\s*\**\s*(ADR[- ]?\d+|\d{3,5})/i, head);
    ids.set(id, (ids.get(id) ?? 0) + 1);
    if (!status) lint.push(`${id}: no Status line`);
    const st = status.slice(0, 24) || 'unknown'; counts[st] = (counts[st] ?? 0) + 1;
    if (items.length < 200) items.push({ id: str(id, 40), title: str(title, 160), status: st, ...(date ? { date } : {}), ...(sup ? { supersedes: str(sup, 40) } : {}), ...(supBy ? { supersededBy: str(supBy, 40) } : {}) });
  }
  for (const [id, k] of ids) if (k > 1) lint.push(`${id}: used by ${k} files`);
  const known = new Set(items.map(i => i.id));
  for (const i of items) for (const k of ['supersedes', 'supersededBy'] as const) { const t = i[k]; if (typeof t === 'string' && !known.has(t.toUpperCase().replace(/^ADR[- ]?0*/, 'ADR-'))) lint.push(`${i.id}: ${k} ${t} not found`); }
  const statuses = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  return { folder: str(best.rel, 100), convention: best.names.some(n => /^\d{3,5}-/.test(n)) ? 'NNNN-title' : 'ADR-N', counts: Object.fromEntries(statuses), items, lint: lint.slice(0, 40).map(l => l.slice(0, 200)) };
};

// ---------------------------------------------------------------------------------------------------------------- whatsnew
const CHANGELOG_READ = 256 * 1024; const CHANGELOG_PARSE = 64 * 1024;
function parseChangelog(text: string): { version: string; date?: string; changes: string[] }[] {
  const out: { version: string; date?: string; changes: string[] }[] = []; let cur: { version: string; date?: string; changes: string[] } | null = null;
  for (const line of text.slice(0, CHANGELOG_PARSE).split('\n')) {
    const h = /^##\s+\[?v?(\d+\.\d+\.\d+[\w.+-]*)\]?\s*(?:[-(–]\s*)?(\d{4}-\d{2}-\d{2})?/.exec(line);
    if (h) { if (out.length >= 3) break; cur = { version: h[1]!, ...(h[2] ? { date: h[2] } : {}), changes: [] }; out.push(cur); continue; }
    const b = /^\s*[-*]\s+(.+)$/.exec(line);
    if (cur && b && cur.changes.length < 6) cur.changes.push(b[1]!.replace(/\*\*/g, '').slice(0, 160));
  }
  return out;
}
export const whatsnew: Collector = async c => {
  const plugins: Obj[] = []; const breaking: string[] = [];
  const sources: { name: string; rel: string }[] = [{ name: 'project', rel: 'CHANGELOG.md' }, ...listDir(c.projectDir, 'plugins', 40).filter(e => e.isDir).map(e => ({ name: e.name, rel: `plugins/${e.name}/CHANGELOG.md` }))];
  for (const s of sources) {
    if (plugins.length >= 10) break;
    const f = readRegular(c.projectDir, s.rel, CHANGELOG_READ); if (!f) continue;
    const entries = parseChangelog(f.text); if (!entries.length) continue;
    plugins.push({ name: str(s.name, 60), entries });
    for (const e of entries) for (const ch of e.changes) if (/breaking/i.test(ch) && breaking.length < 10) breaking.push(`${s.name} ${e.version}: ${ch}`.slice(0, 160));
  }
  return { plugins, breaking };
};

// ---------------------------------------------------------------------------------------------------------------- cost
/** Find the cost-tracker ledger script: the project's plugin folder, else the highest version in the Claude plugin cache. */
export function findLedger(projectDir: string, home: string | undefined): string | null {
  const direct = confine(projectDir, 'plugins/ruflo-cost-tracker/scripts/ledger.mjs');
  if (direct && isFile(direct)) return direct;
  if (!home) return null;
  const base = join(home, '.claude', 'plugins', 'cache');
  const vers: { p: string; v: number[] }[] = [];
  for (const mk of listDir(base, '.', 50)) {
    if (!mk.isDir) continue;
    for (const v of listDir(base, `${mk.name}/ruflo-cost-tracker`, 50)) {
      if (!v.isDir || !/^\d+\.\d+\.\d+$/.test(v.name)) continue;
      const p = confine(base, `${mk.name}/ruflo-cost-tracker/${v.name}/scripts/ledger.mjs`);
      if (p && isFile(p)) vers.push({ p, v: v.name.split('.').map(Number) });
    }
  }
  vers.sort((a, b) => b.v[0]! - a.v[0]! || b.v[1]! - a.v[1]! || b.v[2]! - a.v[2]!);
  return vers[0]?.p ?? null;
}
function isFile(p: string): boolean { try { return statSync(p).isFile() && realpathSync(p) === p; } catch { return false; } }
const unavailable = (reason: string): Obj => ({ available: false, reason: reason.slice(0, 160), byModel: [], advice: [], perMission: [] });

export const cost: Collector = async c => {
  const script = findLedger(c.projectDir, c.home);
  if (!script) return unavailable('cost-tracker ledger script not found (install ruflo-cost-tracker >= 0.27.0)');
  let r;
  try { r = await c.run([process.execPath, script, '--since', '7d', '--format', 'json', '--advise'], 60_000); } catch (e) { return unavailable(`ledger could not run: ${(e as Error).message}`); }
  if (r.timedOut || r.truncated || r.code !== 0) return unavailable(`ledger ${r.timedOut ? 'timed out' : r.truncated ? 'output too large' : `exited ${r.code}`}`);
  let d: Obj; try { d = JSON.parse(r.stdout) as Obj; } catch { return unavailable('ledger output is not JSON'); }
  const totals = isObj(d.totals) ? d.totals : {}; const by = isObj(d.byModel) ? d.byModel : {}; const tok = isObj(d.tokens) ? d.tokens : {};
  const today = new Date(c.now()).toISOString().slice(0, 10);
  const day = isObj(d.byDay) && isObj((d.byDay as Obj)[today]) ? ((d.byDay as Obj)[today] as Obj) : {};
  const byModel = Object.entries(by).filter(([, v]) => isObj(v)).map(([k, v]) => {
    const o = v as Obj; const [provider = '', ...rest] = k.split('|'); const unit = typeof o.usd === 'number' ? 'usd' : 'credits'; const t = isObj(tok[k]) ? (tok[k] as Obj) : {};
    return { provider: str(provider, 24), model: str(rest.join('|'), 60), minor: Math.round(Number(unit === 'usd' ? o.usd : o.credits) * (unit === 'usd' ? 100 : 1)) || 0, unit, tokens: nat(t.input) + nat(t.cache_read) + nat(t.cache_write) + nat(t.output) };
  }).sort((a, b) => b.minor - a.minor).slice(0, 20);
  const cache = isObj(d.cache) ? d.cache : {}; const cc = (isObj(cache.claude) ? cache.claude : Object.values(cache).find(isObj)) as Obj | undefined;
  const findings = (Array.isArray(d.findings) ? d.findings.filter(isObj) : []).slice(0, 10).map(f => `${str(f.title, 80)}: ${str(f.evidence, 120)}`.slice(0, 200));
  return {
    available: true, windowDays: 7,
    ...(typeof totals.usd === 'number' ? { totals: { currency: 'USD', totalMinor: Math.round(totals.usd * 100), ...(typeof day.usd === 'number' ? { todayMinor: Math.round(day.usd * 100) } : {}) } } : {}),
    ...(typeof totals.credits === 'number' ? { creditsTotal: Math.round(totals.credits) } : {}),
    byModel, ...(cc && typeof cc.hitRatio === 'number' ? { cacheHitRatio: Math.min(1, Math.max(0, cc.hitRatio)) } : {}),
    unpriced: Object.keys(isObj(d.unpriced) ? d.unpriced : {}).slice(0, 20).map(k => k.slice(0, 60)), advice: findings, perMission: [],
  };
};
export type { CollectCtx };
