/**
 * Trust management
 *
 * Implements T3 Trust Tensors and entity trust tracking.
 * Integrates with claude-flow's Claims system to provide
 * trust-weighted authorization.
 */

import type { T3Tensor, TrustLevel, EntityTrust, EntityType } from './types.js';

/**
 * Create a default T3 tensor (all dimensions at 0.5)
 */
export function createDefaultT3(): T3Tensor {
  return {
    talent: 0.5,
    training: 0.5,
    temperament: 0.5,
  };
}

/**
 * Calculate composite trust score from T3 tensor
 *
 * Per Web4 spec: talent * 0.3 + training * 0.4 + temperament * 0.3
 */
export function t3Composite(t3: T3Tensor): number {
  return t3.talent * 0.3 + t3.training * 0.4 + t3.temperament * 0.3;
}

/**
 * @deprecated Use t3Composite instead - matches Web4 spec naming
 */
export function t3Average(t3: T3Tensor): number {
  return t3Composite(t3);
}

/**
 * Get trust level from score
 */
export function trustLevelFromScore(score: number): TrustLevel {
  if (score < 0.2) return 'low';
  if (score < 0.4) return 'medium_low';
  if (score < 0.6) return 'medium';
  if (score < 0.8) return 'medium_high';
  return 'high';
}

/**
 * Update T3 tensor from outcome per Web4 spec evolution mechanics
 *
 * | Outcome | Talent Impact | Training Impact | Temperament Impact |
 * |---------|--------------|-----------------|-------------------|
 * | Novel Success | +0.02 to +0.05 | +0.01 to +0.02 | +0.01 |
 * | Standard Success | 0 | +0.005 to +0.01 | +0.005 |
 * | Unexpected Failure | -0.02 | -0.01 | -0.02 |
 */
export function updateT3FromOutcome(
  t3: T3Tensor,
  success: boolean,
  isNovel: boolean = false
): T3Tensor {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  if (success) {
    if (isNovel) {
      return {
        talent: clamp(t3.talent + 0.03),
        training: clamp(t3.training + 0.015),
        temperament: clamp(t3.temperament + 0.01),
      };
    } else {
      return {
        talent: t3.talent, // Standard success doesn't affect talent
        training: clamp(t3.training + 0.008),
        temperament: clamp(t3.temperament + 0.005),
      };
    }
  } else {
    return {
      talent: clamp(t3.talent - 0.02),
      training: clamp(t3.training - 0.01),
      temperament: clamp(t3.temperament - 0.02),
    };
  }
}

/**
 * Entity trust store
 *
 * Tracks trust for tools, sessions, agents, and policies.
 * Integrates with claude-flow's Claims for authorization.
 */
export class TrustStore {
  private entities = new Map<string, EntityTrust>();

  /**
   * Get or create entity trust
   */
  getOrCreate(entityId: string, entityType?: EntityType): EntityTrust {
    let entity = this.entities.get(entityId);
    if (!entity) {
      entity = {
        entityId,
        entityType: entityType ?? this.inferEntityType(entityId),
        t3: createDefaultT3(),
        level: 'medium',
        interactionCount: 0,
        successCount: 0,
        failureCount: 0,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      this.entities.set(entityId, entity);
    }
    return entity;
  }

  /**
   * Get entity trust
   */
  get(entityId: string): EntityTrust | undefined {
    return this.entities.get(entityId);
  }

  /**
   * Update entity from outcome
   */
  updateFromOutcome(entityId: string, success: boolean, weight: number = 0.1): EntityTrust {
    const entity = this.getOrCreate(entityId);

    entity.interactionCount++;
    if (success) {
      entity.successCount++;
    } else {
      entity.failureCount++;
    }

    // Note: isNovel defaults to false for standard operations
    entity.t3 = updateT3FromOutcome(entity.t3, success, false);
    entity.level = trustLevelFromScore(t3Average(entity.t3));
    entity.lastUpdated = new Date().toISOString();

    return entity;
  }

  /**
   * List all entities
   */
  listEntities(): EntityTrust[] {
    return [...this.entities.values()];
  }

  /**
   * List entities by type
   */
  listByType(type: EntityType): EntityTrust[] {
    return this.listEntities().filter((e) => e.entityType === type);
  }

  /**
   * Get entities with trust above threshold
   */
  getTrusted(minScore: number): EntityTrust[] {
    return this.listEntities().filter((e) => t3Average(e.t3) >= minScore);
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    totalEntities: number;
    byType: Record<EntityType, number>;
    byLevel: Record<TrustLevel, number>;
    averageTrust: number;
  } {
    const entities = this.listEntities();
    const byType: Record<EntityType, number> = {
      tool: 0,
      session: 0,
      agent: 0,
      policy: 0,
      user: 0,
    };
    const byLevel: Record<TrustLevel, number> = {
      unknown: 0,
      low: 0,
      medium_low: 0,
      medium: 0,
      medium_high: 0,
      high: 0,
    };

    let totalTrust = 0;
    for (const entity of entities) {
      byType[entity.entityType]++;
      byLevel[entity.level]++;
      totalTrust += t3Average(entity.t3);
    }

    return {
      totalEntities: entities.length,
      byType,
      byLevel,
      averageTrust: entities.length > 0 ? totalTrust / entities.length : 0.5,
    };
  }

  private inferEntityType(entityId: string): EntityType {
    if (entityId.startsWith('tool:')) return 'tool';
    if (entityId.startsWith('session:')) return 'session';
    if (entityId.startsWith('agent:')) return 'agent';
    if (entityId.startsWith('policy:')) return 'policy';
    return 'user';
  }
}

/**
 * Calculate transitive trust through witnesses
 *
 * Combines direct trust with witness attestations.
 * Formula: direct_trust * 0.7 + witness_trust * 0.3
 */
export function calculateTransitiveTrust(
  directTrust: number,
  witnessTrust: number[]
): number {
  if (witnessTrust.length === 0) {
    return directTrust;
  }

  const avgWitness = witnessTrust.reduce((a, b) => a + b, 0) / witnessTrust.length;
  return directTrust * 0.7 + avgWitness * 0.3;
}

/**
 * Check if entity meets minimum trust requirement
 *
 * Integrates with claude-flow's Claims system:
 * - Low trust entities may be restricted
 * - High trust entities get expanded permissions
 */
export function meetsTrustRequirement(
  entity: EntityTrust,
  minTrust: number
): boolean {
  return t3Average(entity.t3) >= minTrust;
}

/**
 * Get weight adjustment for tool category
 *
 * Higher-impact operations have more effect on trust.
 */
export function getCategoryWeight(toolName: string): number {
  switch (toolName) {
    case 'Bash':
      return 1.5; // Highest impact
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return 1.2;
    case 'WebFetch':
    case 'WebSearch':
      return 1.1;
    case 'Task':
      return 1.1;
    case 'Read':
    case 'Glob':
    case 'Grep':
      return 0.8;
    default:
      return 1.0;
  }
}
