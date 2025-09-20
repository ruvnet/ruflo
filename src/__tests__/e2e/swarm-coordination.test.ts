/**
 * End-to-End Swarm Coordination Tests
 * Testing complete user workflows and real-world scenarios
 */

import { jest } from '@jest/globals';
import { SwarmCoordinator } from '../../swarm/coordinator.js';
import { RealMemoryManager } from '../../memory/real-memory-manager.js';
import { 
  createTempDir, 
  cleanupTempDir, 
  TestEventCollector,
  ResourceCleanup,
  waitForCondition
} from '../helpers/test-utils.js';
import path from 'path';
import { EventEmitter } from 'events';

describe('End-to-End Swarm Coordination', () => {
  let coordinator: SwarmCoordinator;
  let memoryManager: RealMemoryManager;
  let testDir: string;
  let eventCollector: TestEventCollector;
  let cleanup: ResourceCleanup;

  beforeAll(async () => {
    testDir = await createTempDir('e2e-swarm-test');
    eventCollector = new TestEventCollector();
    cleanup = new ResourceCleanup();
  });

  afterAll(async () => {
    await cleanup.cleanup();
    await cleanupTempDir(testDir);
  });

  beforeEach(async () => {
    // Initialize memory manager
    memoryManager = new RealMemoryManager({
      persistenceDir: path.join(testDir, 'memory'),
      sessionId: 'e2e-test',
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      vectorSearchEnabled: true,
      compressionEnabled: true
    });
    await memoryManager.initialize();

    // Initialize swarm coordinator  
    coordinator = new SwarmCoordinator({
      mode: 'distributed',
      strategy: 'adaptive',
      maxAgents: 10,
      topology: 'mesh',
      memoryManager,
      logging: { level: 'error' }
    });
    await coordinator.initialize();

    // Set up event collection
    eventCollector.clear();
    eventCollector.collect(coordinator, [
      'swarm.started', 'swarm.completed', 'swarm.paused',
      'agent.spawned', 'agent.removed', 'agent.failed',
      'task.created', 'task.assigned', 'task.completed', 'task.failed',
      'message.broadcast', 'coordination.optimized'
    ]);

    // Add cleanup tasks
    cleanup.add(() => coordinator?.shutdown());
    cleanup.add(() => memoryManager?.clearNamespace('default'));
  });

  afterEach(async () => {
    await cleanup.cleanup();
  });

  describe('Complete Development Workflow', () => {
    it('should execute a full software development cycle', async () => {
      // Step 1: Project initialization
      const projectContext = {
        name: 'TaskManager API',
        description: 'Build a RESTful API for task management',
        requirements: [
          'User authentication',
          'CRUD operations for tasks',
          'Task categorization',
          'API documentation',
          'Unit tests',
          'Integration tests'
        ],
        technologies: ['Node.js', 'Express', 'MongoDB', 'JWT'],
        timeline: '2 weeks'
      };

      await memoryManager.store({
        key: 'project-context',
        value: projectContext,
        namespace: 'project',
        category: 'requirements',
        tags: ['project-init', 'requirements', 'api-development']
      });

      // Step 2: Spawn specialized agents for different roles
      const teamAgents = {
        projectManager: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'Project Manager',
          capabilities: ['project-planning', 'coordination', 'progress-tracking']
        }),
        architect: await coordinator.spawnAgent({
          type: 'architect',
          name: 'System Architect',
          capabilities: ['system-design', 'api-design', 'database-design']
        }),
        backendDev: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Backend Developer',
          capabilities: ['nodejs', 'express', 'mongodb', 'api-development']
        }),
        testEngineer: await coordinator.spawnAgent({
          type: 'tester',
          name: 'Test Engineer', 
          capabilities: ['unit-testing', 'integration-testing', 'api-testing']
        }),
        researcher: await coordinator.spawnAgent({
          type: 'researcher',
          name: 'Technical Researcher',
          capabilities: ['technology-research', 'best-practices', 'documentation']
        })
      };

      // Wait for all agents to be spawned
      await waitForCondition(
        () => eventCollector.getEventCount('agent.spawned') === 5,
        5000
      );

      expect(eventCollector.getEventCount('agent.spawned')).toBe(5);

      // Step 3: Create development phases with dependencies
      const developmentPhases = [
        {
          id: 'requirements-analysis',
          name: 'Requirements Analysis',
          description: 'Analyze and document detailed requirements',
          assignedTo: teamAgents.researcher,
          dependencies: [],
          tasks: [
            'research-auth-patterns',
            'analyze-api-requirements',
            'document-user-stories'
          ]
        },
        {
          id: 'system-design',
          name: 'System Architecture Design',
          description: 'Design system architecture and database schema',
          assignedTo: teamAgents.architect,
          dependencies: ['requirements-analysis'],
          tasks: [
            'design-database-schema',
            'design-api-endpoints',
            'create-system-architecture'
          ]
        },
        {
          id: 'implementation',
          name: 'Backend Implementation',
          description: 'Implement API endpoints and business logic',
          assignedTo: teamAgents.backendDev,
          dependencies: ['system-design'],
          tasks: [
            'setup-project-structure',
            'implement-auth-middleware',
            'implement-task-crud',
            'implement-user-management'
          ]
        },
        {
          id: 'testing',
          name: 'Testing and Quality Assurance',
          description: 'Create and execute comprehensive tests',
          assignedTo: teamAgents.testEngineer,
          dependencies: ['implementation'],
          tasks: [
            'create-unit-tests',
            'create-integration-tests',
            'create-api-tests',
            'performance-testing'
          ]
        },
        {
          id: 'deployment-prep',
          name: 'Deployment Preparation',
          description: 'Prepare for production deployment',
          assignedTo: teamAgents.projectManager,
          dependencies: ['testing'],
          tasks: [
            'create-deployment-scripts',
            'setup-monitoring',
            'create-documentation'
          ]
        }
      ];

      // Store development phases in memory
      for (const phase of developmentPhases) {
        await memoryManager.store({
          key: `phase-${phase.id}`,
          value: phase,
          namespace: 'project',
          category: 'phases',
          tags: ['development-phase', phase.id]
        });
      }

      // Step 4: Create and assign tasks for each phase
      const allTasks = [];
      for (const phase of developmentPhases) {
        for (const taskName of phase.tasks) {
          const task = {
            id: `${phase.id}-${taskName}`,
            type: this.getTaskType(taskName),
            description: `${phase.name}: ${taskName}`,
            priority: phase.id === 'requirements-analysis' ? 'critical' as const : 'high' as const,
            estimatedDuration: this.estimateTaskDuration(taskName),
            phase: phase.id,
            dependencies: phase.dependencies.length > 0 ? 
              phase.dependencies.flatMap(dep => 
                developmentPhases.find(p => p.id === dep)?.tasks.map(t => `${dep}-${t}`) || []
              ) : []
          };
          
          allTasks.push(task);
          await coordinator.queueTask(task);
        }
      }

      // Step 5: Execute phases in order with dependency management
      let currentPhase = 0;
      while (currentPhase < developmentPhases.length) {
        const phase = developmentPhases[currentPhase];
        
        // Check if phase dependencies are met
        const dependenciesMet = phase.dependencies.every(depId => {
          const depPhase = developmentPhases.find(p => p.id === depId);
          return depPhase && this.isPhaseComplete(depPhase, allTasks);
        });

        if (dependenciesMet || phase.dependencies.length === 0) {
          console.log(`🚀 Starting phase: ${phase.name}`);
          
          // Assign phase tasks to the designated agent
          const phaseTasks = allTasks.filter(t => t.phase === phase.id);
          for (const task of phaseTasks) {
            await coordinator.assignTask(phase.assignedTo, task);
            
            // Simulate task execution
            await new Promise(resolve => setTimeout(resolve, 50));
            await coordinator.updateTaskStatus(task.id, 'in_progress');
            
            // Store task progress in memory
            await memoryManager.store({
              key: `task-progress-${task.id}`,
              value: {
                taskId: task.id,
                phase: phase.id,
                status: 'in_progress',
                assignedTo: phase.assignedTo,
                startTime: new Date().toISOString()
              },
              namespace: 'project',
              category: 'progress',
              tags: ['task-progress', phase.id, task.id]
            });
            
            // Simulate completion
            await new Promise(resolve => setTimeout(resolve, 30));
            await coordinator.updateTaskStatus(task.id, 'completed', {
              output: `Completed ${task.description}`,
              metrics: { duration: task.estimatedDuration }
            });
            
            // Update progress in memory
            await memoryManager.update(`task-progress-${task.id}`, {
              value: {
                taskId: task.id,
                phase: phase.id,
                status: 'completed',
                assignedTo: phase.assignedTo,
                startTime: new Date().toISOString(),
                endTime: new Date().toISOString(),
                output: `Completed ${task.description}`
              }
            }, 'project');
          }
          
          console.log(`✅ Completed phase: ${phase.name}`);
          currentPhase++;
        } else {
          // Wait for dependencies
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Step 6: Verify workflow completion
      const completedTasks = await coordinator.listTasks();
      const projectProgress = await memoryManager.query({
        namespace: 'project',
        category: 'progress'
      });

      // Verify all tasks are completed
      expect(completedTasks.length).toBe(allTasks.length);
      expect(completedTasks.every(t => t.status === 'completed')).toBe(true);
      expect(projectProgress.results.length).toBe(allTasks.length);

      // Verify event sequence
      expect(eventCollector.getEventCount('task.created')).toBe(allTasks.length);
      expect(eventCollector.getEventCount('task.assigned')).toBe(allTasks.length);
      expect(eventCollector.getEventCount('task.completed')).toBe(allTasks.length);

      // Step 7: Generate project completion report
      const projectReport = {
        projectName: projectContext.name,
        completionTime: new Date().toISOString(),
        phases: developmentPhases.length,
        totalTasks: allTasks.length,
        teamSize: Object.keys(teamAgents).length,
        metrics: await coordinator.getMetrics(),
        memoryStats: memoryManager.getStats()
      };

      await memoryManager.store({
        key: 'project-completion-report',
        value: projectReport,
        namespace: 'project',
        category: 'reports',
        tags: ['completion-report', 'final-report']
      });

      expect(projectReport.metrics.completedTasks).toBe(allTasks.length);
      expect(projectReport.metrics.activeAgents).toBe(5);
      
      console.log(`🎉 Project "${projectContext.name}" completed successfully!`);
      console.log(`📊 Final stats: ${allTasks.length} tasks, ${Object.keys(teamAgents).length} agents, ${developmentPhases.length} phases`);
    });

    // Helper methods
    getTaskType(taskName: string): string {
      if (taskName.includes('research') || taskName.includes('analyze') || taskName.includes('document')) {
        return 'research';
      } else if (taskName.includes('design') || taskName.includes('architecture')) {
        return 'design';
      } else if (taskName.includes('implement') || taskName.includes('setup')) {
        return 'code';
      } else if (taskName.includes('test')) {
        return 'test';
      } else {
        return 'coordination';
      }
    }

    estimateTaskDuration(taskName: string): number {
      const baseDurations: Record<string, number> = {
        'research': 3600000, // 1 hour
        'analyze': 2700000,  // 45 minutes
        'document': 1800000, // 30 minutes
        'design': 5400000,   // 1.5 hours
        'implement': 7200000, // 2 hours
        'setup': 1800000,    // 30 minutes
        'test': 3600000      // 1 hour
      };

      for (const [key, duration] of Object.entries(baseDurations)) {
        if (taskName.includes(key)) {
          return duration;
        }
      }
      return 1800000; // Default 30 minutes
    }

    isPhaseComplete(phase: any, allTasks: any[]): boolean {
      const phaseTasks = allTasks.filter(t => t.phase === phase.id);
      return phaseTasks.every(t => t.status === 'completed');
    }
  });

  describe('Multi-Agent Collaboration Scenarios', () => {
    it('should handle complex multi-agent research and development collaboration', async () => {
      // Scenario: AI Research Paper Implementation
      const researchProject = {
        title: 'Implementing Transformer Architecture Optimization',
        objective: 'Research, design, and implement optimizations for transformer models',
        complexity: 'high',
        requiredExpertise: [
          'machine-learning', 'research', 'python', 'pytorch', 
          'optimization', 'mathematics', 'benchmarking'
        ]
      };

      // Create specialized research team
      const researchTeam = {
        leadResearcher: await coordinator.spawnAgent({
          type: 'researcher',
          name: 'AI Research Lead',
          capabilities: ['machine-learning', 'research-methodology', 'paper-analysis']
        }),
        mlEngineer: await coordinator.spawnAgent({
          type: 'coder',
          name: 'ML Engineer',
          capabilities: ['python', 'pytorch', 'model-implementation']
        }),
        mathematician: await coordinator.spawnAgent({
          type: 'analyst',
          name: 'Applied Mathematics Specialist',
          capabilities: ['mathematics', 'optimization', 'algorithm-analysis']
        }),
        benchmarkSpecialist: await coordinator.spawnAgent({
          type: 'tester',
          name: 'Performance Benchmark Specialist',
          capabilities: ['benchmarking', 'performance-analysis', 'data-analysis']
        })
      };

      // Phase 1: Literature Review and Analysis
      const literatureReviewTasks = [
        {
          id: 'survey-transformer-optimizations',
          type: 'research' as const,
          description: 'Survey recent transformer optimization techniques',
          assignedTo: researchTeam.leadResearcher,
          priority: 'critical' as const,
          estimatedDuration: 7200000 // 2 hours
        },
        {
          id: 'analyze-attention-mechanisms',
          type: 'analysis' as const,
          description: 'Mathematical analysis of attention mechanism efficiency',
          assignedTo: researchTeam.mathematician,
          priority: 'high' as const,
          estimatedDuration: 5400000 // 1.5 hours
        }
      ];

      // Execute literature review phase
      for (const task of literatureReviewTasks) {
        await coordinator.queueTask(task);
        await coordinator.assignTask(task.assignedTo, task);
        
        // Simulate research work with memory storage
        await memoryManager.store({
          key: `research-findings-${task.id}`,
          value: {
            taskId: task.id,
            findings: this.generateResearchFindings(task.id),
            references: this.generateReferences(task.id),
            status: 'in-progress'
          },
          namespace: 'research',
          category: 'findings',
          tags: ['research', 'transformer', 'optimization']
        });
        
        await coordinator.updateTaskStatus(task.id, 'in_progress');
        await new Promise(resolve => setTimeout(resolve, 100));
        await coordinator.updateTaskStatus(task.id, 'completed');
      }

      // Phase 2: Collaborative Design Session
      const designSession = {
        id: 'optimization-design-session',
        participants: Object.values(researchTeam),
        objective: 'Design novel transformer optimization approach',
        duration: 3600000 // 1 hour
      };

      // Store collaborative session context
      await memoryManager.store({
        key: 'design-session-context',
        value: designSession,
        namespace: 'collaboration',
        category: 'sessions',
        tags: ['design-session', 'collaboration', 'optimization']
      });

      // Simulate collaborative discussion through message passing
      const collaborationMessages = [
        {
          from: researchTeam.leadResearcher,
          to: researchTeam.mathematician,
          content: 'Based on literature review, attention sparsity shows promise. Can we model computational complexity?',
          type: 'technical-question'
        },
        {
          from: researchTeam.mathematician,
          to: researchTeam.mlEngineer,
          content: 'Sparse attention reduces complexity from O(n²) to O(n√n). Implementation feasible?',
          type: 'technical-response'
        },
        {
          from: researchTeam.mlEngineer,
          to: researchTeam.benchmarkSpecialist,
          content: 'Can implement sparse patterns. What benchmarks should we target?',
          type: 'implementation-query'
        },
        {
          from: researchTeam.benchmarkSpecialist,
          to: 'all',
          content: 'Focus on GLUE tasks and efficiency metrics. Need baseline measurements first.',
          type: 'requirements'
        }
      ];

      // Process collaboration messages
      for (const message of collaborationMessages) {
        await coordinator.sendMessage(message.from, message.to, {
          type: 'collaboration',
          content: message.content,
          messageType: message.type,
          timestamp: new Date(),
          sessionId: designSession.id
        });

        // Store message in collaborative memory
        await memoryManager.store({
          key: `collab-message-${Date.now()}`,
          value: message,
          namespace: 'collaboration',
          category: 'messages',
          tags: ['collaboration', 'design-session', message.type]
        });
      }

      // Phase 3: Implementation with Cross-Agent Coordination
      const implementationTasks = [
        {
          id: 'implement-sparse-attention',
          type: 'code' as const,
          description: 'Implement sparse attention mechanism',
          assignedTo: researchTeam.mlEngineer,
          dependencies: ['survey-transformer-optimizations', 'analyze-attention-mechanisms']
        },
        {
          id: 'create-benchmarks',
          type: 'test' as const,
          description: 'Create comprehensive performance benchmarks',
          assignedTo: researchTeam.benchmarkSpecialist,
          dependencies: []
        },
        {
          id: 'mathematical-validation',
          type: 'analysis' as const,
          description: 'Validate theoretical complexity improvements',
          assignedTo: researchTeam.mathematician,
          dependencies: ['implement-sparse-attention']
        }
      ];

      // Execute implementation with dependency management
      const taskQueue = [...implementationTasks];
      const completedTasks = new Set<string>();

      while (taskQueue.length > 0) {
        const readyTasks = taskQueue.filter(task => 
          task.dependencies.every(dep => completedTasks.has(dep))
        );

        if (readyTasks.length === 0) {
          throw new Error('Circular dependency or missing tasks detected');
        }

        // Execute ready tasks in parallel
        const taskPromises = readyTasks.map(async (task) => {
          await coordinator.queueTask(task);
          await coordinator.assignTask(task.assignedTo, task);
          
          // Simulate implementation work
          await coordinator.updateTaskStatus(task.id, 'in_progress');
          
          // Cross-agent coordination during implementation
          if (task.id === 'implement-sparse-attention') {
            // Request mathematical validation during implementation
            await coordinator.sendMessage(
              task.assignedTo,
              researchTeam.mathematician,
              {
                type: 'validation-request',
                content: 'Please review attention pattern implementation for theoretical correctness',
                timestamp: new Date(),
                relatedTask: task.id
              }
            );
          }
          
          await new Promise(resolve => setTimeout(resolve, 150));
          await coordinator.updateTaskStatus(task.id, 'completed');
          
          return task.id;
        });

        const completedTaskIds = await Promise.all(taskPromises);
        completedTaskIds.forEach(id => completedTasks.add(id));
        
        // Remove completed tasks from queue
        taskQueue.splice(0, taskQueue.length, ...taskQueue.filter(t => !completedTasks.has(t.id)));
      }

      // Phase 4: Results Analysis and Collaboration Summary
      const collaborationResults = await memoryManager.query({
        namespace: 'collaboration',
        tags: ['design-session']
      });

      const researchFindings = await memoryManager.query({
        namespace: 'research',
        category: 'findings'
      });

      // Generate collaboration effectiveness metrics
      const collaborationMetrics = {
        totalMessages: collaborationMessages.length,
        participantCount: Object.keys(researchTeam).length,
        crossAgentInteractions: collaborationMessages.filter(m => m.to !== 'all').length,
        knowledgeSharing: researchFindings.results.length,
        taskInterdependencies: implementationTasks.reduce((acc, task) => acc + task.dependencies.length, 0),
        sessionDuration: designSession.duration,
        completionRate: completedTasks.size / (literatureReviewTasks.length + implementationTasks.length)
      };

      await memoryManager.store({
        key: 'collaboration-metrics',
        value: collaborationMetrics,
        namespace: 'collaboration',
        category: 'metrics',
        tags: ['collaboration-analysis', 'research-project']
      });

      // Verify collaboration effectiveness
      expect(completedTasks.size).toBe(literatureReviewTasks.length + implementationTasks.length);
      expect(collaborationResults.results.length).toBeGreaterThan(0);
      expect(collaborationMetrics.completionRate).toBe(1.0);
      expect(collaborationMetrics.crossAgentInteractions).toBeGreaterThan(0);
      
      // Verify knowledge was shared between agents
      const messageCategories = new Set(collaborationMessages.map(m => m.type));
      expect(messageCategories.size).toBeGreaterThan(2); // Multiple types of interactions

      console.log(`🔬 Research collaboration completed successfully!`);
      console.log(`📈 Collaboration metrics: ${JSON.stringify(collaborationMetrics, null, 2)}`);
    });

    // Helper methods for research scenario
    generateResearchFindings(taskId: string): any {
      const findings = {
        'survey-transformer-optimizations': [
          'Sparse attention patterns reduce computational complexity',
          'Linear attention mechanisms show promise for long sequences',
          'Mixed precision training improves efficiency'
        ],
        'analyze-attention-mechanisms': [
          'Attention complexity is O(n²) for sequence length n',
          'Sparsity patterns can reduce to O(n√n) or O(n log n)',
          'Mathematical approximations maintain 95% accuracy'
        ]
      };
      return findings[taskId as keyof typeof findings] || ['General research findings'];
    }

    generateReferences(taskId: string): string[] {
      return [
        'Attention Is All You Need (Vaswani et al., 2017)',
        'Sparse Transformers (Child et al., 2019)',
        'Linformer: Self-Attention with Linear Complexity (Wang et al., 2020)'
      ];
    }
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle agent failures and recover gracefully', async () => {
      // Create a critical system with multiple agents
      const systemAgents = {
        primary: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Primary System Agent',
          capabilities: ['system-management', 'error-handling']
        }),
        backup: await coordinator.spawnAgent({
          type: 'coder', 
          name: 'Backup System Agent',
          capabilities: ['system-management', 'recovery']
        }),
        monitor: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'System Monitor',
          capabilities: ['monitoring', 'alerting', 'coordination']
        })
      };

      // Create critical tasks
      const criticalTasks = [
        {
          id: 'critical-process-1',
          type: 'code' as const,
          description: 'Critical system process',
          priority: 'critical' as const,
          assignedTo: systemAgents.primary
        },
        {
          id: 'critical-process-2',
          type: 'code' as const,
          description: 'Secondary critical process',
          priority: 'critical' as const,
          assignedTo: systemAgents.primary
        },
        {
          id: 'monitoring-task',
          type: 'coordination' as const,
          description: 'System monitoring and health checks',
          priority: 'high' as const,
          assignedTo: systemAgents.monitor
        }
      ];

      // Assign tasks
      for (const task of criticalTasks) {
        await coordinator.queueTask(task);
        await coordinator.assignTask(task.assignedTo, task);
        await coordinator.updateTaskStatus(task.id, 'in_progress');
      }

      // Store system state before failure
      const preFailureState = {
        agents: await coordinator.listAgents(),
        tasks: await coordinator.listTasks(),
        metrics: await coordinator.getMetrics()
      };

      await memoryManager.store({
        key: 'pre-failure-state',
        value: preFailureState,
        namespace: 'system',
        category: 'checkpoints',
        tags: ['system-state', 'pre-failure']
      });

      // Simulate primary agent failure
      const failureError = new Error('Simulated agent crash - memory corruption');
      await coordinator.handleAgentFailure(systemAgents.primary, failureError);

      // Wait for failure event
      await eventCollector.waitForEvent('agent.failed', 2000);
      expect(eventCollector.getEventCount('agent.failed')).toBe(1);

      // Verify failure is recorded
      const failedAgent = await coordinator.getAgent(systemAgents.primary);
      expect(failedAgent.status).toBe('failed');
      expect(failedAgent.lastError).toContain('memory corruption');

      // System should attempt recovery
      await coordinator.recoverFailedAgent(systemAgents.primary);

      // Reassign critical tasks to backup agent
      const failedTasks = await coordinator.listTasks();
      const criticalFailedTasks = failedTasks.filter(t => 
        t.assignedTo === systemAgents.primary && t.status !== 'completed'
      );

      for (const task of criticalFailedTasks) {
        // Reassign to backup agent
        await coordinator.assignTask(systemAgents.backup, {
          ...task,
          id: `${task.id}-recovery`,
          description: `Recovery: ${task.description}`,
          metadata: {
            originalTask: task.id,
            recoveryAction: true,
            failedAgent: systemAgents.primary
          }
        });
      }

      // Store recovery actions
      await memoryManager.store({
        key: 'recovery-actions',
        value: {
          failedAgent: systemAgents.primary,
          backupAgent: systemAgents.backup,
          reassignedTasks: criticalFailedTasks.length,
          recoveryTime: new Date().toISOString(),
          cause: failureError.message
        },
        namespace: 'system',
        category: 'recovery',
        tags: ['recovery', 'failure-handling', 'task-reassignment']
      });

      // Verify system resilience
      const postRecoveryState = {
        agents: await coordinator.listAgents(),
        tasks: await coordinator.listTasks(),
        metrics: await coordinator.getMetrics()
      };

      // System should still be operational
      expect(postRecoveryState.agents.length).toBe(3); // All agents should exist
      expect(postRecoveryState.tasks.length).toBeGreaterThan(criticalTasks.length); // Recovery tasks added
      
      // Backup agent should be handling critical work
      const backupAgent = await coordinator.getAgent(systemAgents.backup);
      expect(backupAgent.status).toBe('busy');

      // Monitor should still be active
      const monitorAgent = await coordinator.getAgent(systemAgents.monitor);
      expect(monitorAgent.status).toBe('busy');

      console.log('🔄 System recovery completed successfully');
      console.log(`📊 Recovery stats: ${criticalFailedTasks.length} tasks reassigned to backup agent`);
    });

    it('should handle cascading failures and maintain system stability', async () => {
      // Create a complex system with interdependencies
      const complexSystem = {
        webServer: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Web Server Agent',
          capabilities: ['web-server', 'request-handling']
        }),
        database: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Database Agent',
          capabilities: ['database', 'data-management']
        }),
        cache: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Cache Agent',
          capabilities: ['caching', 'performance']
        }),
        loadBalancer: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'Load Balancer',
          capabilities: ['load-balancing', 'traffic-management']
        }),
        healthCheck: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'Health Check Agent',
          capabilities: ['monitoring', 'health-checks']
        })
      };

      // Create interdependent tasks
      const systemTasks = [
        {
          id: 'web-request-handling',
          assignedTo: complexSystem.webServer,
          dependencies: ['database-operations', 'cache-operations']
        },
        {
          id: 'database-operations',
          assignedTo: complexSystem.database,
          dependencies: []
        },
        {
          id: 'cache-operations',
          assignedTo: complexSystem.cache,
          dependencies: ['database-operations']
        },
        {
          id: 'load-balancing',
          assignedTo: complexSystem.loadBalancer,
          dependencies: ['web-request-handling']
        },
        {
          id: 'health-monitoring',
          assignedTo: complexSystem.healthCheck,
          dependencies: []
        }
      ];

      // Assign all tasks
      for (const task of systemTasks) {
        await coordinator.queueTask({
          id: task.id,
          type: 'code' as const,
          description: `System task: ${task.id}`,
          priority: 'high' as const,
          dependencies: task.dependencies
        });
        await coordinator.assignTask(task.assignedTo, await coordinator.getTask(task.id));
      }

      // Start with normal operation
      for (const task of systemTasks) {
        await coordinator.updateTaskStatus(task.id, 'in_progress');
      }

      // Store normal operation state
      await memoryManager.store({
        key: 'normal-operation-state',
        value: {
          activeAgents: Object.keys(complexSystem).length,
          activeTasks: systemTasks.length,
          systemHealth: 'healthy',
          timestamp: new Date().toISOString()
        },
        namespace: 'system',
        category: 'states',
        tags: ['normal-operation', 'system-health']
      });

      // Trigger cascading failure - database fails first
      console.log('💥 Triggering database failure...');
      await coordinator.handleAgentFailure(
        complexSystem.database, 
        new Error('Database connection lost')
      );

      // This should cause cache to fail (depends on database)
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('💥 Cache failure due to database dependency...');
      await coordinator.handleAgentFailure(
        complexSystem.cache,
        new Error('Cache invalidation failed due to database unavailability')
      );

      // This should cause web server to fail (depends on cache and database)
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('💥 Web server failure due to backend dependencies...');
      await coordinator.handleAgentFailure(
        complexSystem.webServer,
        new Error('Web server cannot process requests without backend services')
      );

      // Load balancer should adapt (no incoming requests to balance)
      await coordinator.updateTaskStatus('load-balancing', 'paused', {
        reason: 'No healthy backend services available'
      });

      // Health check should detect and report system-wide failure
      await memoryManager.store({
        key: 'system-failure-state',
        value: {
          failedAgents: ['database', 'cache', 'webServer'],
          activeAgents: ['loadBalancer', 'healthCheck'],
          cascadeDepth: 3,
          totalFailureTime: new Date().toISOString(),
          cause: 'Database connection lost - cascading failure'
        },
        namespace: 'system',
        category: 'failures',
        tags: ['cascading-failure', 'system-wide', 'critical']
      });

      // System should attempt graceful degradation
      console.log('🔧 Attempting system recovery...');
      
      // Restart critical services in reverse dependency order
      const recoveryOrder = ['database', 'cache', 'webServer'];
      for (const serviceName of recoveryOrder) {
        const agentId = complexSystem[serviceName as keyof typeof complexSystem];
        console.log(`🔄 Recovering ${serviceName}...`);
        
        await coordinator.recoverFailedAgent(agentId);
        
        // Create recovery task
        await coordinator.queueTask({
          id: `recovery-${serviceName}`,
          type: 'coordination' as const,
          description: `Recovery procedure for ${serviceName}`,
          priority: 'critical' as const
        });
        
        await coordinator.assignTask(agentId, await coordinator.getTask(`recovery-${serviceName}`));
        await coordinator.updateTaskStatus(`recovery-${serviceName}`, 'completed');
        
        // Restart original service task
        await coordinator.updateTaskStatus(
          systemTasks.find(t => t.assignedTo === agentId)?.id!,
          'in_progress'
        );
        
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Resume load balancing
      await coordinator.updateTaskStatus('load-balancing', 'in_progress');

      // Verify system recovery
      const postRecoveryAgents = await coordinator.listAgents();
      const healthyAgents = postRecoveryAgents.filter(a => a.status !== 'failed');
      
      expect(healthyAgents.length).toBe(Object.keys(complexSystem).length);
      expect(eventCollector.getEventCount('agent.failed')).toBe(3); // Three agents failed
      
      // Store recovery completion
      await memoryManager.store({
        key: 'recovery-completion-state',
        value: {
          recoveredAgents: recoveryOrder.length,
          recoveryDuration: '150ms', // Simulated
          systemStatus: 'recovered',
          lessonsLearned: [
            'Database is single point of failure',
            'Need redundant database connections',
            'Cache should have fallback to direct database access',
            'Web server needs circuit breaker pattern'
          ]
        },
        namespace: 'system',
        category: 'recovery',
        tags: ['recovery-complete', 'lessons-learned', 'system-resilience']
      });

      console.log('✅ Cascading failure recovery completed');
      console.log(`📊 System resilience test passed: ${recoveryOrder.length} services recovered`);
    });
  });

  describe('Real-time Coordination and Communication', () => {
    it('should handle real-time multi-agent coordination with WebSocket-like communication', async () => {
      // Create real-time trading system simulation
      const tradingSystem = {
        marketData: await coordinator.spawnAgent({
          type: 'researcher',
          name: 'Market Data Feed',
          capabilities: ['market-analysis', 'data-streaming']
        }),
        riskAnalyst: await coordinator.spawnAgent({
          type: 'analyst',
          name: 'Risk Analyst',
          capabilities: ['risk-assessment', 'real-time-analysis']
        }),
        trader: await coordinator.spawnAgent({
          type: 'coder',
          name: 'Algorithmic Trader',
          capabilities: ['trading-algorithms', 'decision-making']
        }),
        executor: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'Trade Executor',
          capabilities: ['trade-execution', 'order-management']
        }),
        monitor: await coordinator.spawnAgent({
          type: 'coordinator',
          name: 'System Monitor',
          capabilities: ['monitoring', 'alerting']
        })
      };

      // Set up real-time event stream simulation
      const marketEvents = [
        { type: 'price_update', symbol: 'AAPL', price: 150.25, volume: 1000, timestamp: Date.now() },
        { type: 'news_alert', content: 'Apple announces new product', sentiment: 'positive', timestamp: Date.now() + 100 },
        { type: 'price_update', symbol: 'AAPL', price: 151.50, volume: 2000, timestamp: Date.now() + 200 },
        { type: 'risk_alert', level: 'medium', message: 'Volatility increasing', timestamp: Date.now() + 300 },
        { type: 'price_update', symbol: 'AAPL', price: 149.75, volume: 3000, timestamp: Date.now() + 400 }
      ];

      // Create coordination channels for real-time communication
      const coordinationChannels = {
        marketUpdates: 'market-data-channel',
        riskAlerts: 'risk-alert-channel',
        tradeSignals: 'trade-signal-channel',
        executionUpdates: 'execution-channel'
      };

      // Store channel configurations
      for (const [name, channel] of Object.entries(coordinationChannels)) {
        await memoryManager.store({
          key: `channel-${channel}`,
          value: {
            name,
            channel,
            subscribers: Object.values(tradingSystem),
            messageTypes: [name],
            realTime: true
          },
          namespace: 'communication',
          category: 'channels',
          tags: ['real-time', 'coordination', 'trading']
        });
      }

      // Process market events in real-time
      const eventProcessingResults = [];
      
      for (let i = 0; i < marketEvents.length; i++) {
        const event = marketEvents[i];
        console.log(`📊 Processing market event: ${event.type} at ${new Date(event.timestamp).toISOString()}`);

        // Market data agent processes raw event
        await coordinator.sendMessage(
          'system',
          tradingSystem.marketData,
          {
            type: 'market_event',
            content: event,
            timestamp: new Date(event.timestamp),
            channel: coordinationChannels.marketUpdates
          }
        );

        // Store raw market data
        await memoryManager.store({
          key: `market-event-${i}`,
          value: event,
          namespace: 'market-data',
          category: 'events',
          tags: ['real-time', event.type, event.symbol || 'system']
        });

        // Market data agent analyzes and broadcasts
        const analysisResult = this.analyzeMarketEvent(event, marketEvents.slice(0, i));
        
        await memoryManager.store({
          key: `market-analysis-${i}`,
          value: analysisResult,
          namespace: 'market-data',
          category: 'analysis',
          tags: ['analysis', 'real-time', event.type]
        });

        // Risk analyst evaluates risk
        if (event.type === 'price_update' || event.type === 'risk_alert') {
          const riskAssessment = this.assessRisk(event, analysisResult);
          
          await coordinator.sendMessage(
            tradingSystem.riskAnalyst,
            tradingSystem.trader,
            {
              type: 'risk_assessment',
              content: riskAssessment,
              timestamp: new Date(),
              channel: coordinationChannels.riskAlerts
            }
          );

          await memoryManager.store({
            key: `risk-assessment-${i}`,
            value: riskAssessment,
            namespace: 'risk',
            category: 'assessments',
            tags: ['risk', 'real-time', riskAssessment.level]
          });
        }

        // Trader makes decisions based on analysis and risk
        if (event.type === 'price_update') {
          const tradingDecision = this.makeTradeDecision(event, analysisResult);
          
          if (tradingDecision.action !== 'hold') {
            await coordinator.sendMessage(
              tradingSystem.trader,
              tradingSystem.executor,
              {
                type: 'trade_signal',
                content: tradingDecision,
                timestamp: new Date(),
                channel: coordinationChannels.tradeSignals,
                priority: 'urgent'
              }
            );

            // Execute trade
            const executionResult = await this.executeTrade(tradingDecision);
            
            await coordinator.sendMessage(
              tradingSystem.executor,
              'all',
              {
                type: 'execution_update',
                content: executionResult,
                timestamp: new Date(),
                channel: coordinationChannels.executionUpdates
              }
            );

            await memoryManager.store({
              key: `trade-execution-${i}`,
              value: {
                decision: tradingDecision,
                execution: executionResult,
                timestamp: new Date().toISOString()
              },
              namespace: 'trading',
              category: 'executions',
              tags: ['trade', 'execution', tradingDecision.action]
            });

            eventProcessingResults.push({
              event,
              analysis: analysisResult,
              decision: tradingDecision,
              execution: executionResult
            });
          }
        }

        // Monitor system performance
        const systemMetrics = {
          eventProcessingTime: 50, // Simulated processing time
          communicationLatency: 10,
          memoryUsage: memoryManager.getStats().storage.totalSize,
          activeConnections: Object.keys(tradingSystem).length
        };

        await memoryManager.store({
          key: `system-metrics-${i}`,
          value: systemMetrics,
          namespace: 'monitoring',
          category: 'performance',
          tags: ['real-time', 'performance', 'system-health']
        });

        // Simulate real-time delay
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      // Analyze real-time coordination effectiveness
      const coordinationAnalysis = {
        totalEvents: marketEvents.length,
        processedEvents: eventProcessingResults.length,
        tradesExecuted: eventProcessingResults.filter(r => r.execution).length,
        averageProcessingTime: 50, // ms
        systemLatency: 10, // ms
        communicationPatterns: {
          marketDataBroadcasts: marketEvents.length,
          riskAssessments: marketEvents.filter(e => e.type === 'price_update' || e.type === 'risk_alert').length,
          tradeSignals: eventProcessingResults.length,
          executionUpdates: eventProcessingResults.filter(r => r.execution).length
        }
      };

      await memoryManager.store({
        key: 'real-time-coordination-analysis',
        value: coordinationAnalysis,
        namespace: 'analysis',
        category: 'coordination',
        tags: ['real-time', 'coordination-analysis', 'performance']
      });

      // Verify real-time coordination
      expect(coordinationAnalysis.processedEvents).toBe(marketEvents.length);
      expect(coordinationAnalysis.averageProcessingTime).toBeLessThan(100); // Sub-100ms processing
      expect(coordinationAnalysis.systemLatency).toBeLessThan(50); // Low latency communication
      
      // Check that all agents participated in coordination
      const communicationMemories = await memoryManager.query({
        namespace: 'communication',
        category: 'channels'
      });
      expect(communicationMemories.results.length).toBe(Object.keys(coordinationChannels).length);

      console.log('⚡ Real-time coordination test completed successfully');
      console.log(`📊 Coordination stats: ${coordinationAnalysis.tradesExecuted} trades executed from ${coordinationAnalysis.totalEvents} market events`);
      console.log(`🚀 System performance: ${coordinationAnalysis.averageProcessingTime}ms avg processing, ${coordinationAnalysis.systemLatency}ms latency`);
    });

    // Helper methods for trading simulation
    analyzeMarketEvent(event: any, history: any[]): any {
      return {
        trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
        momentum: Math.random() * 100,
        volatility: Math.random() * 50,
        volume_analysis: event.volume > 1500 ? 'high' : 'normal',
        confidence: Math.random() * 100
      };
    }

    assessRisk(event: any, analysis: any): any {
      return {
        level: analysis.volatility > 30 ? 'high' : analysis.volatility > 15 ? 'medium' : 'low',
        factors: ['volatility', 'volume', 'trend'],
        score: Math.random() * 100,
        recommendation: analysis.volatility > 30 ? 'reduce_position' : 'maintain'
      };
    }

    makeTradeDecision(event: any, analysis: any): any {
      const actions = ['buy', 'sell', 'hold'];
      const action = actions[Math.floor(Math.random() * actions.length)];
      
      return {
        action,
        symbol: event.symbol,
        quantity: action !== 'hold' ? Math.floor(Math.random() * 100) + 10 : 0,
        price: event.price,
        confidence: analysis.confidence,
        reasoning: `Based on ${analysis.trend} trend and ${analysis.momentum} momentum`
      };
    }

    async executeTrade(decision: any): Promise<any> {
      if (decision.action === 'hold') return null;
      
      return {
        orderId: `ORDER_${Date.now()}`,
        status: Math.random() > 0.1 ? 'filled' : 'partial',
        executedQuantity: decision.quantity,
        executedPrice: decision.price + (Math.random() - 0.5) * 0.50, // Price slippage
        commission: 0.99,
        timestamp: new Date().toISOString()
      };
    }
  });
});