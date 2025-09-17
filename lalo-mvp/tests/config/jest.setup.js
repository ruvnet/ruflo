/**
 * Jest Setup Configuration for LALO MVP Tests
 * Sets up global test environment, mocks, and utilities
 */

require('dotenv').config({ path: '.env.test' });

// Global test timeout
jest.setTimeout(30000);

// Mock console methods in test environment
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
global.testUtils = {
  // Create mock user object
  createMockUser: (overrides = {}) => ({
    id: 'test-user-id',
    email: 'test@example.com',
    role: 'user',
    permissions: ['read'],
    createdAt: new Date(),
    ...overrides,
  }),

  // Create mock request object
  createMockRequest: (overrides = {}) => ({
    headers: {},
    body: {},
    params: {},
    query: {},
    user: global.testUtils.createMockUser(),
    ...overrides,
  }),

  // Create mock response object
  createMockResponse: () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    res.end = jest.fn().mockReturnValue(res);
    return res;
  },

  // Generate test data
  generateTestData: (type, count = 1) => {
    const generators = {
      user: () => global.testUtils.createMockUser({
        id: `user-${Math.random().toString(36).substr(2, 9)}`,
        email: `test-${Math.random().toString(36).substr(2, 5)}@example.com`,
      }),
      document: () => ({
        id: `doc-${Math.random().toString(36).substr(2, 9)}`,
        content: `Test document content ${Math.random()}`,
        embedding: Array(768).fill(0).map(() => Math.random()),
        metadata: { source: 'test', type: 'document' },
      }),
      query: () => ({
        id: `query-${Math.random().toString(36).substr(2, 9)}`,
        text: `Test query ${Math.random()}`,
        type: 'natural_language',
        timestamp: new Date(),
      }),
    };

    if (count === 1) {
      return generators[type]();
    }
    return Array(count).fill(null).map(() => generators[type]());
  },

  // Wait for condition with timeout
  waitFor: async (condition, timeout = 5000, interval = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  },

  // Delay execution
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

// Global test environment setup
beforeAll(async () => {
  // Initialize test database
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'sqlite::memory:';

  // Clear any existing test data
  if (global.testDatabase) {
    await global.testDatabase.clear();
  }
});

// Cleanup after each test
afterEach(async () => {
  // Reset all mocks
  jest.clearAllMocks();

  // Clear test data
  if (global.testDatabase) {
    await global.testDatabase.clearTestData();
  }
});

// Global cleanup
afterAll(async () => {
  // Close database connections
  if (global.testDatabase) {
    await global.testDatabase.close();
  }

  // Close server connections
  if (global.testServer) {
    await global.testServer.close();
  }
});

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Mock external services
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  })),
}));

// Mock file system operations for tests
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
}));

// Mock environment variables
process.env.TEST_ENV = 'true';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.ENCRYPTION_KEY = 'test-encryption-key';

console.log('🧪 Jest test environment initialized');