/**
 * Main governance module
 *
 * Provides a unified interface for Web4 governance in claude-flow.
 */

import { PolicyEntity, PolicyRegistry, computePolicyHash } from './policy.js';
import { TrustStore, t3Average, getCategoryWeight } from './trust.js';
import { GovernanceHooks, createGovernanceHooks } from './hooks.js';
import { getPreset, type PresetName } from './presets.js';
import type {
  PolicyConfig,
  PolicyEvaluation,
  EntityTrust,
  AuditChain,
  R6Action,
  GovernanceHookContext,
  GovernanceHookOutput,
} from './types.js';

/** Governance configuration */
export interface GovernanceConfig {
  /** Policy preset name or custom config */
  policy: PresetName | PolicyConfig;
  /** Session ID for this governance instance */
  sessionId: string;
  /** Enable audit chain logging */
  enableAudit?: boolean;
  /** Custom policy name (for custom configs) */
  policyName?: string;
}

/**
 * Main governance controller
 *
 * Integrates:
 * - Policy evaluation
 * - Trust management
 * - Audit logging
 * - Hook handlers for claude-flow
 */
export class Governance {
  private policyRegistry: PolicyRegistry;
  private trustStore: TrustStore;
  private hooks: GovernanceHooks;
  private auditChain: AuditChain | null;
  private activePolicy: PolicyEntity;

  constructor(config: GovernanceConfig) {
    this.policyRegistry = new PolicyRegistry();
    this.trustStore = new TrustStore();

    // Resolve policy
    const policyConfig = typeof config.policy === 'string'
      ? getPreset(config.policy)
      : config.policy;

    const policyName = config.policyName ?? policyConfig.name;

    // Register policy
    this.activePolicy = this.policyRegistry.registerPolicy({
      name: policyName,
      config: policyConfig,
      source: typeof config.policy === 'string' ? 'preset' : 'custom',
    });

    // Create hooks
    this.hooks = createGovernanceHooks(policyConfig, config.sessionId);

    // Initialize audit chain if enabled
    this.auditChain = config.enableAudit
      ? {
          sessionId: config.sessionId,
          policyId: this.activePolicy.entityId,
          entries: [],
          latestHash: null,
          sequenceNumber: 0,
          createdAt: new Date().toISOString(),
        }
      : null;
  }

  /**
   * Evaluate a tool call against policy
   */
  evaluate(
    toolName: string,
    target?: string,
    agentId?: string
  ): PolicyEvaluation {
    const sessionTrust = this.trustStore.getOrCreate(`session:${this.activePolicy.entityId}`);
    const toolTrust = this.trustStore.getOrCreate(`tool:${toolName}`);

    // Combine trust scores
    const trustScore = (t3Average(sessionTrust.t3) + t3Average(toolTrust.t3)) / 2;

    const category = this.categorize(toolName);
    return this.activePolicy.evaluate(toolName, category, target, trustScore);
  }

  /**
   * Handle pre-tool-use hook
   */
  async preToolUse(ctx: GovernanceHookContext): Promise<GovernanceHookOutput> {
    const output = await this.hooks.preToolUse(ctx);

    // Log to audit chain if enabled
    if (this.auditChain && output.decision !== 'allow') {
      this.appendAudit({
        toolName: ctx.toolName,
        target: ctx.target,
        decision: output.decision,
        reason: output.reason,
        blocked: output.decision === 'deny' || output.decision === 'block',
      });
    }

    return output;
  }

  /**
   * Handle post-tool-use hook
   */
  async postToolUse(
    ctx: GovernanceHookContext,
    success: boolean,
    result?: unknown
  ): Promise<void> {
    await this.hooks.postToolUse(ctx, success, result);

    // Update trust from outcome
    const weight = getCategoryWeight(ctx.toolName);
    this.trustStore.updateFromOutcome(`tool:${ctx.toolName}`, success, weight * 0.1);
    this.trustStore.updateFromOutcome(`session:${ctx.sessionId}`, success, weight * 0.05);

    // Log to audit chain
    if (this.auditChain) {
      this.appendAudit({
        toolName: ctx.toolName,
        target: ctx.target,
        decision: 'allow',
        success,
        blocked: false,
      });
    }
  }

  /**
   * Get active policy
   */
  getActivePolicy(): PolicyEntity {
    return this.activePolicy;
  }

  /**
   * Get trust store
   */
  getTrustStore(): TrustStore {
    return this.trustStore;
  }

  /**
   * Get audit chain
   */
  getAuditChain(): AuditChain | null {
    return this.auditChain;
  }

  /**
   * Get entity trust
   */
  getEntityTrust(entityId: string): EntityTrust | undefined {
    return this.trustStore.get(entityId);
  }

  /**
   * Export state for persistence
   */
  exportState(): {
    policy: PolicyEntity;
    trust: EntityTrust[];
    audit: AuditChain | null;
  } {
    return {
      policy: this.activePolicy,
      trust: this.trustStore.listEntities(),
      audit: this.auditChain,
    };
  }

  private categorize(toolName: string): string {
    switch (toolName) {
      case 'Read':
      case 'Glob':
      case 'Grep':
        return 'file_read';
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return 'file_write';
      case 'Bash':
        return 'execute';
      case 'WebFetch':
      case 'WebSearch':
        return 'network';
      case 'Task':
        return 'agent';
      default:
        return 'system';
    }
  }

  private appendAudit(entry: {
    toolName: string;
    target?: string;
    decision: string;
    reason?: string;
    success?: boolean;
    blocked: boolean;
  }): void {
    if (!this.auditChain) return;

    const hash = computePolicyHash({
      ...entry,
      timestamp: Date.now(),
      sequence: this.auditChain.sequenceNumber + 1,
    } as unknown as PolicyConfig);

    this.auditChain.entries.push(hash);
    this.auditChain.latestHash = hash;
    this.auditChain.sequenceNumber++;
  }
}

/**
 * Create a governance instance
 *
 * Quick start for integrating Web4 governance with claude-flow:
 *
 * ```typescript
 * import { createGovernance } from '@claude-flow/governance';
 *
 * const governance = createGovernance({
 *   policy: 'standard',
 *   sessionId: 'session-123',
 *   enableAudit: true,
 * });
 *
 * // In pre-tool-use hook:
 * const output = await governance.preToolUse(context);
 *
 * // In post-tool-use hook:
 * await governance.postToolUse(context, success, result);
 * ```
 */
export function createGovernance(config: GovernanceConfig): Governance {
  return new Governance(config);
}
