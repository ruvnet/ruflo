/**
 * Hooks integration for claude-flow
 *
 * Bridges Web4 governance with claude-flow's Official Hooks Bridge,
 * providing policy enforcement at tool call boundaries.
 *
 * ## Integration Architecture
 *
 * ```
 * Claude Code → Official Hook (PreToolUse)
 *                    ↓
 *            OfficialHooksBridge.toV3Context()
 *                    ↓
 *            GovernanceHooks.preToolUse()
 *                    ↓
 *            Policy.evaluate() + Trust.update()
 *                    ↓
 *            OfficialHooksBridge.toOfficialOutput()
 *                    ↓
 *            Decision: allow/deny/ask
 * ```
 */

import type {
  GovernanceHookContext,
  GovernanceHookOutput,
  PolicyConfig,
  PolicyEvaluation,
  EntityTrust,
  T3Tensor,
  TrustLevel,
} from './types.js';

/** Hook handler function type */
export type HookHandler = (ctx: GovernanceHookContext) => Promise<GovernanceHookOutput>;

/**
 * Governance hooks for claude-flow integration
 */
export class GovernanceHooks {
  private policy: PolicyConfig;
  private entityTrust: Map<string, EntityTrust>;
  private sessionId: string;

  constructor(policy: PolicyConfig, sessionId: string) {
    this.policy = policy;
    this.entityTrust = new Map();
    this.sessionId = sessionId;
  }

  /**
   * Pre-tool-use hook: Evaluate policy before tool execution
   *
   * Integrates with claude-flow's PreToolUse event via OfficialHooksBridge.
   */
  async preToolUse(ctx: GovernanceHookContext): Promise<GovernanceHookOutput> {
    const toolTrust = this.getOrCreateTrust(`tool:${ctx.toolName}`);
    const sessionTrust = this.getOrCreateTrust(`session:${ctx.sessionId}`);

    // Combine tool and session trust
    // Compute composite scores (talent * 0.3 + training * 0.4 + temperament * 0.3)
    const toolComposite = toolTrust.t3.talent * 0.3 + toolTrust.t3.training * 0.4 + toolTrust.t3.temperament * 0.3;
    const sessionComposite = sessionTrust.t3.talent * 0.3 + sessionTrust.t3.training * 0.4 + sessionTrust.t3.temperament * 0.3;
    const combinedScore = (toolComposite + sessionComposite) / 2;

    const evaluation = this.evaluatePolicy(
      ctx.toolName,
      ctx.target,
      combinedScore
    );

    // Map policy decision to hook output
    return this.mapDecisionToOutput(evaluation, combinedScore);
  }

  /**
   * Post-tool-use hook: Update trust based on outcome
   *
   * Integrates with claude-flow's PostToolUse event.
   */
  async postToolUse(
    ctx: GovernanceHookContext,
    success: boolean,
    _result?: unknown
  ): Promise<void> {
    const toolTrust = this.getOrCreateTrust(`tool:${ctx.toolName}`);
    const sessionTrust = this.getOrCreateTrust(`session:${ctx.sessionId}`);

    // Update trust from outcome
    const weight = this.getUpdateWeight(ctx.toolName);
    this.updateTrust(toolTrust, success, weight);
    this.updateTrust(sessionTrust, success, weight * 0.5);
  }

  /**
   * Session start hook: Initialize governance state
   *
   * Integrates with claude-flow's SessionStart event.
   */
  async sessionStart(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    this.getOrCreateTrust(`session:${sessionId}`);
  }

  /**
   * Get current trust for an entity
   */
  getTrust(entityId: string): EntityTrust | undefined {
    return this.entityTrust.get(entityId);
  }

