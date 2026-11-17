/**
 * The shared budget file (ADR-508 §2.1): `.claude-flow/cost/budget.json`,
 * version 1. `ruflo cost budget set` writes it; the ruflo-mods cost ladder and
 * `ruflo cost budget export` read it.
 *
 * Second copy of plugins/ruflo-mods/hooks/cost/file.ts (the mod may not import
 * outside its plugin folder). __tests__/cost-budget-file.test.ts runs both over
 * the same hostile corpus and requires identical answers.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const BUDGET_PATH = '.claude-flow/cost/budget.json';
export const MAX_WINDOWS = 8;
export const MAX_USD = 1_000_000;
/** The largest budget file read (a budget is a few hundred bytes). */
export const MAX_FILE_BYTES = 64 * 1024;
/** LiteLLM's `budget_duration` grammar (`30s`, `30m`, `30h`, `30d`), with a bounded count. */
export const PERIOD = /^[1-9][0-9]{0,3}[smhd]$/;
const MODEL = /^[A-Za-z0-9._:/@-]{1,128}$/;

export interface BudgetWindow { readonly usd: number; readonly period: string }

export interface BudgetFile {
  readonly version: 1;
  readonly windows: readonly BudgetWindow[];
  readonly hardStop: boolean;
  readonly fallbackModel?: string;
}

const SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
export const periodSeconds = (period: string): number => Number(period.slice(0, -1)) * SECONDS[period.slice(-1)]!;

/** A budget value validated, or undefined when it breaks any rule (see the mod copy for the list). */
export function validateBudget(value: unknown): BudgetFile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const o = value as Record<string, unknown>;
  if (o.version !== 1) return undefined;
  if (!Array.isArray(o.windows) || o.windows.length === 0 || o.windows.length > MAX_WINDOWS) return undefined;
  const windows: BudgetWindow[] = [];
  const seen = new Set<string>();
  for (const w of o.windows as unknown[]) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return undefined;
    const { usd, period } = w as Record<string, unknown>;
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > MAX_USD) return undefined;
    if (typeof period !== 'string' || !PERIOD.test(period) || seen.has(period)) return undefined;
    seen.add(period);
    windows.push({ usd, period });
  }
  if (o.hardStop !== undefined && typeof o.hardStop !== 'boolean') return undefined;
  if (o.fallbackModel !== undefined && (typeof o.fallbackModel !== 'string' || !MODEL.test(o.fallbackModel))) return undefined;
  return {
    version: 1,
    windows,
    hardStop: o.hardStop === true,
    ...(typeof o.fallbackModel === 'string' ? { fallbackModel: o.fallbackModel } : {}),
  };
}

/** The smallest-`usd` window (ties: the shorter period): the one a single session nears first. */
export function ladderWindow(budget: BudgetFile): BudgetWindow {
  return [...budget.windows].sort((a, b) => a.usd - b.usd || periodSeconds(a.period) - periodSeconds(b.period))[0]!;
}

export type ReadBudget =
  | { kind: 'absent' }
  | { kind: 'ok'; budget: BudgetFile }
  | { kind: 'invalid'; reason: string };

/** Reads and validates the project's budget file. Never throws. */
export function readBudget(cwd: string): ReadBudget {
  const file = path.join(cwd, BUDGET_PATH);
  let text: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { kind: 'invalid', reason: `${BUDGET_PATH} is not a file` };
    if (stat.size > MAX_FILE_BYTES) return { kind: 'invalid', reason: `${BUDGET_PATH} is over ${MAX_FILE_BYTES} bytes` };
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? { kind: 'absent' } : { kind: 'invalid', reason: String((error as Error)?.message ?? error) };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: `${BUDGET_PATH} is not JSON` };
  }
  const budget = validateBudget(value);
  return budget ? { kind: 'ok', budget } : { kind: 'invalid', reason: `${BUDGET_PATH} fails validation (version 1, 1-${MAX_WINDOWS} windows, usd in (0, ${MAX_USD}], period like 24h/7d/30d)` };
}

export interface BudgetFlags {
  daily?: unknown;
  weekly?: unknown;
  monthly?: unknown;
  hardStop?: unknown;
  fallbackModel?: unknown;
}

/** A budget from `set` flags (`--daily` 24h, `--weekly` 7d, `--monthly` 30d), or the reason it is not one. */
export function budgetFromFlags(flags: BudgetFlags): { budget?: BudgetFile; error?: string } {
  const windows: { usd: number; period: string }[] = [];
  for (const [flag, period] of [['daily', '24h'], ['weekly', '7d'], ['monthly', '30d']] as const) {
    const raw = flags[flag];
    if (raw === undefined || raw === false) continue;
    const usd = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(usd) || usd <= 0 || usd > MAX_USD) return { error: `--${flag} must be a USD amount in (0, ${MAX_USD}]` };
    windows.push({ usd, period });
  }
  if (windows.length === 0) return { error: 'give at least one of --daily, --weekly, --monthly' };
  const value: Record<string, unknown> = { version: 1, windows, hardStop: flags.hardStop === true || flags.hardStop === 'true' };
  if (flags.fallbackModel !== undefined && flags.fallbackModel !== false) value.fallbackModel = String(flags.fallbackModel);
  const budget = validateBudget(value);
  return budget ? { budget } : { error: '--fallback-model must be a plain model name (letters, digits, . _ : / @ -; at most 128)' };
}

/** Writes the budget file atomically (temp file, rename). Holds no credential. */
export function writeBudget(cwd: string, budget: BudgetFile): string {
  const file = path.join(cwd, BUDGET_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(budget, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}
