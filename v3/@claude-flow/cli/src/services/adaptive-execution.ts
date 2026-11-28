/**
 * ADR-532: opt-in, read-only, capability-checked DAG scheduler.
 * This is an orchestration primitive, NOT a sandbox or Claude Code Code Mode.
 * Only caller-registered handlers execute; effectful operations are refused.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export type Effect = 'read' | 'compute' | 'write' | 'network' | 'shell' | 'secret';
export type Strategy = 'serial' | 'parallel' | 'auto';
export type TaskStatus = 'ok' | 'denied' | 'failed' | 'timeout';
export interface Step {
  id: string;
  handler: string;
  effect: Effect;
  capability: string;
  deps?: string[];
  args?: unknown;
  estimatedMs?: number;
  estimatedCostUsd?: number;
}
export interface ExecutionPlan { version: 1; steps: Step[] }
export interface ExecuteOptions {
  strategy?: Strategy;
  maxConcurrency?: number;
  maxWallMs?: number;
  maxEstimatedCostUsd?: number;
  /** Called for EACH step just before its handler; missing callback denies. */
  authorize?: (step: Readonly<Step>) => boolean | Promise<boolean>;
  handlers: Readonly<Record<string, RegisteredHandler>>;
}
/** Binding metadata belongs to the trusted host, never to the submitted plan. */
export interface RegisteredHandler {
  effect: 'read' | 'compute';
  capability: string;
  run: (args: unknown, ctx: {signal: AbortSignal; dependencies: ReadonlyMap<string, unknown>}) => unknown | Promise<unknown>;
}
export interface Event {
  id: string;
  effect: Effect;
  status: TaskStatus;
  authorized: boolean;
  durationMs: number;
  valueHash?: string;
}
export interface ExecutionReceipt {
  schema: 'ruflo.adaptive.v1';
  planHash: string;
  chainHead: string;
  events: Event[];
  strategy: Strategy;
  concurrency: number;
  status: 'ok' | 'failed';
  completed: number;
  total: number;
  wallMs: number;
  estimatedCostUsd: number;
}
export interface ExecutionOutcome {
  receipt: ExecutionReceipt;
  results: Record<string, unknown>;
}

const IDENT = /^[a-z][a-z0-9:_-]{0,63}$/;
const EFFECTS: readonly Effect[] = ['read', 'compute', 'write', 'network', 'shell', 'secret'];
const MAX_STEPS = 64;
const MAX_ARG_BYTES = 16_384;
const MAX_WORKERS = 8;

function digest(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new Error('unserializable value');
  return createHash('sha256').update(json).digest('hex');
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Snapshot and freeze validated plan data; trusted callbacks cannot rewrite authorization metadata. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function assertFiniteBound(value: unknown, field: string, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`invalid ${field}`);
  }
}

function sanitizedArgs(value: unknown): unknown {
  if (value === undefined) return null;
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { /* refuse cyclic and BigInt inputs */ }
  if (!encoded || Buffer.byteLength(encoded, 'utf8') > MAX_ARG_BYTES) throw new Error('invalid or oversized args');
  const decoded: unknown = JSON.parse(encoded);
  // Prototype-pollution keys are not needed by the declarative protocol.
  function scan(x: unknown, depth: number): void {
    if (depth > 20) throw new Error('args too deeply nested');
    if (!x || typeof x !== 'object') return;
    for (const [key, child] of Object.entries(x)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('unsafe args key');
      scan(child, depth + 1);
    }
  }
  scan(decoded, 0);
  return decoded;
}

