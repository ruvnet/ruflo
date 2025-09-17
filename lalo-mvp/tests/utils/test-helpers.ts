/**
 * LALO MVP Test Utilities and Helpers
 * Common testing utilities for consistent test setup and execution
 */

import { randomBytes, createHash } from 'crypto';
import { faker } from '@faker-js/faker';

export interface TestUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  department?: string;
  level?: number;
  clearanceLevel?: string;
  createdAt: Date;
}

export interface TestDocument {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    type: string;
    source: string;
    category?: string;
    classification?: string;
    createdAt: Date;
  };
}

export interface TestQuery {
  id: string;
  text: string;
  type: 'natural_language' | 'sql' | 'hybrid';
  complexity: 'simple' | 'medium' | 'complex' | 'very_complex';
  expectedComponents: string[];
  timestamp: Date;
}

export interface HiveCoordinationContext {
  sessionId: string;
  nodeId: string;
  coordination: {
    topology: string;
    participatingNodes: string[];
    consensusRequired: boolean;
  };
  memory: {
    sharedContext: Record<string, any>;
    localContext: Record<string, any>;
  };
}

/**
 * Test Data Factory
 * Generates consistent test data for various testing scenarios
 */
export class TestDataFactory {
  private static seedValue: string = 'lalo-mvp-test-seed';

  /**
   * Set seed for deterministic test data generation
   */
  static setSeed(seed: string): void {
    this.seedValue = seed;
    faker.seed(this.generateNumericSeed(seed));
  }

  private static generateNumericSeed(seed: string): number {
    return parseInt(createHash('md5').update(seed).digest('hex').substring(0, 8), 16);
  }

  /**
   * Generate test user with specified role and permissions
   */
  static createUser(overrides: Partial<TestUser> = {}): TestUser {
    const roles = {
      viewer: ['read:basic', 'read:public'],
      user: ['read:basic', 'read:own_data', 'write:own_data'],
      analyst: ['read:data', 'read:analytics', 'write:reports', 'execute:queries'],
      admin: ['*:*'],
      developer: ['read:data', 'write:code', 'execute:tests', 'debug:system'],
      security_officer: ['read:audit', 'read:security', 'write:security_policies']
    };

    const defaultRole = overrides.role || 'user';
    const permissions = roles[defaultRole as keyof typeof roles] || roles.user;

    return {
      id: `user-${faker.string.uuid()}`,
      email: faker.internet.email(),
      role: defaultRole,
      permissions,
      department: faker.commerce.department(),
      level: faker.number.int({ min: 1, max: 5 }),
      clearanceLevel: faker.helpers.arrayElement(['low', 'medium', 'high', 'critical']),
      createdAt: faker.date.past(),
      ...overrides
    };
  }

  /**
   * Generate test document for RAG testing
   */
  static createDocument(overrides: Partial<TestDocument> = {}): TestDocument {
    const documentTypes = ['article', 'research', 'documentation', 'policy', 'guide', 'faq'];
    const sources = ['internal', 'external', 'user_generated', 'imported', 'api'];
    const categories = ['technical', 'business', 'legal', 'hr', 'security', 'general'];

    return {
      id: `doc-${faker.string.uuid()}`,
      content: faker.lorem.paragraphs(faker.number.int({ min: 3, max: 10 })),
      embedding: Array(768).fill(0).map(() => faker.number.float({ min: -1, max: 1 })),
      metadata: {
        type: faker.helpers.arrayElement(documentTypes),
        source: faker.helpers.arrayElement(sources),
        category: faker.helpers.arrayElement(categories),
        classification: faker.helpers.arrayElement(['public', 'internal', 'confidential', 'secret']),
        createdAt: faker.date.past(),
        ...overrides.metadata
      },
      ...overrides
    };
  }

