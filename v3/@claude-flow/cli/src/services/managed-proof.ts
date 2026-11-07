/** Host evaluation API, deliberately absent from MCP and automatic promotion. */
import { createPublicKey, verify } from 'node:crypto';
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest, recommend, trustedEvidence, scopeOf, type Evidence, type Scope } from './managed-learning.js';
import { evaluateCandidate } from './managed-proof/rgi-evaluation.js';

export type ProofTask = { id: string; inputHash: string; family: string; domain: string };
export type ProofConfig = {
  sourceHash: string; evaluatorHash: string; oracleHash: string; baselineId: string;
  strategies: string[]; tasks: ProofTask[]; seed: number; budgetMicros: number; timeoutMs: number;
  evidenceClass: 'local-code' | 'live-provider'; costOrigin: 'synthetic-fixture' | 'metered';
};
export type ProofPlan = ProofConfig & {
  v: 1; round: number; candidateId: string; trainingDigest: string; trainingTaskHashes: string[];
  scope: Scope; alpha: number; familySize: number; minFamilies: number; minRelativeLift: number;
};
export type OracleObservation = {
  planHash: string; taskId: string; arm: 'baseline' | 'random' | 'learned'; strategyId: string;
  sourceHash: string; outputHash: string; passed: boolean; safety: boolean;
  status: 'finished' | 'failed' | 'timeout'; costMicros: number; latencyMs: number;
};
export type OracleReceipt = { observation: OracleObservation; signature: string };
type Registry = { v: 1; oracleKeyHash: string; verifierKeyHash: string; plans: Array<{ hash: string; tasks: string[]; inputs: string[]; evaluated: boolean }> };
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const integer = (n: unknown, min: number, max: number): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
const publicHash = (pem: string) => { const key = createPublicKey(pem); if (key.asymmetricKeyType !== 'ed25519') throw Error('Ed25519 host key required'); return digest(key.export({ type: 'spki', format: 'der' }).toString('base64')); };
function regular(path: string): void { const s = lstatSync(path); if (s.isSymbolicLink() || !s.isFile() || s.size > 2_000_000) throw Error('Invalid proof registry'); }
/** Exclusive fail-fast transaction, bounded registry and atomic fsync. Same-user filesystem adversaries require OS isolation. */
function transaction<T>(root: string, keys: { verifier: string; oracle: string }, fn: (state: Registry) => T): T {
  if (publicHash(keys.verifier) === publicHash(keys.oracle)) throw Error('Independent oracle and verifier keys required');
  if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error('Invalid host proof directory');
  const path = join(root, 'proof-registry.json'), lock = join(root, 'proof-registry.lock'), temp = join(root, 'proof-registry.tmp');
  const fd = openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    const oracleKeyHash = publicHash(keys.oracle), verifierKeyHash = publicHash(keys.verifier);
    let state: Registry = { v: 1, oracleKeyHash, verifierKeyHash, plans: [] };
    if (existsSync(path)) { regular(path); state = JSON.parse(readFileSync(path, 'utf8')); }
    if (state.v !== 1 || state.oracleKeyHash !== oracleKeyHash || state.verifierKeyHash !== verifierKeyHash || !Array.isArray(state.plans) || state.plans.length > 3) throw Error('Proof registry authority or schema changed');
    const result = fn(state);
    const out = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { writeFileSync(out, JSON.stringify(state)); fsyncSync(out); } finally { closeSync(out); }
    renameSync(temp, path);
    const dir = openSync(root, constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
    return result;
  } finally { closeSync(fd); unlinkSync(lock); }
}
function configOf(value: ProofConfig): ProofConfig {
  const c = structuredClone(value);
  if (Object.keys(c).sort().join(',') !== 'baselineId,budgetMicros,costOrigin,evaluatorHash,evidenceClass,oracleHash,seed,sourceHash,strategies,tasks,timeoutMs' || ![c.sourceHash,c.evaluatorHash,c.oracleHash].every(h => typeof h === 'string' && HASH.test(h)) || !ID.test(c.baselineId) || !Array.isArray(c.strategies) || c.strategies.length < 2 || c.strategies.length > 8 || new Set(c.strategies).size !== c.strategies.length || c.strategies.some(s => !ID.test(s)) || !c.strategies.includes(c.baselineId) || !integer(c.seed,0,0xffffffff) || !integer(c.budgetMicros,1,1_000_000_000) || !integer(c.timeoutMs,1,120_000) || !['local-code','live-provider'].includes(c.evidenceClass) || !['synthetic-fixture','metered'].includes(c.costOrigin)) throw Error('Invalid frozen proof configuration');
  if (!Array.isArray(c.tasks) || c.tasks.length < 1 || c.tasks.length > 300 || new Set(c.tasks.map(t=>t.id)).size !== c.tasks.length || new Set(c.tasks.map(t=>t.inputHash)).size !== c.tasks.length || c.tasks.some(t => Object.keys(t).sort().join(',') !== 'domain,family,id,inputHash' || !ID.test(t.id) || !ID.test(t.family) || !ID.test(t.domain) || !HASH.test(t.inputHash))) throw Error('Invalid independent audit tasks');
  c.tasks.sort((a,b)=>a.id.localeCompare(b.id));
  return c;
}
/** Persist reservation BEFORE exposing audit inputs or running arms. Holdouts stay consumed even after crashes/failure. */
export function registerProof(root: string, value: ProofConfig, training: Evidence[], scope: Scope, keys: { verifier: string; oracle: string }): ProofPlan {
  const c = configOf(value), s = scopeOf(scope), trusted = trustedEvidence(training, keys.verifier);
  if (trusted.length !== training.length || trusted.length === 0 || trusted.some(e => e.observation.split !== 'train' || e.observation.sourceHash !== c.sourceHash || e.observation.policyHash !== s.policyHash || e.observation.evaluatorHash !== s.evaluatorHash || e.observation.taskType !== s.taskType)) throw Error('Exact authenticated training cohort required');
  if (c.evaluatorHash !== s.evaluatorHash) throw Error('Evaluator changed between training and audit');
  const choice = recommend(trusted,s).selected?.strategy.id;
  if (!choice || !c.strategies.includes(choice)) throw Error('No admissible learned strategy');
  const trainingTaskHashes = [...new Set(trusted.map(e=>e.observation.taskHash))].sort();
  if (c.tasks.some(t=>trainingTaskHashes.includes(t.inputHash))) throw Error('Training audit leakage');
  return transaction(root,keys,state=> {
    if (state.plans.some(p=>trainingTaskHashes.some(h=>p.inputs.includes(h)))) throw Error('Consumed audit data cannot become training evidence');
    if (state.plans.length >= 3) throw Error('Proof loop exhausted; preregister a new independent campaign');
    if (state.plans.some(p=>c.tasks.some(t=>p.tasks.includes(t.id) || p.inputs.includes(t.inputHash)))) throw Error('Audit holdout already consumed');
    const plan: ProofPlan = { ...c,v:1,round:state.plans.length+1,candidateId:choice,trainingDigest:digest(trusted.map(e=>digest(e.observation)).sort()),trainingTaskHashes,scope:s,alpha:.05,familySize:6,minFamilies:30,minRelativeLift:.10 };
    state.plans.push({ hash:digest(plan),tasks:c.tasks.map(t=>t.id),inputs:c.tasks.map(t=>t.inputHash),evaluated:false });
    return plan;
  });
}
/** Seeded task-level random control is selected before outcomes, independent of execution order. */
export function proofStrategy(plan: ProofPlan, task: ProofTask, arm: OracleObservation['arm']): string {
  if (arm === 'baseline') return plan.baselineId;
  if (arm === 'learned') return plan.candidateId;
  return plan.strategies[parseInt(digest({ seed:plan.seed,task:task.id }).slice(0,8),16)%plan.strategies.length]!;
}
function receiptOf(raw: OracleReceipt, plan: ProofPlan, oracleKey: string): OracleObservation {
  const e = raw?.observation;
  if (!raw || Object.keys(raw).sort().join(',') !== 'observation,signature' || !e || Object.keys(e).sort().join(',') !== 'arm,costMicros,latencyMs,outputHash,passed,planHash,safety,sourceHash,status,strategyId,taskId' || e.planHash !== digest(plan) || e.sourceHash !== plan.sourceHash || !HASH.test(e.outputHash) || !plan.tasks.some(t=>t.id===e.taskId) || !['baseline','random','learned'].includes(e.arm) || !['finished','failed','timeout'].includes(e.status) || typeof e.passed !== 'boolean' || typeof e.safety !== 'boolean' || !integer(e.costMicros,0,1_000_000_000) || !integer(e.latencyMs,0,120_001) || typeof raw.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(raw.signature)) throw Error('Invalid independent oracle receipt');
  const task = plan.tasks.find(t=>t.id===e.taskId)!;
  if (e.strategyId !== proofStrategy(plan,task,e.arm) || !verify(null,Buffer.from(canonical(e)),oracleKey,Buffer.from(raw.signature,'base64'))) throw Error('Oracle authority or strategy mismatch');
  return e;
}
/** Consume evaluation once. Failed/missing/timed-out results count as failures, never disappear from the denominator. */
export function evaluateProof(root: string, plan: ProofPlan, receipts: OracleReceipt[], keys: { verifier: string; oracle: string }) {
  return transaction(root,keys,state=> {
    const registered = state.plans.find(p=>p.hash===digest(plan));
    if (!registered || registered.evaluated) throw Error('Unknown, mutated or already evaluated proof plan');
    if (!Array.isArray(receipts) || receipts.length > plan.tasks.length*3) throw Error('Proof receipt bound exceeded');
    const rows = receipts.map(r=>receiptOf(r,plan,keys.oracle));
    if (new Set(rows.map(r=>r.taskId+':'+r.arm)).size !== rows.length) throw Error('Duplicate audit outcome');
    registered.evaluated = true;
    const success = (r: OracleObservation | undefined) => !!r && r.status==='finished' && r.passed && r.safety && r.costMicros<=plan.budgetMicros && r.latencyMs<=plan.timeoutMs;
    const row = (taskId:string,arm:string)=>rows.find(r=>r.taskId===taskId&&r.arm===arm);
    const families = [...new Set(plan.tasks.map(t=>t.family))].sort();
    if (families.some(f=>new Set(plan.tasks.filter(t=>t.family===f).map(t=>t.domain)).size!==1)) throw Error('Family crosses independent domains');
    const p95 = (arm:OracleObservation['arm']) => plan.tasks.map(t=>row(t.id,arm)?.latencyMs??plan.timeoutMs).sort((a,b)=>a-b)[Math.ceil(plan.tasks.length*.95)-1]!;
    const comparisons = (['baseline','random'] as const).map(control=> {
      const pairs = families.map(f=> {
        const tasks = plan.tasks.filter(t=>t.family===f);
        const aggregate = (arm:OracleObservation['arm'])=>tasks.every(t=>success(row(t.id,arm)));
        const cost = (arm:OracleObservation['arm'])=>tasks.reduce((n,t)=>n+(row(t.id,arm)?.costMicros??plan.budgetMicros),0);
        return { taskId:f,domain:tasks[0]!.domain,baselineSuccess:aggregate(control),candidateSuccess:aggregate('learned'),baselineCostMicros:cost(control),candidateCostMicros:cost('learned'),capabilityViolations:tasks.some(t=>!row(t.id,'learned')?.safety)?1:0 };
      });
      const decision = evaluateCandidate({ candidateId:'learned',baselineId:control,trainIds:plan.trainingTaskHashes,selectionIds:[],auditIds:families,pairs,alpha:plan.alpha,familySize:plan.familySize,minPairs:plan.minFamilies,maxCostRatio:1 });
      const baselineSuccess = pairs.filter(p=>p.baselineSuccess).length, learnedSuccess = pairs.filter(p=>p.candidateSuccess).length;
      const relativeLift = baselineSuccess ? learnedSuccess/baselineSuccess-1 : null;
      // Keep the existing Ruflo per-task no-regression rule stricter than rGi's domain aggregate.
      const noRegression = plan.tasks.every(t=>!success(row(t.id,control))||success(row(t.id,'learned')));
      const latencyNoRegression = p95('learned')<=p95(control);
      return { control,decision,relativeLift,noRegression,latencyNoRegression,baselineP95Ms:p95(control),learnedP95Ms:p95('learned'),eligible:decision.promote&&relativeLift!==null&&relativeLift>=plan.minRelativeLift-Number.EPSILON&&noRegression&&latencyNoRegression };
    });
    const counts = Object.fromEntries((['baseline','random','learned'] as const).map(arm=>[arm,{ passed:plan.tasks.filter(t=>success(row(t.id,arm))).length,total:plan.tasks.length,costMicros:plan.tasks.reduce((n,t)=>n+(row(t.id,arm)?.costMicros??plan.budgetMicros),0),p95Ms:p95(arm) }]));
    const experimentEligible = comparisons.every(c=>c.eligible);
    return { planHash:digest(plan),round:plan.round,independentFamilies:families.length,counts,comparisons,missingOutcomes:plan.tasks.length*3-rows.length,experimentEligible,
      claim:experimentEligible&&plan.evidenceClass==='live-provider'&&plan.costOrigin==='metered'?'bounded-live-improvement':'inconclusive',
      reason:!experimentEligible?'Independent evidence, statistical significance, effect, cost or no-regression gate not satisfied':plan.evidenceClass!=='live-provider'||plan.costOrigin!=='metered'?'Local mechanism or synthetic-cost evidence cannot establish live agent improvement':'All preregistered gates satisfied within this campaign',
      defaultsChanged:false,promotionAuthorized:false };
  });
}
