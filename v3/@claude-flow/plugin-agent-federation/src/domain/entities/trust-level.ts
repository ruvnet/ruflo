export enum TrustLevel {
  UNTRUSTED = 0,
  VERIFIED = 1,
  ATTESTED = 2,
  TRUSTED = 3,
  PRIVILEGED = 4,
}

export interface TrustTransitionThreshold {
  upgradeScore: number;
  downgradeScore: number;
  minInteractions: number;
}

export const TRUST_TRANSITION_THRESHOLDS: Record<string, TrustTransitionThreshold> = {
  '1->2': { upgradeScore: 0.7, downgradeScore: 0.5, minInteractions: 50 },
  '2->3': { upgradeScore: 0.85, downgradeScore: 0.65, minInteractions: 500 },
  '3->4': { upgradeScore: 0.95, downgradeScore: 0.8, minInteractions: 5000 },
};

// 'admin-change' gates trust-change/topology-change — control-plane operations
// that mutate a peer's trust level or the mesh topology itself, as opposed to
// the data-plane operations (send/receive/query-redacted) available from
// ATTESTED. Granted from TRUSTED, matching this table's existing floor for
// other sensitive capabilities (share-context, collaborative-task); this is
// the hardcoded floor a SecurityPolicy.minTrustLevelForAdmin override cannot
// loosen below, same defense-in-depth shape as remote-spawn/PRIVILEGED.
export const CAPABILITY_GATES: Record<TrustLevel, readonly string[]> = {
  [TrustLevel.UNTRUSTED]: ['discovery'],
  [TrustLevel.VERIFIED]: ['discovery', 'status', 'ping'],
  [TrustLevel.ATTESTED]: ['discovery', 'status', 'ping', 'send', 'receive', 'query-redacted'],
  [TrustLevel.TRUSTED]: ['discovery', 'status', 'ping', 'send', 'receive', 'query-redacted', 'share-context', 'collaborative-task', 'admin-change'],
  [TrustLevel.PRIVILEGED]: ['discovery', 'status', 'ping', 'send', 'receive', 'query-redacted', 'share-context', 'collaborative-task', 'full-memory', 'remote-spawn', 'admin-change'],
};

export function isOperationAllowed(trustLevel: TrustLevel, operation: string): boolean {
  const allowed = CAPABILITY_GATES[trustLevel];
  return allowed.includes(operation);
}

export function getTrustLevelLabel(level: TrustLevel): string {
  const labels: Record<TrustLevel, string> = {
    [TrustLevel.UNTRUSTED]: 'UNTRUSTED',
    [TrustLevel.VERIFIED]: 'VERIFIED',
    [TrustLevel.ATTESTED]: 'ATTESTED',
    [TrustLevel.TRUSTED]: 'TRUSTED',
    [TrustLevel.PRIVILEGED]: 'PRIVILEGED',
  };
  return labels[level];
}
