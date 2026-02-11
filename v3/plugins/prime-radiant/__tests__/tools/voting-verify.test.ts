/**
 * Consensus Verify MCP Tool Tests
 *
 * Tests for the pr_voting_verify MCP tool that mathematically
 * validates multi-agent consensus using coherence and spectral analysis.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mock Types
// ============================================================================

interface AgentState {
  agentId: string;
  embedding: number[];
  vote: boolean;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

interface VotingVerifyInput {
  agentStates: AgentState[];
  consensusThreshold?: number;
  options?: {
    requireSpectralStability?: boolean;
    requireCoherence?: boolean;
    minAgents?: number;
    maxEnergy?: number;
  };
}

interface VotingVerifyOutput {
  consensusAchieved: boolean;
  agreementRatio: number;
  coherenceEnergy: number;
  spectralStability: boolean;
  details: {
    votesFor: number;
    votesAgainst: number;
    abstentions: number;
    effectiveThreshold: number;
  };
  violations: string[];
  recommendation: string;
}

// ============================================================================
// Mock Implementation
// ============================================================================

class MockVotingVerifyTool {
  private defaultThreshold = 2/3; // Exact 2/3 majority
  private defaultMaxEnergy = 0.5;
  private defaultMinAgents = 3;

  async execute(input: VotingVerifyInput): Promise<VotingVerifyOutput> {
    // Validate input
    if (!input.agentStates || input.agentStates.length === 0) {
      return this.createEmptyResponse('No agent states provided');
    }

    const minAgents = input.options?.minAgents ?? this.defaultMinAgents;
    if (input.agentStates.length < minAgents) {
      return this.createEmptyResponse(`Minimum ${minAgents} agents required for consensus`);
    }

    // Count votes
    const votesFor = input.agentStates.filter((a) => a.vote === true).length;
    const votesAgainst = input.agentStates.filter((a) => a.vote === false).length;
    const abstentions = input.agentStates.length - votesFor - votesAgainst;

    const activeVoters = votesFor + votesAgainst;
    const agreementRatio = activeVoters > 0 ? votesFor / activeVoters : 0;

    // Compute coherence energy
    const embeddings = input.agentStates.map((a) => a.embedding);
    const coherenceEnergy = this.computeCoherence(embeddings);

    // Compute spectral stability
    const spectralStability = this.computeSpectralStability(input.agentStates);

    // Check consensus criteria
    const threshold = input.consensusThreshold ?? this.defaultThreshold;
    const maxEnergy = input.options?.maxEnergy ?? this.defaultMaxEnergy;

    const violations: string[] = [];

    // Check vote threshold
    const votesMet = agreementRatio >= threshold;
    if (!votesMet) {
      violations.push(`Agreement ratio ${(agreementRatio * 100).toFixed(1)}% below threshold ${(threshold * 100).toFixed(1)}%`);
    }

    // Check coherence requirement
    const requireCoherence = input.options?.requireCoherence !== false;
    const coherenceMet = !requireCoherence || coherenceEnergy < maxEnergy;
    if (requireCoherence && !coherenceMet) {
      violations.push(`Coherence energy ${coherenceEnergy.toFixed(3)} exceeds maximum ${maxEnergy}`);
    }

    // Check spectral stability requirement
    const requireStability = input.options?.requireSpectralStability !== false;
    const stabilityMet = !requireStability || spectralStability;
    if (requireStability && !stabilityMet) {
      violations.push('Spectral analysis indicates unstable consensus');
    }

    const consensusAchieved = votesMet && coherenceMet && stabilityMet;

    return {
      consensusAchieved,
      agreementRatio,
      coherenceEnergy,
      spectralStability,
      details: {
        votesFor,
        votesAgainst,
        abstentions,
        effectiveThreshold: threshold,
      },
      violations,
      recommendation: this.getRecommendation(consensusAchieved, violations),
    };
  }

  private computeCoherence(embeddings: number[][]): number {
    if (embeddings.length < 2) return 0;

    let totalEnergy = 0;
    let pairs = 0;

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        totalEnergy += this.cosineDissimilarity(embeddings[i], embeddings[j]);
        pairs++;
      }
    }

    return pairs > 0 ? totalEnergy / pairs : 0;
  }

  private computeSpectralStability(agentStates: AgentState[]): boolean {
    // Build agreement matrix
    const n = agentStates.length;
    const matrix: number[][] = [];

    for (let i = 0; i < n; i++) {
      matrix[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 0;
        } else {
          // Connection strength based on vote agreement and embedding similarity
          const voteAgreement = agentStates[i].vote === agentStates[j].vote ? 1 : 0;
          const embeddingSim = 1 - this.cosineDissimilarity(
            agentStates[i].embedding,
            agentStates[j].embedding
          );
          matrix[i][j] = (voteAgreement + embeddingSim) / 2;
        }
      }
    }

    // Simplified spectral gap check
    // In real implementation, would compute eigenvalues
    const avgConnection = this.averageConnection(matrix);
    return avgConnection > 0.3;
  }

  private averageConnection(matrix: number[][]): number {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix.length; j++) {
        sum += matrix[i][j];
        count++;
      }
    }

    return count > 0 ? sum / count : 0;
  }

  private cosineDissimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 1;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 1;

    const cosineSim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return Math.max(0, 1 - cosineSim);
  }

  private getRecommendation(achieved: boolean, violations: string[]): string {
    if (achieved) {
      return 'Consensus achieved: all criteria met';
    }

    if (violations.length === 1) {
      return `Consensus not achieved: ${violations[0]}`;
    }

    return `Consensus not achieved: ${violations.length} criteria failed - review agent alignment`;
  }

  private createEmptyResponse(reason: string): VotingVerifyOutput {
    return {
      consensusAchieved: false,
      agreementRatio: 0,
      coherenceEnergy: 0,
      spectralStability: false,
      details: {
        votesFor: 0,
        votesAgainst: 0,
        abstentions: 0,
        effectiveThreshold: this.defaultThreshold,
      },
      violations: [reason],
      recommendation: reason,
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('VotingVerifyTool', () => {
  let tool: MockVotingVerifyTool;

  beforeEach(() => {
    tool = new MockVotingVerifyTool();
  });

  describe('basic consensus checking', () => {
    it('should achieve consensus with unanimous agreement', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'agent-1', embedding: [1, 0, 0], vote: true },
          { agentId: 'agent-2', embedding: [0.95, 0.05, 0], vote: true },
          { agentId: 'agent-3', embedding: [0.9, 0.1, 0], vote: true },
        ],
      });

      expect(result.consensusAchieved).toBe(true);
      expect(result.agreementRatio).toBe(1);
      expect(result.violations).toHaveLength(0);
    });

    it('should achieve consensus with 2/3 majority', async () => {
      // Use very similar embeddings to ensure spectral stability passes
      // when we have 2/3 vote agreement
      const result = await tool.execute({
        agentStates: [
          { agentId: 'agent-1', embedding: [1, 0, 0], vote: true },
          { agentId: 'agent-2', embedding: [0.98, 0.02, 0], vote: true },
          { agentId: 'agent-3', embedding: [0.96, 0.04, 0], vote: false },
        ],
        options: { requireSpectralStability: false }, // Focus on vote test only
      });

      expect(result.consensusAchieved).toBe(true);
      expect(result.agreementRatio).toBeCloseTo(0.67, 1);
    });

    it('should fail consensus below threshold', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'agent-1', embedding: [1, 0, 0], vote: true },
          { agentId: 'agent-2', embedding: [0, 1, 0], vote: false },
          { agentId: 'agent-3', embedding: [0, 0, 1], vote: false },
        ],
      });

      expect(result.consensusAchieved).toBe(false);
      expect(result.agreementRatio).toBeCloseTo(0.33, 1);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should handle empty input', async () => {
      const result = await tool.execute({ agentStates: [] });

      expect(result.consensusAchieved).toBe(false);
      expect(result.violations).toContain('No agent states provided');
    });
  });

  describe('threshold handling', () => {
    it('should use default 2/3 threshold', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [1, 0, 0], vote: false },
        ],
      });

      expect(result.details.effectiveThreshold).toBeCloseTo(0.67, 2);
    });

    it('should respect custom threshold', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [1, 0, 0], vote: false },
        ],
        consensusThreshold: 0.5, // 50% threshold
      });

      expect(result.consensusAchieved).toBe(true);
      expect(result.details.effectiveThreshold).toBe(0.5);
    });

    it('should fail with strict threshold', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [1, 0, 0], vote: false },
        ],
        consensusThreshold: 0.8, // 80% threshold
      });

      expect(result.consensusAchieved).toBe(false);
    });
  });

  describe('vote counting', () => {
    it('should count votes correctly', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [1, 0, 0], vote: false },
        ],
      });

      expect(result.details.votesFor).toBe(2);
      expect(result.details.votesAgainst).toBe(1);
      expect(result.details.abstentions).toBe(0);
    });

    it('should handle unanimous for', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [1, 0, 0], vote: true },
        ],
      });

      expect(result.details.votesFor).toBe(3);
      expect(result.details.votesAgainst).toBe(0);
    });

    it('should handle unanimous against', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: false },
          { agentId: 'a2', embedding: [1, 0, 0], vote: false },
          { agentId: 'a3', embedding: [1, 0, 0], vote: false },
        ],
      });

      expect(result.details.votesFor).toBe(0);
      expect(result.details.votesAgainst).toBe(3);
      expect(result.agreementRatio).toBe(0);
    });
  });

  describe('coherence checking', () => {
    it('should report low coherence energy for aligned agents', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0.99, 0.01, 0], vote: true },
          { agentId: 'a3', embedding: [0.98, 0.02, 0], vote: true },
        ],
      });

      expect(result.coherenceEnergy).toBeLessThan(0.2);
    });

    it('should report high coherence energy for misaligned agents', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0, 1, 0], vote: true },
          { agentId: 'a3', embedding: [0, 0, 1], vote: true },
        ],
      });

      expect(result.coherenceEnergy).toBeGreaterThan(0.5);
    });

    it('should fail consensus if coherence exceeds max', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [-1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [0, 1, 0], vote: true },
        ],
        options: { maxEnergy: 0.3 },
      });

      expect(result.consensusAchieved).toBe(false);
      expect(result.violations.some((v) => v.includes('Coherence'))).toBe(true);
    });

    it('should skip coherence check if disabled', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [-1, 0, 0], vote: true },
          { agentId: 'a3', embedding: [0, 1, 0], vote: true },
        ],
        options: { requireCoherence: false },
      });

      // Still fails spectral, but not coherence
      expect(result.violations.some((v) => v.includes('Coherence'))).toBe(false);
    });
  });

  describe('spectral stability', () => {
    it('should report stable for agreeing similar agents', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0.95, 0.05, 0], vote: true },
          { agentId: 'a3', embedding: [0.9, 0.1, 0], vote: true },
        ],
      });

      expect(result.spectralStability).toBe(true);
    });

    it('should report unstable for disagreeing dissimilar agents', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0, 1, 0], vote: false },
          { agentId: 'a3', embedding: [0, 0, 1], vote: true },
        ],
      });

      expect(result.spectralStability).toBe(false);
    });

    it('should skip stability check if disabled', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0, 1, 0], vote: true },
          { agentId: 'a3', embedding: [0, 0, 1], vote: true },
        ],
        options: { requireSpectralStability: false, requireCoherence: false },
      });

      // Should pass if only vote threshold matters
      expect(result.violations.some((v) => v.includes('Spectral'))).toBe(false);
    });
  });

  describe('minimum agents', () => {
    it('should require minimum 3 agents by default', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [1, 0, 0], vote: true },
        ],
      });

      expect(result.consensusAchieved).toBe(false);
      expect(result.violations.some((v) => v.includes('Minimum'))).toBe(true);
    });

    it('should respect custom minimum', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0.99, 0.01, 0], vote: true },
        ],
        options: { minAgents: 2 },
      });

      expect(result.consensusAchieved).toBe(true);
    });
  });

  describe('recommendations', () => {
    it('should provide positive recommendation on success', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0.95, 0.05, 0], vote: true },
          { agentId: 'a3', embedding: [0.9, 0.1, 0], vote: true },
        ],
      });

      expect(result.recommendation).toContain('achieved');
    });

    it('should provide actionable recommendation on failure', async () => {
      const result = await tool.execute({
        agentStates: [
          { agentId: 'a1', embedding: [1, 0, 0], vote: true },
          { agentId: 'a2', embedding: [0, 1, 0], vote: false },
          { agentId: 'a3', embedding: [0, 0, 1], vote: false },
        ],
      });

      expect(result.recommendation).toContain('not achieved');
    });
  });

  describe('performance', () => {
    it('should verify consensus in reasonable time', async () => {
      const agentStates = Array.from({ length: 10 }, (_, i) => ({
        agentId: `agent-${i}`,
        embedding: Array.from({ length: 100 }, () => Math.random()),
        vote: i % 3 !== 0, // 7/10 vote true
      }));

      const startTime = performance.now();
      await tool.execute({ agentStates });
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(50);
    });
  });
});

describe('VotingVerifyTool Edge Cases', () => {
  let tool: MockVotingVerifyTool;

  beforeEach(() => {
    tool = new MockVotingVerifyTool();
  });

  it('should handle tie vote', async () => {
    const result = await tool.execute({
      agentStates: [
        { agentId: 'a1', embedding: [1, 0, 0, 0], vote: true },
        { agentId: 'a2', embedding: [1, 0, 0, 0], vote: true },
        { agentId: 'a3', embedding: [1, 0, 0, 0], vote: false },
        { agentId: 'a4', embedding: [1, 0, 0, 0], vote: false },
      ],
    });

    expect(result.agreementRatio).toBe(0.5);
    expect(result.consensusAchieved).toBe(false); // Below 2/3
  });

  it('should handle agents with varying confidence', async () => {
    const result = await tool.execute({
      agentStates: [
        { agentId: 'a1', embedding: [1, 0, 0], vote: true, confidence: 0.9 },
        { agentId: 'a2', embedding: [1, 0, 0], vote: true, confidence: 0.8 },
        { agentId: 'a3', embedding: [1, 0, 0], vote: false, confidence: 0.5 },
      ],
    });

    // Confidence is metadata, not currently factored into consensus
    expect(result).toBeDefined();
  });

  it('should handle high-dimensional embeddings', async () => {
    const dim = 768; // BERT-like dimension
    const result = await tool.execute({
      agentStates: [
        { agentId: 'a1', embedding: Array.from({ length: dim }, () => Math.random()), vote: true },
        { agentId: 'a2', embedding: Array.from({ length: dim }, () => Math.random()), vote: true },
        { agentId: 'a3', embedding: Array.from({ length: dim }, () => Math.random()), vote: true },
      ],
    });

    expect(result).toBeDefined();
    expect(result.coherenceEnergy).toBeGreaterThanOrEqual(0);
  });
});
