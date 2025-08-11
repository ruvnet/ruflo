/**
 * Logger mock for Jest testing environment
 */
import { jest } from '@jest/globals';

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

export class Logger {
  constructor(config) {
    this.config = config || { level: 'error', format: 'text', destination: 'console' };
    Object.assign(this, mockLogger);
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
}

export class MockLogger extends Logger {}

// Export as default for compatibility
export default Logger;