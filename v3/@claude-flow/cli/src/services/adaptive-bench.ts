/**
 * ADR-532 deterministic in-process scheduler benchmark.
 * No network, shell, model calls, file mutation or paid inference.
 * Synthetic delay workloads estimate scheduling overhead, NOT real Claude Code performance.
 */
import { createHash } from 'node:crypto';
import { executePlan, verifyReceipt, type ExecutionPlan } from './adaptive-execution.js';

type Mode = 'serial' | 'parallel';
interface Sample { id: number; serialMs: number; adaptiveMs: number; identical: boolean; receiptValid: boolean }
type Runner = (args: unknown, ctx: {signal: AbortSignal; dependencies: ReadonlyMap<string,unknown>}) => Promise<unknown>;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('aborted')); return; }
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    function stop() { clearTimeout(timer); reject(new Error('aborted')); }
    signal.addEventListener('abort', stop, {once: true});
  });
}

const handler: Runner = async (args, {signal, dependencies}) => {
  const p = args as { n: number; delayMs: number };
  await delay(p.delayMs, signal);
  let out = p.n;
  for (const v of dependencies.values()) out += Number(v);
  return out;
};

export function makeCase(i: number): ExecutionPlan {
  const steps = Array.from({length: 6}, (_, n) => {
    const deps = i % 3 === 0 ? [] :
      i % 3 === 1 ? (n >= 3 ? [`s${n-3}`] : []) :
      (n === 2 ? ['s1'] : n === 1 ? ['s0'] : []);
    const ms = 3 + ((i + n * 3) % 5);
    return {id: `s${n}`, handler: 'fixture', effect: 'compute' as const,
      capability: 'bench:read', deps, args: {n: n+1, delayMs: ms}, estimatedMs: ms,
      estimatedCostUsd: 0};
  });
  return {version: 1, steps};
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a,b) => a-b);
  return Math.round(sorted[Math.min(sorted.length-1, Math.ceil(sorted.length*fraction)-1)]*1000)/1000;
}

async function runCase(index: number, concurrency: number): Promise<{ms: number; result: Record<string,unknown>; valid:boolean; calls:number}> {
  const plan = makeCase(index);
  let calls = 0;
  const run = await executePlan(plan, {
    handlers: {fixture: handler},
    authorize: step => { calls++; return step.capability === 'bench:read'; },
    strategy: concurrency === 1 ? 'serial' : 'parallel',
    maxConcurrency: concurrency, maxWallMs: 10_000, maxEstimatedCostUsd: 0,
  });
  if (run.receipt.status !== 'ok') throw new Error(`benchmark case ${index} failed`);
  if (calls !== plan.steps.length) throw new Error('policy call coverage regression');
  return {ms:run.receipt.wallMs, result:run.results, valid:verifyReceipt(plan, run.receipt),calls};
}

export async function runAdaptiveBenchmark(devCount = 20, holdoutCount = 30): Promise<{
  schema: 'ruflo.adaptive.bench.v1'; environment: {node:string; synthetic:boolean; externalUsd:number};
  corpusHash:string; dev: {samples:number; candidates:Array<{concurrency:number; medianMs:number; p95Ms:number}>};
  selectedConcurrency:number; holdout: {samples:number; paired:Sample[]; correctness:number;
  serialMedianMs:number; serialP95Ms:number; adaptiveMedianMs:number; adaptiveP95Ms:number;
  medianSpeedup:number; p95Speedup:number; policyCalls:number; receiptValid:number};
}> {
  if (!Number.isInteger(devCount) || devCount < 5 || devCount > 100 ||
      !Number.isInteger(holdoutCount) || holdoutCount < 30 || holdoutCount > 100) {
    throw new Error('dev must be 5..100 and frozen holdout 30..100');
  }
  const candidates: Array<{concurrency:number; medianMs:number; p95Ms:number}> = [];
  for (const concurrency of [1,2,4,8]) {
    const samples: number[] = [];
    for (let i=0; i<devCount; i++) samples.push((await runCase(i,concurrency)).ms);
    candidates.push({concurrency, medianMs:percentile(samples,.5),p95Ms:percentile(samples,.95)});
  }
  // Tune on DEV only; deterministic tie-break to lower concurrency.
  const selected = [...candidates].sort((a,b) => a.medianMs-b.medianMs || a.concurrency-b.concurrency)[0].concurrency;
  const paired: Sample[] = [];
  let policyCalls = 0, valid = 0;
  for (let i=devCount; i<devCount+holdoutCount; i++) {
    const serial = await runCase(i,1);
    const adaptive = await runCase(i,selected);
    const identical = JSON.stringify(serial.result) === JSON.stringify(adaptive.result);
    if (!identical) throw new Error(`result parity regression in case ${i}`);
    if (!serial.valid || !adaptive.valid) throw new Error(`invalid receipt in case ${i}`);
    policyCalls += serial.calls + adaptive.calls;
    valid += 2;
    paired.push({id:i,serialMs:serial.ms,adaptiveMs:adaptive.ms,identical,receiptValid:serial.valid && adaptive.valid});
  }
  const serialMs = paired.map(x => x.serialMs), adaptiveMs = paired.map(x => x.adaptiveMs);
  const base = percentile(serialMs,.5), candidate = percentile(adaptiveMs,.5);
  const baseP95 = percentile(serialMs,.95), candidateP95 = percentile(adaptiveMs,.95);
  return {
    schema:'ruflo.adaptive.bench.v1',
    environment:{node:process.version,synthetic:true,externalUsd:0},
    corpusHash:createHash('sha256').update(JSON.stringify(Array.from({length:devCount+holdoutCount},(_,i)=>makeCase(i)))).digest('hex'),
    dev:{samples:devCount,candidates},
    selectedConcurrency:selected,
    holdout:{
      samples:holdoutCount,paired,correctness:paired.filter(x=>x.identical).length,
      serialMedianMs:base,serialP95Ms:baseP95,adaptiveMedianMs:candidate,adaptiveP95Ms:candidateP95,
      medianSpeedup:Math.round((base/candidate)*1000)/1000,
      p95Speedup:Math.round((baseP95/candidateP95)*1000)/1000,
      policyCalls,receiptValid:valid,
    }
  };
}
