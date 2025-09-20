/**
 * Test Utilities for Claude Flow MCP System Tests
 * Helper functions for setting up test environments and common operations
 */

import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

/**
 * Create a temporary directory for test files
 */
export async function createTempDir(prefix: string = 'claude-flow-test'): Promise<string> {
  const tempPath = path.join(tmpdir(), `${prefix}-${crypto.randomBytes(8).toString('hex')}`);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Clean up temporary directory
 */
export async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
    console.warn(`Failed to cleanup temp dir ${dirPath}:`, error);
  }
}

/**
 * Create mock logger for tests
 */
export function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn()
  };
}

/**
 * Generate test data for memory system
 */
export function generateTestMemoryData(count: number = 10) {
  const testData = [];
  
  for (let i = 0; i < count; i++) {
    testData.push({
      key: `test-key-${i}`,
      value: {
        id: i,
        content: `Test content for item ${i}`,
        type: 'test-data',
        timestamp: new Date().toISOString(),
        metadata: {
          index: i,
          generated: true
        }
      },
      namespace: 'test',
      category: 'generated',
      tags: ['test', 'generated', `item-${i}`],
      priority: ['low', 'medium', 'high'][i % 3] as 'low' | 'medium' | 'high'
    });
  }
  
  return testData;
}

/**
 * Generate test agents for swarm coordination
 */
export function generateTestAgents(count: number = 5) {
  const agentTypes = ['coder', 'tester', 'researcher', 'analyst', 'coordinator'] as const;
  const testAgents = [];
  
  for (let i = 0; i < count; i++) {
    testAgents.push({
      type: agentTypes[i % agentTypes.length],
      name: `Test-${agentTypes[i % agentTypes.length]}-${i}`,
      capabilities: [
        'testing',
        'coordination',
        agentTypes[i % agentTypes.length]
      ],
      maxConcurrentTasks: Math.floor(Math.random() * 3) + 1
    });
  }
  
  return testAgents;
}

/**
 * Generate test tasks for coordination
 */
export function generateTestTasks(count: number = 10) {
  const taskTypes = ['code', 'test', 'research', 'analysis', 'coordination'] as const;
  const priorities = ['low', 'medium', 'high', 'critical'] as const;
  const testTasks = [];
  
  for (let i = 0; i < count; i++) {
    testTasks.push({
      id: `test-task-${i}`,
      type: taskTypes[i % taskTypes.length],
      description: `Test task ${i} - ${taskTypes[i % taskTypes.length]}`,
      priority: priorities[i % priorities.length],
      estimatedDuration: (Math.floor(Math.random() * 60) + 10) * 1000, // 10-70 seconds
      dependencies: i > 0 && Math.random() > 0.7 ? [`test-task-${i-1}`] : [],
      requirements: [
        taskTypes[i % taskTypes.length],
        'testing'
      ]
    });
  }
  
  return testTasks;
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await condition();
      if (result) {
        return true;
      }
    } catch (error) {
      // Continue trying
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return false;
}

/**
 * Mock MCP tool responses
 */
export function createMockMCPTools() {
  return {
    'memory-manager': {
      name: 'memory-manager',
      type: 'memory',
      capabilities: ['store', 'retrieve', 'query', 'vector-search'],
      methods: {
        store: jest.fn().mockResolvedValue({ success: true }),
        retrieve: jest.fn().mockResolvedValue({ data: 'mock-data' }),
        query: jest.fn().mockResolvedValue({ results: [] }),
        vectorSearch: jest.fn().mockResolvedValue({ matches: [] })
      }
    },
    'task-orchestrator': {
      name: 'task-orchestrator',
      type: 'coordination',
      capabilities: ['assign', 'monitor', 'complete'],
      methods: {
        assign: jest.fn().mockResolvedValue({ taskId: 'mock-task' }),
        monitor: jest.fn().mockResolvedValue({ status: 'running' }),
        complete: jest.fn().mockResolvedValue({ success: true })
      }
    }
  };
}

