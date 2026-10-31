/** Test-only ephemeral signing helpers. Never import from production services. */
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonical, digest, observationOf, type Evidence } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
import { proofStrategy, type ProofPlan, type OracleObservation, type OracleReceipt } from '../v3/@claude-flow/cli/src/services/managed-proof.js';
export const keyPair = () => { const p=generateKeyPairSync('ed25519');return { private:p.privateKey, public:p.publicKey.export({format:'pem',type:'spki'}).toString() }; };
export const sourceHash=digest('proof-fixture-source'), evaluatorHash=digest('independent-proof-evaluator'), oracleHash=digest('oracle-implementation');
export const scope={taskType:'code-review' as const,policyHash:digest('fixed-policy'),evaluatorHash};
export function training(key:ReturnType<typeof keyPair>, outcomes?:Array<{hash:string;strategy:string;passed:boolean;durationMs:number}>) {
  const rows=outcomes??['baseline','strict'].flatMap(strategy=>Array.from({length:3},(_,i)=>({hash:digest('train'+i),strategy,passed:strategy==='strict'||i===0,durationMs:1})));
  return rows.map((r,i):Evidence=> {const observation=observationOf({v:1,attemptId:digest({i,r}),taskHash:r.hash,sourceHash,artifactHash:digest({r,artifact:true}),policyHash:scope.policyHash,corpusHash:digest('training-only'),evaluatorHash,taskType:'code-review',split:'train',trial:0,strategy:{id:r.strategy,model:'local-code',workers:1,template:'fixed'},budgetCents:1,costCents:1,durationMs:r.durationMs,checks:{acceptance:r.passed,safety:true,replay:true,adversarial:true,drift:0,driftThreshold:.05,rollbackRate:0}});return{observation,signature:sign(null,Buffer.from(canonical(observation)),key.private).toString('base64')};});
}
export function receipt(key:ReturnType<typeof keyPair>, plan:ProofPlan, taskId:string, arm:OracleObservation['arm'], patch:Partial<OracleObservation>={}):OracleReceipt {
  const task=plan.tasks.find(t=>t.id===taskId)!;
  const observation:OracleObservation={planHash:digest(plan),taskId,arm,strategyId:proofStrategy(plan,task,arm),sourceHash:plan.sourceHash,outputHash:digest({taskId,arm}),passed:true,safety:true,status:'finished',costMicros:1,latencyMs:1,...patch};
  return {observation,signature:sign(null,Buffer.from(canonical(observation)),key.private).toString('base64')};
}
