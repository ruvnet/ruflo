/**
 * End-to-end full workflow tests
 * Tests complete scenarios from CLI to execution
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertStringIncludes,
  spy,
} from '../test.utils.ts';
import { cleanupTestEnv, setupTestEnv } from '../test.config.ts';
import { delay, generateId } from '../../src/utils/helpers.ts';

describe('E2E Full Workflow', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    setupTestEnv();
    testDir = await Deno.makeTempDir({ prefix: 'gemini-flow-workflow-' });
    configPath = `${testDir}/workflow-config.json`;

    // Create a test configuration
    const testConfig = {
      orchestrator: {
        maxConcurrentAgents: 3,
        taskQueueSize: 50,
        healthCheckInterval: 5000,
        shutdownTimeout: 5000,
        maintenanceInterval: 10000,
        metricsInterval: 5000,
        persistSessions: false,
        taskMaxRetries: 2,
      },
      terminal: {
        type: 'native',
        poolSize: 3,
        recycleAfter: 10,
        healthCheckInterval: 5000,
        commandTimeout: 10000,
      },
      memory: {
        backend: 'sqlite',
        cacheSizeMB: 50,
        syncInterval: 2000,
        conflictResolution: 'last-write',
        retentionDays: 7,
      },
      coordination: {
        maxRetries: 2,
        retryDelay: 500,
        deadlockDetection: false,
        resourceTimeout: 5000,
        messageTimeout: 3000,
      },
      mcp: {
        transport: 'stdio',
      },
      logging: {
        level: 'info',
        format: 'text',
        destination: 'console',
      },
    };

    await Deno.writeTextFile(configPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    await cleanupTestEnv();
  });

  describe('research and implementation workflow', () => {
    it('should execute complete research-to-implementation pipeline', async () => {
      // Step 1: Initialize configuration
      const configCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'validate', configPath,
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code: configCode } = await configCommand.output();
      assertEquals(configCode, 0);

      // Step 2: Start system in background
      const startCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'start',
          '--config', configPath,
          '--daemon',
          '--test-mode',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const startProcess = startCommand.spawn();
      
      // Give system time to start
      await delay(2000);

      try {
        // Step 3: Create research agent
        const researcherCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'agent', 'spawn', 'researcher',
            '--name', 'Research Specialist',
            '--capabilities', 'web-search,analysis,documentation',
            '--priority', '1',
            '--max-tasks', '2',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: researcherCode, stdout: researcherOutput } = await researcherCommand.output();
        assertEquals(researcherCode, 0);
        
        const researcherResult = new TextDecoder().decode(researcherOutput);
        const researcherMatch = researcherResult.match(/"id":\s*"([^"]+)"/);
        assertExists(researcherMatch);
        const researcherId = researcherMatch[1];

        // Step 4: Create implementer agent
        const implementerCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'agent', 'spawn', 'implementer',
            '--name', 'Implementation Specialist',
            '--capabilities', 'coding,terminal,testing',
            '--priority', '2',
            '--max-tasks', '3',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: implementerCode, stdout: implementerOutput } = await implementerCommand.output();
        assertEquals(implementerCode, 0);
        
        const implementerResult = new TextDecoder().decode(implementerOutput);
        const implementerMatch = implementerResult.match(/"id":\s*"([^"]+)"/);
        assertExists(implementerMatch);
        const implementerId = implementerMatch[1];

        // Step 5: Create research task
        const researchTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'create', 'research',
            'Research best practices for Deno TypeScript applications',
            '--priority', '10',
            '--agent-id', researcherId,
            '--metadata', JSON.stringify({
              topic: 'Deno TypeScript best practices',
              depth: 'comprehensive',
              output_format: 'structured_report',
            }),
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: researchTaskCode, stdout: researchTaskOutput } = await researchTaskCommand.output();
        assertEquals(researchTaskCode, 0);
        
        const researchTaskResult = new TextDecoder().decode(researchTaskOutput);
        const researchTaskMatch = researchTaskResult.match(/"id":\s*"([^"]+)"/);
        assertExists(researchTaskMatch);
        const researchTaskId = researchTaskMatch[1];

        // Step 6: Create implementation task (depends on research)
        const implementTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'create', 'implementation',
            'Implement Deno application based on research findings',
            '--priority', '8',
            '--dependencies', researchTaskId,
            '--agent-id', implementerId,
            '--metadata', JSON.stringify({
              language: 'TypeScript',
              framework: 'Deno',
              testing_required: true,
              research_task: researchTaskId,
            }),
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: implementTaskCode, stdout: implementTaskOutput } = await implementTaskCommand.output();
        assertEquals(implementTaskCode, 0);
        
        const implementTaskResult = new TextDecoder().decode(implementTaskOutput);
        const implementTaskMatch = implementTaskResult.match(/"id":\s*"([^"]+)"/);
        assertExists(implementTaskMatch);
        const implementTaskId = implementTaskMatch[1];

        // Step 7: Execute research task
        const executeResearchCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'execute', researchTaskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: executeResearchCode } = await executeResearchCommand.output();
        assertEquals(executeResearchCode, 0);

        // Step 8: Wait for research task to complete, then execute implementation
        await delay(3000);

        const executeImplementCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'execute', implementTaskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: executeImplementCode } = await executeImplementCommand.output();
        assertEquals(executeImplementCode, 0);

        // Step 9: Check task statuses
        const researchStatusCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'status', researchTaskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: researchStatusCode, stdout: researchStatusOutput } = await researchStatusCommand.output();
        assertEquals(researchStatusCode, 0);
        
        const researchStatus = new TextDecoder().decode(researchStatusOutput);
        assertStringIncludes(researchStatus, researchTaskId);

        // Step 10: Query memory for stored results
        const memoryQueryCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'memory', 'query',
            '--agent-id', researcherId,
            '--type', 'insight',
            '--limit', '5',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: memoryQueryCode } = await memoryQueryCommand.output();
        assertEquals(memoryQueryCode, 0);

        // Step 11: Check system status
        const statusCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'status',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: statusCode, stdout: statusOutput } = await statusCommand.output();
        assertEquals(statusCode, 0);
        
        const statusResult = new TextDecoder().decode(statusOutput);
        assertStringIncludes(statusResult, 'System Status');

        // Step 12: List all agents and tasks
        const listAgentsCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'agent', 'list',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: listAgentsCode } = await listAgentsCommand.output();
        assertEquals(listAgentsCode, 0);

        const listTasksCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'list',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: listTasksCode } = await listTasksCommand.output();
        assertEquals(listTasksCode, 0);

      } finally {
        // Step 13: Shutdown system
        const shutdownCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'shutdown',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        await shutdownCommand.output();
        
        // Cleanup start process
        try {
          startProcess.kill();
        } catch {
          // Process may have already terminated
        }
      }
    });

    it('should handle multi-agent coordination workflow', async () => {
      // Start system
      const startCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'start',
          '--config', configPath,
          '--daemon',
          '--test-mode',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const startProcess = startCommand.spawn();
      await delay(2000);

      try {
        // Create coordinator agent
        const coordinatorCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'agent', 'spawn', 'coordinator',
            '--name', 'Project Coordinator',
            '--capabilities', 'planning,coordination,messaging',
            '--priority', '1',
            '--max-tasks', '5',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { stdout: coordinatorOutput } = await coordinatorCommand.output();
        const coordinatorResult = new TextDecoder().decode(coordinatorOutput);
        const coordinatorId = coordinatorResult.match(/"id":\s*"([^"]+)"/)?.[1];
        assertExists(coordinatorId);

        // Create multiple worker agents
        const workerIds: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const workerCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'agent', 'spawn', 'implementer',
              '--name', `Worker Agent ${i}`,
              '--capabilities', 'execution,processing,reporting',
              '--priority', '3',
              '--max-tasks', '2',
              '--config', configPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          const { stdout: workerOutput } = await workerCommand.output();
          const workerResult = new TextDecoder().decode(workerOutput);
          const workerId = workerResult.match(/"id":\s*"([^"]+)"/)?.[1];
          assertExists(workerId);
          workerIds.push(workerId);
        }

        // Create coordination task
        const coordinationTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'create', 'coordination',
            'Coordinate work distribution among worker agents',
            '--priority', '10',
            '--agent-id', coordinatorId,
            '--metadata', JSON.stringify({
              worker_agents: workerIds,
              work_type: 'data_processing',
              coordination_strategy: 'load_balanced',
            }),
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { stdout: coordinationTaskOutput } = await coordinationTaskCommand.output();
        const coordinationTaskResult = new TextDecoder().decode(coordinationTaskOutput);
        const coordinationTaskId = coordinationTaskResult.match(/"id":\s*"([^"]+)"/)?.[1];
        assertExists(coordinationTaskId);

        // Create worker tasks
        const workerTaskIds: string[] = [];
        for (let i = 0; i < workerIds.length; i++) {
          const workerTaskCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'task', 'create', 'processing',
              `Process data chunk ${i + 1}`,
              '--priority', '5',
              '--dependencies', coordinationTaskId,
              '--agent-id', workerIds[i],
              '--metadata', JSON.stringify({
                chunk_id: i + 1,
                coordinator_task: coordinationTaskId,
                processing_type: 'data_analysis',
              }),
              '--config', configPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          const { stdout: workerTaskOutput } = await workerTaskCommand.output();
          const workerTaskResult = new TextDecoder().decode(workerTaskOutput);
          const workerTaskId = workerTaskResult.match(/"id":\s*"([^"]+)"/)?.[1];
          assertExists(workerTaskId);
          workerTaskIds.push(workerTaskId);
        }

        // Execute coordination task
        const executeCoordinationCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'execute', coordinationTaskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        await executeCoordinationCommand.output();

        // Execute worker tasks concurrently
        const workerExecutions = workerTaskIds.map(taskId => {
          const executeWorkerCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'task', 'execute', taskId,
              '--config', configPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          return executeWorkerCommand.output();
        });

        await Promise.all(workerExecutions);

        // Verify all tasks completed
        for (const taskId of [coordinationTaskId, ...workerTaskIds]) {
          const statusCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'task', 'status', taskId,
              '--config', configPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          const { code } = await statusCommand.output();
          assertEquals(code, 0);
        }

        // Check memory for coordination events
        const coordinationMemoryCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'memory', 'query',
            '--agent-id', coordinatorId,
            '--tags', 'coordination',
            '--limit', '10',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: memoryCode } = await coordinationMemoryCommand.output();
        assertEquals(memoryCode, 0);

      } finally {
        // Shutdown system
        const shutdownCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'shutdown',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        await shutdownCommand.output();
        
        try {
          startProcess.kill();
        } catch {
          // Process may have already terminated
        }
      }
    });

    it('should handle error recovery and retry workflow', async () => {
      // Start system
      const startCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'start',
          '--config', configPath,
          '--daemon',
          '--test-mode',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const startProcess = startCommand.spawn();
      await delay(2000);

      try {
        // Create resilient agent
        const resilientAgentCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'agent', 'spawn', 'implementer',
            '--name', 'Resilient Agent',
            '--capabilities', 'error-handling,recovery,terminal',
            '--priority', '1',
            '--max-tasks', '3',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { stdout: agentOutput } = await resilientAgentCommand.output();
        const agentResult = new TextDecoder().decode(agentOutput);
        const agentId = agentResult.match(/"id":\s*"([^"]+)"/)?.[1];
        assertExists(agentId);

        // Create task that may fail initially
        const unreliableTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'create', 'shell-command',
            'Execute potentially failing command',
            '--priority', '8',
            '--agent-id', agentId,
            '--metadata', JSON.stringify({
              command: 'exit 1', // Command that fails
              max_retries: 3,
              retry_strategy: 'exponential_backoff',
              recovery_action: 'log_and_continue',
            }),
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { stdout: taskOutput } = await unreliableTaskCommand.output();
        const taskResult = new TextDecoder().decode(taskOutput);
        const taskId = taskResult.match(/"id":\s*"([^"]+)"/)?.[1];
        assertExists(taskId);

        // Execute unreliable task
        const executeTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'execute', taskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: executeCode } = await executeTaskCommand.output();
        // Task may fail but system should handle it gracefully
        assertEquals([0, 1].includes(executeCode), true);

        // Check task status to see retry attempts
        const statusCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'status', taskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: statusCode } = await statusCommand.output();
        assertEquals(statusCode, 0);

        // Create recovery task
        const recoveryTaskCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'create', 'shell-command',
            'Recovery validation task',
            '--priority', '10',
            '--agent-id', agentId,
            '--metadata', JSON.stringify({
              command: 'echo "Recovery successful"',
              recovery_from: taskId,
            }),
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { stdout: recoveryOutput } = await recoveryTaskCommand.output();
        const recoveryResult = new TextDecoder().decode(recoveryOutput);
        const recoveryTaskId = recoveryResult.match(/"id":\s*"([^"]+)"/)?.[1];
        assertExists(recoveryTaskId);

        // Execute recovery task
        const executeRecoveryCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'task', 'execute', recoveryTaskId,
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: recoveryCode } = await executeRecoveryCommand.output();
        assertEquals(recoveryCode, 0);

        // Check system health after error scenarios
        const healthCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'status',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: healthCode } = await healthCommand.output();
        assertEquals(healthCode, 0);

      } finally {
        // Shutdown system
        const shutdownCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'shutdown',
            '--config', configPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        await shutdownCommand.output();
        
        try {
          startProcess.kill();
        } catch {
          // Process may have already terminated
        }
      }
    });
  });

  describe('performance and stress testing', () => {
    it('should handle high-load scenarios', async () => {
      // Start system with performance config
      const perfConfig = {
        ...JSON.parse(await Deno.readTextFile(configPath)),
        orchestrator: {
          maxConcurrentAgents: 10,
          taskQueueSize: 200,
          healthCheckInterval: 1000,
          shutdownTimeout: 5000,
          metricsInterval: 2000,
        },
        terminal: {
          type: 'native',
          poolSize: 8,
          recycleAfter: 20,
          healthCheckInterval: 2000,
          commandTimeout: 15000,
        },
      };

      const perfConfigPath = `${testDir}/perf-config.json`;
      await Deno.writeTextFile(perfConfigPath, JSON.stringify(perfConfig, null, 2));

      const startCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'start',
          '--config', perfConfigPath,
          '--daemon',
          '--test-mode',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const startProcess = startCommand.spawn();
      await delay(3000);

      try {
        // Create multiple agents for load testing
        const agentIds: string[] = [];
        for (let i = 1; i <= 5; i++) {
          const agentCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'agent', 'spawn', 'implementer',
              '--name', `Load Test Agent ${i}`,
              '--capabilities', 'processing,computation',
              '--priority', '2',
              '--max-tasks', '4',
              '--config', perfConfigPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          const { stdout: agentOutput } = await agentCommand.output();
          const agentResult = new TextDecoder().decode(agentOutput);
          const agentId = agentResult.match(/"id":\s*"([^"]+)"/)?.[1];
          assertExists(agentId);
          agentIds.push(agentId);
        }

        // Create many tasks for stress testing
        const taskIds: string[] = [];
        for (let i = 1; i <= 20; i++) {
          const taskCommand = new Deno.Command(Deno.execPath(), {
            args: [
              'run', '--allow-all', 'src/cli/index.ts',
              'task', 'create', 'shell-command',
              `Load test task ${i}`,
              '--priority', String(Math.floor(Math.random() * 10) + 1),
              '--agent-id', agentIds[Math.floor(Math.random() * agentIds.length)],
              '--metadata', JSON.stringify({
                command: `echo "Task ${i} processing..." && sleep 0.1`,
                load_test: true,
                task_number: i,
              }),
              '--config', perfConfigPath,
            ],
            stdout: 'piped',
            stderr: 'piped',
            cwd: Deno.cwd(),
          });

          const { stdout: taskOutput } = await taskCommand.output();
          const taskResult = new TextDecoder().decode(taskOutput);
          const taskId = taskResult.match(/"id":\s*"([^"]+)"/)?.[1];
          assertExists(taskId);
          taskIds.push(taskId);
        }

        // Execute tasks in batches
        const batchSize = 5;
        for (let i = 0; i < taskIds.length; i += batchSize) {
          const batch = taskIds.slice(i, i + batchSize);
          
          const batchExecutions = batch.map(taskId => {
            const executeCommand = new Deno.Command(Deno.execPath(), {
              args: [
                'run', '--allow-all', 'src/cli/index.ts',
                'task', 'execute', taskId,
                '--config', perfConfigPath,
              ],
              stdout: 'piped',
              stderr: 'piped',
              cwd: Deno.cwd(),
            });

            return executeCommand.output();
          });

          await Promise.all(batchExecutions);
          
          // Brief pause between batches
          await delay(500);
        }

        // Check system metrics after load test
        const metricsCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'status',
            '--detailed',
            '--config', perfConfigPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: metricsCode, stdout: metricsOutput } = await metricsCommand.output();
        assertEquals(metricsCode, 0);
        
        const metricsResult = new TextDecoder().decode(metricsOutput);
        assertStringIncludes(metricsResult, 'System Status');

        // Verify memory usage for completed tasks
        const memoryStatsCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'memory', 'stats',
            '--config', perfConfigPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        const { code: memoryStatsCode } = await memoryStatsCommand.output();
        assertEquals(memoryStatsCode, 0);

      } finally {
        // Shutdown system
        const shutdownCommand = new Deno.Command(Deno.execPath(), {
          args: [
            'run', '--allow-all', 'src/cli/index.ts',
            'shutdown',
            '--config', perfConfigPath,
          ],
          stdout: 'piped',
          stderr: 'piped',
          cwd: Deno.cwd(),
        });

        await shutdownCommand.output();
        
        try {
          startProcess.kill();
        } catch {
          // Process may have already terminated
        }
      }
    });
  });
});