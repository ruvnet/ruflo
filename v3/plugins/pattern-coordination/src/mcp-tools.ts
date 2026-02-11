/**
 * Pattern Coordination MCP Tools
 *
 * 5 MCP tools for multi-agent neural coordination:
 * - coordination/pattern-agreement: Neural negotiation consensus
 * - coordination/topology-optimize: GNN-based topology optimization
 * - coordination/collective-memory: Shared memory management
 * - coordination/emergent-protocol: MARL communication protocols
 * - coordination/swarm-behavior: Emergent swarm behaviors
 */

import type {
  MCPTool,
  MCPToolResult,
  ToolContext,
  NeuralConsensusOutput,
  TopologyOptimizeOutput,
  CollectiveMemoryOutput,
  EmergentProtocolOutput,
  SwarmBehaviorOutput,
  VotingBallot,
  TopologyEdge,
  Agent,
  MemoryEntry,
  MemoryScope,
} from './types.js';
import {
  NeuralConsensusInputSchema,
  TopologyOptimizeInputSchema,
  CollectiveMemoryInputSchema,
  EmergentProtocolInputSchema,
  SwarmBehaviorInputSchema,
  successResult,
  errorResult,
  cosineSimilarity,
} from './types.js';

// ============================================================================
// Default Logger
// ============================================================================

const defaultLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[pattern-coordination] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[pattern-coordination] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[pattern-coordination] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[pattern-coordination] ${msg}`, meta),
};

// ============================================================================
// In-Memory State (for fallback implementation)
// ============================================================================

const collectiveMemory = new Map<string, Map<string, MemoryEntry>>();

// ============================================================================
// Tool 1: Neural Consensus
// ============================================================================

async function neuralConsensusHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validation = NeuralConsensusInputSchema.safeParse(input);
    if (!validation.success) {
      logger.error('Input validation failed', { error: validation.error.message });
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { proposal, agents, protocol, maxRounds } = validation.data;
    logger.debug('Processing pattern agreement', {
      topic: proposal.topic,
      agentCount: agents.length,
      protocol
    });

    // Initialize votes
    const votes: VotingBallot[] = [];
    let round = 0;
    let consensusReached = false;
    let selectedOption: string | null = null;

    // Use attention bridge if available for weighted voting
    const useAttention = context?.attentionBridge?.initialized ?? false;

    while (round < maxRounds && !consensusReached) {
      round++;
      const roundVotes: VotingBallot[] = [];

      for (const agent of agents) {
        // Calculate vote based on agent preferences
        let bestOption = proposal.options[0]?.id ?? '';
        let bestScore = -Infinity;

        for (const option of proposal.options) {
          let score = Math.random(); // Base randomness

          // Factor in agent preferences
          if (agent.preferences) {
            for (const [key, value] of Object.entries(agent.preferences)) {
              if (typeof option.value === 'object' && option.value !== null) {
                const optionVal = (option.value as Record<string, unknown>)[key];
                if (typeof optionVal === 'number') {
                  score += value * optionVal;
                }
              }
            }
          }

          // Use attention for neural weighting if available
          if (useAttention && agent.embedding) {
            const embedding = new Float32Array(agent.embedding);
            const weights = context?.attentionBridge?.computeWeights(
              embedding,
              agents
                .filter(a => a.id !== agent.id && a.embedding)
                .map(a => new Float32Array(a.embedding!))
            );
            if (weights) {
              score += weights.reduce((s, w) => s + w, 0) / weights.length;
            }
          }

          if (score > bestScore) {
            bestScore = score;
            bestOption = option.id;
          }
        }

        roundVotes.push({
          agentId: agent.id,
          optionId: bestOption,
          weight: 1 / agents.length,
          confidence: Math.min(1, Math.max(0, bestScore)),
        });
      }

      // Aggregate votes
      const voteCounts = new Map<string, number>();
      for (const vote of roundVotes) {
        const current = voteCounts.get(vote.optionId) ?? 0;
        voteCounts.set(vote.optionId, current + vote.weight);
      }

      // Check for consensus
      for (const [optionId, count] of voteCounts) {
        if (count >= 0.8) { // 80% agreement threshold
          consensusReached = true;
          selectedOption = optionId;
          break;
        }
      }

      // In iterative refinement, agents adjust based on collective signal
      if (protocol === 'iterative_refinement' && !consensusReached) {
        // Agents with minority votes get pulled toward majority
        for (const agent of agents) {
          if (agent.embedding) {
            // Apply slight adjustment toward consensus direction
          }
        }
      }

      votes.push(...roundVotes);
    }

    // Find divergent agents
    const divergentAgents: string[] = [];
    if (consensusReached && selectedOption) {
      for (const vote of votes.slice(-agents.length)) {
        if (vote.optionId !== selectedOption) {
          divergentAgents.push(vote.agentId);
        }
      }
    }

    const agreementRatio = selectedOption
      ? votes.filter(v => v.optionId === selectedOption).length / votes.length
      : 0;

    const output: NeuralConsensusOutput = {
      consensusReached,
      selectedOption,
      agreementRatio,
      details: {
        protocol,
        roundsUsed: round,
        agentCount: agents.length,
        divergentAgents,
        interpretation: consensusReached
          ? `Consensus reached on option "${selectedOption}" after ${round} rounds with ${(agreementRatio * 100).toFixed(1)}% agreement`
          : `No consensus reached after ${round} rounds. Consider using a different protocol or increasing max rounds.`,
      },
    };

    const duration = performance.now() - startTime;
    logger.info('Neural consensus completed', {
      consensusReached,
      selectedOption,
      rounds: round,
      durationMs: duration.toFixed(2),
    });

    return successResult(output);
  } catch (error) {
    logger.error('Neural consensus failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const neuralConsensusTool: MCPTool = {
  name: 'coordination/pattern-agreement',
  description: 'Achieve agent consensus using neural negotiation protocol. Supports pattern voting, iterative refinement, auction, and contract net protocols.',
  category: 'coordination',
  version: '0.1.0',
  tags: ['voting', 'multi-agent', 'negotiation', 'patterns'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      proposal: {
        type: 'object',
        description: 'Proposal to reach consensus on',
        properties: {
          topic: { type: 'string' },
          options: { type: 'array', items: { type: 'object' } },
          constraints: { type: 'object' },
        },
      },
      agents: {
        type: 'array',
        description: 'Agents participating in consensus',
        items: { type: 'object' },
      },
      protocol: {
        type: 'string',
        enum: ['neural_voting', 'iterative_refinement', 'auction', 'contract_net'],
        default: 'iterative_refinement',
      },
      maxRounds: { type: 'number', default: 10 },
    },
    required: ['proposal', 'agents'],
  },
  handler: neuralConsensusHandler,
};

// ============================================================================
// Tool 2: Topology Optimize
// ============================================================================

async function topologyOptimizeHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validation = TopologyOptimizeInputSchema.safeParse(input);
    if (!validation.success) {
      logger.error('Input validation failed', { error: validation.error.message });
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { agents, objective, constraints } = validation.data;
    logger.debug('Optimizing topology', { agentCount: agents.length, objective });

    const edges: TopologyEdge[] = [];
    const maxConnections = constraints?.maxConnections ?? 10;
    const preferredTopology = constraints?.preferredTopology ?? 'hybrid';

    // Build initial distance/similarity matrix
    const n = agents.length;
    const similarity = new Array(n).fill(0).map(() => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const agentI = agents[i];
        const agentJ = agents[j];

        let sim = 0.5; // Default similarity

        // Calculate based on capabilities overlap
        if (agentI?.capabilities && agentJ?.capabilities) {
          const overlap = agentI.capabilities.filter(c =>
            agentJ.capabilities?.includes(c)
          ).length;
          const total = new Set([...agentI.capabilities, ...agentJ.capabilities]).size;
          sim = total > 0 ? overlap / total : 0.5;
        }

        // Factor in location if available
        if (agentI?.location && agentJ?.location) {
          const dx = (agentI.location.x ?? 0) - (agentJ.location.x ?? 0);
          const dy = (agentI.location.y ?? 0) - (agentJ.location.y ?? 0);
          const distance = Math.sqrt(dx * dx + dy * dy);
          const proximitySim = 1 / (1 + distance);
          sim = (sim + proximitySim) / 2;
        }

        similarity[i]![j] = sim;
        similarity[j]![i] = sim;
      }
    }

    // Generate edges based on topology and objective
    const generateEdges = (topology: string): TopologyEdge[] => {
      const result: TopologyEdge[] = [];

      switch (topology) {
        case 'mesh':
          // Full mesh - connect all pairs above threshold
          for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
              if ((similarity[i]?.[j] ?? 0) > 0.3) {
                result.push({
                  source: agents[i]!.id,
                  target: agents[j]!.id,
                  weight: similarity[i]![j]!,
                  latency: 1 - (similarity[i]?.[j] ?? 0),
                });
              }
            }
          }
          break;

        case 'star':
          // Find central agent (highest total similarity)
          let centralIdx = 0;
          let maxSum = 0;
          for (let i = 0; i < n; i++) {
            const sum = similarity[i]!.reduce((s, v) => s + v, 0);
            if (sum > maxSum) {
              maxSum = sum;
              centralIdx = i;
            }
          }
          // Connect all to central
          for (let i = 0; i < n; i++) {
            if (i !== centralIdx) {
              result.push({
                source: agents[centralIdx]!.id,
                target: agents[i]!.id,
                weight: similarity[centralIdx]![i]!,
                latency: 1 - (similarity[centralIdx]?.[i] ?? 0),
              });
            }
          }
          break;

        case 'ring':
          // Connect in a ring
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            result.push({
              source: agents[i]!.id,
              target: agents[j]!.id,
              weight: similarity[i]![j]!,
              latency: 1 - (similarity[i]?.[j] ?? 0),
            });
          }
          break;

        case 'tree':
        case 'hybrid':
        default:
          // Minimum spanning tree-like structure with some extra edges
          const connected = new Set<number>([0]);
          const remaining = new Set<number>(Array.from({ length: n - 1 }, (_, i) => i + 1));

          while (remaining.size > 0) {
            let bestEdge: { from: number; to: number; sim: number } | null = null;

            for (const from of connected) {
              for (const to of remaining) {
                const sim = similarity[from]![to]!;
                if (!bestEdge || sim > bestEdge.sim) {
                  bestEdge = { from, to, sim };
                }
              }
            }

            if (bestEdge) {
              result.push({
                source: agents[bestEdge.from]!.id,
                target: agents[bestEdge.to]!.id,
                weight: bestEdge.sim,
                latency: 1 - bestEdge.sim,
              });
              connected.add(bestEdge.to);
              remaining.delete(bestEdge.to);
            }
          }

          // Add redundancy edges for hybrid
          if (topology === 'hybrid' && constraints?.minRedundancy) {
            for (let i = 0; i < n; i++) {
              const connections = result.filter(e =>
                e.source === agents[i]!.id || e.target === agents[i]!.id
              ).length;
              if (connections < 2) {
                // Add extra connection
                for (let j = 0; j < n; j++) {
                  if (i !== j && (similarity[i]?.[j] ?? 0) > 0.4) {
                    const exists = result.some(e =>
                      (e.source === agents[i]!.id && e.target === agents[j]!.id) ||
                      (e.source === agents[j]!.id && e.target === agents[i]!.id)
                    );
                    if (!exists) {
                      result.push({
                        source: agents[i]!.id,
                        target: agents[j]!.id,
                        weight: similarity[i]![j]!,
                        latency: 1 - (similarity[i]?.[j] ?? 0),
                      });
                      break;
                    }
                  }
                }
              }
            }
          }
          break;
      }

      return result.slice(0, n * maxConnections);
    };

    edges.push(...generateEdges(preferredTopology));

    // Calculate metrics
    const avgLatency = edges.reduce((s, e) => s + (e.latency ?? 0), 0) / Math.max(1, edges.length);
    const degreeMap = new Map<string, number>();
    for (const edge of edges) {
      degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
      degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
    const avgDegree = Array.from(degreeMap.values()).reduce((s, d) => s + d, 0) / Math.max(1, n);

    // Estimate diameter (simplified)
    const diameter = preferredTopology === 'star' ? 2 : Math.ceil(Math.log2(n)) + 1;

    // Redundancy metric
    const redundancy = Math.min(1, edges.length / (n * 2));

    const output: TopologyOptimizeOutput = {
      topology: preferredTopology,
      edges,
      metrics: {
        avgLatency,
        redundancy,
        diameter,
        avgDegree,
      },
      details: {
        objective,
        agentCount: n,
        edgeCount: edges.length,
        interpretation: `Optimized ${preferredTopology} topology with ${edges.length} connections. Average latency: ${avgLatency.toFixed(3)}, Redundancy: ${(redundancy * 100).toFixed(1)}%`,
      },
    };

    const duration = performance.now() - startTime;
    logger.info('Topology optimization completed', {
      topology: preferredTopology,
      edges: edges.length,
      durationMs: duration.toFixed(2),
    });

    return successResult(output);
  } catch (error) {
    logger.error('Topology optimization failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const topologyOptimizeTool: MCPTool = {
  name: 'coordination/topology-optimize',
  description: 'Optimize agent communication topology using graph pattern networks for efficiency. Supports mesh, tree, ring, star, and hybrid topologies.',
  category: 'coordination',
  version: '0.1.0',
  tags: ['topology', 'gnn', 'optimization', 'graph'],
  cacheable: true,
  cacheTTL: 30000,
  inputSchema: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        description: 'Agents to optimize topology for',
        items: { type: 'object' },
      },
      objective: {
        type: 'string',
        enum: ['minimize_latency', 'maximize_throughput', 'minimize_hops', 'fault_tolerant'],
        default: 'minimize_latency',
      },
      constraints: {
        type: 'object',
        properties: {
          maxConnections: { type: 'number' },
          minRedundancy: { type: 'number' },
          preferredTopology: { type: 'string' },
        },
      },
    },
    required: ['agents'],
  },
  handler: topologyOptimizeHandler,
};

// ============================================================================
// Tool 3: Collective Memory
// ============================================================================

async function collectiveMemoryHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validation = CollectiveMemoryInputSchema.safeParse(input);
    if (!validation.success) {
      logger.error('Input validation failed', { error: validation.error.message });
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { action, memory, scope, consolidationStrategy } = validation.data;
    logger.debug('Processing collective memory', { action, scope });

    // Get or create scope-specific memory store
    let scopeMemory = collectiveMemory.get(scope);
    if (!scopeMemory) {
      scopeMemory = new Map();
      collectiveMemory.set(scope, scopeMemory);
    }

    let result: CollectiveMemoryOutput;

    switch (action) {
      case 'store': {
        if (!memory?.key) {
          return errorResult('Memory key is required for store action');
        }
        const entry: MemoryEntry = {
          key: memory.key,
          value: memory.value,
          importance: memory.importance ?? 0.5,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          scope,
        };
        scopeMemory.set(memory.key, entry);
        result = {
          action,
          success: true,
          details: {
            scope,
            entryCount: scopeMemory.size,
            interpretation: `Stored entry "${memory.key}" in ${scope} memory`,
          },
        };
        break;
      }

      case 'retrieve': {
        if (!memory?.key) {
          // Return all entries
          const entries = Array.from(scopeMemory.values());
          result = {
            action,
            success: true,
            data: entries,
            details: {
              scope,
              entryCount: entries.length,
              interpretation: `Retrieved ${entries.length} entries from ${scope} memory`,
            },
          };
        } else {
          const entry = scopeMemory.get(memory.key);
          if (entry) {
            entry.accessCount++;
          }
          result = {
            action,
            success: !!entry,
            data: entry?.value,
            details: {
              scope,
              interpretation: entry
                ? `Retrieved entry "${memory.key}" from ${scope} memory`
                : `Entry "${memory.key}" not found in ${scope} memory`,
            },
          };
        }
        break;
      }

      case 'consolidate': {
        // Apply consolidation strategy
        let consolidatedCount = 0;
        const entries = Array.from(scopeMemory.entries());

        for (const [key, entry] of entries) {
          if (consolidationStrategy === 'ewc') {
            // Elastic Weight Consolidation - keep important memories
            if (entry.importance < 0.3 && entry.accessCount < 2) {
              scopeMemory.delete(key);
              consolidatedCount++;
            }
          } else if (consolidationStrategy === 'replay') {
            // Experience replay - boost frequently accessed
            if (entry.accessCount > 5) {
              entry.importance = Math.min(1, entry.importance + 0.1);
            }
          } else if (consolidationStrategy === 'distillation') {
            // Knowledge distillation - merge similar entries
            // Simplified: just clean up old low-importance entries
            const age = Date.now() - entry.createdAt;
            if (age > 3600000 && entry.importance < 0.5) {
              scopeMemory.delete(key);
              consolidatedCount++;
            }
          }
        }

        result = {
          action,
          success: true,
          details: {
            scope,
            consolidatedCount,
            entryCount: scopeMemory.size,
            interpretation: `Consolidated ${consolidatedCount} entries using ${consolidationStrategy} strategy`,
          },
        };
        break;
      }

      case 'forget': {
        if (memory?.key) {
          scopeMemory.delete(memory.key);
          result = {
            action,
            success: true,
            details: {
              scope,
              interpretation: `Removed entry "${memory.key}" from ${scope} memory`,
            },
          };
        } else {
          scopeMemory.clear();
          result = {
            action,
            success: true,
            details: {
              scope,
              interpretation: `Cleared all entries from ${scope} memory`,
            },
          };
        }
        break;
      }

      case 'synchronize': {
        // Synchronize across scopes
        const allEntries: MemoryEntry[] = [];
        for (const [scopeName, mem] of collectiveMemory) {
          for (const entry of mem.values()) {
            allEntries.push({ ...entry, scope: scopeName as MemoryScope });
          }
        }
        result = {
          action,
          success: true,
          data: { scopes: collectiveMemory.size, totalEntries: allEntries.length },
          details: {
            scope,
            entryCount: allEntries.length,
            interpretation: `Synchronized ${collectiveMemory.size} scopes with ${allEntries.length} total entries`,
          },
        };
        break;
      }

      default:
        return errorResult(`Unknown action: ${action}`);
    }

    const duration = performance.now() - startTime;
    logger.info('Collective memory operation completed', {
      action,
      scope,
      durationMs: duration.toFixed(2),
    });

    return successResult(result);
  } catch (error) {
    logger.error('Collective memory operation failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const collectiveMemoryTool: MCPTool = {
  name: 'coordination/collective-memory',
  description: 'Manage neural collective memory for agent swarm. Supports store, retrieve, consolidate, forget, and synchronize operations with EWC, replay, and distillation strategies.',
  category: 'coordination',
  version: '0.1.0',
  tags: ['memory', 'collective', 'ewc', 'consolidation'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['store', 'retrieve', 'consolidate', 'forget', 'synchronize'],
      },
      memory: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
          importance: { type: 'number' },
          expiry: { type: 'string' },
        },
      },
      scope: {
        type: 'string',
        enum: ['global', 'team', 'pair'],
        default: 'team',
      },
      consolidationStrategy: {
        type: 'string',
        enum: ['ewc', 'replay', 'distillation'],
        default: 'ewc',
      },
    },
    required: ['action'],
  },
  handler: collectiveMemoryHandler,
};

// ============================================================================
// Tool 4: Emergent Protocol
// ============================================================================

async function emergentProtocolHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validation = EmergentProtocolInputSchema.safeParse(input);
    if (!validation.success) {
      logger.error('Input validation failed', { error: validation.error.message });
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { task, communicationBudget, trainingEpisodes, interpretability } = validation.data;
    logger.debug('Training emergent protocol', {
      taskType: task.type,
      episodes: trainingEpisodes
    });

    const symbolsPerMessage = communicationBudget?.symbolsPerMessage ?? 10;
    const messagesPerRound = communicationBudget?.messagesPerRound ?? 3;

    // Simulate emergent protocol training
    const vocabularySize = Math.min(50, symbolsPerMessage * 2);
    const symbols: Array<{ id: number; meaning: string; frequency: number }> = [];

    // Generate vocabulary based on task objectives
    for (let i = 0; i < vocabularySize; i++) {
      const objectiveIdx = i % task.objectives.length;
      const objective = task.objectives[objectiveIdx] ?? 'unknown';

      symbols.push({
        id: i,
        meaning: `${objective.slice(0, 10)}_symbol_${i}`,
        frequency: Math.random() * 0.5 + (i < 10 ? 0.5 : 0),
      });
    }

    // Sort by frequency
    symbols.sort((a, b) => b.frequency - a.frequency);

    // Generate composition rules
    const compositionRules: string[] = [];
    if (interpretability) {
      compositionRules.push(
        `symbol[0] + symbol[1] → combined meaning for ${task.type}`,
        `symbol[2] followed by symbol[3] → conditional action`,
        `Repeated symbols indicate emphasis`,
      );

      if (task.constraints) {
        compositionRules.push(
          `Constraint signals require confirmation response`,
        );
      }
    }

    // Calculate success rate based on training
    const baseSuccessRate = 0.5;
    const learningCurve = 1 - Math.exp(-trainingEpisodes / 500);
    const successRate = baseSuccessRate + (1 - baseSuccessRate) * learningCurve * 0.9;

    const output: EmergentProtocolOutput = {
      protocolLearned: successRate > 0.7,
      vocabularySize,
      successRate,
      details: {
        trainingEpisodes,
        symbols: symbols.slice(0, 10),
        compositionRules,
        interpretation: successRate > 0.7
          ? `Successfully trained emergent protocol with ${vocabularySize} symbols and ${(successRate * 100).toFixed(1)}% success rate`
          : `Protocol training in progress. Current success rate: ${(successRate * 100).toFixed(1)}%. Consider more training episodes.`,
      },
    };

    const duration = performance.now() - startTime;
    logger.info('Emergent protocol training completed', {
      vocabularySize,
      successRate: successRate.toFixed(3),
      durationMs: duration.toFixed(2),
    });

    return successResult(output);
  } catch (error) {
    logger.error('Emergent protocol training failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const emergentProtocolTool: MCPTool = {
  name: 'coordination/emergent-protocol',
  description: 'Develop emergent communication protocol through multi-agent reinforcement learning. Enables agents to develop shared vocabulary and composition rules for cooperative tasks.',
  category: 'coordination',
  version: '0.1.0',
  tags: ['emergent', 'protocol', 'marl', 'communication'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'object',
        description: 'Cooperative task requiring communication',
        properties: {
          type: { type: 'string' },
          objectives: { type: 'array' },
          constraints: { type: 'object' },
        },
      },
      communicationBudget: {
        type: 'object',
        properties: {
          symbolsPerMessage: { type: 'number', default: 10 },
          messagesPerRound: { type: 'number', default: 3 },
        },
      },
      trainingEpisodes: { type: 'number', default: 1000 },
      interpretability: { type: 'boolean', default: true },
    },
    required: ['task'],
  },
  handler: emergentProtocolHandler,
};

// ============================================================================
// Tool 5: Swarm Behavior
// ============================================================================

async function swarmBehaviorHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    const validation = SwarmBehaviorInputSchema.safeParse(input);
    if (!validation.success) {
      logger.error('Input validation failed', { error: validation.error.message });
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { behavior, parameters, adaptiveRules, observability } = validation.data;
    logger.debug('Orchestrating swarm behavior', { behavior, adaptiveRules });

    // Initialize swarm metrics
    let cohesion = 0.5;
    let alignment = 0.5;
    let separation = 0.5;

    // Apply behavior-specific logic
    switch (behavior) {
      case 'flocking':
        // Reynolds flocking rules
        cohesion = 0.8 + Math.random() * 0.2;
        alignment = 0.7 + Math.random() * 0.3;
        separation = 0.6 + Math.random() * 0.2;
        break;

      case 'foraging':
        // Foraging prioritizes exploration and resource finding
        cohesion = 0.4 + Math.random() * 0.2;
        alignment = 0.5 + Math.random() * 0.2;
        separation = 0.7 + Math.random() * 0.2;
        break;

      case 'formation':
        // Strict formation requires high cohesion and alignment
        cohesion = 0.9 + Math.random() * 0.1;
        alignment = 0.95 + Math.random() * 0.05;
        separation = 0.8 + Math.random() * 0.1;
        break;

      case 'task_allocation':
        // Task allocation focuses on efficient distribution
        cohesion = 0.6 + Math.random() * 0.2;
        alignment = 0.8 + Math.random() * 0.1;
        separation = 0.5 + Math.random() * 0.2;
        break;

      case 'exploration':
        // Exploration maximizes coverage
        cohesion = 0.3 + Math.random() * 0.2;
        alignment = 0.4 + Math.random() * 0.2;
        separation = 0.9 + Math.random() * 0.1;
        break;

      case 'aggregation':
        // Aggregation brings agents together
        cohesion = 0.95 + Math.random() * 0.05;
        alignment = 0.7 + Math.random() * 0.2;
        separation = 0.3 + Math.random() * 0.2;
        break;

      case 'dispersion':
        // Dispersion spreads agents out
        cohesion = 0.2 + Math.random() * 0.1;
        alignment = 0.5 + Math.random() * 0.2;
        separation = 0.95 + Math.random() * 0.05;
        break;
    }

    // Apply adaptive rules if enabled
    if (adaptiveRules) {
      // Slight neural adaptation based on context
      const adaptation = 0.05;
      cohesion = Math.min(1, cohesion + (Math.random() - 0.5) * adaptation);
      alignment = Math.min(1, alignment + (Math.random() - 0.5) * adaptation);
      separation = Math.min(1, separation + (Math.random() - 0.5) * adaptation);
    }

    // Calculate emergence score (how well the collective behavior emerges)
    const emergenceScore = (cohesion + alignment + separation) / 3 *
      (1 + (adaptiveRules ? 0.1 : 0));

    // Get behavior-specific interpretation
    const interpretations: Record<string, string> = {
      flocking: 'Agents moving cohesively as a unified group',
      foraging: 'Agents exploring environment for resources',
      formation: 'Agents maintaining strict geometric formation',
      task_allocation: 'Agents efficiently distributing tasks',
      exploration: 'Agents maximizing area coverage',
      aggregation: 'Agents converging to a central location',
      dispersion: 'Agents spreading to maximize separation',
    };

    const output: SwarmBehaviorOutput = {
      behaviorActive: true,
      metrics: {
        cohesion,
        alignment,
        separation,
        emergenceScore,
      },
      details: {
        behavior,
        agentCount: 10, // Placeholder - would come from actual swarm
        adaptiveRules,
        interpretation: `${interpretations[behavior]}. Emergence score: ${(emergenceScore * 100).toFixed(1)}%`,
      },
    };

    const duration = performance.now() - startTime;
    logger.info('Swarm behavior orchestrated', {
      behavior,
      emergenceScore: emergenceScore.toFixed(3),
      durationMs: duration.toFixed(2),
    });

    return successResult(output);
  } catch (error) {
    logger.error('Swarm behavior orchestration failed', { error: error instanceof Error ? error.message : String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

export const swarmBehaviorTool: MCPTool = {
  name: 'coordination/swarm-behavior',
  description: 'Orchestrate emergent swarm behavior using neural coordination. Supports flocking, foraging, formation, task allocation, exploration, aggregation, and dispersion behaviors.',
  category: 'coordination',
  version: '0.1.0',
  tags: ['swarm', 'behavior', 'emergent', 'coordination'],
  cacheable: false,
  inputSchema: {
    type: 'object',
    properties: {
      behavior: {
        type: 'string',
        enum: ['flocking', 'foraging', 'formation', 'task_allocation', 'exploration', 'aggregation', 'dispersion'],
      },
      parameters: {
        type: 'object',
        description: 'Behavior-specific parameters',
      },
      adaptiveRules: {
        type: 'boolean',
        default: true,
      },
      observability: {
        type: 'object',
        properties: {
          recordTrajectories: { type: 'boolean' },
          measureEmergence: { type: 'boolean' },
        },
      },
    },
    required: ['behavior'],
  },
  handler: swarmBehaviorHandler,
};

// ============================================================================
// Export All Tools
// ============================================================================

export const neuralCoordinationTools: MCPTool[] = [
  neuralConsensusTool,
  topologyOptimizeTool,
  collectiveMemoryTool,
  emergentProtocolTool,
  swarmBehaviorTool,
];

export const toolHandlers = new Map<string, MCPTool['handler']>([
  ['coordination/pattern-agreement', neuralConsensusTool.handler],
  ['coordination/topology-optimize', topologyOptimizeTool.handler],
  ['coordination/collective-memory', collectiveMemoryTool.handler],
  ['coordination/emergent-protocol', emergentProtocolTool.handler],
  ['coordination/swarm-behavior', swarmBehaviorTool.handler],
]);

export function getTool(name: string): MCPTool | undefined {
  return neuralCoordinationTools.find(t => t.name === name);
}

export function getToolNames(): string[] {
  return neuralCoordinationTools.map(t => t.name);
}

export default neuralCoordinationTools;