  /**
   * Generate test query for NL2SQL testing
   */
  static createQuery(overrides: Partial<TestQuery> = {}): TestQuery {
    const queryTemplates = {
      simple: [
        'Show all users',
        'List departments',
        'Count total sales',
        'Display recent orders'
      ],
      medium: [
        'Show users with their department names',
        'Find top 10 customers by revenue',
        'List active projects with team members',
        'Show sales by month for current year'
      ],
      complex: [
        'Analyze user engagement patterns by department and tenure',
        'Generate comprehensive sales report with trends and forecasts',
        'Show performance metrics with comparisons to previous periods',
        'Create detailed user activity analysis with behavioral insights'
      ],
      very_complex: [
        'Perform multi-dimensional analysis of customer segments with predictive modeling',
        'Generate executive dashboard with real-time KPIs and advanced analytics',
        'Create comprehensive audit trail analysis with anomaly detection',
        'Build sophisticated forecasting model with multiple variables'
      ]
    };

    const complexity = overrides.complexity || 'medium';
    const templates = queryTemplates[complexity];
    const text = overrides.text || faker.helpers.arrayElement(templates);

    const componentMap = {
      simple: ['nl2sql'],
      medium: ['nl2sql', 'governance'],
      complex: ['nl2sql', 'governance', 'rag'],
      very_complex: ['nl2sql', 'governance', 'rag', 'langgraph', 'mcp']
    };

    return {
      id: `query-${faker.string.uuid()}`,
      text,
      type: faker.helpers.arrayElement(['natural_language', 'sql', 'hybrid']),
      complexity,
      expectedComponents: componentMap[complexity],
      timestamp: new Date(),
      ...overrides
    };
  }

  /**
   * Generate hive coordination context
   */
  static createHiveContext(overrides: Partial<HiveCoordinationContext> = {}): HiveCoordinationContext {
    const topologies = ['mesh', 'hierarchical', 'star', 'ring'];
    const nodeCount = faker.number.int({ min: 3, max: 8 });

    return {
      sessionId: `session-${Date.now()}-${faker.string.alphanumeric(8)}`,
      nodeId: `node-${faker.string.uuid()}`,
      coordination: {
        topology: faker.helpers.arrayElement(topologies),
        participatingNodes: Array(nodeCount).fill(null).map(() => `node-${faker.string.uuid()}`),
        consensusRequired: faker.datatype.boolean(),
        ...overrides.coordination
      },
      memory: {
        sharedContext: {
          taskId: `task-${faker.string.uuid()}`,
          priority: faker.helpers.arrayElement(['low', 'medium', 'high', 'critical']),
          deadline: faker.date.future(),
          requiredCapabilities: faker.helpers.arrayElements(['analysis', 'synthesis', 'optimization'], 2)
        },
        localContext: {
          nodeCapabilities: faker.helpers.arrayElements(['compute', 'storage', 'network', 'ai'], 2),
          resourceUtilization: faker.number.float({ min: 0.1, max: 0.9 }),
          lastActivity: new Date()
        },
        ...overrides.memory
      },
      ...overrides
    };
  }

  /**
   * Generate batch test data for load testing
   */
  static createBatch<T>(
    factory: () => T,
    count: number,
    options: { unique?: boolean; seed?: string } = {}
  ): T[] {
    if (options.seed) {
      this.setSeed(options.seed);
    }

    const items: T[] = [];
    const uniqueCheck = options.unique ? new Set() : null;

    for (let i = 0; i < count; i++) {
      const item = factory();

      if (uniqueCheck) {
        const key = JSON.stringify(item);
        if (uniqueCheck.has(key)) {
          continue; // Skip duplicate
        }
        uniqueCheck.add(key);
      }

      items.push(item);
    }

    return items;
  }
}

/**
 * Test Environment Manager
 * Manages test environment setup, cleanup, and state
 */
export class TestEnvironmentManager {
  private static instances: Map<string, TestEnvironmentManager> = new Map();
  private environmentId: string;
  private resources: Map<string, any> = new Map();
  private cleanupTasks: (() => Promise<void>)[] = [];

  private constructor(environmentId: string) {
    this.environmentId = environmentId;
  }

  /**
   * Get or create test environment instance
   */
  static getInstance(environmentId: string = 'default'): TestEnvironmentManager {
    if (!this.instances.has(environmentId)) {
      this.instances.set(environmentId, new TestEnvironmentManager(environmentId));
    }
    return this.instances.get(environmentId)!;
  }

