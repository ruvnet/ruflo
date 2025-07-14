/**
 * Resume Command Integration Tests
 * Tests the full resume workflow including CLI interaction
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { hiveMindCommand } from '../../../src/cli/simple-commands/hive-mind.js';
import { HiveMindSessionManager } from '../../../src/cli/simple-commands/hive-mind/session-manager.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import chalk from 'chalk';

// Mock chalk for cleaner test output
jest.mock('chalk', () => ({
  default: {
    bold: jest.fn(str => str),
    cyan: jest.fn(str => str),
    yellow: jest.fn(str => str),
    green: jest.fn(str => str),
    red: jest.fn(str => str),
    gray: jest.fn(str => str),
    blue: jest.fn(str => str),
    magenta: jest.fn(str => str)
  },
  bold: jest.fn(str => str),
  cyan: jest.fn(str => str),
  yellow: jest.fn(str => str),
  green: jest.fn(str => str),
  red: jest.fn(str => str),
  gray: jest.fn(str => str),
  blue: jest.fn(str => str),
  magenta: jest.fn(str => str)
}));

// Mock ora spinner
jest.mock('ora', () => {
  return jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: ''
  }));
});

// Mock child_process for Claude Code spawning
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    on: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() }
  })),
  execSync: jest.fn()
}));

// Mock cwd to use temp directory
let tempDir;
jest.mock('../../../src/cli/node-compat.js', () => ({
  ...jest.requireActual('../../../src/cli/node-compat.js'),
  cwd: () => tempDir,
  exit: jest.fn()
}));

describe('Resume Command Integration', () => {
  let sessionManager;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    // Create temporary directory
    tempDir = mkdtempSync(path.join(tmpdir(), 'resume-test-'));
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    
    // Initialize session manager
    sessionManager = new HiveMindSessionManager(tempDir);
  });

  afterEach(() => {
    // Clean up
    if (sessionManager) {
      sessionManager.close();
    }
    
    // Restore console
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    
    // Remove temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Basic Resume Flow', () => {
    it('should show error when no session ID provided', async () => {
      await hiveMindCommand(['resume'], {});
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error:'),
        expect.stringContaining('Please provide a session ID')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage:')
      );
    });

    it('should show error for non-existent session', async () => {
      await hiveMindCommand(['resume', 'non-existent-session'], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session non-existent-session not found')
      );
    });

    it('should successfully resume a paused session', async () => {
      // Create and pause a session
      const sessionId = await setupPausedSession();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session resumed successfully!')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session ID:'),
        sessionId
      );
      
      // Verify session status changed
      const session = sessionManager.getSession(sessionId);
      expect(session.status).toBe('active');
    });

    it('should show error when trying to resume non-paused session', async () => {
      // Create active session
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session is not paused')
      );
    });
  });

  describe('Session List Command', () => {
    it('should show no sessions when none exist', async () => {
      await hiveMindCommand(['sessions'], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No active or paused sessions found')
      );
    });

    it('should list all active and paused sessions', async () => {
      // Create multiple sessions
      const session1 = sessionManager.createSession('swarm-1', 'Active Swarm', 'Objective 1');
      const session2 = sessionManager.createSession('swarm-2', 'Paused Swarm', 'Objective 2');
      sessionManager.pauseSession(session2);
      
      await hiveMindCommand(['sessions'], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Hive Mind Sessions')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Active Swarm')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Paused Swarm')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Status:'),
        expect.stringContaining('active')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Status:'),
        expect.stringContaining('paused')
      );
    });

    it('should show session progress information', async () => {
      const sessionId = await setupSessionWithProgress();
      
      await hiveMindCommand(['sessions'], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Progress:'),
        expect.stringContaining('50%')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tasks:'),
        expect.stringContaining('2/4')
      );
    });
  });

  describe('Resume with Progress Display', () => {
    it('should display comprehensive session summary on resume', async () => {
      const sessionId = await setupComplexSession();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      // Check for all expected summary sections
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resumed Session Summary')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Objective:'),
        expect.stringContaining('Complex test objective')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Progress:'),
        expect.stringContaining('%')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Task Status')
      );
    });

    it('should show recent activity logs', async () => {
      const sessionId = await setupSessionWithLogs();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recent Activity')
      );
      // Should show recent log entries
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d+:\d+:\d+\]/), // Time format
        expect.stringContaining('Test activity')
      );
    });

    it('should indicate checkpoint restoration', async () => {
      const sessionId = await setupSessionWithCheckpoint();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restoring from checkpoint')
      );
    });
  });

  describe('Resume with Claude Code Integration', () => {
    it('should offer Claude Code spawning tip when --claude not provided', async () => {
      const sessionId = await setupPausedSession();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pro Tip:'),
        expect.stringContaining('Add --claude to spawn Claude Code')
      );
    });

    it('should attempt to spawn Claude Code with --claude flag', async () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {}); // Claude is available
      
      const sessionId = await setupPausedSession();
      
      await hiveMindCommand(['resume', sessionId], { claude: true });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Launching Claude Code with restored context')
      );
    });

    it('should save prompt to file when Claude Code not available', async () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('Command not found');
      });
      
      const sessionId = await setupPausedSession();
      
      await hiveMindCommand(['resume', sessionId], { claude: true });
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session context saved to:'),
        expect.stringMatching(/hive-mind-resume-\d+\.txt/)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const sessionId = await setupPausedSession();
      
      // Close database to simulate error
      sessionManager.close();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resume session')
      );
    });

    it('should handle corrupted session data', async () => {
      // Create session with corrupted data
      const db = new Database(path.join(tempDir, 'hive.db'));
      db.prepare(`
        INSERT INTO sessions (id, swarm_id, swarm_name, objective, status, checkpoint_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('corrupt-session', 'swarm-123', 'Test', 'Test', 'paused', 'invalid-json');
      db.close();
      
      await hiveMindCommand(['resume', 'corrupt-session'], {});
      
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Auto-Save Integration', () => {
    it('should restore auto-saved checkpoints', async () => {
      const sessionId = await setupSessionWithAutoSave();
      
      await hiveMindCommand(['resume', sessionId], {});
      
      // Should mention checkpoint data
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Checkpoint data available')
      );
    });
  });

  // Helper functions
  async function setupPausedSession() {
    const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
    
    // Create swarm in database
    const db = new Database(path.join(tempDir, 'hive.db'));
    db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run('swarm-123', 'Test Swarm', 'Test objective');
    db.close();
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }

  async function setupSessionWithProgress() {
    const sessionId = sessionManager.createSession('swarm-progress', 'Progress Swarm', 'Test progress');
    
    const db = new Database(path.join(tempDir, 'hive.db'));
    
    // Create swarm
    db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run('swarm-progress', 'Progress Swarm', 'Test progress');
    
    // Create agents
    db.prepare('INSERT INTO agents (id, swarm_id, name, type, role) VALUES (?, ?, ?, ?, ?)').run('agent-1', 'swarm-progress', 'Worker 1', 'coder', 'worker');
    db.prepare('INSERT INTO agents (id, swarm_id, name, type, role) VALUES (?, ?, ?, ?, ?)').run('agent-2', 'swarm-progress', 'Worker 2', 'tester', 'worker');
    
    // Create tasks with different statuses
    db.prepare('INSERT INTO tasks (id, swarm_id, agent_id, description, status) VALUES (?, ?, ?, ?, ?)').run('task-1', 'swarm-progress', 'agent-1', 'Task 1', 'completed');
    db.prepare('INSERT INTO tasks (id, swarm_id, agent_id, description, status) VALUES (?, ?, ?, ?, ?)').run('task-2', 'swarm-progress', 'agent-1', 'Task 2', 'completed');
    db.prepare('INSERT INTO tasks (id, swarm_id, agent_id, description, status) VALUES (?, ?, ?, ?, ?)').run('task-3', 'swarm-progress', 'agent-2', 'Task 3', 'in_progress');
    db.prepare('INSERT INTO tasks (id, swarm_id, agent_id, description, status) VALUES (?, ?, ?, ?, ?)').run('task-4', 'swarm-progress', 'agent-2', 'Task 4', 'pending');
    
    db.close();
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }

  async function setupComplexSession() {
    const sessionId = sessionManager.createSession('swarm-complex', 'Complex Swarm', 'Complex test objective', {
      queenType: 'adaptive',
      maxWorkers: 8
    });
    
    const db = new Database(path.join(tempDir, 'hive.db'));
    
    // Create swarm
    db.prepare('INSERT INTO swarms (id, name, objective, queen_type) VALUES (?, ?, ?, ?)').run('swarm-complex', 'Complex Swarm', 'Complex test objective', 'adaptive');
    
    // Create multiple agents
    for (let i = 1; i <= 4; i++) {
      db.prepare('INSERT INTO agents (id, swarm_id, name, type, role, status) VALUES (?, ?, ?, ?, ?, ?)').run(
        `agent-${i}`,
        'swarm-complex',
        `Worker ${i}`,
        i % 2 === 0 ? 'coder' : 'analyst',
        'worker',
        i === 1 ? 'active' : 'idle'
      );
    }
    
    db.close();
    
    // Add checkpoint
    await sessionManager.saveCheckpoint(sessionId, 'complex-checkpoint', {
      progress: 'midway',
      completedSteps: ['init', 'design'],
      pendingSteps: ['implement', 'test']
    });
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }

  async function setupSessionWithLogs() {
    const sessionId = sessionManager.createSession('swarm-logs', 'Logged Swarm', 'Test logging');
    
    // Add various log entries
    sessionManager.logSessionEvent(sessionId, 'info', 'Test activity 1', 'agent-1');
    sessionManager.logSessionEvent(sessionId, 'warn', 'Test warning', 'agent-2');
    sessionManager.logSessionEvent(sessionId, 'info', 'Test activity 2', 'agent-1', { data: 'test' });
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }

  async function setupSessionWithCheckpoint() {
    const sessionId = sessionManager.createSession('swarm-checkpoint', 'Checkpoint Swarm', 'Test checkpoints');
    
    await sessionManager.saveCheckpoint(sessionId, 'test-checkpoint', {
      timestamp: new Date().toISOString(),
      state: 'intermediate',
      data: { key: 'value' }
    });
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }

  async function setupSessionWithAutoSave() {
    const sessionId = sessionManager.createSession('swarm-autosave', 'AutoSave Swarm', 'Test auto-save');
    
    // Simulate auto-save checkpoint
    await sessionManager.saveCheckpoint(sessionId, 'auto-save-123456', {
      timestamp: new Date().toISOString(),
      changeCount: 15,
      changesByType: {
        task_progress: [{ data: { taskId: 'task-1', status: 'completed' } }],
        agent_activity: [{ data: { agentId: 'agent-1', activity: 'working' } }]
      },
      statistics: {
        tasksProcessed: 5,
        tasksCompleted: 3,
        memoryUpdates: 2,
        agentActivities: 4,
        consensusDecisions: 1
      }
    });
    
    sessionManager.pauseSession(sessionId);
    return sessionId;
  }
});