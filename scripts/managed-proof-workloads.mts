/** Host-owned labelled cases, never imported by the executor worker. Five correlated source families. */
import { digest, type Observation } from '../v3/@claude-flow/cli/src/services/managed-learning.js';
export type Workload={kind:string;value:unknown;expected:boolean};
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
export function workloads(round:number,train=false):Workload[]{
  const hash=(n:string)=>digest({round,train,n});
  const observation:Observation={v:1,attemptId:hash('attempt'),taskHash:hash('task'),sourceHash:hash('source'),artifactHash:hash('artifact'),policyHash:hash('policy'),corpusHash:hash('corpus'),evaluatorHash:hash('evaluator'),taskType:'code-review',split:'train',trial:train?0:round+1,strategy:{id:'strict',model:'local-code',workers:1,template:'fixed'},budgetCents:100+round,costCents:10+round,durationMs:10+round,checks:{acceptance:true,safety:true,replay:true,adversarial:true,drift:0,driftThreshold:.05,rollbackRate:0}};
  const valid:Record<string,unknown>={scope:{taskType:'code-review',policyHash:hash('policy'),evaluatorHash:hash('eval')},manifest:{taskHashes:[hash('one'),hash('two')],trials:[round*3,round*3+1,round*3+2]},observation,evidence:{observation},gate:{heldOutScore:train?.6:.8+round/1000,baselineHeldOutScore:.5,redblue:'PASS',drift:0,driftThreshold:.05,replayDeterministic:true,receiptCoverage:1,canaryRollbackRate:0,baselineRollbackRate:0}};
  const bad:Record<string,unknown[]>={
    scope:[{...valid.scope as object,taskType:'unknown'+round},{...valid.scope as object,policyHash:'invalid'+round},{...valid.scope as object,evaluatorHash:'bad'+round},{...valid.scope as object,extra:round}],
    manifest:[{taskHashes:[hash('one')],trials:[0,1,2]},{taskHashes:[hash('one'),hash('one')],trials:[0,1,2]},{taskHashes:[hash('one'),hash('two')],trials:[0,1]},{taskHashes:[hash('one'),hash('two')],trials:[0,1,100+round]}],
    observation:[{...observation,budgetCents:-1-round},{...observation,trial:100+round},{...observation,strategy:{...observation.strategy,workers:65+round}},{...observation,checks:{...observation.checks,safety:'true'}}],
    evidence:[{observation,signature:'invalid'+round},{observation,extra:round},{observation:{...observation,taskType:'invalid'+round}},{observation:{...observation,checks:{...observation.checks,drift:2+round}}}],
    gate:[{...valid.gate as object,redblue:'FAIL',drift:round/100},{...valid.gate as object,replayDeterministic:false,drift:round/100},{...valid.gate as object,receiptCoverage:.5+round/100},{...valid.gate as object,canaryRollbackRate:.5+round/100}]
  };
  return Object.entries(valid).flatMap(([kind,value])=>{
    if(train)return[{kind,value,expected:true},{kind,value:{...value as object,unexpectedTrainingOnly:round},expected:kind==='gate'}];
    const changed=clone(value) as Record<string,unknown>;
    if(kind==='scope')changed.taskType='research';
    if(kind==='manifest')changed.trials=[10+round,20+round,30+round];
    if(kind==='observation')changed.costCents=11+round;
    if(kind==='evidence')(changed.observation as Observation).costCents=11+round;
    if(kind==='gate')changed.heldOutScore=.9+round/1000;
    return [{kind,value,expected:true},{kind,value:changed,expected:true},...bad[kind]!.map(value=>({kind,value,expected:false}))];
  });
}
