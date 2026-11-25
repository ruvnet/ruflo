/** Executes existing Ruflo functions in separate processes. This is local-code evidence, not live LLM performance. */
import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { mkdirSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonical,digest,isVerified,observationOf,type Evidence } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { cycleLearning } from '../v3/@claude-flow/cli/src/services/managed-learning-loop.js';
import { registerProof,evaluateProof,proofStrategy,type OracleObservation,type OracleReceipt,type ProofConfig } from '../v3/@claude-flow/cli/src/services/managed-proof.js';
import { keyPair } from './managed-proof-fixtures.mjs';
import { workloads,type Workload } from './managed-proof-workloads.mjs';
const here=dirname(fileURLToPath(import.meta.url)),worker=join(here,'managed-proof-worker.mjs');
const sourceFiles=['../v3/@claude-flow/cli/src/services/managed-learning.js','../v3/@claude-flow/cli/src/services/harness-benchmark.js'];
const sourceHash=digest(sourceFiles.map(f=>({file:f,hash:digest(readFileSync(join(here,f),'utf8'))}))),evaluatorHash=digest(readFileSync(fileURLToPath(import.meta.url),'utf8')),oracleHash=digest(readFileSync(join(here,'managed-proof-workloads.mjs'),'utf8'));
const verifier=keyPair(),oracle=keyPair(),keys={verifier:verifier.public,oracle:oracle.public};
const root=mkdtempSync(join(tmpdir(),'managed-real-code-proof-')),scope={taskType:'code-review' as const,policyHash:digest('equal-budget-no-promotion'),evaluatorHash};
let assertions=0,executions=0;const check=(v:unknown)=>{assert.ok(v);assertions++;};
function execute(strategy:string,task:Workload){
  const publicInput={kind:task.kind,value:task.value};const started=performance.now();
  const child=spawnSync(process.execPath,[worker,strategy,JSON.stringify(publicInput)],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:2000,maxBuffer:4096});executions++;
  let answer:unknown;try{answer=JSON.parse(child.stdout);}catch{answer=null;}
  const shaped=!!answer&&typeof answer==='object'&&Object.keys(answer).length===1&&typeof(answer as {accepted:unknown}).accepted==='boolean';
  return {passed:child.status===0&&shaped&&(answer as {accepted:boolean}).accepted===task.expected,weakAcceptance:child.status===0&&shaped,outputHash:digest({stdout:child.stdout,status:child.status,signal:child.signal}),latencyMs:Math.ceil(performance.now()-started),status:child.error?.message.includes('ETIMEDOUT')?'timeout' as const:child.status===0?'finished' as const:'failed' as const};
}
try{
  mkdirSync(join(root,'learning'));mkdirSync(join(root,'weak-learning'));
  const trainTasks=workloads(0,true),training:Evidence[]=[];
  for(const strategy of ['baseline','strict'])for(const [i,task]of trainTasks.entries()){
    const result=execute(strategy,task),observation=observationOf({v:1,attemptId:digest({strategy,i}),taskHash:digest({kind:task.kind,value:task.value}),sourceHash,artifactHash:result.outputHash,policyHash:scope.policyHash,corpusHash:digest(trainTasks.map(t=>({kind:t.kind,value:t.value}))),evaluatorHash,taskType:'code-review',split:'train',trial:0,strategy:{id:strategy,model:'local-code',workers:1,template:'fixed'},budgetCents:1,costCents:1,durationMs:result.latencyMs,checks:{acceptance:result.passed,safety:true,replay:true,adversarial:true,drift:0,driftThreshold:.05,rollbackRate:0}});
    training.push({observation,signature:sign(null,Buffer.from(canonical(observation)),verifier.private).toString('base64')});
  }
  const cycle=await cycleLearning(join(root,'learning'),{scope,evidence:training,index:false},verifier.public,()=>true);
  check(cycle.recommendation.selected?.strategy.id==='strict');check(!cycle.defaultsChanged);
  const reports=[];let weakFalsePositives=0;
  for(let round=1;round<=2;round++){
    const tasks=workloads(round),descriptors=tasks.map((t,i)=>({id:'round'+round+'task'+i,inputHash:digest({kind:t.kind,value:t.value}),family:t.kind,domain:t.kind==='gate'?'governance':'validation'}));
    const config:ProofConfig={sourceHash,evaluatorHash,oracleHash,baselineId:'baseline',strategies:['baseline','strict'],tasks:descriptors,seed:100+round,budgetMicros:1,timeoutMs:2000,evidenceClass:'local-code',costOrigin:'synthetic-fixture'};
    const plan=registerProof(join(root,'campaign'),config,training,scope,keys);
    const receipts:OracleReceipt[]=[];let staticBestPassed=0;
    for(const task of tasks)staticBestPassed+=Number(execute('strict',task).passed);
    // Rotate execution order deterministically; oracle labels stay in this host process.
    for(const [i,task]of tasks.entries())for(const arm of (round===1?['random','baseline','learned']:['learned','baseline','random']) as OracleObservation['arm'][]){
      const descriptor=descriptors[i]!,strategy=proofStrategy(plan,descriptor,arm),result=execute(strategy,task);
      if(result.weakAcceptance&&!result.passed)weakFalsePositives++;
      const observation:OracleObservation={planHash:digest(plan),taskId:descriptor.id,arm,strategyId:strategy,sourceHash,outputHash:result.outputHash,passed:result.passed,safety:true,status:result.status,costMicros:1,latencyMs:result.latencyMs};
      receipts.push({observation,signature:sign(null,Buffer.from(canonical(observation)),oracle.private).toString('base64')});
    }
    const report=evaluateProof(join(root,'campaign'),plan,receipts,keys);reports.push({...report,staticBest:{strategy:'strict',passed:staticBestPassed,total:tasks.length},adaptiveAdvantageOverStaticBest:report.counts.learned.passed-staticBestPassed});check(staticBestPassed===report.counts.learned.passed);
    check(report.claim==='inconclusive');check(report.independentFamilies===5);check(report.comparisons.every(c=>c.decision.reason==='insufficient_pairs'));check(report.counts.learned.passed===30);check(!report.defaultsChanged);
    assert.throws(()=>registerProof(join(root,'campaign'),config,training,scope,keys));assertions++;
  }
  check(weakFalsePositives>0);
  const replay=await cycleLearning(join(root,'learning'),{scope,evidence:training,index:false},verifier.public,()=>true);check(replay.duplicates.length===20);
  // A valid signature on an intentionally weak verdict is still not correctness.
  const weak=training.map(e=>{const observation={...e.observation,budgetCents:2,costCents:e.observation.strategy.id==='baseline'?1:2,checks:{...e.observation.checks,acceptance:true}};return{observation,signature:sign(null,Buffer.from(canonical(observation)),verifier.private).toString('base64')};});
  check(weak.every(e=>isVerified(e,verifier.public)));
  const poisoned=await cycleLearning(join(root,'weak-learning'),{scope,evidence:weak,index:false},verifier.public,()=>true);
  check(poisoned.recommendation.selected?.strategy.id==='baseline');
  console.log(JSON.stringify({schema:'ruflo.managed-learning-proof/v1',assertions,executions,trainingRows:training.length,selected:cycle.recommendation.selected?.strategy.id,weakVerifierFalsePositives:weakFalsePositives,validSignatureIsCorrectness:false,weakSignedTrainingSelected:poisoned.recommendation.selected?.strategy.id,adaptiveAdvantageOverStaticBest:0,replayDuplicates:replay.duplicates.length,rounds:reports,liveProviderCalls:0,liveImprovementProven:false,defaultsChanged:false,limitations:'Existing Ruflo functions executed in subprocesses; baseline is a deliberately shallow validator. Only five correlated source families, synthetic cost units, no LLM tasks or provider billing. Both rounds correctly remain inconclusive; repeated inputs are not independent tasks. Separate processes omit oracle labels and keys but are not an OS security sandbox.'},null,2));
}finally{rmSync(root,{recursive:true,force:true});}
