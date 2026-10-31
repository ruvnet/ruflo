import { TrustLevel, isOperationAllowed } from '../domain/entities/trust-level.js';
import { type PIIAction, type PIIType, type PIIDetection, type PIIPolicyConfig } from '../domain/services/pii-pipeline-service.js';
import { type FederationMessageType } from '../domain/entities/federation-envelope.js';

export type FederationClaimType =
  | 'federation:discover'
  | 'federation:connect'
  | 'federation:read'
  | 'federation:write'
  | 'federation:admin'
  | 'federation:memory'
  | 'federation:spawn';

export interface SecurityPolicy {
  readonly maxMessageSizeBytes: number;
  readonly maxMessagesPerMinute: number;
  readonly allowedMessageTypes: readonly FederationMessageType[];
  readonly requirePiiScan: boolean;
  readonly requireAiDefenceScan: boolean;
  readonly minTrustLevelForWrite: TrustLevel;
  readonly minTrustLevelForMemory: TrustLevel;
  readonly minTrustLevelForSpawn: TrustLevel;
}

export interface PolicyEvaluationResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly requiredClaims: readonly FederationClaimType[];
  readonly trustLevelSufficient: boolean;
  readonly piiAction?: PIIAction;
}

const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  maxMessageSizeBytes: 1_048_576,
  maxMessagesPerMinute: 120,
  allowedMessageTypes: [
    'task-assignment', 'memory-query', 'memory-response',
    'context-share', 'status-broadcast', 'heartbeat',
    'trust-change', 'topology-change', 'agent-spawn',
  ],
  requirePiiScan: true,
  requireAiDefenceScan: true,
  minTrustLevelForWrite: TrustLevel.ATTESTED,
  minTrustLevelForMemory: TrustLevel.TRUSTED,
  minTrustLevelForSpawn: TrustLevel.PRIVILEGED,
};

// Message categories gated by the per-operation thresholds declared on
// SecurityPolicy (minTrustLevelForWrite/Memory/Spawn). Message types not
// listed here rely solely on CAPABILITY_GATES (trust-level.ts) — their
// gating is not configurable via SecurityPolicy today.
type PolicyGatedCategory = 'write' | 'memory' | 'spawn';

const POLICY_CATEGORY_FOR_MESSAGE_TYPE: Partial<Record<FederationMessageType, PolicyGatedCategory>> = {
  'task-assignment': 'write',
  'context-share': 'write',
  'claim-event': 'write',
  'memory-query': 'memory',
  'memory-response': 'memory',
  'agent-spawn': 'spawn',
  'agent-handoff': 'spawn',
};

function policyThresholdForCategory(policy: SecurityPolicy, category: PolicyGatedCategory): TrustLevel {
  switch (category) {
    case 'write':
      return policy.minTrustLevelForWrite;
    case 'memory':
      return policy.minTrustLevelForMemory;
    case 'spawn':
      return policy.minTrustLevelForSpawn;
  }
}

const CLAIMS_FOR_MESSAGE_TYPE: Record<FederationMessageType, FederationClaimType[]> = {
  'task-assignment': ['federation:write'],
  'memory-query': ['federation:read', 'federation:memory'],
  'memory-response': ['federation:read', 'federation:memory'],
  'context-share': ['federation:write'],
  'status-broadcast': ['federation:read'],
  'trust-change': ['federation:admin'],
  'topology-change': ['federation:admin'],
  'agent-spawn': ['federation:spawn'],
  'heartbeat': ['federation:connect'],
  'challenge': ['federation:connect'],
  'challenge-response': ['federation:connect'],
  'handshake-init': ['federation:connect'],
  'handshake-accept': ['federation:connect'],
  'handshake-reject': ['federation:connect'],
  'session-terminate': ['federation:connect'],
  // ADR-101 Component C — federated claims operations.
  // claim-event: broadcasts a ClaimDomainEvent (state mutation across peers),
  // same authorization shape as task-assignment.
  'claim-event': ['federation:write'],
  // agent-handoff: transfers claim ownership to a remote agent. Requires
  // both the write capability (state mutation) AND spawn-lifecycle authority
  // (handoff is a sibling of agent-spawn — both reshape who owns work).
  // Matches the consensus-gated security posture in ADR-101.
  'agent-handoff': ['federation:write', 'federation:spawn'],
};

export interface PolicyEngineDeps {
  checkClaim: (claim: FederationClaimType) => boolean;
}

export class PolicyEngine {
  private readonly deps: PolicyEngineDeps;
  private readonly securityPolicy: SecurityPolicy;
  private readonly piiPolicy: PIIPolicyConfig;
  private readonly rateLimitCounters: Map<string, { count: number; windowStart: number }>;

  constructor(
    deps: PolicyEngineDeps,
    securityPolicy?: Partial<SecurityPolicy>,
    piiPolicy?: PIIPolicyConfig,
  ) {
    this.deps = deps;
    this.securityPolicy = { ...DEFAULT_SECURITY_POLICY, ...securityPolicy };
    this.piiPolicy = piiPolicy ?? {
      defaultAction: 'redact',
      overrides: {},
      hashAlgorithm: 'sha256',
      hashSalt: '',
      redactionPlaceholder: '[REDACTED:{type}]',
    };
    this.rateLimitCounters = new Map();
  }