/** Fully validate and copy untrusted input before any policy or handler executes. */
export function compilePlan(input: unknown): ExecutionPlan {
  if (!record(input) || input.version !== 1 || !Array.isArray(input.steps) ||
    input.steps.length < 1 || input.steps.length > MAX_STEPS ||
    Object.keys(input).some(k => k !== 'version' && k !== 'steps')) {
    throw new Error('invalid plan shape');
  }
  const ids = new Set<string>();
  const steps: Step[] = [];
  for (const raw of input.steps) {
    if (!record(raw) || Object.keys(raw).some(k => !['id','handler','effect','capability','deps','args','estimatedMs','estimatedCostUsd'].includes(k)) ||
      typeof raw.id !== 'string' || !IDENT.test(raw.id) ||
      typeof raw.handler !== 'string' || !IDENT.test(raw.handler) ||
      typeof raw.capability !== 'string' || !IDENT.test(raw.capability) ||
      !EFFECTS.includes(raw.effect as Effect)) throw new Error('invalid step descriptor');
    if (ids.has(raw.id)) throw new Error('duplicate step id');
    ids.add(raw.id);
    const deps = raw.deps ?? [];
    if (!Array.isArray(deps) || deps.some(x => typeof x !== 'string' || !IDENT.test(x)) ||
      new Set(deps).size !== deps.length || deps.includes(raw.id)) throw new Error('invalid dependencies');
    if (raw.estimatedMs !== undefined) assertFiniteBound(raw.estimatedMs, 'estimatedMs', 0, 600_000);
    if (raw.estimatedCostUsd !== undefined) assertFiniteBound(raw.estimatedCostUsd, 'estimatedCostUsd', 0, 100);
    steps.push({
      id: raw.id, handler: raw.handler, effect: raw.effect as Effect, capability: raw.capability,
      deps: [...deps], args: sanitizedArgs(raw.args),
      estimatedMs: (raw.estimatedMs as number | undefined) ?? 0,
      estimatedCostUsd: (raw.estimatedCostUsd as number | undefined) ?? 0,
    });
  }
  for (const step of steps) for (const dep of step.deps ?? []) {
    if (!ids.has(dep)) throw new Error('unknown dependency');
  }
  const byId = new Map(steps.map(s => [s.id, s]));
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error('dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of byId.get(id)?.deps ?? []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const step of steps) visit(step.id);
  return deepFreeze({ version: 1 as const, steps });
}

/** Critical-path priority, stable tie-break by input order. Never uses an ML guess as authorization. */
export function chooseStrategy(plan: ExecutionPlan, requested: Strategy = 'auto', limit = 2): { strategy: 'serial' | 'parallel'; concurrency: number } {
  if (!['serial','parallel','auto'].includes(requested)) throw new Error('unknown strategy');
  assertFiniteBound(limit, 'maxConcurrency', 1, MAX_WORKERS);
  if (!Number.isInteger(limit)) throw new Error('maxConcurrency must be integer');
  const roots = plan.steps.filter(step => !(step.deps?.length));
  const concurrent = limit > 1 && roots.length > 1;
  const enoughWork = roots.some(step => (step.estimatedMs ?? 0) >= 2);
  const parallel = requested === 'parallel' ? limit > 1 : requested === 'auto' ? concurrent && enoughWork : false;
  return { strategy: parallel ? 'parallel' : 'serial', concurrency: parallel ? limit : 1 };
}

export async function executePlan(input: unknown, options: ExecuteOptions): Promise<ExecutionOutcome> {
  const plan = compilePlan(input);
  const maxWallMs = options.maxWallMs ?? 30_000;
  const maxEstimatedCostUsd = options.maxEstimatedCostUsd ?? 0;
  assertFiniteBound(maxWallMs, 'maxWallMs', 1, 120_000);
  assertFiniteBound(maxEstimatedCostUsd, 'maxEstimatedCostUsd', 0, 1_000);
  const estimate = plan.steps.reduce((sum, s) => sum + (s.estimatedCostUsd ?? 0), 0);
  if (estimate > maxEstimatedCostUsd + 1e-9) throw new Error('estimated budget exceeded');
  const chosen = chooseStrategy(plan, options.strategy ?? 'auto', options.maxConcurrency ?? 2);
  if (!record(options.handlers)) throw new Error('invalid handler registry');
  const handlers: Record<string, RegisteredHandler> = Object.create(null);
  for (const step of plan.steps) {
    if (step.effect !== 'read' && step.effect !== 'compute') throw new Error('P0 refuses privileged effects');
    const binding = Object.hasOwn(options.handlers, step.handler) ? options.handlers[step.handler] : undefined;
    if (!binding || !record(binding) || typeof binding.run !== 'function') throw new Error('unregistered handler');
    if (binding.effect !== step.effect || binding.capability !== step.capability) {
      throw new Error('handler effect or capability mismatch');
    }
    handlers[step.handler] = Object.freeze({effect:binding.effect,capability:binding.capability,run:binding.run});
  }

  const startedAt = performance.now(), planHash = digest(plan);
  const byId = new Map(plan.steps.map(s => [s.id, s]));
  const order = new Map(plan.steps.map((s, i) => [s.id, i]));
  const children = new Map(plan.steps.map(s => [s.id, [] as string[]]));
  for (const s of plan.steps) for (const dep of s.deps ?? []) children.get(dep)?.push(s.id);
  const critical = new Map<string, number>();
  function criticalPath(id: string): number {
    if (critical.has(id)) return critical.get(id)!;
    const weight = Math.max(0, byId.get(id)?.estimatedMs ?? 0);
    const n = weight + Math.max(0, ...(children.get(id) ?? []).map(criticalPath));
    critical.set(id, n);
    return n;
  }
  for (const step of plan.steps) criticalPath(step.id);

  const completed = new Map<string, unknown>();
  const remaining = new Set(plan.steps.map(s => s.id));
  const active = new Map<string, Promise<void>>();
  const events = new Map<string, Event>();
  const aborted = new AbortController();
  let failed = false;

  function ready(): Step[] {
    return plan.steps.filter(s => remaining.has(s.id) && (s.deps ?? []).every(d => completed.has(d)))
      .sort((a,b) => (critical.get(b.id)! - critical.get(a.id)!) || (order.get(a.id)! - order.get(b.id)!));
  }

  async function dispatch(step: Step): Promise<void> {
    const t = performance.now();
    let authorized = false, status: TaskStatus = 'failed', valueHash: string | undefined;
    const controller = new AbortController();
    const stop = () => controller.abort();
    aborted.signal.addEventListener('abort', stop, { once: true });
    const allowedMs = maxWallMs - (performance.now() - startedAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Budget covers authorization AND handler, not only the tool body.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('deadline')); }, Math.max(1, allowedMs));
    });
    try {
      if (allowedMs <= 0 || controller.signal.aborted) throw new Error('deadline');
      // Each call has a distinct policy review. A single batch decision is insufficient.
      authorized = (await Promise.race([
        Promise.resolve().then(() => options.authorize?.(step)), deadline
      ])) === true;
      if (controller.signal.aborted) throw new Error('deadline');
      if (!authorized) { status = 'denied'; failed = true; aborted.abort(); return; }
      const dependencies = new Map((step.deps ?? []).map(id => [id, completed.get(id)]));
      const handler = handlers[step.handler]!;
      // Trusted host handlers only. P0 cannot sandbox arbitrary JavaScript.
      const value = await Promise.race([
        Promise.resolve().then(() => handler.run(step.args, {signal: controller.signal, dependencies})), deadline
      ]);
      if (controller.signal.aborted) throw new Error('deadline');
      // Reject non-JSON outputs: a missing output hash must never appear as a success.
      valueHash = digest(value);
      completed.set(step.id, value);
      status = 'ok';
    } catch (error) {
      status = error instanceof Error && error.message === 'deadline' ? 'timeout' : 'failed';
      failed = true;
      aborted.abort();
    } finally {
      if (timer) clearTimeout(timer);
      aborted.signal.removeEventListener('abort', stop);
      events.set(step.id, {
        id: step.id, effect: step.effect, status, authorized,
        durationMs: Math.max(0, Math.round((performance.now() - t) * 1000) / 1000),
        ...(status === 'ok' ? {valueHash} : {}),
      });
    }
  }

  while (remaining.size > 0 || active.size > 0) {
    if (!failed && performance.now() - startedAt >= maxWallMs) { failed = true; aborted.abort(); }
    if (!failed) {
      for (const step of ready().slice(0, chosen.concurrency - active.size)) {
        remaining.delete(step.id);
        const promise = dispatch(step).finally(() => { active.delete(step.id); });
        active.set(step.id, promise);
      }
    }
    if (active.size === 0) break;
    await Promise.race(active.values());
  }
  const ordered = plan.steps.flatMap(s => events.has(s.id) ? [events.get(s.id)!] : []);
  // The SHA chain is tamper-evident, not a signature, and must be anchored by Flywheel.
  let chainHead = planHash;
  for (const event of ordered) chainHead = digest({ parent: chainHead, event });
  const receipt: ExecutionReceipt = {
    schema: 'ruflo.adaptive.v1', planHash, chainHead, events: ordered,
    strategy: chosen.strategy, concurrency: chosen.concurrency,
    status: !failed && completed.size === plan.steps.length ? 'ok' : 'failed',
    completed: completed.size, total: plan.steps.length,
    wallMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
    estimatedCostUsd: estimate,
  };
  // Never put arbitrary task values in the receipt, only their hash.
  return { receipt, results: Object.fromEntries(completed) };
}

