/**
 * Bounded context delegation, inspired by Spotify Shunt's routing concept.
 * No filesystem, subprocess, network, persistence or implicit model invocation.
 * The trusted host supplies already-authorized immutable source snapshots and
 * an adapter whose policy, budget and capability controls remain authoritative.
 */
import { createHash } from 'node:crypto';

export type ContextMode = 'legacy' | 'observe' | 'enforce';
export type ContextIntent = 'analysis' | 'edit' | 'debug' | 'architecture';
export interface ContextRead {
  mode?: ContextMode;
  intent: ContextIntent;
  inputBytes: number;
  fileCount: number;
  offset?: number;
  limit?: number;
  depth?: number;
  workerAvailable: boolean;
}
export interface ContextLimits {
  minInputBytes: number;
  maxInputBytes: number;
  maxFiles: number;
  maxOutputBytes: number;
  maxFindings: number;
  timeoutMs: number;
}
export const DEFAULT_CONTEXT_LIMITS: Readonly<ContextLimits> = Object.freeze({
  minInputBytes: 14_000, maxInputBytes: 120_000, maxFiles: 16,
  maxOutputBytes: 8_000, maxFindings: 32, timeoutMs: 30_000,
});
export interface ContextPlan {
  route: 'direct' | 'observe' | 'delegate';
  reason: string;
}
function limitsOf(overrides: Partial<ContextLimits> = {}): ContextLimits {
  const limits = { ...DEFAULT_CONTEXT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('invalid context limits');
  }
  if (limits.timeoutMs > 2_147_483_647) throw new Error('invalid context timeout');
  if (limits.minInputBytes > limits.maxInputBytes) throw new Error('invalid context threshold');
  return limits;
}
export function planContextRead(read: ContextRead, overrides?: Partial<ContextLimits>): ContextPlan {
  const limits = limitsOf(overrides);
  if (!['legacy', 'observe', 'enforce'].includes(read.mode ?? 'legacy')) throw new Error('invalid context mode');
  if (!['analysis', 'edit', 'debug', 'architecture'].includes(read.intent)) throw new Error('invalid context intent');
  for (const value of [read.inputBytes, read.fileCount, read.depth ?? 0, read.offset ?? 0, read.limit ?? 0]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid context metadata');
  }
  const direct = (reason: string): ContextPlan => ({ route: 'direct', reason });
  if (!read.mode || read.mode === 'legacy') return direct('legacy');
  if (read.intent !== 'analysis') return direct('exact-source-required');
  if (read.offset !== undefined || read.limit !== undefined) return direct('targeted-read');
  if ((read.depth ?? 0) > 0) return direct('depth-limit');
  if (read.workerAvailable !== true) return direct('worker-unavailable');
  if (read.fileCount === 0 || read.fileCount > limits.maxFiles) return direct('file-limit');
  if (read.inputBytes < limits.minInputBytes) return direct('small-input');
  if (read.inputBytes > limits.maxInputBytes) return direct('input-limit');
  return { route: read.mode === 'observe' ? 'observe' : 'delegate', reason: 'bulk-analysis' };
}

export interface ContextSource { path: string; content: string }
export interface ContextEvidence {
  path: string;
  sourceSha256: string;
  startLine: number;
  endLine: number;
  quote: string;
  answer: string;
}
export interface ContextWorkerReply {
  findings: ContextEvidence[];
  /** Provider-reported usage only. Absence means unknown, never zero. */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}