  /**
   * Setup test database with seed data
   */
  async setupDatabase(config: {
    users?: number;
    documents?: number;
    queries?: number;
    seedData?: boolean;
  } = {}): Promise<void> {
    const {
      users = 10,
      documents = 50,
      queries = 20,
      seedData = true
    } = config;

    if (!seedData) return;

    // Generate and insert test data
    const testUsers = TestDataFactory.createBatch(() => TestDataFactory.createUser(), users);
    const testDocuments = TestDataFactory.createBatch(() => TestDataFactory.createDocument(), documents);
    const testQueries = TestDataFactory.createBatch(() => TestDataFactory.createQuery(), queries);

    // Store in mock database or actual test database
    this.resources.set('users', testUsers);
    this.resources.set('documents', testDocuments);
    this.resources.set('queries', testQueries);

    // Add cleanup task
    this.cleanupTasks.push(async () => {
      // Clean up database
      this.resources.clear();
    });
  }

  /**
   * Setup hive mind coordination for testing
   */
  async setupHiveCoordination(config: {
    nodeCount?: number;
    topology?: string;
    enableCollectiveIntelligence?: boolean;
  } = {}): Promise<HiveCoordinationContext> {
    const {
      nodeCount = 5,
      topology = 'mesh',
      enableCollectiveIntelligence = true
    } = config;

    const hiveContext = TestDataFactory.createHiveContext({
      coordination: {
        topology,
        participatingNodes: Array(nodeCount).fill(null).map(() => `node-${randomBytes(4).toString('hex')}`),
        consensusRequired: enableCollectiveIntelligence
      }
    });

    this.resources.set('hiveContext', hiveContext);

    // Add cleanup task
    this.cleanupTasks.push(async () => {
      // Cleanup hive coordination
      this.resources.delete('hiveContext');
    });

    return hiveContext;
  }

  /**
   * Setup mock services for testing
   */
  async setupMockServices(): Promise<void> {
    const mockServices = {
      authService: {
        url: 'http://mock-auth-service:80',
        endpoints: {
          login: '/auth/login',
          validate: '/auth/validate',
          refresh: '/auth/refresh'
        }
      },
      mlService: {
        url: 'http://mock-ml-service:80',
        endpoints: {
          embed: '/ml/embed',
          predict: '/ml/predict',
          analyze: '/ml/analyze'
        }
      }
    };

    this.resources.set('mockServices', mockServices);

    // Add cleanup task
    this.cleanupTasks.push(async () => {
      // Cleanup mock services
      this.resources.delete('mockServices');
    });
  }

  /**
   * Get resource by name
   */
  getResource<T>(name: string): T | undefined {
    return this.resources.get(name);
  }

  /**
   * Add custom resource
   */
  setResource(name: string, resource: any): void {
    this.resources.set(name, resource);
  }

  /**
   * Add cleanup task
   */
  addCleanupTask(task: () => Promise<void>): void {
    this.cleanupTasks.push(task);
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    for (const task of this.cleanupTasks.reverse()) {
      try {
        await task();
      } catch (error) {
        console.error('Cleanup task failed:', error);
      }
    }

    this.cleanupTasks = [];
    this.resources.clear();
  }

  /**
   * Reset environment to initial state
   */
  async reset(): Promise<void> {
    await this.cleanup();
    this.resources = new Map();
    this.cleanupTasks = [];
  }

  /**
   * Get environment statistics
   */
  getStats(): {
    environmentId: string;
    resourceCount: number;
    cleanupTaskCount: number;
    resources: string[];
  } {
    return {
      environmentId: this.environmentId,
      resourceCount: this.resources.size,
      cleanupTaskCount: this.cleanupTasks.length,
      resources: Array.from(this.resources.keys())
    };
  }
}

/**
 * Test Assertion Helpers
 * Custom assertions for LALO MVP specific testing
 */