/**
 * Performance measurement utilities
 */
export class PerformanceMeasure {
  private startTimes: Map<string, number> = new Map();
  private measurements: Map<string, number[]> = new Map();
  
  start(label: string): void {
    this.startTimes.set(label, performance.now());
  }
  
  end(label: string): number {
    const startTime = this.startTimes.get(label);
    if (!startTime) {
      throw new Error(`No start time found for label: ${label}`);
    }
    
    const duration = performance.now() - startTime;
    
    if (!this.measurements.has(label)) {
      this.measurements.set(label, []);
    }
    this.measurements.get(label)!.push(duration);
    
    this.startTimes.delete(label);
    return duration;
  }
  
  getStats(label: string) {
    const measurements = this.measurements.get(label) || [];
    if (measurements.length === 0) {
      return null;
    }
    
    const sorted = [...measurements].sort((a, b) => a - b);
    return {
      count: measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      average: measurements.reduce((a, b) => a + b, 0) / measurements.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }
  
  getAllStats() {
    const stats: Record<string, any> = {};
    for (const label of this.measurements.keys()) {
      stats[label] = this.getStats(label);
    }
    return stats;
  }
  
  reset(): void {
    this.startTimes.clear();
    this.measurements.clear();
  }
}

/**
 * Memory usage tracking
 */
export class MemoryTracker {
  private initialMemory: NodeJS.MemoryUsage;
  private measurements: NodeJS.MemoryUsage[] = [];
  
  constructor() {
    this.initialMemory = process.memoryUsage();
  }
  
  snapshot(): NodeJS.MemoryUsage {
    const current = process.memoryUsage();
    this.measurements.push(current);
    return current;
  }
  
  getDelta(): NodeJS.MemoryUsage {
    const current = process.memoryUsage();
    return {
      rss: current.rss - this.initialMemory.rss,
      heapTotal: current.heapTotal - this.initialMemory.heapTotal,
      heapUsed: current.heapUsed - this.initialMemory.heapUsed,
      external: current.external - this.initialMemory.external,
      arrayBuffers: current.arrayBuffers - this.initialMemory.arrayBuffers
    };
  }
  
  getStats() {
    if (this.measurements.length === 0) {
      return null;
    }
    
    const stats = {
      rss: { min: Infinity, max: -Infinity, avg: 0 },
      heapTotal: { min: Infinity, max: -Infinity, avg: 0 },
      heapUsed: { min: Infinity, max: -Infinity, avg: 0 },
      external: { min: Infinity, max: -Infinity, avg: 0 },
      arrayBuffers: { min: Infinity, max: -Infinity, avg: 0 }
    };
    
    for (const measurement of this.measurements) {
      for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
        const value = measurement[key];
        stats[key].min = Math.min(stats[key].min, value);
        stats[key].max = Math.max(stats[key].max, value);
        stats[key].avg += value;
      }
    }
    
    for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
      stats[key].avg /= this.measurements.length;
    }
    
    return stats;
  }
  
  reset(): void {
    this.initialMemory = process.memoryUsage();
    this.measurements = [];
  }
}

/**
 * Test event collector for verifying event emissions
 */
export class TestEventCollector {
  private events: Array<{ type: string; data: any; timestamp: number }> = [];
  
  collect(eventEmitter: any, eventTypes: string[]): void {
    for (const eventType of eventTypes) {
      eventEmitter.on(eventType, (data: any) => {
        this.events.push({
          type: eventType,
          data,
          timestamp: Date.now()
        });
      });
    }
  }
  
  getEvents(type?: string) {
    if (type) {
      return this.events.filter(e => e.type === type);
    }
    return [...this.events];
  }
  
  getEventCount(type?: string): number {
    return this.getEvents(type).length;
  }
  
  waitForEvent(type: string, timeoutMs: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeoutMs);
      
      const existingEvent = this.events.find(e => e.type === type);
      if (existingEvent) {
        clearTimeout(timeout);
        resolve(existingEvent.data);
        return;
      }
      
