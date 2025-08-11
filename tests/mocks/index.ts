/**
 * Mock exports for tests
 */
import { jest } from '@jest/globals';
import { Logger, mockLogger } from './logger.js';

export const createMocks = () => ({
  logger: mockLogger,
  orchestrator: {
    start: jest.fn(),
    stop: jest.fn(),
    executeTask: jest.fn(),
    getAgents: jest.fn(),
    getTaskStatus: jest.fn()
  },
  coordinationSystem: {
    initialize: jest.fn(),
    shutdown: jest.fn(),
    getStatus: jest.fn(),
    addAgent: jest.fn(),
    removeAgent: jest.fn(),
    orchestrateTask: jest.fn()
  }
});

export { Logger, mockLogger };
export default createMocks;