  /**
   * Get all entity trust records
   */
  getAllTrust(): EntityTrust[] {
    return Array.from(this.entityTrust.values());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────

  private getOrCreateTrust(entityId: string): EntityTrust {
    let trust = this.entityTrust.get(entityId);
    if (!trust) {
      trust = {
        entityId,
        entityType: this.inferEntityType(entityId),
        t3: this.defaultT3(),
        level: 'medium',
        interactionCount: 0,
        successCount: 0,
        failureCount: 0,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      this.entityTrust.set(entityId, trust);
    }
    return trust;
  }

  private defaultT3(): T3Tensor & { composite: () => number } {
    const t3 = {
      talent: 0.5,
      training: 0.5,
      temperament: 0.5,
      composite() {
        // Per Web4 spec: talent * 0.3 + training * 0.4 + temperament * 0.3
        return this.talent * 0.3 + this.training * 0.4 + this.temperament * 0.3;
      },
    };
    return t3;
  }

  private inferEntityType(entityId: string): EntityTrust['entityType'] {
    if (entityId.startsWith('tool:')) return 'tool';
    if (entityId.startsWith('session:')) return 'session';
    if (entityId.startsWith('agent:')) return 'agent';
    if (entityId.startsWith('policy:')) return 'policy';
    return 'user';
  }

  private updateTrust(trust: EntityTrust, success: boolean, _weight: number): void {
    trust.interactionCount++;
    if (success) {
      trust.successCount++;
    } else {
      trust.failureCount++;
    }

    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const t3 = trust.t3;

    // Per Web4 spec evolution mechanics
    if (success) {
      // Standard success: training and temperament improve
      t3.training = clamp(t3.training + 0.008);
      t3.temperament = clamp(t3.temperament + 0.005);
    } else {
      // Failure: all dimensions decrease
      t3.talent = clamp(t3.talent - 0.02);
      t3.training = clamp(t3.training - 0.01);
      t3.temperament = clamp(t3.temperament - 0.02);
    }

    // Composite: talent * 0.3 + training * 0.4 + temperament * 0.3
    const composite = t3.talent * 0.3 + t3.training * 0.4 + t3.temperament * 0.3;
    trust.level = this.trustLevelFromScore(composite);
    trust.lastUpdated = new Date().toISOString();
  }

  private trustLevelFromScore(score: number): TrustLevel {
    if (score < 0.2) return 'low';
    if (score < 0.4) return 'medium_low';
    if (score < 0.6) return 'medium';
    if (score < 0.8) return 'medium_high';
    return 'high';
  }

  private getUpdateWeight(toolName: string): number {
    // Higher weight for higher-impact tools
    const category = this.categorize(toolName);
    switch (category) {
      case 'execute':
        return 0.15;
      case 'file_write':
        return 0.12;
      case 'network':
        return 0.10;
      case 'agent':
        return 0.10;
      case 'file_read':
        return 0.05;
      default:
        return 0.08;
    }
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

  private evaluatePolicy(
    toolName: string,
    target: string | undefined,
    trustScore: number
  ): PolicyEvaluation {
    const category = this.categorize(toolName);

    // Sort rules by priority
    const sortedRules = [...this.policy.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (this.matchesRule(toolName, category, target, trustScore, rule)) {
        return {
          decision: rule.decision,
          matchedRule: rule.id,
          enforced: rule.decision !== 'deny' || this.policy.enforce,
          reason: rule.reason ?? `Matched rule: ${rule.name}`,
          trustScore,
          constraints: [
            `policy:${this.policy.name}`,
            `rule:${rule.id}`,
            `decision:${rule.decision}`,
          ],
        };
      }
    }

    // Default policy
    return {
      decision: this.policy.defaultPolicy,
      matchedRule: null,
      enforced: true,
      reason: `Default policy: ${this.policy.defaultPolicy}`,
      trustScore,
      constraints: [
        `policy:${this.policy.name}`,
        'rule:default',
        `decision:${this.policy.defaultPolicy}`,
      ],
    };
  }

  private matchesRule(
    toolName: string,
    category: string,
    target: string | undefined,
    trustScore: number,
    rule: PolicyConfig['rules'][0]
  ): boolean {
    const match = rule.match;

    // Check minimum trust
    if (match.minTrust !== undefined && trustScore < match.minTrust) {
      return false;
    }

    // Check tools
    if (match.tools && !match.tools.includes(toolName)) {
      return false;
    }

    // Check categories
    if (match.categories && !match.categories.includes(category as never)) {
      return false;
    }

    // Check target patterns
    if (match.targetPatterns && target) {
      const matched = match.targetPatterns.some((pattern) =>
        this.matchGlob(pattern, target)
      );
      if (!matched) {
        return false;
      }
    } else if (match.targetPatterns && !target) {
      return false;
    }

    return true;
  }

  private matchGlob(pattern: string, target: string): boolean {
    if (pattern === '*' || pattern === '**') return true;
    if (pattern.startsWith('**/')) {
      const suffix = pattern.slice(3);
      return target.endsWith(suffix) || target.includes(`/${suffix}`);
    }
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      return target.startsWith(prefix);
    }
    if (pattern.includes('*')) {
      const parts = pattern.split('*');
      if (parts.length === 2) {
        return target.startsWith(parts[0]) && target.endsWith(parts[1]);
      }
    }
    return pattern === target;
  }

  private mapDecisionToOutput(
    evaluation: PolicyEvaluation,
    trustScore: number
  ): GovernanceHookOutput {
    switch (evaluation.decision) {
      case 'allow':
        return {
          decision: 'allow',
          reason: evaluation.reason,
          continue: true,
          trustScore,
        };
      case 'deny':
        return {
          decision: evaluation.enforced ? 'deny' : 'allow',
          reason: evaluation.reason,
          continue: !evaluation.enforced,
          trustScore,
        };
      case 'ask_user':
        return {
          decision: 'ask',
          reason: evaluation.reason,
          continue: false,
          trustScore,
        };
      case 'log_only':
        return {
          decision: 'allow',
          reason: evaluation.reason,
          continue: true,
          trustScore,
        };
      default:
        return {
          decision: 'allow',
          continue: true,
          trustScore,
        };
    }
  }
}

/**
 * Create hooks for claude-flow integration
 *
 * Use with claude-flow's Official Hooks Bridge:
 *
 * ```typescript
 * import { createGovernanceHooks } from '@claude-flow/governance';
 * import { getPreset } from '@claude-flow/governance/presets';
 *
 * const hooks = createGovernanceHooks(getPreset('standard'), sessionId);
 *
 * // In pre-tool-use handler:
 * const output = await hooks.preToolUse(context);
 * ```
 */
export function createGovernanceHooks(
  policy: PolicyConfig,
  sessionId: string
): GovernanceHooks {
  return new GovernanceHooks(policy, sessionId);
}
