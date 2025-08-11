/**
 * Jest Setup File - ES Module Compatible
 * Configure test environment and global settings
 */

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
  getInstance: jest.fn(() => mockLogger),
  configure: jest.fn(),
  level: 'test',
  format: 'test',
  destination: 'test'
};

// Set up logger mock before any imports
global.mockLogger = mockLogger;

// Mock the logger module
jest.mock('./src/core/logger.js', () => ({
  Logger: mockLogger
}), { virtual: true });

// Provide default logger configuration for test environment
process.env.CLAUDE_FLOW_LOG_LEVEL = 'error';
process.env.CLAUDE_FLOW_LOG_FORMAT = 'json';
process.env.CLAUDE_FLOW_LOG_DESTINATION = 'console';