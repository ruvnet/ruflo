/**
 * Routing outcome store: the persistence half of ruflo's routing learning loop.
 *
 * Two files, deliberately separate:
 * - `routing-outcomes.json`: labelled outcomes written by `hooks_post-task`
 *   (MCP/CLI, explicit success or failure). The learner reads only this, and
 *   compiles `learned-patterns.json` for the prompt-time hook router.
 * - `routing-observations.jsonl`: an append-only line per Agent/Task call from
 *   the `post-agent` hook in `.claude/helpers/hook-handler.cjs`, `unknown`
 *   unless the tool reported an error. High volume, never used as a label.
 *
 * Two invariants:
 * - Paths resolve from the project directory, never the process cwd. The MCP
 *   server's cwd is wherever it was launched, which scattered outcomes across
 *   unrelated directories.
 * - Prompt text is never stored. Prompts can carry secrets, so a row keeps
 *   only extracted keywords and a truncated SHA-256 of the prompt.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getProjectCwd } from '../mcp-tools/types.js';
import {
  buildLearnedRoutingPatterns,
  type LearnedRoutingOutcome,
  type LearnedRoutingPattern,
} from './learned-routing.js';

export const MAX_ROUTING_OUTCOMES = 500;
/** A store larger than this is not read; it cannot be produced by the capped writer. */
const MAX_STORE_BYTES = 5 * 1024 * 1024;

export type RoutingOutcomeLabel = 'success' | 'failure' | 'unknown';

export interface RoutingOutcomeRow extends LearnedRoutingOutcome {
  promptHash?: string;
  outcome?: RoutingOutcomeLabel;
  signal?: string;
  source?: 'mcp' | 'hook';
}

export interface LearnedPatternsFile {
  version: 1;
  generatedAt: string;
  outcomes: number;
  labelled: number;
  patterns: Record<string, LearnedRoutingPattern>;
}

/**
 * Stopwords shared with the hook helper. `hook-handler.cjs` carries an
 * identical copy (it cannot import TypeScript); a parity test keeps them equal.
 */
export const ROUTING_STOPWORDS: ReadonlySet<string> = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','under','again','further','then','once',
  'it','its','this','that','these','those','i','me','my','we','our','you','your',
  'he','she','they','them','and','but','or','nor','not','no','so','if','when','than',
  'very','just','also','only','both','each','all','any','few','more','most','other',
  'some','such','same','new','now','here','there','where','how','what','which','who',
]);

export function extractRoutingKeywords(text: string): string[] {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !ROUTING_STOPWORDS.has(word));
}

/** Plain words only: letters and inner hyphens, 3-24 chars, no digits. */
const STORABLE_KEYWORD = /^[a-z](?:[a-z-]{1,22}[a-z])$/;

/**
 * Keywords safe to persist. Tokens with digits or unusual length are dropped
 * because credentials, IDs and hashes look like that (`sk-live-...`, UUIDs);
 * a routing vocabulary does not need them.
 */
export function storableRoutingKeywords(text: string, max = 40): string[] {
  return [...new Set(extractRoutingKeywords(text).filter((word) => STORABLE_KEYWORD.test(word)))].slice(0, max);
}

export function hashPrompt(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

export function routingOutcomesPath(projectDir: string = getProjectCwd()): string {
  return join(projectDir, '.claude-flow', 'routing-outcomes.json');
}

export function learnedPatternsPath(projectDir: string = getProjectCwd()): string {
  return join(projectDir, '.claude-flow', 'learned-patterns.json');
}

/**
 * Append-only log the `post-agent` hook writes, one line per Agent/Task call.
 * Kept apart from the labelled store so a high-volume stream of `unknown`
 * rows can never evict the rare labelled outcomes the learner depends on.
 */
export function routingObservationsPath(projectDir: string = getProjectCwd()): string {
  return join(projectDir, '.claude-flow', 'routing-observations.jsonl');
}

export interface RoutingObservation {
  agent: string;
  promptHash: string;
  keywords: string[];
  outcome: 'failure' | 'unknown';
  signal: string;
  background: boolean;
  source: 'hook';
  timestamp: string;
}

/** Read the observation log, skipping malformed lines. Bounded like the store. */
export function loadRoutingObservations(file: string = routingObservationsPath()): RoutingObservation[] {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_STORE_BYTES) return [];
    return readFileSync(file, 'utf-8')
      .split('\n')
      .flatMap((line) => {
        if (!line.trim()) return [];
        try { return [JSON.parse(line) as RoutingObservation]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

export function loadRoutingOutcomes(file: string = routingOutcomesPath()): RoutingOutcomeRow[] {
  try {
    if (!existsSync(file) || statSync(file).size > MAX_STORE_BYTES) return [];
    const data = JSON.parse(readFileSync(file, 'utf-8')) as { outcomes?: unknown };
    return Array.isArray(data.outcomes) ? (data.outcomes as RoutingOutcomeRow[]) : [];
  } catch {
    return [];
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

/**
 * Compile the prompt-time pattern file from stored outcomes, using the same
 * rule as `hooks_route` so the hook helper never needs its own learner.
 */
export function compileLearnedPatterns(
  outcomes: RoutingOutcomeRow[],
  file: string = learnedPatternsPath(),
  now: () => Date = () => new Date(),
): LearnedPatternsFile {
  const labelled = outcomes.filter((row) => row.success === true);
  const compiled: LearnedPatternsFile = {
    version: 1,
    generatedAt: now().toISOString(),
    outcomes: outcomes.length,
    labelled: labelled.length,
    patterns: buildLearnedRoutingPatterns(labelled),
  };
  writeJsonAtomic(file, compiled);
  return compiled;
}

/** Append rows, cap the store, and recompile the prompt-time patterns. */
export function saveRoutingOutcomes(
  outcomes: RoutingOutcomeRow[],
  projectDir: string = getProjectCwd(),
): void {
  const capped = outcomes.slice(-MAX_ROUTING_OUTCOMES);
  writeJsonAtomic(routingOutcomesPath(projectDir), { outcomes: capped });
  compileLearnedPatterns(capped, learnedPatternsPath(projectDir));
}

/** Build a stored row from an explicit outcome; the task text is hashed, never kept. */
export function toRoutingOutcomeRow(input: {
  task: string;
  agent: string;
  success: boolean;
  quality: number;
  now?: Date;
}): RoutingOutcomeRow {
  return {
    agent: input.agent,
    promptHash: hashPrompt(input.task),
    keywords: storableRoutingKeywords(input.task),
    success: input.success,
    outcome: input.success ? 'success' : 'failure',
    signal: 'explicit',
    quality: input.quality,
    source: 'mcp',
    timestamp: (input.now ?? new Date()).toISOString(),
  };
}
