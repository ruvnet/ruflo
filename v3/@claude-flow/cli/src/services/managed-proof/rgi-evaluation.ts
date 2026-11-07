import { createHash } from 'node:crypto';

export interface EvaluationPair {
  taskId: string;
  domain: string;
  baselineSuccess: boolean;
  candidateSuccess: boolean;
  baselineCostMicros: number;
  candidateCostMicros: number;
  capabilityViolations: number;
}
export interface CandidateEvaluation {
  candidateId: string;
  baselineId: string;
  trainIds: string[];
  selectionIds: string[];
  auditIds: string[];
  pairs: EvaluationPair[];
  alpha: number;
  familySize: number;
  minPairs: number;
  maxCostRatio: number;
}
export interface PromotionDecision {
  promote: boolean;
  reason: string;
  wins: number;
  losses: number;
  pValue: number | null;
  adjustedAlpha: number;
  baselineSuccessRate: number;
  candidateSuccessRate: number;
  manifestSha256: string;
}
const LIMIT = 100_000;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const list = (value: unknown): value is string[] => Array.isArray(value)
  && value.length <= LIMIT && Array.from(value).every(validId) && new Set(value).size === value.length;

/** Exact one-sided paired sign test, accumulated in log space. Requires independent
 * task pairs under the null; repeated or correlated trials do not establish that. */
function binomialTail(wins: number, losses: number): number {
  const n = wins + losses;
  if (wins === 0) return 1;
  if (wins <= losses) return 1 - binomialTail(losses + 1, wins - 1);
  let term = -n * Math.LN2;
  for (let k = 1; k <= wins; k++) term += Math.log(n - k + 1) - Math.log(k);
  let total = term;
  for (let k = wins; k < n; k++) {
    term += Math.log(n - k) - Math.log(k + 1);
    total += Math.log1p(Math.exp(term - total));
  }
  // A positive tail is never reported as an exact zero due to underflow.
  return Math.max(Number.MIN_VALUE, Math.min(1, Math.exp(total)));
}

/** Host-owned evidence only. This hashes a canonical submitted manifest, not the
 * truth or provenance of scores. Caller must enforce sealed audit access, fresh
 * holdouts across runs, paired task independence and the complete search family. */
export function evaluateCandidate(input: CandidateEvaluation): PromotionDecision {
  const result: PromotionDecision = {
    promote: false, reason: 'invalid_input', wins: 0, losses: 0, pValue: null,
    adjustedAlpha: 0, baselineSuccessRate: 0, candidateSuccessRate: 0,
    manifestSha256: hash({ version: 1, invalid: true }),
  };
  const deny = (reason: string): PromotionDecision => ({ ...result, reason });
  try {
    if (!input || typeof input !== 'object' || !validId(input.candidateId)
      || !validId(input.baselineId) || input.candidateId === input.baselineId
      || !list(input.trainIds) || !list(input.selectionIds) || !list(input.auditIds)
      || !Array.isArray(input.pairs) || input.pairs.length > LIMIT
      || !Number.isFinite(input.alpha) || input.alpha <= 0 || input.alpha > 0.05
      || !count(input.familySize) || input.familySize < 1
      || !count(input.minPairs) || input.minPairs < 30 || input.minPairs > LIMIT
      || !Number.isFinite(input.maxCostRatio) || input.maxCostRatio <= 0)
      return deny('invalid_input');
    result.adjustedAlpha = input.alpha / input.familySize;
    if (result.adjustedAlpha === 0) return deny('invalid_alpha');
    const allIds = [...input.trainIds, ...input.selectionIds, ...input.auditIds];
    if (new Set(allIds).size !== allIds.length) return deny('holdout_overlap');
    if (input.auditIds.length < input.minPairs) return deny('insufficient_pairs');
    if (input.pairs.length !== input.auditIds.length) return deny('audit_mismatch');
    const audit = new Set(input.auditIds);
    const seen = new Set<string>();
    const pairs: EvaluationPair[] = [];
    let baselineCost = 0, candidateCost = 0, baselineSuccess = 0, candidateSuccess = 0;
    let violations = false;
    const domains = new Map<string, { baseline: number; candidate: number }>();
    for (const pair of input.pairs) {
      if (!pair || typeof pair !== 'object' || !validId(pair.taskId) || !validId(pair.domain)
        || typeof pair.baselineSuccess !== 'boolean' || typeof pair.candidateSuccess !== 'boolean'
        || !count(pair.baselineCostMicros) || !count(pair.candidateCostMicros)
        || !count(pair.capabilityViolations)) return deny('invalid_pair');
      if (seen.has(pair.taskId)) return deny('duplicate_task');
      if (!audit.has(pair.taskId)) return deny('audit_mismatch');
      seen.add(pair.taskId);
      baselineCost += pair.baselineCostMicros;
      candidateCost += pair.candidateCostMicros;
      if (!Number.isSafeInteger(baselineCost) || !Number.isSafeInteger(candidateCost))
        return deny('cost_overflow');
      baselineSuccess += Number(pair.baselineSuccess);
      candidateSuccess += Number(pair.candidateSuccess);
      result.wins += Number(pair.candidateSuccess && !pair.baselineSuccess);
      result.losses += Number(pair.baselineSuccess && !pair.candidateSuccess);
      violations ||= pair.capabilityViolations > 0;
      const domain = domains.get(pair.domain) ?? { baseline: 0, candidate: 0 };
      domain.baseline += Number(pair.baselineSuccess);
      domain.candidate += Number(pair.candidateSuccess);
      domains.set(pair.domain, domain);
      // Copy only typed fields: unknown self-reported claims have no authority.
      pairs.push({ taskId: pair.taskId, domain: pair.domain,
        baselineSuccess: pair.baselineSuccess, candidateSuccess: pair.candidateSuccess,
        baselineCostMicros: pair.baselineCostMicros, candidateCostMicros: pair.candidateCostMicros,
        capabilityViolations: pair.capabilityViolations });
    }
    result.baselineSuccessRate = baselineSuccess / pairs.length;
    result.candidateSuccessRate = candidateSuccess / pairs.length;
    result.manifestSha256 = hash({ version: 1, candidateId: input.candidateId,
      baselineId: input.baselineId, trainIds: [...input.trainIds].sort(),
      selectionIds: [...input.selectionIds].sort(), auditIds: [...input.auditIds].sort(),
      pairs: pairs.sort((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
      alpha: input.alpha, familySize: input.familySize, minPairs: input.minPairs,
      maxCostRatio: input.maxCostRatio });
    if (violations) return deny('capability_violation');
    if ([...domains.values()].some(domain => domain.candidate < domain.baseline))
      return deny('domain_regression');
    if ((baselineCost === 0 && candidateCost > 0)
      || (baselineCost > 0 && candidateCost / baselineCost > input.maxCostRatio))
      return deny('cost_regression');
    result.pValue = binomialTail(result.wins, result.losses);
    if (result.wins <= result.losses) return deny('no_improvement');
    if (result.pValue > result.adjustedAlpha) return deny('insufficient_significance');
    return { ...result, promote: true, reason: 'gate_passed' };
  } catch {
    return deny('invalid_input');
  }
}
