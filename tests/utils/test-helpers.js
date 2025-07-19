/**
 * Test utilities and helpers
 */

import { jest } from '@jest/globals';
import fs from 'fs-extra';
import path from 'path';
import { tmpdir } from 'os';

/**
 * Create a temporary test directory
 */
export async function createTempDir(prefix = 'gemini-flow-test') {
  const tempDir = path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  await fs.ensureDir(tempDir);
  return tempDir;
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(dir) {
  if (dir && await fs.pathExists(dir)) {
    await fs.remove(dir);
  }
}

/**
 * Mock swarm data structure
 */
export function createMockSwarmData(overrides = {}) {
  return {
    id: `swarm-${Date.now()}`,
    objective: 'Test objective',
    status: 'active',
    topology: 'hierarchical',
    strategy: 'adaptive',
    maxAgents: 8,
    parallel: false,
    created: new Date().toISOString(),
    agents: [],
    tasks: [],
    metrics: {
      startTime: new Date().toISOString(),
      tasksCompleted: 0,
      tasksInProgress: 0,
      tasksPending: 0,
      avgCompletionTime: 0,
      successRate: 1.0
    },
    logs: [],
    ...overrides
  };
}

/**
 * Mock agent data structure
 */
export function createMockAgent(overrides = {}) {
  return {
    id: `agent-${Date.now()}`,
    name: 'Test Agent',
    type: 'researcher',
    status: 'idle',
    created: new Date().toISOString(),
    currentTask: null,
    tasksCompleted: 0,
    capabilities: ['research', 'analysis'],
    metrics: {
      avgCompletionTime: 5000,
      successRate: 0.95,
      totalTasks: 0
    },
    ...overrides
  };
}

/**
 * Mock memory entry structure
 */
export function createMockMemoryEntry(key, value, overrides = {}) {
  return {
    key,
    value,
    timestamp: new Date().toISOString(),
    tags: [],
    expiresAt: null,
    metadata: {},
    ...overrides
  };
}

/**
 * Mock task data structure
 */
export function createMockTask(overrides = {}) {
  return {
    id: `task-${Date.now()}`,
    title: 'Test Task',
    description: 'Test task description',
    status: 'pending',
    priority: 'medium',
    assignedTo: null,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    dependencies: [],
    tags: [],
    ...overrides
  };
}

/**
 * Mock log entry structure
 */
export function createMockLogEntry(message, level = 'info', overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {},
    agentId: null,
    taskId: null,
    ...overrides
  };
}

/**
 * Mock console methods for testing
 */
export function mockConsole() {
  const originalConsole = { ...console };
  const mocks = {
    log: jest.spyOn(console, 'log').mockImplementation(),
    error: jest.spyOn(console, 'error').mockImplementation(),
    warn: jest.spyOn(console, 'warn').mockImplementation(),
    info: jest.spyOn(console, 'info').mockImplementation(),
    debug: jest.spyOn(console, 'debug').mockImplementation(),
  };

  return {
    mocks,
    restore: () => {
      Object.keys(mocks).forEach(key => {
        mocks[key].mockRestore();
      });
    },
    getOutput: (method = 'log') => {
      return mocks[method].mock.calls.flat().join('\n');
    }
  };
}

/**
 * Mock file system operations
 */
export function mockFileSystem() {
  const mocks = {
    pathExists: jest.spyOn(fs, 'pathExists'),
    readJson: jest.spyOn(fs, 'readJson'),
    writeJson: jest.spyOn(fs, 'writeJson'),
    ensureDir: jest.spyOn(fs, 'ensureDir'),
    remove: jest.spyOn(fs, 'remove'),
    readFile: jest.spyOn(fs, 'readFile'),
    writeFile: jest.spyOn(fs, 'writeFile'),
    copy: jest.spyOn(fs, 'copy'),
  };

  return {
    mocks,
    restore: () => {
      Object.keys(mocks).forEach(key => {
        mocks[key].mockRestore();
      });
    },
    reset: () => {
      Object.keys(mocks).forEach(key => {
        mocks[key].mockReset();
      });
    }
  };
}

/**
 * Mock spawn process
 */
