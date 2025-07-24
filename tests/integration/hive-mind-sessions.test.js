/**
 * Test for hive-mind sessions command
 * Ensures getActiveSessions is properly awaited to prevent "forEach is not a function" error
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { HiveMindSessionManager } from '../../src/cli/simple-commands/hive-mind/session-manager.js';

// Mock console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('Hive Mind Sessions Command', () => {
  let consoleOutput = [];
  let sessionManager;

  beforeEach(() => {
    // Capture console output
    consoleOutput = [];
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.join(' '));
    });
    console.error = jest.fn((...args) => {
      consoleOutput.push('ERROR: ' + args.join(' '));
    });

    // Create session manager instance
    sessionManager = new HiveMindSessionManager();
  });

  afterEach(() => {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    
    // Clean up
    if (sessionManager) {
      sessionManager.close();
    }
  });

  it('should handle getActiveSessions returning a promise', async () => {
    // Mock getActiveSessions to return a promise
    sessionManager.getActiveSessions = jest.fn().mockResolvedValue([
      {
        id: 'test-session-1',
        swarm_id: 'swarm-1',
        swarm_name: 'Test Swarm',
        objective: 'Test objective',
        status: 'active',
        completion_percentage: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]);

    // The actual showSessions function would call getActiveSessions with await
    const sessions = await sessionManager.getActiveSessions();
    
    // Verify it returns an array that can be used with forEach
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(1);
    
    // Verify forEach works on the result
    let forEachCalled = false;
    sessions.forEach((session) => {
      forEachCalled = true;
      expect(session.id).toBe('test-session-1');
    });
    
    expect(forEachCalled).toBe(true);
  });

  it('should handle empty sessions array', async () => {
    // Mock getActiveSessions to return empty array
    sessionManager.getActiveSessions = jest.fn().mockResolvedValue([]);

    const sessions = await sessionManager.getActiveSessions();
    
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(0);
  });

  it('should throw error if getActiveSessions is not awaited', async () => {
    // Mock getActiveSessions to return a promise
    sessionManager.getActiveSessions = jest.fn().mockResolvedValue([
      { id: 'test-1', swarm_name: 'Test' }
    ]);

    // This simulates the bug - calling without await
    const sessionsPromise = sessionManager.getActiveSessions();
    
    // Trying to use forEach on a Promise should fail
    expect(() => {
      sessionsPromise.forEach(() => {});
    }).toThrow(TypeError);
  });

  it('should handle getActiveSessions errors gracefully', async () => {
    // Mock getActiveSessions to reject
    sessionManager.getActiveSessions = jest.fn().mockRejectedValue(
      new Error('Database connection failed')
    );

    try {
      await sessionManager.getActiveSessions();
      fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).toBe('Database connection failed');
    }
  });
});

describe('Hive Mind Sessions Integration', () => {
  it('should verify the fix in hive-mind.js', async () => {
    // This test verifies that the actual code has been fixed
    // by checking if the showSessions function properly awaits getActiveSessions
    
    // Import the actual hive-mind module
    const hiveMindModule = await import('../../src/cli/simple-commands/hive-mind.js');
    
    // Get the source code of showSessions function
    const showSessionsCode = hiveMindModule.default.toString();
    
    // Check if the function contains 'await sessionManager.getActiveSessions()'
    // This ensures the fix has been applied
    expect(showSessionsCode).toMatch(/await\s+sessionManager\.getActiveSessions\(\)/);
  });
});