      const checkForEvent = () => {
        const event = this.events.find(e => e.type === type);
        if (event) {
          clearTimeout(timeout);
          resolve(event.data);
        } else {
          setTimeout(checkForEvent, 50);
        }
      };
      
      checkForEvent();
    });
  }
  
  clear(): void {
    this.events = [];
  }
}

/**
 * Resource cleanup helper
 */
export class ResourceCleanup {
  private cleanupTasks: Array<() => Promise<void> | void> = [];
  
  add(cleanupTask: () => Promise<void> | void): void {
    this.cleanupTasks.push(cleanupTask);
  }
  
  async cleanup(): Promise<void> {
    const errors: Error[] = [];
    
    // Run cleanup tasks in reverse order
    for (const task of this.cleanupTasks.reverse()) {
      try {
        await task();
      } catch (error) {
        errors.push(error as Error);
      }
    }
    
    this.cleanupTasks = [];
    
    if (errors.length > 0) {
      console.warn('Cleanup errors:', errors);
    }
  }
}

/**
 * Test configuration builder
 */
export class TestConfigBuilder {
  private config: any = {};
  
  withMemoryConfig(overrides: any = {}): this {
    this.config.memory = {
      persistenceDir: './test-memory',
      sessionId: 'test-session',
      vectorSearchEnabled: true,
      compressionEnabled: true,
      similarityThreshold: 0.3,
      ...overrides
    };
    return this;
  }
  
  withSwarmConfig(overrides: any = {}): this {
    this.config.swarm = {
      mode: 'distributed',
      strategy: 'adaptive',
      maxAgents: 5,
      topology: 'mesh',
      timeout: 30000,
      retryAttempts: 3,
      ...overrides
    };
    return this;
  }
  
  withLoggingConfig(overrides: any = {}): this {
    this.config.logging = {
      level: 'error',
      format: 'json',
      destination: 'console',
      ...overrides
    };
    return this;
  }
  
  build(): any {
    return { ...this.config };
  }
}

/**
 * Stress test helper
 */
export class StressTestHelper {
  private operations: Array<() => Promise<any>> = [];
  private concurrency: number = 10;
  private duration: number = 10000; // 10 seconds
  
  addOperation(operation: () => Promise<any>): this {
    this.operations.push(operation);
    return this;
  }
  
  setConcurrency(concurrency: number): this {
    this.concurrency = concurrency;
    return this;
  }
  
  setDuration(duration: number): this {
    this.duration = duration;
    return this;
  }
  
  async run(): Promise<{
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageLatency: number;
    operationsPerSecond: number;
    errors: Error[];
  }> {
    const startTime = Date.now();
    const endTime = startTime + this.duration;
    const errors: Error[] = [];
    let totalOperations = 0;
    let successfulOperations = 0;
    let totalLatency = 0;
    
    const workers = [];
    
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this.runWorker(endTime, errors, (latency: number) => {
        totalOperations++;
        totalLatency += latency;
        successfulOperations++;
      }));
    }
    
    await Promise.all(workers);
    
    const actualDuration = Date.now() - startTime;
    
    return {
      totalOperations,
      successfulOperations,
      failedOperations: totalOperations - successfulOperations,
      averageLatency: totalOperations > 0 ? totalLatency / totalOperations : 0,
      operationsPerSecond: (totalOperations / actualDuration) * 1000,
      errors
    };
  }
  
  private async runWorker(
    endTime: number,
    errors: Error[],
    onSuccess: (latency: number) => void
  ): Promise<void> {
    while (Date.now() < endTime) {
      if (this.operations.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }
      
      const operation = this.operations[Math.floor(Math.random() * this.operations.length)];
      const operationStart = Date.now();
      
      try {
        await operation();
        const latency = Date.now() - operationStart;
        onSuccess(latency);
      } catch (error) {
        errors.push(error as Error);
      }
    }
  }
}