export interface ContextWorkerRequest {
  version: 1;
  question: string;
  sources: ReadonlyArray<Readonly<ContextSource & { sha256: string }>>;
  maxOutputBytes: number;
  maxFindings: number;
  depth: 1;
  tools: readonly [];
}
export interface ContextAdapter {
  /** Must enforce policy, budget, data destination, tools=[] and cancellation.
   * Return a raw bounded JSON string; never start a provider in authorize(). */
  authorize(request: Readonly<ContextWorkerRequest>, signal: AbortSignal): Promise<boolean>;
  invoke(request: Readonly<ContextWorkerRequest>, signal: AbortSignal): Promise<string>;
}
export interface ContextReceipt {
  version: 1;
  requestSha256: string;
  sources: Array<{ path: string; sha256: string; bytes: number }>;
  sourceBytes: number;
  workerInputBytes: number;
  workerOutputBytes: number;
  coordinatorBytes: number;
  durationMs: number;
  usage?: ContextWorkerReply['usage'];
}
export type ContextResult =
  | { status: 'direct'; plan: ContextPlan }
  | { status: 'escalate'; plan: ContextPlan; reason: string }
  | { status: 'delegated'; plan: ContextPlan; findings: ContextEvidence[]; receipt: ContextReceipt };

export const contextSha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const contextBytes = (text: string): number => Buffer.byteLength(text, 'utf8');

function snapshotsOf(sources: readonly ContextSource[], limits: ContextLimits) {
  if (sources.length < 1 || sources.length > limits.maxFiles) throw new Error('file-limit');
  let bytes = 0;
  const paths = new Set<string>();
  return Object.freeze(sources.map(source => {
    // Identifiers only: no path is ever opened by this service. Hosts authorize
    // reads first, including realpath/symlink handling and secret filtering.
    if (typeof source.path !== 'string' || !/^[A-Za-z0-9_./@-]{1,512}$/.test(source.path)
      || source.path.startsWith('/') || source.path.split('/').some(p => !p || p === '.' || p === '..')
      || paths.has(source.path)) throw new Error('invalid-source-path');
    if (typeof source.content !== 'string' || source.content.includes('\0')) throw new Error('invalid-source-content');
    paths.add(source.path);
    bytes += contextBytes(source.content);
    if (bytes > limits.maxInputBytes) throw new Error('input-limit');
    return Object.freeze({ path: source.path, content: source.content, sha256: contextSha256(source.content) });
  }));
}

function validateReply(raw: string, request: ContextWorkerRequest, limits: ContextLimits): ContextWorkerReply {
  if (typeof raw !== 'string' || contextBytes(raw) > limits.maxOutputBytes) throw new Error('output-limit');
  const reply: unknown = JSON.parse(raw);
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw new Error('invalid-reply');
  const object = reply as Record<string, unknown>;
  if (!Array.isArray(object.findings) || object.findings.length < 1 || object.findings.length > limits.maxFindings) throw new Error('invalid-findings');
  const findings: ContextEvidence[] = object.findings.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('invalid-evidence');
    const f = value as ContextEvidence;
    const source = request.sources.find(s => s.path === f.path);
    if (!source || f.sourceSha256 !== source.sha256 || !Number.isSafeInteger(f.startLine)
      || !Number.isSafeInteger(f.endLine) || f.startLine < 1 || f.endLine < f.startLine
      || typeof f.answer !== 'string' || !f.answer.trim() || typeof f.quote !== 'string' || !f.quote.trim()) throw new Error('invalid-evidence');
    const lines = source.content.split('\n');
    if (f.endLine > lines.length || lines.slice(f.startLine - 1, f.endLine).join('\n') !== f.quote) throw new Error('quote-mismatch');
    // Copy only schema fields. Worker-supplied extra keys never enter context.
    return { path: f.path, sourceSha256: f.sourceSha256, startLine: f.startLine, endLine: f.endLine, quote: f.quote, answer: f.answer };
  });
  let usage: ContextWorkerReply['usage'];
  if (object.usage !== undefined) {
    const u = object.usage as NonNullable<ContextWorkerReply['usage']>;
    if (!u || !Number.isSafeInteger(u.inputTokens) || u.inputTokens < 0 || !Number.isSafeInteger(u.outputTokens) || u.outputTokens < 0
      || (u.costUsd !== undefined && (!Number.isFinite(u.costUsd) || u.costUsd < 0))) throw new Error('invalid-usage');
    usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens, ...(u.costUsd === undefined ? {} : { costUsd: u.costUsd }) };
  }
  return { findings, ...(usage ? { usage } : {}) };
}

