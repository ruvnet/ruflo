import { describe, it, expect } from 'vitest';
import { compilePlan, chooseStrategy, executePlan, verifyReceipt, type ExecutionPlan } from '../src/services/adaptive-execution.js';
import { makeCase, runAdaptiveBenchmark, selectConcurrency } from '../src/services/adaptive-bench.js';

const fixture = (count = 3): ExecutionPlan => ({
  version:1,
  steps:Array.from({length:count},(_,i) => ({
    id:`s${i}`,handler:'unit',effect:'compute',capability:'unit:read',
    deps:i===0 ? [] : [`s${i-1}`],args:{value:i+1},estimatedMs:5,estimatedCostUsd:0
  }))
});
const handlers = {
  unit: {effect:'compute' as const,capability:'unit:read',run:async (args:unknown, ctx:{signal:AbortSignal;dependencies:ReadonlyMap<string,unknown>}) => {
    if(ctx.signal.aborted) throw new Error('aborted');
    const input = args as {value:number};
    return input.value + Array.from(ctx.dependencies.values()).reduce<number>((x,v)=>x+Number(v),0);
  }}
};
const opts = {handlers,authorize:()=>true,maxEstimatedCostUsd:0};

describe('ADR-532 compile and threat invariants', () => {
  it('rejects ten adversarial input shapes before calling a handler', async () => {
    const base = fixture();
    const attacks:unknown[] = [
      {...base, steps:[base.steps[0],base.steps[0]]}, // duplicate ID
      {...base, steps:[{...base.steps[0],deps:['missing']}]}, // unknown dependency
      {...base, steps:[{...base.steps[0],deps:['s1']},{...base.steps[1],deps:['s0']}]}, // cycle
      {...base, steps:[{...base.steps[0],id:'../secrets'}]}, // unsafe ID
      {...base, steps:[{...base.steps[0],estimatedCostUsd:-1}]},
      {...base, steps:[{...base.steps[0],estimatedMs:Number.POSITIVE_INFINITY}]},
      {...base, steps:[{...base.steps[0],args:JSON.parse('{"__proto__":{"admin":true}}')}]},
      {...base, steps:[{...base.steps[0],effect:'shell'}]},
      {...base, steps:[{...base.steps[0],effect:'write'}]},
      {...base, steps:[{...base.steps[0],handler:'unregistered'}]},
    ];
    for (const attack of attacks) {
      let invoked=0;
      await expect(executePlan(attack, {...opts, handlers:{unit:{effect:'compute',capability:'unit:read',run:()=>{invoked++; return true;}}}})).rejects.toThrow();
      expect(invoked).toBe(0);
    }
  });
  it('denies additional privileged network and secret effects', async () => {
    for(const effect of ['network','secret']){
      await expect(executePlan({version:1,steps:[{...fixture(1).steps[0],effect}]},opts)).rejects.toThrow(/privileged/);
    }
  });
  it('does not trust a plan claiming a lower effect than its registered handler', async () => {
    let calls=0;
    await expect(executePlan(fixture(1),{...opts,handlers:{
      unit:{effect:'read',capability:'unit:read',run:()=>{calls++;return true;}}
    }})).rejects.toThrow(/handler effect/);
    await expect(executePlan(fixture(1),{...opts,handlers:{
      unit:{effect:'compute',capability:'another:read',run:()=>{calls++;return true;}}
    }})).rejects.toThrow(/handler effect/);
    expect(calls).toBe(0);
  });
  it('denies unknown keys, oversized args, invalid limits and excessive graph size', async () => {
    expect(()=>compilePlan({version:1,steps:fixture(1).steps,program:'console.log(1)'})).toThrow();
    expect(()=>compilePlan({version:1,steps:[{...fixture(1).steps[0],args:{text:'a'.repeat(17000)}}]})).toThrow();
    expect(()=>compilePlan(fixture(65))).toThrow();
    await expect(executePlan(fixture(),{...opts,maxConcurrency:9})).rejects.toThrow();
    await expect(executePlan(fixture(),{...opts,maxWallMs:0})).rejects.toThrow();
    await expect(executePlan(fixture(),{...opts,maxEstimatedCostUsd:-1})).rejects.toThrow();
  });
  it('does not execute without a per-operation authorizer', async () => {
    const run=await executePlan(fixture(1),{handlers});
    expect(run.receipt.status).toBe('failed');
    expect(run.receipt.events[0].status).toBe('denied');
    expect(run.receipt.completed).toBe(0);
  });
  it('enforces total estimated budget before any handler', async () => {
    const plan=fixture(1);
    plan.steps[0].estimatedCostUsd=1;
    await expect(executePlan(plan,opts)).rejects.toThrow(/budget/);
  });
});

