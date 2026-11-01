import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const owned: string[] = [];
afterEach(()=>{for(const p of owned.splice(0))rmSync(p,{recursive:true,force:true});});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ruflo-context-pilot-'));owned.push(dir);
 const cli=join(dir,'v3/@claude-flow/cli'), here=join(cli,'benchmarks/context-delegation');
 mkdirSync(here,{recursive:true});mkdirSync(join(cli,'src/services'),{recursive:true});mkdirSync(join(cli,'dist/src/services'),{recursive:true});mkdirSync(join(dir,'checkpoint'),{mode:0o700});
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');writeFileSync(join(dir,'package-lock.json'),'{}');
 writeFileSync(join(dir,'.git'),'gitdir: '+execFileSync('git',['rev-parse','--absolute-git-dir'],{cwd:root,encoding:'utf8'}).trim()+'\n');
 for(const name of ['provider-pilot.mjs','corpus.json'])copyFileSync(join(root,'v3/@claude-flow/cli/benchmarks/context-delegation',name),join(here,name));
 for(const name of ['context-delegation.ts','anthropic-context-adapter.ts','global-ai-budget.ts'])copyFileSync(join(root,'v3/@claude-flow/cli/src/services',name),join(cli,'src/services',name));
 writeFileSync(join(cli,'dist/src/index.js'),`import {readFileSync,writeFileSync} from 'node:fs';
 export function createAnthropicContextAdapter(o){return {o,r:[],receipts(){return this.r;}};}
 export async function delegateContextRead({adapter,signal}){
 const log=process.env.PILOT_CALL_LOG;let count=0;try{count=Number(readFileSync(log,'utf8'));}catch{}
 const allowed=await adapter.o.authorize({model:'claude-fixture',endpoints:[],sourceHashes:[],requestSha256:'fixture',totalRequestBytes:1,inputTokenCeiling:1,outputTokenCeiling:1,costCeilingUsd:0.001},signal);
 if(!allowed)return {status:'escalate',plan:{route:'delegate',reason:'fixture'},reason:'authorization-failed'};
 if(process.env.FIXTURE_BUDGET_BLOCK==='1'&&count===2){adapter.r.push({status:'failed',stage:'budget'});return {status:'escalate',reason:'budget'};}
 writeFileSync(log,String(count+1));
 if(process.env.FIXTURE_UNKNOWN==='1')return {status:'escalate',reason:'timeout'};
 adapter.r.push({status:'succeeded',stage:'complete',usage:{inputTokens:1,outputTokens:1},usagePricedCostUsd:0.001});
 return {status:'delegated',findings:[{answer:'fixture',quote:'fixture'}],receipt:{fixture:true}};
 }`);
 copyFileSync(join(cli,'dist/src/index.js'),join(cli,'dist/src/alternate.js'));
 writeFileSync(join(cli,'dist/src/services/policy-runtime.js'),`import {readFileSync} from 'node:fs';export function loadPolicyState(){return {mode:'enforce'};}export async function authorizeMcpTool(){let count=0;try{count=Number(readFileSync(process.env.PILOT_CALL_LOG,'utf8'));}catch{}return {mode:process.env.FIXTURE_OBSERVE==='1'&&count>0?'observe':'enforce',enforcedOutcome:'allowed'};}`);
 const config=join(dir,'config.json'),state=join(dir,'checkpoint/state.json'),calls=join(dir,'calls');
 writeFileSync(config,JSON.stringify({coordinator:{model:'claude-fixture'},worker:{model:'claude-fixture'},maxCostUsdPerCall:.1}));
 writeFileSync(join(dir,'durability-failure.cjs'),"const fs=require('node:fs');fs.fsyncSync=()=>{throw new Error('fixture fsync failure')};require('node:module').syncBuiltinESMExports();");
 const run=(env:Record<string,string>={})=>spawnSync(process.execPath,[...(env.FIXTURE_FSYNC_FAIL==='1'?['--require',join(dir,'durability-failure.cjs')]:[]),join(here,'provider-pilot.mjs'),'--execute','--config',config,'--state',state,...(env.FIXTURE_ALT_RUNTIME==='1'?['--runtime',join(cli,'dist/src/alternate.js')]:[])],{encoding:'utf8',env:{...process.env,ANTHROPIC_API_KEY:'fixture-only-not-real',PILOT_CALL_LOG:calls,...env},timeout:10000});
 return {dir,cli,here,state,calls,run};
}
it('executes all three phases through built runtime exports and resumes completed state without calls',()=>{const f=fixture(),result=f.run();expect(result.status,result.stderr).toBe(0);const output=JSON.parse(result.stdout);expect(output.accounting).toMatchObject({baselineUsagePricedCostUsd:.001,candidateUsagePricedCostUsd:.002,usagePricedCostReductionPct:-100,humanReviewRequired:true,invoiceReconciled:false});expect(readFileSync(f.calls,'utf8')).toBe('3');const state=JSON.parse(readFileSync(f.state,'utf8'));expect(Object.values(state.phases).map((p:any)=>p.status)).toEqual(['complete','complete','complete']);expect(state.requestedMaximumUsd).toBeCloseTo(.3);expect(state.runtimeManifest).toHaveProperty('src/index.js');expect(f.run().status).toBe(0);expect(readFileSync(f.calls,'utf8')).toBe('3');});
it('refuses an observe-mode decision even after initial enforce preflight',()=>{const f=fixture(),result=f.run({FIXTURE_OBSERVE:'1'});expect(result.status).toBe(2);expect(readFileSync(f.calls,'utf8')).toBe('1');expect(JSON.parse(readFileSync(f.state,'utf8')).phases.worker.status).toBe('failed');});
it('rejects changed runtime before resuming paid phases',()=>{const f=fixture();expect(f.run().status).toBe(0);appendFileSync(join(f.cli,'dist/src/index.js'),'\n// changed');const result=f.run();expect(result.status).not.toBe(0);expect(result.stderr).toContain('checkpoint/config mismatch');expect(readFileSync(f.calls,'utf8')).toBe('3');});
it('saves uncertainty and never automatically repeats an unreceipted failed call',()=>{const f=fixture();expect(f.run({FIXTURE_UNKNOWN:'1'}).status).toBe(2);const state=JSON.parse(readFileSync(f.state,'utf8'));expect(state.phases.baseline.chargeUncertain).toBe(true);expect(f.run().status).not.toBe(0);expect(readFileSync(f.calls,'utf8')).toBe('1');});
it('resumes a quota blocked final phase without repeating prior calls',()=>{const f=fixture();expect(f.run({FIXTURE_BUDGET_BLOCK:'1'}).status).toBe(2);expect(readFileSync(f.calls,'utf8')).toBe('2');expect(JSON.parse(readFileSync(f.state,'utf8')).phases.routedCoordinator.status).toBe('blocked');expect(f.run().status).toBe(0);expect(readFileSync(f.calls,'utf8')).toBe('3');});

it('fails before any model call if durable intent cannot be synced',()=>{const f=fixture(),result=f.run({FIXTURE_FSYNC_FAIL:'1'});expect(result.status).not.toBe(0);expect(result.stderr).toContain('fixture fsync failure');expect(()=>readFileSync(f.calls)).toThrow();});

it('binds the selected entrypoint even when the dist tree is unchanged',()=>{const f=fixture();expect(f.run().status).toBe(0);const result=f.run({FIXTURE_ALT_RUNTIME:'1'});expect(result.status).not.toBe(0);expect(result.stderr).toContain('checkpoint/config mismatch');expect(readFileSync(f.calls,'utf8')).toBe('3');});
