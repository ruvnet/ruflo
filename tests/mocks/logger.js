/**
 * Logger mock for Jest testing environment
 */

export const mockLogger = {
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

export class MockLogger {
  constructor(config) {
    this.config = config || { level: 'error', format: 'text', destination: 'console' };
    Object.assign(this, mockLogger);
  }
  
  static getInstance() {
    return mockLogger;
  }
}

// Export as default for compatibility
export default MockLogger;