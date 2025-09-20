/**
 * Comprehensive Integration Tests for Claude Flow MCP System
 * Testing real implementations of memory, swarm coordination, AIME integration, and MCP protocol
 */

import { jest } from '@jest/globals';
import { SwarmCoordinator } from '../../swarm/coordinator.js';
import { RealMemoryManager } from '../../memory/real-memory-manager.js';
import { createTempDir, cleanupTempDir } from '../helpers/test-utils.js';
import { EventEmitter } from 'events';
import path from 'path';

describe('Claude Flow MCP System Integration', () => {
  let coordinator: SwarmCoordinator;
  let memoryManager: RealMemoryManager;
  let testDir: string;
  let mockLogger: any;

  beforeAll(async () => {
    testDir = await createTempDir('integration-test');
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  afterAll(async () => {
    await cleanupTempDir(testDir);
  });

  beforeEach(async () => {
    // Initialize memory manager
    memoryManager = new RealMemoryManager({
      persistenceDir: path.join(testDir, 'memory'),
      sessionId: 'integration-test',
      logger: mockLogger,
      vectorSearchEnabled: true,
      compressionEnabled: true
    });
    await memoryManager.initialize();

    // Initialize swarm coordinator with memory integration
    coordinator = new SwarmCoordinator({
      mode: 'distributed',
      strategy: 'adaptive',
      maxAgents: 5,
      topology: 'mesh',
      memoryManager,
      logging: {
        level: 'info',
        format: 'json',
        destination: 'console'
      }
    });
    await coordinator.initialize();
  });

  afterEach(async () => {
    if (coordinator) {
      await coordinator.shutdown();
    }
    if (memoryManager) {
      await memoryManager.clearNamespace('default');
    }
  });

  describe('Memory-Swarm Integration', () => {
    it('should persist swarm coordination data in memory system', async () => {
      // Spawn agents and create tasks
      const agentId = await coordinator.spawnAgent({
        type: 'coder',
        name: 'Integration Test Coder',
        capabilities: ['javascript', 'testing']
      });

      const taskDefinition = {
        id: 'integration-task-1',
        type: 'code' as const,
        description: 'Test memory-swarm integration',
        priority: 'high' as const,
        estimatedDuration: 30000
      };

      await coordinator.assignTask(agentId, taskDefinition);

      // Verify swarm state is persisted in memory
      const swarmState = await memoryManager.retrieve('swarm_state', 'coordination');
      expect(swarmState).toBeDefined();

      const agentMemory = await memoryManager.query({
        namespace: 'agents',
        tags: ['agent-state']
      });
      expect(agentMemory.results.length).toBeGreaterThan(0);

      const taskMemory = await memoryManager.query({
        namespace: 'tasks',
        search: 'integration-task-1'
      });
      expect(taskMemory.results.length).toBeGreaterThan(0);
    });

    it('should restore swarm state from memory on restart', async () => {
      // Create initial state
      const agentId = await coordinator.spawnAgent({
        type: 'researcher',
        name: 'Persistent Researcher'
      });

      await coordinator.queueTask({
        id: 'persistent-task',
        type: 'research' as const,
        description: 'Task that should persist',
        priority: 'medium' as const
      });

      // Store coordination state in memory
      await memoryManager.store({
        key: 'swarm_coordination_state',
        value: {
          agents: await coordinator.listAgents(),
          tasks: await coordinator.listTasks(),
          metrics: await coordinator.getMetrics()
        },
        namespace: 'coordination',
        category: 'persistence',
        tags: ['swarm-state', 'checkpoint']
      });

      // Shutdown and restart coordinator
      await coordinator.shutdown();

      const newCoordinator = new SwarmCoordinator({
        mode: 'distributed',
        strategy: 'adaptive',
        maxAgents: 5,
        topology: 'mesh',
        memoryManager,
        restoreFromMemory: true
      });
      await newCoordinator.initialize();

      try {
        // Verify state restoration
        const restoredState = await memoryManager.retrieve('swarm_coordination_state', 'coordination');
        expect(restoredState).toBeDefined();
        expect(restoredState.value.agents.length).toBe(1);
        expect(restoredState.value.tasks.length).toBe(1);

        // Verify coordinator can continue operations
        const newAgentId = await newCoordinator.spawnAgent({ type: 'coder' });
        expect(newAgentId).toBeDefined();

      } finally {
        await newCoordinator.shutdown();
      }
    });

    it('should enable semantic search across swarm operations', async () => {
      // Create agents with different specializations
      const coderAgent = await coordinator.spawnAgent({
        type: 'coder',
        name: 'JavaScript Developer',
        capabilities: ['javascript', 'react', 'nodejs']
      });

      const researcherAgent = await coordinator.spawnAgent({
        type: 'researcher',
        name: 'AI Researcher',
        capabilities: ['machine-learning', 'data-analysis', 'research']
      });

      // Create tasks with rich descriptions
      const tasks = [
        {
          id: 'js-optimization',
          type: 'code' as const,
          description: 'Optimize JavaScript performance for React components using memoization and virtual DOM techniques',
          priority: 'high' as const,
          tags: ['javascript', 'react', 'performance']
        },
        {
          id: 'ml-research',
          type: 'research' as const,
          description: 'Research latest machine learning algorithms for natural language processing and transformer architectures',
          priority: 'medium' as const,
          tags: ['machine-learning', 'nlp', 'transformers']
        }
      ];

      for (const task of tasks) {
        await coordinator.queueTask(task);
      }

      // Store task and agent information in memory for semantic search
      await memoryManager.store({
        key: `agent_${coderAgent}`,
        value: {
          id: coderAgent,
          type: 'coder',
          capabilities: ['javascript', 'react', 'nodejs'],
          description: 'Expert JavaScript developer specializing in React and Node.js applications'
        },
        namespace: 'agents',
        tags: ['agent', 'coder', 'javascript', 'react']
      });

      await memoryManager.store({
        key: `agent_${researcherAgent}`,
        value: {
          id: researcherAgent,
          type: 'researcher', 
          capabilities: ['machine-learning', 'data-analysis', 'research'],
          description: 'AI researcher focused on machine learning algorithms and natural language processing'
        },
        namespace: 'agents',
        tags: ['agent', 'researcher', 'ai', 'machine-learning']
      });

      // Perform semantic searches
      const jsSearchResults = await memoryManager.query({
        semanticSearch: 'React JavaScript frontend optimization performance',
        namespace: 'agents'
      });
      expect(jsSearchResults.results.length).toBeGreaterThan(0);
      expect(jsSearchResults.results[0].value.type).toBe('coder');

      const mlSearchResults = await memoryManager.query({
        semanticSearch: 'artificial intelligence neural networks deep learning',
        namespace: 'agents'
      });
      expect(mlSearchResults.results.length).toBeGreaterThan(0);
      expect(mlSearchResults.results[0].value.type).toBe('researcher');
    });
  });

  describe('AIME System Integration', () => {
    it('should support AIME dual planning with swarm coordination', async () => {
      // Store AIME mission context
      const missionContext = {
        objective: 'Build comprehensive test suite for Claude Flow MCP',
        phases: [
          {
            id: 'planning',
            description: 'Analyze requirements and create test plan',
            estimatedDuration: 3600000, // 1 hour
            dependencies: []
          },
          {
            id: 'unit-testing',
            description: 'Create unit tests for all components',
            estimatedDuration: 7200000, // 2 hours
            dependencies: ['planning']
          },
          {
            id: 'integration-testing',
            description: 'Create integration tests',
            estimatedDuration: 5400000, // 1.5 hours
            dependencies: ['unit-testing']
          }
        ],
        requiredAgents: [
          { type: 'analyst', count: 1, capabilities: ['requirement-analysis'] },
          { type: 'coder', count: 2, capabilities: ['testing', 'javascript'] },
          { type: 'coordinator', count: 1, capabilities: ['project-management'] }
        ]
      };

      await memoryManager.store({
        key: 'aime_mission_context',
        value: missionContext,
        namespace: 'aime',
        category: 'planning',
        tags: ['mission', 'dual-planning', 'phases']
      });

      // AIME strategic planning phase
      const strategicPlan = {
        missionId: 'test-suite-mission',
        phases: missionContext.phases,
        resourceAllocation: {
          totalAgents: 4,
          phaseAssignments: {
            planning: ['analyst', 'coordinator'],
            'unit-testing': ['coder', 'coder'],
            'integration-testing': ['coder', 'coordinator']
          }
        },
        riskAssessment: {
          risks: ['timeline-delay', 'resource-shortage'],
          mitigations: ['parallel-execution', 'agent-scaling']
        }
      };

      await memoryManager.store({
        key: 'strategic_plan',
        value: strategicPlan,
        namespace: 'aime',
        category: 'planning',
        tags: ['strategic', 'phases', 'resources']
      });

      // AIME tactical planning phase  
      const tacticalPlan = {
        missionId: 'test-suite-mission',
        tasks: [
          {
            id: 'analyze-components',
            phaseId: 'planning',
            description: 'Analyze system components for test coverage',
            assignedAgent: 'analyst',
            duration: 1800000
          },
          {
            id: 'create-memory-tests',
            phaseId: 'unit-testing',
            description: 'Create unit tests for memory system',
            assignedAgent: 'coder-1',
            duration: 3600000
          },
          {
            id: 'create-swarm-tests',
            phaseId: 'unit-testing', 
            description: 'Create unit tests for swarm coordinator',
            assignedAgent: 'coder-2',
            duration: 3600000
          }
        ],
        toolAssignments: {
          'analyze-components': ['memory-manager', 'query-tools'],
          'create-memory-tests': ['jest', 'typescript', 'mocking-tools'],
          'create-swarm-tests': ['jest', 'typescript', 'event-emitter']
        }
      };

      await memoryManager.store({
        key: 'tactical_plan',
        value: tacticalPlan,
        namespace: 'aime',
        category: 'planning',
        tags: ['tactical', 'tasks', 'assignments']
      });

      // Spawn agents based on AIME planning
      const analystAgent = await coordinator.spawnAgent({
        type: 'analyst',
        name: 'Requirements Analyst',
        capabilities: ['requirement-analysis', 'system-analysis']
      });

      const coder1Agent = await coordinator.spawnAgent({
        type: 'coder',
        name: 'Memory Test Developer',
        capabilities: ['testing', 'javascript', 'memory-systems']
      });

      const coder2Agent = await coordinator.spawnAgent({
        type: 'coder', 
        name: 'Swarm Test Developer',
        capabilities: ['testing', 'javascript', 'distributed-systems']
      });

      const coordinatorAgent = await coordinator.spawnAgent({
        type: 'coordinator',
        name: 'Test Project Coordinator',
        capabilities: ['project-management', 'coordination']
      });

      // Execute AIME tactical plan
      for (const task of tacticalPlan.tasks) {
        const agentMap = {
          'analyst': analystAgent,
          'coder-1': coder1Agent,
          'coder-2': coder2Agent,
          'coordinator': coordinatorAgent
        };

        const assignedAgent = agentMap[task.assignedAgent as keyof typeof agentMap];
        if (assignedAgent) {
          await coordinator.assignTask(assignedAgent, {
            id: task.id,
            type: task.phaseId as any,
            description: task.description,
            priority: 'high' as const,
            estimatedDuration: task.duration,
            metadata: {
              aimePhase: task.phaseId,
              aimeMission: 'test-suite-mission'
            }
          });
        }
      }

      // Verify AIME integration
      const assignedTasks = await coordinator.listTasks();
      expect(assignedTasks.length).toBe(3);
      expect(assignedTasks.every(t => t.assignedTo)).toBe(true);

      const aimeMemories = await memoryManager.query({
        namespace: 'aime',
        tags: ['planning']
      });
      expect(aimeMemories.results.length).toBe(2); // Strategic and tactical plans
    });

    it('should support AIME actor factory pattern', async () => {
      // Define AIME actor personas with knowledge domains
      const actorPersonas = {
        architect: {
          knowledge: ['system-design', 'scalability', 'cloud-architecture', 'microservices'],
          environment: ['design-tools', 'diagramming', 'architecture-frameworks'],
          format: ['technical-documentation', 'architectural-diagrams'],
          specialization: 'system-architecture'
        },
        researcher: {
          knowledge: ['literature-review', 'data-analysis', 'methodology', 'statistics'],
          environment: ['research-databases', 'analysis-tools', 'citation-managers'],
          format: ['academic-writing', 'research-reports', 'data-visualization'],
          specialization: 'research-analysis'
        },
        coder: {
          knowledge: ['programming-languages', 'frameworks', 'best-practices', 'testing'],
          environment: ['ide', 'debuggers', 'version-control', 'build-tools'],
          format: ['clean-code', 'documentation', 'test-coverage'],
          specialization: 'software-development'
        }
      };

      // Store actor personas in memory
      for (const [persona, config] of Object.entries(actorPersonas)) {
        await memoryManager.store({
          key: `aime_persona_${persona}`,
          value: config,
          namespace: 'aime',
          category: 'personas',
          tags: ['actor-factory', 'persona', persona]
        });
      }

      // AIME dynamic actor creation based on task requirements
      const complexTask = {
        id: 'system-redesign',
        description: 'Redesign the memory system architecture for better scalability and performance',
        requiredKnowledge: ['system-design', 'scalability', 'memory-management'],
        complexity: 'high',
        estimatedDuration: 14400000 // 4 hours
      };

      // Query memory for best matching personas
      const architectMatch = await memoryManager.query({
        namespace: 'aime',
        category: 'personas',
        semanticSearch: 'system design scalability architecture'
      });

      expect(architectMatch.results.length).toBeGreaterThan(0);
      const bestPersona = architectMatch.results[0];
      expect(bestPersona.key).toBe('aime_persona_architect');

      // Spawn agent with AIME persona configuration
      const architectAgent = await coordinator.spawnAgent({
        type: 'architect',
        name: 'System Architect (AIME Generated)',
        capabilities: bestPersona.value.knowledge,
        metadata: {
          aimePersona: 'architect',
          knowledgeDomain: bestPersona.value.knowledge,
          workingEnvironment: bestPersona.value.environment,
          outputFormat: bestPersona.value.format
        }
      });

      await coordinator.assignTask(architectAgent, {
        id: complexTask.id,
        type: 'design' as const,
        description: complexTask.description,
        priority: 'critical' as const,
        estimatedDuration: complexTask.estimatedDuration,
        metadata: {
          aimeGenerated: true,
          personaMatch: 'architect',
          complexity: complexTask.complexity
        }
      });

      // Verify AIME actor factory integration
      const agent = await coordinator.getAgent(architectAgent);
      expect(agent.metadata?.aimePersona).toBe('architect');
      expect(agent.capabilities).toEqual(bestPersona.value.knowledge);

      const task = await coordinator.getTask(complexTask.id);
      expect(task.metadata?.aimeGenerated).toBe(true);
      expect(task.metadata?.personaMatch).toBe('architect');
    });

    it('should support AIME adaptive planning and execution monitoring', async () => {
      // Initial AIME plan
      const initialPlan = {
        missionId: 'adaptive-mission',
        phases: [
          { id: 'phase-1', duration: 1800000, resources: 2 },
          { id: 'phase-2', duration: 3600000, resources: 3 }
        ],
        totalEstimatedTime: 5400000,
        riskFactors: ['resource-availability', 'timeline-pressure']
      };

      await memoryManager.store({
        key: 'initial_aime_plan',
        value: initialPlan,
        namespace: 'aime',
        category: 'planning',
        tags: ['adaptive', 'initial-plan']
      });

      // Spawn agents for initial plan
      const agents = await Promise.all([
        coordinator.spawnAgent({ type: 'coder', name: 'Dev-1' }),
        coordinator.spawnAgent({ type: 'tester', name: 'QA-1' }),
        coordinator.spawnAgent({ type: 'researcher', name: 'Research-1' })
      ]);

      // Simulate execution monitoring and adaptation trigger
      const executionProgress = {
        currentPhase: 'phase-1',
        completedTasks: 1,
        totalTasks: 4,
        actualDuration: 2700000, // 50% longer than estimated
        resourceUtilization: 85,
        blockers: ['dependency-delay', 'resource-contention']
      };

      await memoryManager.store({
        key: 'execution_progress',
        value: executionProgress,
        namespace: 'aime',
        category: 'monitoring',
        tags: ['execution', 'progress', 'metrics']
      });

      // AIME adaptive planning - trigger plan modification
      const adaptationTrigger = {
        type: 'timeline-delay',
        severity: 'medium',
        impact: {
          estimatedDelay: 1800000, // 30 minutes
          affectedPhases: ['phase-1', 'phase-2'],
          recommendedActions: ['resource-scaling', 'parallel-execution']
        }
      };

      await memoryManager.store({
        key: 'adaptation_trigger',
        value: adaptationTrigger,
        namespace: 'aime',
        category: 'adaptation',
        tags: ['trigger', 'timeline-delay', 'planning']
      });

      // Adaptive plan modification
      const adaptedPlan = {
        missionId: 'adaptive-mission',
        phases: [
          { 
            id: 'phase-1', 
            duration: 2700000, // Updated based on actual progress
            resources: 3, // Scaled up
            status: 'in-progress'
          },
          { 
            id: 'phase-2', 
            duration: 2700000, // Reduced through parallelization
            resources: 4, // Additional resources
            modifications: ['parallel-execution', 'resource-boost']
          }
        ],
        totalEstimatedTime: 5400000, // Maintained through optimization
        adaptations: [
          {
            trigger: 'timeline-delay',
            action: 'resource-scaling',
            timestamp: new Date().toISOString()
          }
        ]
      };

      await memoryManager.store({
        key: 'adapted_aime_plan',
        value: adaptedPlan,
        namespace: 'aime',
        category: 'planning',
        tags: ['adaptive', 'modified-plan', 'resource-scaling']
      });

      // Spawn additional agent for scaled resources
      const additionalAgent = await coordinator.spawnAgent({
        type: 'coder',
        name: 'Dev-2 (Adaptive Scaling)',
        metadata: {
          aimeAdaptive: true,
          scalingReason: 'timeline-delay',
          originalPlan: 'adaptive-mission'
        }
      });

      // Verify adaptive planning integration
      const allAgents = await coordinator.listAgents();
      expect(allAgents.length).toBe(4); // Original 3 + 1 additional

      const adaptiveAgent = allAgents.find(a => a.metadata?.aimeAdaptive);
      expect(adaptiveAgent).toBeDefined();
      expect(adaptiveAgent?.metadata?.scalingReason).toBe('timeline-delay');

      const adaptationMemories = await memoryManager.query({
        namespace: 'aime',
        tags: ['adaptive', 'planning']
      });
      expect(adaptationMemories.results.length).toBe(2); // Initial and adapted plans
    });
  });

  describe('MCP Protocol Integration', () => {
    it('should handle MCP tool routing with swarm coordination', async () => {
      // Store MCP tool configurations
      const mcpTools = [
        {
          name: 'memory-manager',
          type: 'memory',
          capabilities: ['store', 'retrieve', 'query', 'vector-search'],
          routing: 'local'
        },
        {
          name: 'task-orchestrator',
          type: 'coordination',
          capabilities: ['assign', 'monitor', 'complete'],
          routing: 'swarm'
        },
        {
          name: 'code-analyzer',
          type: 'analysis',
          capabilities: ['parse', 'analyze', 'report'],
          routing: 'agent'
        }
      ];

      for (const tool of mcpTools) {
        await memoryManager.store({
          key: `mcp_tool_${tool.name}`,
          value: tool,
          namespace: 'mcp',
          category: 'tools',
          tags: ['mcp-tool', tool.type, tool.routing]
        });
      }

      // Create agents with MCP tool capabilities
      const analystAgent = await coordinator.spawnAgent({
        type: 'analyst',
        name: 'MCP-Enabled Analyst',
        capabilities: ['code-analysis', 'memory-query'],
        mcpTools: ['memory-manager', 'code-analyzer']
      });

      const coordinatorAgent = await coordinator.spawnAgent({
        type: 'coordinator',
        name: 'MCP Task Orchestrator',
        capabilities: ['task-management', 'coordination'],
        mcpTools: ['task-orchestrator', 'memory-manager']
      });

      // Simulate MCP tool routing
      const mcpRequest = {
        id: 'mcp-request-1',
        tool: 'memory-manager',
        method: 'query',
        params: {
          namespace: 'agents',
          search: 'code analysis'
        },
        originAgent: analystAgent,
        routingTarget: 'local'
      };

      await memoryManager.store({
        key: `mcp_request_${mcpRequest.id}`,
        value: mcpRequest,
        namespace: 'mcp',
        category: 'requests',
        tags: ['mcp-request', 'memory-query', 'routing']
      });

      // Verify MCP integration
      const mcpToolMemories = await memoryManager.query({
        namespace: 'mcp',
        category: 'tools'
      });
      expect(mcpToolMemories.results.length).toBe(3);

      const mcpRequestMemories = await memoryManager.query({
        namespace: 'mcp',
        category: 'requests'
      });
      expect(mcpRequestMemories.results.length).toBe(1);

      // Verify agents have MCP tool access
      const analyst = await coordinator.getAgent(analystAgent);
      expect(analyst.mcpTools).toContain('memory-manager');
      expect(analyst.mcpTools).toContain('code-analyzer');
    });

    it('should handle MCP communication errors and recovery', async () => {
      // Simulate MCP communication failure scenario
      const failedMcpRequest = {
        id: 'mcp-error-1',
        tool: 'external-service',
        method: 'analyze',
        params: { data: 'test-data' },
        status: 'failed',
        error: {
          code: 'CONNECTION_TIMEOUT',
          message: 'Failed to connect to external MCP server',
          timestamp: new Date().toISOString(),
          retryable: true
        }
      };

      await memoryManager.store({
        key: `mcp_error_${failedMcpRequest.id}`,
        value: failedMcpRequest,
        namespace: 'mcp',
        category: 'errors',
        tags: ['mcp-error', 'connection-failure', 'retryable']
      });

      // Store recovery strategy
      const recoveryStrategy = {
        errorCode: 'CONNECTION_TIMEOUT',
        strategy: 'exponential-backoff',
        maxRetries: 3,
        baseDelay: 1000,
        fallbackOptions: ['local-processing', 'alternative-tool']
      };

      await memoryManager.store({
        key: 'mcp_recovery_strategy',
        value: recoveryStrategy,
        namespace: 'mcp',
        category: 'recovery',
        tags: ['error-handling', 'retry-strategy', 'fallback']
      });

      // Create agent to handle MCP error recovery
      const errorHandlerAgent = await coordinator.spawnAgent({
        type: 'coordinator',
        name: 'MCP Error Recovery Handler',
        capabilities: ['error-handling', 'retry-logic', 'fallback-routing']
      });

      // Assign error recovery task
      await coordinator.assignTask(errorHandlerAgent, {
        id: 'mcp-error-recovery',
        type: 'coordination' as const,
        description: 'Handle MCP communication error and implement recovery',
        priority: 'high' as const,
        metadata: {
          mcpError: failedMcpRequest.id,
          errorType: failedMcpRequest.error.code,
          retryable: failedMcpRequest.error.retryable
        }
      });

      // Verify error handling integration
      const errorMemories = await memoryManager.query({
        namespace: 'mcp',
        category: 'errors'
      });
      expect(errorMemories.results.length).toBe(1);

      const recoveryMemories = await memoryManager.query({
        namespace: 'mcp',
        category: 'recovery'
      });
      expect(recoveryMemories.results.length).toBe(1);

      const errorTask = await coordinator.getTask('mcp-error-recovery');
      expect(errorTask.metadata?.mcpError).toBe(failedMcpRequest.id);
      expect(errorTask.metadata?.errorType).toBe('CONNECTION_TIMEOUT');
    });
  });

  describe('Performance and Scalability Integration', () => {
    it('should handle high-throughput operations with memory optimization', async () => {
      // Create high-throughput scenario
      const agentCount = 10;
      const taskCount = 50;
      const messageCount = 100;

      // Spawn multiple agents
      const agents = [];
      for (let i = 0; i < agentCount; i++) {
        const agentId = await coordinator.spawnAgent({
          type: ['coder', 'tester', 'researcher', 'analyst'][i % 4] as any,
          name: `High-Throughput-Agent-${i}`,
          capabilities: ['high-performance', 'concurrent-processing']
        });
        agents.push(agentId);
      }

      // Queue many tasks simultaneously
      const taskPromises = [];
      for (let i = 0; i < taskCount; i++) {
        const task = {
          id: `high-throughput-task-${i}`,
          type: ['code', 'test', 'research', 'analysis'][i % 4] as any,
          description: `High throughput task ${i}`,
          priority: ['low', 'medium', 'high'][i % 3] as any,
          estimatedDuration: 1000 + (i * 100)
        };
        taskPromises.push(coordinator.queueTask(task));
      }

      await Promise.all(taskPromises);

      // Store performance monitoring data
      const performanceData = [];
      for (let i = 0; i < messageCount; i++) {
        const dataPoint = {
          timestamp: new Date().toISOString(),
          metric: 'task-throughput',
          value: Math.random() * 100,
          agentId: agents[i % agents.length],
          taskId: `high-throughput-task-${i % taskCount}`
        };
        performanceData.push(dataPoint);
      }

      // Batch store performance data
      const memoryPromises = performanceData.map((data, index) =>
        memoryManager.store({
          key: `performance_${index}`,
          value: data,
          namespace: 'performance',
          category: 'metrics',
          tags: ['high-throughput', 'scalability', 'performance']
        })
      );

      await Promise.all(memoryPromises);

      // Verify system performance under load
      const allTasks = await coordinator.listTasks();
      expect(allTasks.length).toBe(taskCount);

      const allAgents = await coordinator.listAgents();
      expect(allAgents.length).toBe(agentCount);

      const performanceMemories = await memoryManager.query({
        namespace: 'performance',
        category: 'metrics'
      });
      expect(performanceMemories.results.length).toBe(messageCount);

      // Check memory system performance
      const memoryStats = memoryManager.getStats();
      expect(memoryStats.storage.totalMemories).toBeGreaterThan(messageCount);
      expect(memoryStats.performance.averageRetrievalTime).toBeLessThan(100); // Under 100ms

      // Check swarm coordination performance
      const swarmMetrics = await coordinator.getMetrics();
      expect(swarmMetrics.totalTasks).toBe(taskCount);
      expect(swarmMetrics.activeAgents).toBe(agentCount);
    });

    it('should handle memory pressure and optimization', async () => {
      // Fill memory with large amount of data to trigger optimization
      const largeDataSets = [];
      for (let i = 0; i < 20; i++) {
        const largeData = {
          id: `large-dataset-${i}`,
          data: 'x'.repeat(10000), // 10KB of data each
          metadata: {
            size: 10000,
            type: 'test-data',
            index: i
          }
        };
        largeDataSets.push(largeData);
      }

      // Store large datasets
      const storePromises = largeDataSets.map((dataset, index) =>
        memoryManager.store({
          key: `large_data_${index}`,
          value: dataset,
          namespace: 'performance',
          category: 'large-data',
          tags: ['memory-pressure', 'optimization', 'large-dataset'],
          ttl: 30000 // 30 second TTL for cleanup testing
        })
      );

      await Promise.all(storePromises);

      // Trigger memory maintenance
      await memoryManager.performMaintenance();

      // Check compression and optimization
      const memoryStats = memoryManager.getStats();
      expect(memoryStats.storage.totalMemories).toBe(20);
      expect(memoryStats.storage.compressionRatio).toBeGreaterThan(0); // Should have compression

      // Create agents to work with large datasets
      const dataProcessorAgent = await coordinator.spawnAgent({
        type: 'analyst',
        name: 'Data Processor',
        capabilities: ['data-processing', 'memory-optimization']
      });

      // Process large datasets with swarm coordination
      await coordinator.assignTask(dataProcessorAgent, {
        id: 'process-large-datasets',
        type: 'analysis' as const,
        description: 'Process and optimize large datasets',
        priority: 'medium' as const,
        metadata: {
          datasetCount: 20,
          memoryOptimization: true
        }
      });

      // Verify system stability under memory pressure
      const task = await coordinator.getTask('process-large-datasets');
      expect(task.status).toBe('assigned');

      const agent = await coordinator.getAgent(dataProcessorAgent);
      expect(agent.status).toBe('busy');
    });
  });

  describe('End-to-End Workflow Integration', () => {
    it('should execute complete development workflow with all systems', async () => {
      // 1. Initialize complete development workflow
      const workflowContext = {
        project: 'claude-flow-enhancement',
        objective: 'Add new vector search capabilities',
        phases: ['analysis', 'design', 'implementation', 'testing', 'deployment'],
        timeline: 7200000 // 2 hours
      };

      await memoryManager.store({
        key: 'workflow_context',
        value: workflowContext,
        namespace: 'workflow',
        category: 'project',
        tags: ['e2e-workflow', 'development', 'project-context']
      });

      // 2. AIME mission planning
      const aimeMission = {
        missionId: 'vector-search-enhancement',
        strategicPlan: {
          phases: workflowContext.phases,
          resourceAllocation: {
            analysis: ['researcher', 'analyst'],
            design: ['architect'],
            implementation: ['coder', 'coder'],
            testing: ['tester'],
            deployment: ['coordinator']
          }
        },
        tacticalPlan: {
          tasks: [
            { id: 'analyze-requirements', phase: 'analysis', agent: 'researcher' },
            { id: 'system-analysis', phase: 'analysis', agent: 'analyst' },
            { id: 'architecture-design', phase: 'design', agent: 'architect' },
            { id: 'implement-core', phase: 'implementation', agent: 'coder-1' },
            { id: 'implement-api', phase: 'implementation', agent: 'coder-2' },
            { id: 'unit-testing', phase: 'testing', agent: 'tester' },
            { id: 'deploy-system', phase: 'deployment', agent: 'coordinator' }
          ]
        }
      };

      await memoryManager.store({
        key: 'aime_mission_plan',
        value: aimeMission,
        namespace: 'aime',
        category: 'mission',
        tags: ['workflow', 'mission-planning', 'vector-search']
      });

      // 3. Spawn agents based on AIME planning
      const workflowAgents = {
        researcher: await coordinator.spawnAgent({
          type: 'researcher',
          name: 'Requirements Researcher',
          capabilities: ['requirement-analysis', 'research', 'documentation']
        }),
        analyst: await coordinator.spawnAgent({
          type: 'analyst',
          name: 'System Analyst',
          capabilities: ['system-analysis', 'data-modeling', 'optimization']
        }),
        architect: await coordinator.spawnAgent({
          type: 'architect',
          name: 'Vector Search Architect',
          capabilities: ['system-design', 'architecture', 'vector-databases']
        }),
        'coder-1': await coordinator.spawnAgent({
          type: 'coder',
          name: 'Core Implementation Developer',
          capabilities: ['javascript', 'vector-search', 'algorithms']
        }),
        'coder-2': await coordinator.spawnAgent({
          type: 'coder',
          name: 'API Developer',
          capabilities: ['api-design', 'javascript', 'integration']
        }),
        tester: await coordinator.spawnAgent({
          type: 'tester',
          name: 'Vector Search Tester',
          capabilities: ['testing', 'performance-testing', 'vector-validation']
        }),
        coordinator: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'Deployment Coordinator',
          capabilities: ['deployment', 'project-management', 'coordination']
        })
      };

      // 4. Execute workflow phases with task dependencies
      const workflowTasks = aimeMission.tacticalPlan.tasks;
      
      for (const taskDef of workflowTasks) {
        const agentId = workflowAgents[taskDef.agent as keyof typeof workflowAgents];
        
        await coordinator.assignTask(agentId, {
          id: taskDef.id,
          type: taskDef.phase as any,
          description: `${taskDef.phase}: ${taskDef.id}`,
          priority: 'high' as const,
          estimatedDuration: workflowContext.timeline / workflowTasks.length,
          metadata: {
            workflowPhase: taskDef.phase,
            aimeMission: aimeMission.missionId,
            e2eWorkflow: true
          }
        });
      }

      // 5. Store workflow execution state
      const workflowExecution = {
        workflowId: 'vector-search-enhancement',
        status: 'executing',
        startTime: new Date().toISOString(),
        assignedAgents: Object.keys(workflowAgents).length,
        totalTasks: workflowTasks.length,
        currentPhase: 'analysis',
        executionMetrics: {
          tasksAssigned: workflowTasks.length,
          agentsActive: Object.keys(workflowAgents).length,
          memoryUsage: memoryManager.getStats().storage.totalSize
        }
      };

      await memoryManager.store({
        key: 'workflow_execution_state',
        value: workflowExecution,
        namespace: 'workflow',
        category: 'execution',
        tags: ['e2e-workflow', 'execution-state', 'active']
      });

      // 6. Verify complete workflow integration
      const allTasks = await coordinator.listTasks();
      expect(allTasks.length).toBe(workflowTasks.length);
      expect(allTasks.every(t => t.assignedTo && t.metadata?.e2eWorkflow)).toBe(true);

      const allAgents = await coordinator.listAgents();
      expect(allAgents.length).toBe(Object.keys(workflowAgents).length);

      const workflowMemories = await memoryManager.query({
        namespace: 'workflow',
        tags: ['e2e-workflow']
      });
      expect(workflowMemories.results.length).toBe(2); // Context and execution state

      const aimeMemories = await memoryManager.query({
        namespace: 'aime',
        tags: ['workflow']
      });
      expect(aimeMemories.results.length).toBe(1); // Mission plan

      // 7. Check system health under full workflow load
      const systemMetrics = await coordinator.getMetrics();
      expect(systemMetrics.totalTasks).toBe(workflowTasks.length);
      expect(systemMetrics.activeAgents).toBe(Object.keys(workflowAgents).length);

      const memoryHealth = memoryManager.getStats();
      expect(memoryHealth.session.initialized).toBe(true);
      expect(memoryHealth.storage.totalMemories).toBeGreaterThan(3);
    });
  });
});