/** No retries, recursive launches or raw-corpus fallback. Every failure is explicit.
 * Quote integrity proves provenance, not that the answer follows from the quote.
 * Returned content is untrusted data; host guards still govern subsequent tools.
 */
export async function delegateContextRead(options: {
  read: Omit<ContextRead, 'inputBytes' | 'fileCount' | 'workerAvailable'>;
  question: string;
  sources: readonly ContextSource[];
  adapter?: ContextAdapter;
  limits?: Partial<ContextLimits>;
  signal?: AbortSignal;
}): Promise<ContextResult> {
  const started = performance.now();
  const limits = limitsOf(options.limits);
  const sourceBytes = options.sources.reduce((sum, s) => sum + contextBytes(s.content), 0);
  const plan = planContextRead({ ...options.read, inputBytes: sourceBytes, fileCount: options.sources.length, workerAvailable: !!options.adapter }, limits);
  if (plan.route !== 'delegate') return { status: 'direct', plan };
  let phase = 'invalid-request';
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (() => void) | undefined;
  try {
    if (typeof options.question !== 'string' || !options.question.trim() || contextBytes(options.question) > 4096) throw new Error();
    const sources = snapshotsOf(options.sources, limits);
    const request: Readonly<ContextWorkerRequest> = Object.freeze({
      version: 1, question: options.question, sources, maxOutputBytes: limits.maxOutputBytes,
      maxFindings: limits.maxFindings, depth: 1, tools: Object.freeze([]) as readonly [],
    });
    const payload = JSON.stringify(request);
    if (contextBytes(payload) > limits.maxInputBytes) throw new Error();
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('cancelled'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    timer = setTimeout(() => { phase = 'timeout'; controller.abort(); }, limits.timeoutMs);
    const execute = async () => {
      if (controller.signal.aborted) throw new Error();
      phase = 'authorization-failed';
      if (await options.adapter!.authorize(request, controller.signal) !== true) throw new Error();
      if (controller.signal.aborted) throw new Error();
      phase = 'worker-failed';
      const raw = await options.adapter!.invoke(request, controller.signal);
      if (controller.signal.aborted) throw new Error();
      phase = 'invalid-worker-reply';
      const reply = validateReply(raw, request, limits);
      const sourcesReceipt = sources.map(s => ({ path: s.path, sha256: s.sha256, bytes: contextBytes(s.content) }));
      const receipt: ContextReceipt = {
        version: 1, requestSha256: contextSha256(payload), sources: sourcesReceipt,
        sourceBytes, workerInputBytes: contextBytes(payload), workerOutputBytes: contextBytes(raw),
        coordinatorBytes: 0, durationMs: performance.now() - started, ...(reply.usage ? { usage: reply.usage } : {}),
      };
      const result = { status: 'delegated' as const, plan, findings: reply.findings, receipt };
      // Fixed point: the measured coordinator payload includes the receipt itself.
      for (let i = 0; i < 8; i++) {
        const size = contextBytes(JSON.stringify(result));
        if (receipt.coordinatorBytes === size) break;
        receipt.coordinatorBytes = size;
      }
      if (receipt.coordinatorBytes > limits.maxOutputBytes || receipt.coordinatorBytes >= sourceBytes) throw new Error();
      return result;
    };
    return await Promise.race([execute(), cancelled]);
  } catch {
    // Never echo adapter exception strings: they may contain credentials/corpus.
    return { status: 'escalate', plan, reason: options.signal?.aborted ? 'cancelled' : phase };
  } finally {
    if (timer) clearTimeout(timer);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
    options.signal?.removeEventListener('abort', abort);
  }
}