export function mockSpawnProcess(exitCode = 0, stdout = '', stderr = '') {
  const mockProcess = {
    stdout: {
      on: jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(stdout)), 10);
        }
      })
    },
    stderr: {
      on: jest.fn((event, callback) => {
        if (event === 'data') {
          setTimeout(() => callback(Buffer.from(stderr)), 10);
        }
      })
    },
    on: jest.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(exitCode), 50);
      } else if (event === 'error') {
        // Don't trigger error unless explicitly requested
      }
    }),
    kill: jest.fn(),
    pid: 12345
  };

  return mockProcess;
}

/**
 * Mock spinner (ora)
 */
export function mockSpinner() {
  return {
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
    info: jest.fn().mockReturnThis(),
    text: '',
    color: 'cyan',
    isSpinning: false
  };
}

/**
 * Create mock directory structure
 */
export async function createMockProjectStructure(baseDir, structure = {}) {
  const defaultStructure = {
    '.claude': {
      'settings.json': JSON.stringify({ version: '2.0.0' }),
      'commands': {},
      'swarm': {},
      'memory': {
        'memory.json': JSON.stringify({ entries: [] })
      }
    },
    'package.json': JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'jest'
      }
    }),
    'README.md': '# Test Project',
    ...structure
  };

  async function createStructure(dir, struct) {
    for (const [name, content] of Object.entries(struct)) {
      const fullPath = path.join(dir, name);
      
      if (typeof content === 'string') {
        // It's a file
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content);
      } else if (typeof content === 'object') {
        // It's a directory
        await fs.ensureDir(fullPath);
        await createStructure(fullPath, content);
      }
    }
  }

  await createStructure(baseDir, defaultStructure);
  return baseDir;
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Create a test environment with cleanup
 */
export function createTestEnvironment() {
  let tempDir;
  let consoleMocks;
  let fsMocks;
  
  const setup = async () => {
    tempDir = await createTempDir();
    consoleMocks = mockConsole();
    fsMocks = mockFileSystem();
    
    // Create basic project structure
    await createMockProjectStructure(tempDir);
    
    return {
      tempDir,
      consoleMocks,
      fsMocks
    };
  };
  
  const cleanup = async () => {
    if (consoleMocks) consoleMocks.restore();
    if (fsMocks) fsMocks.restore();
    if (tempDir) await cleanupTempDir(tempDir);
  };
  
  return { setup, cleanup };
}

/**
 * Assertion helpers
 */
export const assertions = {
  /**
   * Assert that output contains expected strings
   */
  outputContains(output, ...expectedStrings) {
    for (const expected of expectedStrings) {
      expect(output).toContain(expected);
    }
  },

  /**
   * Assert that file exists and contains expected content
   */
  async fileContains(filePath, expectedContent) {
    expect(await fs.pathExists(filePath)).toBe(true);
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain(expectedContent);
  },

  /**
   * Assert that JSON file contains expected data
   */
  async jsonFileContains(filePath, expectedData) {
    expect(await fs.pathExists(filePath)).toBe(true);
    const data = await fs.readJson(filePath);
    expect(data).toMatchObject(expectedData);
  },

  /**
   * Assert that directory structure exists
   */
  async directoryStructureExists(baseDir, structure) {
    for (const [name, content] of Object.entries(structure)) {
      const fullPath = path.join(baseDir, name);
      
      if (typeof content === 'string') {
        await this.fileContains(fullPath, content);
      } else if (typeof content === 'object') {
        expect(await fs.pathExists(fullPath)).toBe(true);
        await this.directoryStructureExists(fullPath, content);
      }
    }
  }
};

/**
 * Performance testing helpers
 */
export const perfHelpers = {
  /**
   * Measure execution time of a function
   */
  async measureTime(fn) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    return {
      result,
      duration: end - start
    };
  },

  /**
   * Assert that function executes within time limit
   */
  async expectWithinTime(fn, maxDuration) {
    const { result, duration } = await this.measureTime(fn);
    expect(duration).toBeLessThan(maxDuration);
    return result;
  }
};

export default {
  createTempDir,
  cleanupTempDir,
  createMockSwarmData,
  createMockAgent,
  createMockMemoryEntry,
  createMockTask,
  createMockLogEntry,
  mockConsole,
  mockFileSystem,
  mockSpawnProcess,
  mockSpinner,
  createMockProjectStructure,
  waitFor,
  createTestEnvironment,
  assertions,
  perfHelpers
};