export class TestAssertions {
  /**
   * Assert that SQL query is properly parameterized
   */
  static assertParameterizedSQL(sql: string, parameters?: any[]): void {
    // Check for parameter placeholders ($1, $2, etc. for PostgreSQL)
    const parameterPlaceholders = sql.match(/\$\d+/g) || [];

    if (parameters) {
      expect(parameterPlaceholders).toHaveLength(parameters.length);
    }

    // Should not contain direct string interpolation
    expect(sql).not.toMatch(/['"]\s*\+\s*[^'"]/); // No string concatenation
    expect(sql).not.toMatch(/\$\{[^}]+\}/); // No template literals
  }

  /**
   * Assert that user has required permissions
   */
  static assertUserPermissions(user: TestUser, requiredPermissions: string[]): void {
    for (const permission of requiredPermissions) {
      const hasPermission = user.permissions.includes(permission) ||
                           user.permissions.includes('*:*') ||
                           user.permissions.some(p => p.endsWith(':*') && permission.startsWith(p.split(':')[0]));

      expect(hasPermission).toBe(true);
    }
  }

  /**
   * Assert that response contains security headers
   */
  static assertSecurityHeaders(headers: Record<string, string>): void {
    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'strict-transport-security',
      'content-security-policy'
    ];

    for (const header of requiredHeaders) {
      expect(headers[header.toLowerCase()]).toBeDefined();
    }
  }

  /**
   * Assert that data is properly masked
   */
  static assertDataMasked(original: string, masked: string, maskingPattern: RegExp): void {
    expect(masked).toMatch(maskingPattern);
    expect(masked).not.toEqual(original);
    expect(masked.length).toBeGreaterThan(0);
  }

  /**
   * Assert hive coordination success
   */
  static assertHiveCoordination(result: any, expectedNodes: number): void {
    expect(result.coordination).toBeDefined();
    expect(result.coordination.nodesParticipated).toBeGreaterThanOrEqual(expectedNodes);
    expect(result.coordination.consensusAchieved).toBe(true);
    expect(result.coordination.coordinationTime).toBeGreaterThan(0);
  }

  /**
   * Assert performance within acceptable limits
   */
  static assertPerformance(
    executionTime: number,
    maxTime: number,
    component?: string
  ): void {
    expect(executionTime).toBeLessThan(maxTime);

    if (component) {
      // Component-specific performance assertions
      const limits = {
        nl2sql: 1000,      // 1 second
        rag: 2000,         // 2 seconds
        governance: 500,   // 500ms
        langgraph: 1500,   // 1.5 seconds
        mcp: 800          // 800ms
      };

      const limit = limits[component as keyof typeof limits] || maxTime;
      expect(executionTime).toBeLessThan(limit);
    }
  }

  /**
   * Assert collective intelligence patterns
   */
  static assertCollectiveIntelligence(result: any): void {
    expect(result.collectiveIntelligence).toBeDefined();
    expect(result.collectiveIntelligence.patternsLearned).toBeGreaterThan(0);
    expect(result.collectiveIntelligence.knowledgeShared).toBe(true);
    expect(result.collectiveIntelligence.adaptationOccurred).toBeDefined();
  }
}

/**
 * Test Timing Utilities
 */
export class TestTiming {
  private static timers: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  static start(operationId: string): void {
    this.timers.set(operationId, performance.now());
  }

  /**
   * Stop timing and return duration
   */
  static stop(operationId: string): number {
    const startTime = this.timers.get(operationId);
    if (!startTime) {
      throw new Error(`Timer not found for operation: ${operationId}`);
    }

    const duration = performance.now() - startTime;
    this.timers.delete(operationId);
    return duration;
  }

  /**
   * Time an async operation
   */
  static async time<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await operation();
    const duration = performance.now() - start;

    return { result, duration };
  }

  /**
   * Clear all timers
   */
  static clear(): void {
    this.timers.clear();
  }
}

/**
 * Export all utilities for easy importing
 */
export {
  TestDataFactory as DataFactory,
  TestEnvironmentManager as EnvironmentManager,
  TestAssertions as Assertions,
  TestTiming as Timing
};