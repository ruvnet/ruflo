import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// These tests execute the manual Node 24 benchmark with a fake CLI. They never
// authenticate to a provider, run a real Claude binary, or spend model credits.
const node24 = Number(process.versions.node.split('.')[0]) >= 24;
const source = fileURLToPath(new URL('../benchmarks/context-delegation/subscription-pilot.mjs', import.meta.url));
const core = new URL('../src/services/context-delegation.ts', import.meta.url).href;
const owned: string[] = [];
const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
  children.clear();
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-subscription-contract-'));
  owned.push(root);
  chmodSync(root, 0o700);
  mkdirSync(join(root, 'runtime')); mkdirSync(join(root, 'bin'));
  const events = join(root, 'events.jsonl');
  const pid = join(root, 'mock.pid');
  const binary = join(root, 'bin', 'claude');
  const policy = join(root, 'policy.mjs');
  const script = join(root, 'subscription-pilot.mjs');
  // Exercise the real immutable snapshot, cancellation, byte and evidence
  // validator. Only the host policy, budget and native process ports are fake.
  writeFileSync(join(root, 'runtime/context-delegation.js'), `export {delegateContextRead} from ${JSON.stringify(core)};\n`);
  writeFileSync(join(root, 'runtime/global-ai-budget.js'), `
import {appendFileSync,readFileSync} from 'node:fs';
const log=e=>appendFileSync(process.env.NATIVE_EVENTS,JSON.stringify(e)+'\\n');
export const isQuotaErrorText=t=>/quota|429/.test(t||'');
export function getGlobalAiBudget(){return {
 getLimits:()=>({maxConcurrentGlobal:1,maxLaunchesPerHour:2,maxLaunchesPerDay:12,pauseOnQuotaErrorMinutes:60}),
 reserve:async()=>{log({event:'reserve'});return process.env.NATIVE_BUDGET_DENY==='1'?{allowed:false}:{allowed:true,permitId:'fixture-permit'};},
 release:async permitId=>{let alive=false,pid;try{pid=Number(readFileSync(process.env.NATIVE_PID,'utf8'));process.kill(pid,0);alive=true;}catch{}log({event:'release',permitId,pid,alive});},
 recordQuotaError:async()=>log({event:'quota'})
};}
`);
  writeFileSync(policy, `
import {appendFileSync} from 'node:fs';
export async function authorizeMcpTool(){appendFileSync(process.env.NATIVE_EVENTS,JSON.stringify({event:'policy'})+'\\n');return {mode:process.env.NATIVE_OBSERVE_DENY==='1'?'observe':'legacy',outcome:process.env.NATIVE_POLICY_DENY==='1'||process.env.NATIVE_OBSERVE_DENY==='1'?'denied':'allowed',enforcedOutcome:process.env.NATIVE_POLICY_DENY==='1'?'denied':'allowed',reason:'fixture-host-policy',receiptId:'fixture-policy-receipt'};}
`);
  const helper = readFileSync(source, 'utf8');
  const policyImport = "'/usr/lib/node_modules/@claude-flow/cli/dist/src/services/policy-runtime.js'";
  if (!helper.includes(policyImport)) throw Error('update fixture for changed host policy import');
  writeFileSync(script, helper.replace(policyImport, JSON.stringify(pathToFileURL(policy).href)));
  const content = 'export const limit = 2;\n' + '// public immutable fixture\n'.repeat(700);
  writeFileSync(join(root, 'fixture.json'), JSON.stringify({ question: 'What is the declared limit?', source: {
    path: 'src/public-fixture.ts', content, sha256: createHash('sha256').update(content).digest('hex'),
  } }));
  writeFileSync(binary, `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('fixture-claude 1.0.0');process.exit(0);}
if(args[0]==='auth'&&args[1]==='status'){console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'max'}));process.exit(0);}
const log=e=>fs.appendFileSync(process.env.NATIVE_EVENTS,JSON.stringify(e)+'\\n');
fs.writeFileSync(process.env.NATIVE_PID,String(process.pid));log({event:'launch',pid:process.pid,args,canary:process.env.GH_TOKEN??null});
const behavior=process.env.NATIVE_BEHAVIOR||'success';
const model=args[args.indexOf('--model')+1]==='haiku'?'claude-fixture-haiku':'claude-fixture-sonnet';
console.log(JSON.stringify({type:'system',subtype:'init',claude_code_version:'fixture-1.0.0',model,tools:behavior==='bad-init'?['Bash']:[],mcp_servers:[],plugins:[],skills:[]}));
if(behavior==='hang'||behavior==='bad-init'){setInterval(()=>{},1000);process.stdin.resume();}
else{let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{
const r=JSON.parse(input),s=r.sources[0];
const findings=[{path:s.path,sourceSha256:s.sha256,startLine:1,endLine:1,quote:behavior==='bad-quote'?'forged quote':s.content.split('\\n')[0],answer:'The declared limit is 2.'}];
const result={type:'result',is_error:false,result:JSON.stringify({findings}),usage:{input_tokens:20,output_tokens:30,cache_read_input_tokens:0,cache_creation_input_tokens:0},total_cost_usd:behavior==='cost-overrun'?.051:.001,modelUsage:{[model]:{inputTokens:20,outputTokens:30,cacheReadInputTokens:0,cacheCreationInputTokens:0,costUSD:.001}},num_turns:1,duration_api_ms:5};
if(behavior==='missing-cost')delete result.total_cost_usd;
console.log(JSON.stringify(result));if(behavior==='result-hang')setInterval(()=>{},1000);});}
`);
  chmodSync(binary, 0o700);
  const environment = (overrides: Record<string, string> = {}) => {
    const env = { ...process.env };
    for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
    return { ...env, PATH: join(root, 'bin') + delimiter + (process.env.PATH ?? ''), NATIVE_EVENTS: events, NATIVE_PID: pid, GH_TOKEN: 'leak-canary', RUFLO_PILOT_CHILD_ENV_PASS: 'NATIVE_EVENTS,NATIVE_PID,NATIVE_BEHAVIOR', ...overrides };
  };
  const args = (phase: string, deadline: number) => [script, root, phase, String(deadline)];
  const run = (overrides: Record<string, string> = {}, phase = 'baseline', deadline = 1500) => spawnSync(process.execPath, args(phase, deadline), { encoding: 'utf8', env: environment(overrides), timeout: 10_000 });
  const start = (overrides: Record<string, string> = {}, phase = 'baseline', deadline = 1500) => {
    const child = spawn(process.execPath, args(phase, deadline), { env: environment(overrides), stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '', stderr = '';
    child.stdout!.on('data', chunk => stdout += chunk.toString()); child.stderr!.on('data', chunk => stderr += chunk.toString());
    const completion = new Promise<{ code: number | null; stdout: string; stderr: string }>((res, rej) => {
      child.once('error', rej); child.once('close', code => { children.delete(child); res({ code, stdout, stderr }); });
    });
    return { child, completion };
  };
  const log = (): any[] => existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
  const state = () => JSON.parse(readFileSync(join(root, 'state.json'), 'utf8'));
  return { root, binary, run, start, log, state };
}

async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > end) throw Error('fixture process did not launch'); await new Promise(r => setTimeout(r, 10)); }
}

