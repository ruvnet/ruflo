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
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  getInstance: () => mockLogger,
  configure: () => {},
  level: 'test',
  format: 'test',
  destination: 'test'
};

// Set up logger mock globally for test environment
global.mockLogger = mockLogger;

// Provide default logger configuration for test environment
process.env.CLAUDE_FLOW_LOG_LEVEL = 'error';
process.env.CLAUDE_FLOW_LOG_FORMAT = 'json';
process.env.CLAUDE_FLOW_LOG_DESTINATION = 'console';