describe('ADR-532 scheduler execution', () => {
  it('calls policy separately for each authorized task in a dependent chain', async () => {
    let calls=0;
    const run=await executePlan(fixture(4),{...opts,authorize:()=>{calls++;return true;},strategy:'parallel',maxConcurrency:4});
    expect(run.receipt.status).toBe('ok');
    expect(calls).toBe(4);
    expect(run.receipt.completed).toBe(4);
    expect(run.results.s3).toBe(10);
    expect(verifyReceipt(fixture(4),run.receipt)).toBe(true);
  });
  it('never schedules a dependent task after its parent fails', async () => {
    const run=await executePlan(fixture(3),{...opts,handlers:{unit:{effect:'compute',capability:'unit:read',run:()=>{throw Error('failure');}}}});
    expect(run.receipt.status).toBe('failed');
    expect(run.receipt.completed).toBe(0);
    expect(run.receipt.events.map(x=>x.id)).toEqual(['s0']);
  });
  it('does not promote batch permission to other tool calls', async () => {
    const plan=makeCase(0);
    const denied:string[]=[];
    const run=await executePlan(plan,{
      strategy:'serial',handlers:{fixture:{effect:'compute',capability:'bench:read',run:()=>99}},
      authorize:step=>{denied.push(step.id);return step.id!=='s1';}
    });
    expect(run.receipt.status).toBe('failed');
    expect(run.receipt.events.find(e=>e.id==='s1')?.status).toBe('denied');
    expect(run.receipt.completed).toBe(1);
    expect(denied.length).toBe(2);
    expect(denied[1]).toBe('s1');
  });
  it('overlaps independent read-only work without exceeding concurrency limit', async () => {
    let active=0,max=0;
    const run=await executePlan(makeCase(0),{
      strategy:'parallel',maxConcurrency:3,authorize:()=>true,
      handlers:{fixture:{effect:'compute',capability:'bench:read',run:async (_args,{signal})=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,6));active--;if(signal.aborted)throw Error('aborted');return true;}}}
    });
    expect(run.receipt.status).toBe('ok');
    expect(max).toBe(3);
    expect(run.receipt.events.length).toBe(6);
    expect(run.receipt.concurrency).toBe(3);
  });
  it('auto prefers serial for a chain, parallel for independent long tasks', () => {
    expect(chooseStrategy(compilePlan(fixture(4)),'auto',4).strategy).toBe('serial');
    expect(chooseStrategy(compilePlan(makeCase(0)),'auto',4).strategy).toBe('parallel');
  });
  it('selects the least expensive concurrency within ten percent of fastest DEV candidate',()=>{
    const rows=[{concurrency:1,medianMs:12},{concurrency:2,medianMs:6},{concurrency:4,medianMs:5.5},{concurrency:8,medianMs:5.2}];
    expect(selectConcurrency(rows)).toBe(4);
    expect(selectConcurrency([{concurrency:1,medianMs:4},{concurrency:8,medianMs:3.8}])).toBe(1);
    expect(()=>selectConcurrency([])).toThrow();
  });
  it('cancels cooperative handler on timeout, does not mark dependent work successful', async () => {
    const run=await executePlan(fixture(2),{
      ...opts,maxWallMs:5,handlers:{
        unit:{effect:'compute',capability:'unit:read',run:(_args,{signal})=>new Promise((_resolve,reject)=>{
          signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
        })}
      }
    });
    expect(run.receipt.status).toBe('failed');
    expect(run.receipt.events.length).toBe(1);
    expect(run.receipt.completed).toBe(0);
  });
  it('detects tampered receipts, never includes raw input/output in receipts', async () => {
    const plan={version:1 as const,steps:[{...fixture(1).steps[0],args:{value:123456789}}]};
    const run=await executePlan(plan,opts);
    expect(verifyReceipt(plan,run.receipt)).toBe(true);
    expect(JSON.stringify(run.receipt)).not.toContain('123456789');
    expect(verifyReceipt(plan,{...run.receipt,chainHead:'0'.repeat(64)})).toBe(false);
    expect(verifyReceipt({...plan,steps:[{...plan.steps[0],args:{value:2}}]},run.receipt)).toBe(false);
  });
  it('times out a stalled authorization callback before any tool executes', async () => {
    let invoked=0;
    const run=await executePlan(fixture(1),{
      ...opts,maxWallMs:5,
      authorize:()=>new Promise<boolean>(()=>{}),
      handlers:{unit:{effect:'compute',capability:'unit:read',run:()=>{invoked++;return true;}}}
    });
    expect(run.receipt.status).toBe('failed');
    expect(run.receipt.completed).toBe(0);
    expect(run.receipt.events[0].status).toBe('timeout');
    expect(invoked).toBe(0);
  });
  it('refuses unserializable handler results instead of issuing an unverifiable success receipt', async () => {
    for(const result of [undefined,BigInt(2),(()=>{const o:any={};o.self=o;return o;})()]){
      const run=await executePlan(fixture(1),{
        ...opts,handlers:{unit:{effect:'compute',capability:'unit:read',run:()=>result}}
      });
      expect(run.receipt.status).toBe('failed');
      expect(run.receipt.completed).toBe(0);
      expect(run.receipt.events[0].status).toBe('failed');
    }
  });
  it('holds out 30 paired cases and verifies results and policy parity', async () => {
    const bench=await runAdaptiveBenchmark(5,30);
    expect(bench.holdout.samples).toBe(30);
    expect(bench.holdout.correctness).toBe(30);
    expect(bench.holdout.receiptValid).toBe(60);
    expect(bench.holdout.policyCalls).toBe(360);
    expect(bench.holdout.speedupCI95[1]).toBeGreaterThan(bench.holdout.speedupCI95[0]);
    expect(bench.holdout.serialMedianMs).toBeGreaterThan(bench.holdout.adaptiveMedianMs);
    expect(bench.environment.externalUsd).toBe(0);
  },30000);
});
