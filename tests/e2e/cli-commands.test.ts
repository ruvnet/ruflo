/**
 * End-to-end CLI command tests
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from '../test.utils.ts';
import { cleanupTestEnv, setupTestEnv } from '../test.config.ts';
import { generateId } from '../../src/utils/helpers.ts';

describe('CLI Commands E2E', () => {
  let testDir: string;
  
  beforeEach(async () => {
    setupTestEnv();
    testDir = await Deno.makeTempDir({ prefix: 'gemini-flow-e2e-' });
  });

  afterEach(async () => {
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    await cleanupTestEnv();
  });

  describe('configuration commands', () => {
    it('should show help information', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', '--help'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout, stderr } = await command.output();
      const output = new TextDecoder().decode(stdout);
      const errorOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Gemini-Flow');
      assertStringIncludes(output, 'COMMANDS');
      assertStringIncludes(output, 'start');
      assertStringIncludes(output, 'config');
      assertStringIncludes(output, 'agent');
      assertStringIncludes(output, 'task');
      assertStringIncludes(output, 'memory');
    });

    it('should initialize configuration file', async () => {
      const configPath = `${testDir}/test-config.json`;

      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'config', 'init', configPath],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Configuration file created');

      // Verify file was created with valid content
      const stat = await Deno.stat(configPath);
      assertEquals(stat.isFile, true);

      const content = await Deno.readTextFile(configPath);
      const config = JSON.parse(content);

      assertExists(config.orchestrator);
      assertExists(config.terminal);
      assertExists(config.memory);
      assertExists(config.coordination);
      assertExists(config.mcp);
      assertExists(config.logging);

      // Check specific default values
      assertEquals(config.orchestrator.maxConcurrentAgents, 10);
      assertEquals(config.terminal.type, 'auto');
      assertEquals(config.memory.backend, 'hybrid');
    });

    it('should validate configuration file', async () => {
      const configPath = `${testDir}/valid-config.json`;
      
      // Create a valid config file
      const validConfig = {
        orchestrator: {
          maxConcurrentAgents: 5,
          taskQueueSize: 50,
          healthCheckInterval: 30000,
          shutdownTimeout: 10000,
        },
        terminal: {
          type: 'native',
          poolSize: 3,
          recycleAfter: 5,
          healthCheckInterval: 15000,
          commandTimeout: 30000,
        },
        memory: {
          backend: 'sqlite',
          cacheSizeMB: 100,
          syncInterval: 5000,
          conflictResolution: 'crdt',
          retentionDays: 30,
        },
        coordination: {
          maxRetries: 3,
          retryDelay: 1000,
          deadlockDetection: true,
          resourceTimeout: 30000,
          messageTimeout: 10000,
        },
        mcp: {
          transport: 'stdio',
        },
        logging: {
          level: 'info',
          format: 'json',
          destination: 'both',
          filePath: './logs/gemini-flow.log',
        },
      };

      await Deno.writeTextFile(configPath, JSON.stringify(validConfig, null, 2));

      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'config', 'validate', configPath],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Configuration is valid');
    });

    it('should detect invalid configuration', async () => {
      const configPath = `${testDir}/invalid-config.json`;
      
      // Create an invalid config file
      const invalidConfig = {
        orchestrator: {
          maxConcurrentAgents: 0, // Invalid: must be at least 1
          taskQueueSize: -10, // Invalid: negative value
        },
        terminal: {
          type: 'invalid-type', // Invalid: not in enum
          poolSize: 0, // Invalid: must be at least 1
        },
        memory: {
          backend: 'unknown', // Invalid: not in enum
          cacheSizeMB: -5, // Invalid: negative value
        },
      };

      await Deno.writeTextFile(configPath, JSON.stringify(invalidConfig, null, 2));

      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'config', 'validate', configPath],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 1); // Should exit with error code
      assertStringIncludes(output, 'Configuration validation failed');
    });

    it('should show current configuration', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'config', 'show'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      
      // Should contain JSON configuration
      const config = JSON.parse(output);
      assertExists(config.orchestrator);
      assertExists(config.terminal);
      assertExists(config.memory);
    });
  });

  describe('agent commands', () => {
    it('should create agent profile', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'spawn', 'researcher',
          '--name', 'Test Researcher',
          '--priority', '5',
          '--capabilities', 'analysis,research,web-search',
          '--max-tasks', '3',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Agent profile created');
      
      // Parse JSON output to verify profile
      const profile = JSON.parse(output.split('\n').find(line => line.includes('"id"')) || '{}');
      assertEquals(profile.name, 'Test Researcher');
      assertEquals(profile.type, 'researcher');
      assertEquals(profile.priority, 5);
      assertEquals(profile.maxConcurrentTasks, 3);
      assertEquals(profile.capabilities.includes('analysis'), true);
      assertEquals(profile.capabilities.includes('research'), true);
    });

    it('should list agent profiles', async () => {
      // First create an agent
      const createCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'spawn', 'implementer',
          '--name', 'Test Implementer',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      await createCommand.output();

      // Then list agents
      const listCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'agent', 'list'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await listCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Active Agents');
    });

    it('should show agent status', async () => {
      // Create and start an agent first
      const spawnCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'spawn', 'coordinator',
          '--name', 'Status Test Agent',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: spawnOutput } = await spawnCommand.output();
      const spawnResult = new TextDecoder().decode(spawnOutput);
      
      // Extract agent ID from spawn output
      const agentMatch = spawnResult.match(/"id":\s*"([^"]+)"/);
      if (!agentMatch) {
        throw new Error('Could not extract agent ID from spawn output');
      }
      const agentId = agentMatch[1];

      // Check agent status
      const statusCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'agent', 'status', agentId],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await statusCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, agentId);
      assertStringIncludes(output, 'Status Test Agent');
    });

    it('should terminate agent', async () => {
      // Create an agent first
      const spawnCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'spawn', 'analyst',
          '--name', 'Terminate Test Agent',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: spawnOutput } = await spawnCommand.output();
      const spawnResult = new TextDecoder().decode(spawnOutput);
      
      const agentMatch = spawnResult.match(/"id":\s*"([^"]+)"/);
      if (!agentMatch) {
        throw new Error('Could not extract agent ID from spawn output');
      }
      const agentId = agentMatch[1];

      // Terminate the agent
      const terminateCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'terminate', agentId,
          '--reason', 'Test termination',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await terminateCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Agent terminated');
      assertStringIncludes(output, agentId);
    });
  });

  describe('task commands', () => {
    it('should create task', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'create', 'analysis',
          'Analyze the test data for patterns',
          '--priority', '8',
          '--dependencies', 'data-collection,preprocessing',
          '--metadata', '{"dataset": "test-data", "algorithm": "kmeans"}',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Task created');
      
      // Parse JSON output to verify task
      const task = JSON.parse(output.split('\n').find(line => line.includes('"id"')) || '{}');
      assertEquals(task.type, 'analysis');
      assertEquals(task.description, 'Analyze the test data for patterns');
      assertEquals(task.priority, 8);
      assertEquals(task.dependencies.includes('data-collection'), true);
      assertEquals(task.dependencies.includes('preprocessing'), true);
      assertEquals(task.input.dataset, 'test-data');
    });

    it('should list tasks', async () => {
      // Create a task first
      const createCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'create', 'test-task',
          'Test task for listing',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      await createCommand.output();

      // List tasks
      const listCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'task', 'list'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await listCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Tasks');
    });

    it('should show task status', async () => {
      // Create a task first
      const createCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'create', 'status-test',
          'Task for status testing',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: createOutput } = await createCommand.output();
      const createResult = new TextDecoder().decode(createOutput);
      
      const taskMatch = createResult.match(/"id":\s*"([^"]+)"/);
      if (!taskMatch) {
        throw new Error('Could not extract task ID from create output');
      }
      const taskId = taskMatch[1];

      // Check task status
      const statusCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'task', 'status', taskId],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await statusCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, taskId);
      assertStringIncludes(output, 'status-test');
    });

    it('should execute task', async () => {
      // Create a simple task first
      const createCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'create', 'shell-command',
          'Execute echo command',
          '--metadata', '{"command": "echo Hello World"}',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: createOutput } = await createCommand.output();
      const createResult = new TextDecoder().decode(createOutput);
      
      const taskMatch = createResult.match(/"id":\s*"([^"]+)"/);
      if (!taskMatch) {
        throw new Error('Could not extract task ID from create output');
      }
      const taskId = taskMatch[1];

      // Execute the task
      const executeCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'task', 'execute', taskId],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await executeCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Task execution');
    });

    it('should cancel task', async () => {
      // Create a task first
      const createCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'create', 'cancellation-test',
          'Task for cancellation testing',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: createOutput } = await createCommand.output();
      const createResult = new TextDecoder().decode(createOutput);
      
      const taskMatch = createResult.match(/"id":\s*"([^"]+)"/);
      if (!taskMatch) {
        throw new Error('Could not extract task ID from create output');
      }
      const taskId = taskMatch[1];

      // Cancel the task
      const cancelCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'task', 'cancel', taskId,
          '--reason', 'Test cancellation',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await cancelCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Task cancelled');
      assertStringIncludes(output, taskId);
    });
  });

  describe('memory commands', () => {
    it('should query memory entries', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'memory', 'query',
          '--type', 'observation',
          '--tags', 'test,important',
          '--limit', '10',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Memory query results');
    });

    it('should store memory entry', async () => {
      const entryContent = 'Test memory entry for CLI testing';
      
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'memory', 'store',
          '--agent-id', 'test-agent',
          '--type', 'observation',
          '--content', entryContent,
          '--tags', 'cli-test,manual',
          '--context', '{"source": "cli", "test": true}',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Memory entry stored');
      assertStringIncludes(output, entryContent);
    });

    it('should delete memory entry', async () => {
      // First store an entry
      const storeCommand = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'memory', 'store',
          '--agent-id', 'test-agent',
          '--type', 'observation',
          '--content', 'Entry to be deleted',
          '--tags', 'delete-test',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { stdout: storeOutput } = await storeCommand.output();
      const storeResult = new TextDecoder().decode(storeOutput);
      
      const entryMatch = storeResult.match(/"id":\s*"([^"]+)"/);
      if (!entryMatch) {
        throw new Error('Could not extract entry ID from store output');
      }
      const entryId = entryMatch[1];

      // Delete the entry
      const deleteCommand = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'memory', 'delete', entryId],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await deleteCommand.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Memory entry deleted');
      assertStringIncludes(output, entryId);
    });

    it('should sync memory', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'memory', 'sync'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Memory synchronization');
    });

    it('should show memory statistics', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'memory', 'stats'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Memory Statistics');
    });
  });

  describe('system commands', () => {
    it('should start system in test mode', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'start',
          '--test-mode',
          '--timeout', '5000', // 5 second timeout for testing
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Gemini-Flow system');
    });

    it('should show system status', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'status'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'System Status');
    });

    it('should show version information', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', '--version'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'Gemini-Flow');
      assertStringIncludes(output, 'version');
    });
  });

  describe('error handling', () => {
    it('should handle invalid commands gracefully', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'src/cli/index.ts', 'invalid-command'],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stderr } = await command.output();
      const errorOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 1);
      assertStringIncludes(errorOutput, 'Unknown command');
    });

    it('should handle missing required arguments', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'spawn', // Missing agent type
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stderr } = await command.output();
      const errorOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 1);
      assertStringIncludes(errorOutput, 'required');
    });

    it('should handle invalid file paths', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'validate', '/non/existent/path.json',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stderr } = await command.output();
      const errorOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 1);
      assertStringIncludes(errorOutput, 'not found');
    });

    it('should handle invalid JSON in configuration', async () => {
      const invalidConfigPath = `${testDir}/invalid.json`;
      await Deno.writeTextFile(invalidConfigPath, '{ invalid json }');

      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'validate', invalidConfigPath,
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stderr } = await command.output();
      const errorOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 1);
      assertStringIncludes(errorOutput, 'JSON');
    });
  });

  describe('output formats', () => {
    it('should support JSON output format', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'show',
          '--format', 'json',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      
      // Should be valid JSON
      const config = JSON.parse(output);
      assertExists(config.orchestrator);
    });

    it('should support table output format', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'agent', 'list',
          '--format', 'table',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Table format should contain headers and borders
      assertStringIncludes(output, '|');
    });

    it('should support YAML output format', async () => {
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'show',
          '--format', 'yaml',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const { code, stdout } = await command.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // YAML format should contain key-value pairs with colons
      assertStringIncludes(output, 'orchestrator:');
      assertStringIncludes(output, 'terminal:');
    });
  });

  describe('interactive mode', () => {
    it('should support interactive configuration setup', async () => {
      // Note: This test simulates interactive input
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', 'src/cli/index.ts',
          'config', 'init',
          `${testDir}/interactive-config.json`,
          '--interactive',
        ],
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
        cwd: Deno.cwd(),
      });

      const process = command.spawn();
      
      // Simulate user input
      const writer = process.stdin.getWriter();
      await writer.write(new TextEncoder().encode('\n')); // Accept defaults
      await writer.write(new TextEncoder().encode('\n'));
      await writer.write(new TextEncoder().encode('\n'));
      await writer.close();

      const { code } = await process.output();
      assertEquals(code, 0);
    });
  });
});