export function verifyReceipt(input: unknown, receipt: ExecutionReceipt): boolean {
  try {
    const plan = compilePlan(input);
    if (!receipt || !Array.isArray(receipt.events) || receipt.schema !== 'ruflo.adaptive.v1' ||
      receipt.planHash !== digest(plan)) return false;
    if (!Number.isFinite(receipt.wallMs) || receipt.wallMs < 0 ||
      !Number.isInteger(receipt.concurrency) || receipt.concurrency < 1 || receipt.concurrency > MAX_WORKERS) return false;
    const byId = new Map(plan.steps.map(s => [s.id, s]));
    const seen = new Set<string>();
    let hash = receipt.planHash, okCount = 0;
    for (const event of receipt.events) {
      if (!event || !byId.has(event.id) || seen.has(event.id) ||
        event.effect !== byId.get(event.id)?.effect ||
        !['ok','denied','failed','timeout'].includes(event.status) ||
        !Number.isFinite(event.durationMs) || event.durationMs < 0) return false;
      if (event.status === 'ok') {
        if (event.authorized !== true || typeof event.valueHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(event.valueHash)) return false;
        okCount++;
      }
      if (event.status === 'denied' && event.authorized !== false) return false;
      seen.add(event.id);
      hash = digest({parent: hash, event});
    }
    const completed = okCount === plan.steps.length && receipt.events.length === plan.steps.length;
    return hash === receipt.chainHead && okCount === receipt.completed &&
      receipt.total === plan.steps.length && receipt.events.length <= receipt.total &&
      receipt.status === (completed ? 'ok' : 'failed');
  } catch { return false; }
}
