#!/usr/bin/env node
// cost-ledger — one cost view across Claude Code and Codex logs on this machine.
//
//   node ledger.mjs [--since 7d|24h|all] [--provider claude|codex|all] [--format json|markdown] [--advise]
//   --advise adds the optimisation findings (advise.mjs) from the same single pass over the logs.
//
// Reads local logs only; sends nothing anywhere. Prices come from data/prices.json
// (dated). USD and Codex credits are NEVER added together, and an unpriced model
// is listed, not counted as $0.

import { collect } from './_ledger.mjs';
import { priceUsage, bookDate } from './_pricebook.mjs';
import { parseDurationMs } from './_sessions.mjs';
import { advise } from './advise.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };

/** Aggregate priced rows. Exported so advise.mjs and tests share one definition. */
export function summarise(rows) {
  const out = { totals: {}, byProvider: {}, byModel: {}, byDay: {}, unpriced: {}, approx: [], cache: {}, rows: rows.length };
  const add = (bucket, key, unit, cost) => { bucket[key] ??= {}; bucket[key][unit] = (bucket[key][unit] ?? 0) + cost; };
  const tok = (bucket, key, row) => {
    const t = (bucket[key] ??= { input: 0, cache_read: 0, cache_write: 0, output: 0, messages: 0 });
    t.input += row.input; t.cache_read += row.cache_read; t.cache_write += row.cache_write_5m + row.cache_write_1h; t.output += row.output; t.messages += 1;
  };
  const tokens = {};
  const approx = new Set();
  for (const row of rows) {
    const p = priceUsage(row.model, row, row.provider);
    const day = new Date(row.ts).toISOString().slice(0, 10);
    tok(tokens, `${row.provider}|${row.model}`, row);
    if (!p.priced) { const u = (out.unpriced[row.model] ??= { provider: row.provider, messages: 0, tokens: 0 }); u.messages += 1; u.tokens += row.input + row.cache_read + row.output; continue; }
    if (p.approx) approx.add(row.model);
    add(out.byProvider, row.provider, p.unit, p.cost);
    add(out.byModel, `${row.provider}|${row.model}`, p.unit, p.cost);
    add(out.byDay, day, p.unit, p.cost);
    out.totals[p.unit] = (out.totals[p.unit] ?? 0) + p.cost;
  }
  out.approx = [...approx];
  out.tokens = tokens;
  for (const provider of new Set(rows.map(row => row.provider))) {
    const mine = rows.filter(row => row.provider === provider);
    const read = mine.reduce((sum, row) => sum + row.cache_read, 0);
    const fresh = mine.reduce((sum, row) => sum + row.input + row.cache_write_5m + row.cache_write_1h, 0);
    out.cache[provider] = { hitRatio: read + fresh > 0 ? read / (read + fresh) : null, read, fresh };
  }

  return out;
}

const money = (value, unit) => (unit === 'usd' ? `$${value.toFixed(2)}` : `${value.toFixed(0)} credits`);

function markdown(summary, meta) {
  const lines = [`# Cost ledger (${meta.since}, prices as of ${meta.priceDate})`, ''];
  lines.push(`Totals: ${Object.entries(summary.totals).map(([unit, value]) => money(value, unit)).join(' + ') || 'n/a'} · ${summary.rows} messages · estimates at list price, not bills`, '');
  lines.push('| Provider · model | Cost | Msgs | Input | Cache read | Cache write | Output |', '|---|---|---|---|---|---|---|');
  for (const [key, cost] of Object.entries(summary.byModel).sort((a, b) => Object.values(b[1])[0] - Object.values(a[1])[0])) {
    const t = summary.tokens[key];
    lines.push(`| ${key.replaceAll('|', ' · ')} | ${Object.entries(cost).map(([unit, value]) => money(value, unit)).join(', ')} | ${t.messages} | ${t.input} | ${t.cache_read} | ${t.cache_write} | ${t.output} |`);
  }
  for (const [provider, cache] of Object.entries(summary.cache)) lines.push('', `Cache hit ratio · ${provider}: ${cache.hitRatio === null ? 'n/a' : `${(cache.hitRatio * 100).toFixed(1)}%`}`);
  const dark = Object.entries(summary.unpriced);
  if (dark.length > 0) lines.push('', `Unpriced (NOT counted as $0): ${dark.map(([model, u]) => `${model} (${u.messages} msgs)`).join(', ')} — add them to data/prices.json`);
  if (summary.approx.length > 0) lines.push('', `Approximate (family fallback price): ${summary.approx.join(', ')}`);
  lines.push('', 'Claude output tokens come from the transcript, which can under-count streamed output; /usage is authoritative for the live session.');

  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sinceSpec = arg('since', '7d');
  const sinceMs = sinceSpec === 'all' ? 0 : Date.now() - (parseDurationMs(sinceSpec) ?? 7 * 86_400_000);
  const providers = arg('provider', 'all') === 'all' ? undefined : [arg('provider')];
  const rows = collect({ providers, sinceMs });
  const summary = summarise(rows);
  const meta = { since: sinceSpec, priceDate: bookDate() };
  const findings = process.argv.includes('--advise') ? advise(rows) : undefined;

  console.log(arg('format', 'markdown') === 'json' ? JSON.stringify({ ...meta, ...summary, ...(findings && { findings }) }, null, 2) : markdown(summary, meta));
}