describe.skipIf(!node24)('manual subscription pilot contracts using a fake native CLI', () => {
  it('launches with empty tools and MCP and returns production-core-validated evidence', () => {
    const f = fixture(), result = f.run();
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ status: 'complete', result: { status: 'delegated' }, receipt: { childTerminationConfirmed: true, reportedApiEquivalentCostUsd: .001, policyMode: 'legacy', policyOutcome: 'allowed', policyEnforcedOutcome: 'allowed', policyReceiptId: 'fixture-policy-receipt' } });
    expect(output.receipt.host.tools).toEqual([]); expect(output.receipt.host.mcpServers).toEqual([]);
    const launched = f.log().find(e => e.event === 'launch');
    for (const flag of ['--safe-mode','--restricted','--strict-mcp-config','--disable-slash-commands','--no-session-persistence']) expect(launched.args).toContain(flag);
    expect(launched.args[launched.args.indexOf('--tools') + 1]).toBe('');
    // The child gets an allowlisted environment: a GH_TOKEN in the shell must not reach it.
    expect(launched.canary).toBeNull();
    expect(JSON.parse(launched.args[launched.args.indexOf('--mcp-config') + 1])).toEqual({ mcpServers: {} });
    expect(JSON.parse(launched.args[launched.args.indexOf('--settings') + 1])).toEqual({ disableAllHooks: true });
    expect(f.log().find(e => e.event === 'release')).toMatchObject({ alive: false, permitId: 'fixture-permit' });
  });
  it('rejects invented quotes through the real core, retaining captured usage', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'bad-quote' });
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', result: { status: 'escalate', reason: 'invalid-worker-reply' }, receipt: { usage: { inputTokens: 20 }, childTerminationConfirmed: true } });
  });
  it('kills unexpected init capabilities immediately and releases only after death', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'bad-init' }, 'baseline', 4000);
    expect(result.status, result.stderr).toBe(2);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ status: 'failed', receipt: { isolationRejected: true, childTerminationConfirmed: true } });
    expect(output.receipt.durationMs).toBeLessThan(2500);
    expect(f.log().find(e => e.event === 'release')).toMatchObject({ alive: false });
  });
  it('kills a hanging native process on deadline and confirms death before release', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'hang' }, 'baseline', 200);
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', receipt: { childTerminationConfirmed: true } });
    expect(f.log().filter(e => e.event === 'launch')).toHaveLength(1);
    expect(f.run({}, 'worker', 200).stderr).toContain('prior failed or uncertain phase');
    expect(f.log().find(e => e.event === 'release')).toMatchObject({ alive: false });
  });
  it('retains a streamed usage receipt when the CLI hangs after returning it', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'result-hang' }, 'baseline', 300);
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', receipt: { resultEventSeen: true, reportedApiEquivalentCostUsd: .001, usage: { inputTokens: 20 }, chargeUncertain: false, childTerminationConfirmed: true } });
  });
  it('holds an exclusive checkpoint lock across the whole active phase', async () => {
    const f = fixture(), first = f.start({ NATIVE_BEHAVIOR: 'hang' }, 'baseline', 2000);
    await until(() => f.log().some(e => e.event === 'launch'));
    const second = f.run({}, 'baseline', 2000);
    expect(second.status).not.toBe(0); expect(second.stderr).toContain('EEXIST');
    expect(f.state().phases.baseline.status).toBe('started');
    expect(f.log().filter(e => e.event === 'reserve')).toHaveLength(1);
    expect(f.log().filter(e => e.event === 'launch')).toHaveLength(1);
    const completed = await first.completion;
    expect(completed.code, completed.stderr).toBe(2);
    expect(f.state().phases.baseline.status).toBe('failed');
    expect(existsSync(join(f.root, 'subscription.lock'))).toBe(false);
  });
  it.each(['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'])('rejects competing route %s before policy or launch', key => {
    const f = fixture(), result = f.run({ [key]: 'fixture-conflict' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('competing auth route');
    expect(f.log()).toEqual([]); expect(existsSync(join(f.root, 'state.json'))).toBe(false);
  });
  it('binds the selected executable bytes before any subsequent phase', () => {
    const f = fixture(); expect(f.run().status).toBe(0);
    appendFileSync(f.binary, '\n// changed executable identity\n');
    const changed = f.run({}, 'worker');
    expect(changed.status).not.toBe(0); expect(changed.stderr).toContain('changed experiment');
    expect(f.log().filter(e => e.event === 'launch')).toHaveLength(1);
    expect(f.state().phases).not.toHaveProperty('worker');
  });
  it('records API equivalent overrun as failure and never repeats it automatically', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'cost-overrun' });
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', receipt: { reportedApiEquivalentCostUsd: .051, costOverrun: true, usage: { inputTokens: 20 }, childTerminationConfirmed: true } });
    expect(f.run().status).not.toBe(0);
    expect(f.log().filter(e => e.event === 'launch')).toHaveLength(1);
  });
  it('rejects missing cost while retaining usage and cleaning the launch permit', () => {
    const f = fixture(), result = f.run({ NATIVE_BEHAVIOR: 'missing-cost' });
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', receipt: { usage: { inputTokens: 20 }, childTerminationConfirmed: true } });
    expect(f.log().find(e => e.event === 'release')).toMatchObject({ alive: false });
  });
  it('refuses observed policy denial even when enforcement would allow', () => {
    const f = fixture(), result = f.run({ NATIVE_OBSERVE_DENY: '1' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).receipt).toMatchObject({ policyMode: 'observe', policyOutcome: 'denied', policyEnforcedOutcome: 'allowed' });
    expect(f.log().map(e => e.event)).toEqual(['policy']);
  });
  it('honors an existing host policy denial before reservation', () => {
    const f = fixture(), result = f.run({ NATIVE_POLICY_DENY: '1' });
    expect(result.status, result.stderr).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'failed', receipt: { policyEnforcedOutcome: 'denied' } });
    expect(f.log().map(e => e.event)).toEqual(['policy']);
  });
});