  evaluateMessage(
    messageType: FederationMessageType,
    trustLevel: TrustLevel,
    messageSizeBytes: number,
    sourceNodeId: string,
  ): PolicyEvaluationResult {
    if (!this.securityPolicy.allowedMessageTypes.includes(messageType)) {
      return {
        allowed: false,
        reason: `Message type '${messageType}' is not allowed by security policy`,
        requiredClaims: [],
        trustLevelSufficient: false,
      };
    }

    if (messageSizeBytes > this.securityPolicy.maxMessageSizeBytes) {
      return {
        allowed: false,
        reason: `Message size ${messageSizeBytes} exceeds maximum ${this.securityPolicy.maxMessageSizeBytes}`,
        requiredClaims: [],
        trustLevelSufficient: true,
      };
    }

    if (!this.checkRateLimit(sourceNodeId)) {
      return {
        allowed: false,
        reason: `Rate limit exceeded for node ${sourceNodeId}`,
        requiredClaims: [],
        trustLevelSufficient: true,
      };
    }

    const requiredClaims = CLAIMS_FOR_MESSAGE_TYPE[messageType] ?? [];
    const missingClaims = requiredClaims.filter(c => !this.deps.checkClaim(c));
    if (missingClaims.length > 0) {
      return {
        allowed: false,
        reason: `Missing required claims: ${missingClaims.join(', ')}`,
        requiredClaims,
        trustLevelSufficient: true,
      };
    }

    const operationForType = this.getOperationForMessageType(messageType);
    if (!isOperationAllowed(trustLevel, operationForType)) {
      return {
        allowed: false,
        reason: `Trust level ${trustLevel} insufficient for operation '${operationForType}'`,
        requiredClaims,
        trustLevelSufficient: false,
      };
    }

    const policyCategory = POLICY_CATEGORY_FOR_MESSAGE_TYPE[messageType];
    if (policyCategory) {
      const requiredLevel = policyThresholdForCategory(this.securityPolicy, policyCategory);
      if (trustLevel < requiredLevel) {
        return {
          allowed: false,
          reason: `Trust level ${trustLevel} below configured minimum ${requiredLevel} for ${policyCategory} operations`,
          requiredClaims,
          trustLevelSufficient: false,
        };
      }
    }

    return {
      allowed: true,
      reason: 'Policy check passed',
      requiredClaims,
      trustLevelSufficient: true,
    };
  }

  evaluatePiiDetection(detection: PIIDetection, trustLevel: TrustLevel): PIIAction {
    const override = this.piiPolicy.overrides[detection.type];
    if (override?.trustLevelOverride?.[trustLevel]) {
      return override.trustLevelOverride[trustLevel]!;
    }
    if (override?.action) {
      return override.action;
    }
    return this.piiPolicy.defaultAction;
  }

  evaluateTrustChange(
    currentLevel: TrustLevel,
    proposedLevel: TrustLevel,
  ): { allowed: boolean; requiresHumanApproval: boolean; reason: string } {
    if (proposedLevel > currentLevel && proposedLevel === TrustLevel.PRIVILEGED) {
      return {
        allowed: true,
        requiresHumanApproval: true,
        reason: 'Elevation to PRIVILEGED requires institutional attestation and human approval',
      };
    }

    if (proposedLevel > currentLevel) {
      return {
        allowed: true,
        requiresHumanApproval: false,
        reason: `Trust upgrade from ${currentLevel} to ${proposedLevel} allowed`,
      };
    }

    if (proposedLevel < currentLevel) {
      return {
        allowed: true,
        requiresHumanApproval: false,
        reason: `Trust downgrade from ${currentLevel} to ${proposedLevel} allowed`,
      };
    }

    return {
      allowed: false,
      requiresHumanApproval: false,
      reason: 'No trust level change',
    };
  }

  private checkRateLimit(nodeId: string): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(nodeId);

    if (!counter || now - counter.windowStart > 60_000) {
      this.rateLimitCounters.set(nodeId, { count: 1, windowStart: now });
      return true;
    }

    counter.count++;
    return counter.count <= this.securityPolicy.maxMessagesPerMinute;
  }

  private getOperationForMessageType(messageType: FederationMessageType): string {
    switch (messageType) {
      case 'memory-query':
      case 'memory-response':
        return 'query-redacted';
      case 'context-share':
        return 'share-context';
      case 'task-assignment':
        return 'send';
      case 'agent-spawn':
        return 'remote-spawn';
      case 'status-broadcast':
        return 'status';
      case 'heartbeat':
      case 'challenge':
      case 'challenge-response':
      case 'handshake-init':
      case 'handshake-accept':
      case 'handshake-reject':
      case 'session-terminate':
        return 'ping';
      default:
        return 'send';
    }
  }
}
