/**
 * Jest Setup File - ES Module Compatible
 * Configure test environment and global settings
 */

// Import Jest globals for setup file
import { jest } from '@jest/globals';

// Set test environment flags
process.env.CLAUDE_FLOW_ENV = 'test';
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless explicitly needed
const originalConsole = { ...console };

// Store original console for restoration
global.originalConsole = originalConsole;

// Handle unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  // Only log in test environment if needed
  if (process.env.DEBUG_TESTS) {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  }
});

// Mock logger for tests to prevent initialization errors
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  getInstance: () => mockLogger,
  configure: jest.fn().mockResolvedValue(undefined),
  level: 'test',
  format: 'text',
  destination: 'console'
};

// Mock the Logger class constructor
class MockLogger {
  constructor(config) {
    this.config = config || { level: 'error', format: 'text', destination: 'console' };
    return mockLogger;
  }
  
  static getInstance() {
    return mockLogger;
  }
  
  info = jest.fn()
  error = jest.fn()
  warn = jest.fn()
  debug = jest.fn()
  trace = jest.fn()
  configure = jest.fn().mockResolvedValue(undefined)
  level = 'test'
  format = 'text'
  destination = 'console'
}

// Set up logger mock globally for test environment
global.mockLogger = mockLogger;
global.MockLogger = MockLogger;

// Mock Jest environment to prevent jest globals issues
global.jest = global.jest || {
  fn: () => jest.fn ? jest.fn() : (() => {}),
  spyOn: (obj, method) => jest.spyOn ? jest.spyOn(obj, method) : (() => {}),
  clearAllMocks: () => jest.clearAllMocks ? jest.clearAllMocks() : (() => {})
};

// Provide default logger configuration for test environment
process.env.CLAUDE_FLOW_LOG_LEVEL = 'error';
process.env.CLAUDE_FLOW_LOG_FORMAT = 'json';
process.env.CLAUDE_FLOW_LOG_DESTINATION = 'console';