/**
 * Policy entity management
 *
 * Policies are first-class entities in the Web4 trust network:
 * - Immutable once registered (changing = new entity)
 * - Hash-tracked for audit chain reference
 * - Sessions witness operating under a policy
 */

import { createHash } from 'crypto';
import type { PolicyConfig, PolicyEvaluation } from './types.js';

/** Policy entity ID format */
export type PolicyEntityId = `policy:${string}:${string}:${string}`;

/** Policy entity data */
export interface PolicyEntityData {
  entityId: PolicyEntityId;
  name: string;
  version: string;
  contentHash: string;
  createdAt: string;
  source: 'preset' | 'custom';
  config: PolicyConfig;
}

/**
 * A policy as a first-class entity in the trust network
 */
export class PolicyEntity {
  readonly entityId: PolicyEntityId;
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly source: 'preset' | 'custom';
  readonly config: PolicyConfig;

  constructor(data: PolicyEntityData) {
    this.entityId = data.entityId;
    this.name = data.name;
    this.version = data.version;
    this.contentHash = data.contentHash;
    this.createdAt = data.createdAt;
    this.source = data.source;
    this.config = data.config;
  }

  /**
   * Evaluate a tool call against this policy
   */
  evaluate(
    toolName: string,
    category: string,
    target?: string,
    trustScore: number = 0.5
  ): PolicyEvaluation {
    const sortedRules = [...this.config.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (this.matchesRule(toolName, category, target, trustScore, rule)) {
        return {
          decision: rule.decision,
          matchedRule: rule.id,
          enforced: rule.decision !== 'deny' || this.config.enforce,
          reason: rule.reason ?? `Matched rule: ${rule.name}`,
          trustScore,
          constraints: [
            `policy:${this.entityId}`,
            `decision:${rule.decision}`,
            `rule:${rule.id}`,
          ],
        };
      }
    }

    return {
      decision: this.config.defaultPolicy,
      matchedRule: null,
      enforced: true,
      reason: `Default policy: ${this.config.defaultPolicy}`,
      trustScore,
      constraints: [
        `policy:${this.entityId}`,
        `decision:${this.config.defaultPolicy}`,
        'rule:default',
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

    if (match.minTrust !== undefined && trustScore < match.minTrust) {
      return false;
    }

    if (match.tools && !match.tools.includes(toolName)) {
      return false;
    }

    if (match.categories && !match.categories.includes(category as never)) {
      return false;
    }

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

  toJSON(): PolicyEntityData {
    return {
      entityId: this.entityId,
      name: this.name,
      version: this.version,
      contentHash: this.contentHash,
      createdAt: this.createdAt,
      source: this.source,
      config: this.config,
    };
  }
}

/**
 * Registry of policy entities with hash-tracking
 */
export class PolicyRegistry {
  private cache = new Map<PolicyEntityId, PolicyEntity>();

  /**
   * Register a policy and create its entity
   */
  registerPolicy(options: {
    name: string;
    config: PolicyConfig;
    version?: string;
    source?: 'preset' | 'custom';
  }): PolicyEntity {
    const { name, config, version, source = 'custom' } = options;

    const versionStr = version ?? new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const contentHash = computePolicyHash(config);
    const entityId: PolicyEntityId = `policy:${name}:${versionStr}:${contentHash}`;

    if (this.cache.has(entityId)) {
      return this.cache.get(entityId)!;
    }

    const entity = new PolicyEntity({
      entityId,
      name,
      version: versionStr,
      contentHash,
      createdAt: new Date().toISOString(),
      source,
      config,
    });

    this.cache.set(entityId, entity);
    return entity;
  }

  /**
   * Get a policy by entity ID
   */
  getPolicy(entityId: PolicyEntityId): PolicyEntity | undefined {
    return this.cache.get(entityId);
  }

  /**
   * Get a policy by content hash
   */
  getPolicyByHash(contentHash: string): PolicyEntity | undefined {
    for (const entity of this.cache.values()) {
      if (entity.contentHash === contentHash) {
        return entity;
      }
    }
    return undefined;
  }

  /**
   * List all registered policies
   */
  listPolicies(): PolicyEntity[] {
    return [...this.cache.values()];
  }
}

/**
 * Compute a policy content hash
 */
export function computePolicyHash(config: PolicyConfig): string {
  const sortedKeys = Object.keys(config).sort();
  const contentStr = JSON.stringify(config, sortedKeys);
  return createHash('sha256').update(contentStr).digest('hex').slice(0, 16);
}
