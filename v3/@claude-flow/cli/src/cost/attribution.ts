/**
 * `ruflo cost report` (ADR-508 §2.3): which subagent types and tools spent the
 * money, from the lines the ruflo-mods cost ledger writes to
 * `.claude-flow/cost/attribution.jsonl` (one per session; see
 * plugins/ruflo-mods/hooks/cost/attribution.ts `attributionLine`).
 *
 * The file is project-writable, so every line is validated to a fixed shape;
 * a bad line is skipped and counted, never trusted.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const ATTRIBUTION_PATH = '.claude-flow/cost/attribution.jsonl';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_KEYS = 64;
const NAME = /^[A-Za-z0-9_.:@/()-]{1,80}$/;
const MAX_SESSION_USD = 1_000_000;

export interface AttributionLine {
  endedAt: number;
  totalUsd: number;
  byAgent: Record<string, number>;
  byTool: Record<string, number>;
  refusals: number;
}

function amounts(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_KEYS + 1) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!NAME.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_SESSION_USD) return undefined;
    out[k] = v;
  }
  return out;
}

/** One line validated, or undefined. */
export function parseAttributionLine(text: string): AttributionLine | undefined {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!o || typeof o !== 'object' || o.v !== 1) return undefined;
  const { endedAt, totalUsd, refusals } = o;
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return undefined;
  if (typeof totalUsd !== 'number' || !Number.isFinite(totalUsd) || totalUsd < 0 || totalUsd > MAX_SESSION_USD) return undefined;
  if (typeof refusals !== 'number' || !Number.isInteger(refusals) || refusals < 0) return undefined;
  const byAgent = amounts(o.byAgent);
  const byTool = amounts(o.byTool);
  if (!byAgent || !byTool) return undefined;
  return { endedAt, totalUsd, byAgent, byTool, refusals };
}

export interface AttributionReport {
  sessions: number;
  skipped: number;
  totalUsd: number;
  refusals: number;
  byAgent: [string, number][];
  byTool: [string, number][];
}

const add = (map: Map<string, number>, record: Record<string, number>) => {
  for (const [k, v] of Object.entries(record)) map.set(k, (map.get(k) ?? 0) + v);
};
const ranked = (map: Map<string, number>): [string, number][] => [...map].sort((a, b) => b[1] - a[1]);

/** The report over the file's lines, optionally only sessions that ended at or after `since` (ms). */
export function summarize(text: string, since = 0): AttributionReport {
  const byAgent = new Map<string, number>();
  const byTool = new Map<string, number>();
  let sessions = 0;
  let skipped = 0;
  let totalUsd = 0;
  let refusals = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const line = parseAttributionLine(raw);
    if (!line) {
      skipped++;
      continue;
    }
    if (line.endedAt < since) continue;
    sessions++;
    totalUsd += line.totalUsd;
    refusals += line.refusals;
    add(byAgent, line.byAgent);
    add(byTool, line.byTool);
  }
  return { sessions, skipped, totalUsd, refusals, byAgent: ranked(byAgent), byTool: ranked(byTool) };
}

/** Reads the project's attribution file; an absent file is an empty report. */
export function readAttribution(cwd: string, since = 0): { report?: AttributionReport; error?: string } {
  const file = path.join(cwd, ATTRIBUTION_PATH);
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_BYTES) return { error: `${ATTRIBUTION_PATH} is over 4 MiB` };
    return { report: summarize(fs.readFileSync(file, 'utf8'), since) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { report: summarize('', since) };
    return { error: String((error as Error)?.message ?? error) };
  }
}
