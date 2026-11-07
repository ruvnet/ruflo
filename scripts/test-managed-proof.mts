import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { registerProof,evaluateProof,proofStrategy,type ProofConfig } from '../v3/@claude-flow/cli/src/services/managed-proof.js';
import { keyPair,training,receipt,sourceHash,evaluatorHash,oracleHash,scope } from './managed-proof-fixtures.mjs';
const verifier=keyPair(),oracle=keyPair(),keys={verifier:verifier.public,oracle:oracle.public};
const roots:string[]=[];const root=()=>{const p=mkdtempSync(join(tmpdir(),'managed-proof-test-'));roots.push(p);return p;};
let assertions=0;const check=(v:unknown)=>{assert.ok(v);assertions++;};const rejects=(f:()=>unknown,pattern?:RegExp)=>{if(pattern)assert.throws(f,pattern);else assert.throws(f);assertions++;};
const config=(prefix='audit'):ProofConfig=>({sourceHash,evaluatorHash,oracleHash,baselineId:'baseline',strategies:['baseline','strict'],tasks:Array.from({length:40},(_,i)=>({id:prefix+i,inputHash:digest(prefix+i),family:prefix+'family'+i,domain:'code'})),seed:42,budgetMicros:1,timeoutMs:100,evidenceClass:'local-code',costOrigin:'synthetic-fixture'});
const admit=(r=root(),c=config())=>({r,plan:registerProof(r,c,training(verifier),scope,keys)});
const outcomes=(plan:ReturnType<typeof registerProof>)=>plan.tasks.flatMap((t,i)=>(['baseline','random','learned'] as const).map(arm=>receipt(oracle,plan,t.id,arm,{passed:proofStrategy(plan,t,arm)==='strict'||i===0})));
try {
  const {r,plan}=admit();check(plan.candidateId==='strict');check(plan.familySize===6);
  const result=evaluateProof(r,plan,outcomes(plan),keys);check(result.experimentEligible);check(result.claim==='inconclusive');check(result.promotionAuthorized===false);check(result.comparisons.every(c=>c.decision.pValue!==null&&c.decision.pValue<=.05/6));
  rejects(()=>evaluateProof(r,plan,outcomes(plan),keys),/already evaluated/);
  rejects(()=>registerProof(r,config(),training(verifier),scope,keys),/already consumed/);
  const c=config('second'); c.tasks[0]!.inputHash=plan.tasks[0]!.inputHash;rejects(()=>registerProof(r,c,training(verifier),scope,keys),/already consumed/);
  const leaked=config('leak');leaked.tasks[0]!.inputHash=training(verifier)[0]!.observation.taskHash;rejects(()=>registerProof(root(),leaked,training(verifier),scope,keys),/leakage/);
  rejects(()=>registerProof(root(),config(),training(verifier),scope,{verifier:verifier.public,oracle:verifier.public}),/Independent/);
  const wrong=config();wrong.evaluatorHash=digest('changed');rejects(()=>registerProof(root(),wrong,training(verifier),scope,keys),/Evaluator changed/);
  const unsigned=training(verifier);delete unsigned[0]!.signature;rejects(()=>registerProof(root(),config(),unsigned,scope,keys),/authenticated/);
  const mutation=admit();mutation.plan.seed=7;rejects(()=>evaluateProof(mutation.r,mutation.plan,[],keys),/mutated/);
  const spoof=admit();rejects(()=>evaluateProof(spoof.r,spoof.plan,[receipt(verifier,spoof.plan,spoof.plan.tasks[0]!.id,'learned')],keys),/Oracle authority/);
  const tampered=admit();const bad=receipt(oracle,tampered.plan,tampered.plan.tasks[0]!.id,'learned');bad.observation.passed=false;rejects(()=>evaluateProof(tampered.r,tampered.plan,[bad],keys),/Oracle authority/);
  const duplicate=admit();const row=receipt(oracle,duplicate.plan,duplicate.plan.tasks[0]!.id,'learned');rejects(()=>evaluateProof(duplicate.r,duplicate.plan,[row,row],keys),/Duplicate/);
  const missing=admit();const noRows=evaluateProof(missing.r,missing.plan,[],keys);check(noRows.missingOutcomes===120);check(!noRows.experimentEligible);check(noRows.counts.learned.passed===0);
  for(const patch of [{status:'timeout' as const},{status:'failed' as const},{costMicros:2},{latencyMs:101},{safety:false}]){const a=admit();const rows=outcomes(a.plan);const i=rows.findIndex(r=>r.observation.arm==='learned');rows[i]=receipt(oracle,a.plan,rows[i]!.observation.taskId,'learned',patch);const denied=evaluateProof(a.r,a.plan,rows,keys);check(!denied.experimentEligible);check(denied.counts.learned.passed===39);}
  const slow=admit();const slowRows=outcomes(slow.plan);let slowCount=0;for(let i=0;i<slowRows.length;i++){if(slowRows[i]!.observation.arm==='learned'&&slowCount++<3)slowRows[i]=receipt(oracle,slow.plan,slowRows[i]!.observation.taskId,'learned',{latencyMs:99});}const regression=evaluateProof(slow.r,slow.plan,slowRows,keys);check(regression.counts.learned.passed===40);check(!regression.experimentEligible);check(regression.comparisons.every(c=>!c.latencyNoRegression&&c.learnedP95Ms===99));
  const staticBest=admit();const equalRows=staticBest.plan.tasks.flatMap(t=>(['baseline','random','learned'] as const).map(arm=>receipt(oracle,staticBest.plan,t.id,arm,{passed:true,costMicros:arm==='learned'?0:1})));const costOnly=evaluateProof(staticBest.r,staticBest.plan,equalRows,keys);check(costOnly.counts.learned.costMicros<costOnly.counts.baseline.costMicros);check(!costOnly.experimentEligible);check(costOnly.comparisons.every(c=>c.relativeLift===0));
  const clustered=config();clustered.tasks.forEach(t=>t.family='correlated');const a=admit(root(),clustered);const under=evaluateProof(a.r,a.plan,outcomes(a.plan),keys);check(under.independentFamilies===1);check(under.comparisons.every(c=>c.decision.reason==='insufficient_pairs'));
  const campaign=root();for(let i=0;i<3;i++){const p=registerProof(campaign,config('round'+i),training(verifier),scope,keys);check(p.round===i+1);}rejects(()=>registerProof(campaign,config('round4'),training(verifier),scope,keys),/exhausted/);
  const poisoned=training(verifier,[{hash:plan.tasks[0]!.inputHash,strategy:'strict',passed:true,durationMs:1},...['a','b','c'].map(hash=>({hash:digest(hash),strategy:'strict',passed:true,durationMs:1}))]);rejects(()=>registerProof(r,config('fresh'),poisoned,scope,keys),/cannot become training/);
  const live=config();live.evidenceClass='live-provider';live.costOrigin='metered';const actual=admit(root(),live);check(evaluateProof(actual.r,actual.plan,outcomes(actual.plan),keys).claim==='bounded-live-improvement');
  console.log(JSON.stringify({assertions,passed:true,positiveResultsAreSyntheticFixtures:true,defaultsChanged:false}));
}finally{for(const p of roots)rmSync(p,{recursive:true,force:true});}
