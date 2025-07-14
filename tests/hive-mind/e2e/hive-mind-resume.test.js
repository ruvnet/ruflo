/**
 * Hive Mind Resume End-to-End Tests
 * Tests complete workflows from session creation to pause and resume
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { hiveMindCommand } from '../../../src/cli/simple-commands/hive-mind.js';
import { HiveMindSessionManager } from '../../../src/cli/simple-commands/hive-mind/session-manager.js';
import { AutoSaveMiddleware } from '../../../src/cli/simple-commands/hive-mind/auto-save-middleware.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Mock external dependencies
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

jest.mock('ora', () => {
  return jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: ''
  }));
});

jest.mock('inquirer', () => ({
  default: {
    prompt: jest.fn()
  }
}));

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    on: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() }
  })),
  execSync: jest.fn()
}));

// Mock cwd
let tempDir;
jest.mock('../../../src/cli/node-compat.js', () => ({
  ...jest.requireActual('../../../src/cli/node-compat.js'),
  cwd: () => tempDir,
  exit: jest.fn(),
  args: []
}));

describe('Hive Mind Resume E2E', () => {
  let consoleLogSpy;
  let consoleErrorSpy;
  let processExitSpy;

  beforeEach(() => {
    // Create temporary directory
    tempDir = mkdtempSync(path.join(tmpdir(), 'e2e-resume-'));
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Spy on console and process
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation();
  });

  afterEach(() => {
    // Restore
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Complete Session Lifecycle', () => {
    it('should handle full lifecycle: init -> spawn -> pause -> resume', async () => {
      // Step 1: Initialize hive mind
      await hiveMindCommand(['init'], {});
      
      expect(fs.existsSync(path.join(tempDir, '.hive-mind'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.hive-mind', 'hive.db'))).toBe(true);
      
      // Step 2: Spawn a swarm
      await hiveMindCommand(['spawn', 'Build a REST API with authentication'], {
        name: 'api-swarm',
        queenType: 'strategic',
        maxWorkers: 4
      });
      
      // Extract session ID from console output
      let sessionId;
      const sessionCall = consoleLogSpy.mock.calls.find(call => 
        call[0] && call[0].includes('Session ID:')
      );
      if (sessionCall && sessionCall[1]) {
        sessionId = sessionCall[1];
      }
      
      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
      
      // Step 3: Simulate work and auto-save
      const sessionManager = new HiveMindSessionManager(tempDir);
      const autoSave = new AutoSaveMiddleware(sessionId, 100);
      
      autoSave.start();
      autoSave.trackTaskProgress('task-1', 'completed');
      autoSave.trackTaskProgress('task-2', 'in_progress');
      autoSave.trackAgentActivity('agent-1', 'working', { task: 'task-1' });
      
      // Wait for auto-save
      await new Promise(resolve => setTimeout(resolve, 150));
      autoSave.stop();
      
      // Step 4: Pause the session
      sessionManager.pauseSession(sessionId);
      sessionManager.close();
      
      // Step 5: Resume the session
      jest.clearAllMocks(); // Clear previous console logs
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session resumed successfully!')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('api-swarm')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Build a REST API with authentication')
      );
    });

    it('should preserve task progress across pause/resume', async () => {
      // Initialize
      await hiveMindCommand(['init'], {});
      
      // Create session with progress
      const sessionManager = new HiveMindSessionManager(tempDir);
      const db = new Database(path.join(tempDir, '.hive-mind', 'hive.db'));
      
      // Create swarm
      const swarmId = 'swarm-progress-test';
      db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run(
        swarmId, 'Progress Test Swarm', 'Test progress tracking'
      );
      
      // Create session
      const sessionId = sessionManager.createSession(swarmId, 'Progress Test Swarm', 'Test progress tracking');
      
      // Add tasks
      const tasks = [
        { id: 'task-1', status: 'completed', description: 'Setup project' },
        { id: 'task-2', status: 'completed', description: 'Design API' },
        { id: 'task-3', status: 'in_progress', description: 'Implement endpoints' },
        { id: 'task-4', status: 'pending', description: 'Write tests' },
        { id: 'task-5', status: 'pending', description: 'Deploy' }
      ];
      
      tasks.forEach(task => {
        db.prepare('INSERT INTO tasks (id, swarm_id, description, status) VALUES (?, ?, ?, ?)').run(
          task.id, swarmId, task.description, task.status
        );
      });
      
      db.close();
      
      // Save checkpoint with task details
      await sessionManager.saveCheckpoint(sessionId, 'progress-checkpoint', {
        taskProgress: tasks,
        completedCount: 2,
        totalCount: 5
      });
      
      // Pause
      sessionManager.pauseSession(sessionId);
      sessionManager.close();
      
      // Resume
      jest.clearAllMocks();
      await hiveMindCommand(['resume', sessionId], {});
      
      // Check progress display
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Progress:'),
        expect.stringContaining('40%') // 2 out of 5 tasks
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Completed: 2')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('In Progress: 1')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pending: 2')
      );
    });
  });

  describe('Multi-Session Management', () => {
    it('should handle multiple concurrent sessions', async () => {
      await hiveMindCommand(['init'], {});
      
      const sessionManager = new HiveMindSessionManager(tempDir);
      const db = new Database(path.join(tempDir, '.hive-mind', 'hive.db'));
      
      // Create multiple swarms and sessions
      const sessions = [];
      for (let i = 1; i <= 3; i++) {
        const swarmId = `swarm-${i}`;
        db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run(
          swarmId, `Swarm ${i}`, `Objective ${i}`
        );
        
        const sessionId = sessionManager.createSession(swarmId, `Swarm ${i}`, `Objective ${i}`);
        sessions.push({ id: sessionId, name: `Swarm ${i}` });
        
        if (i % 2 === 0) {
          sessionManager.pauseSession(sessionId);
        }
      }
      
      db.close();
      sessionManager.close();
      
      // List sessions
      jest.clearAllMocks();
      await hiveMindCommand(['sessions'], {});
      
      // Should show all sessions
      sessions.forEach(session => {
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining(session.name)
        );
      });
      
      // Resume specific session
      jest.clearAllMocks();
      await hiveMindCommand(['resume', sessions[1].id], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Swarm 2')
      );
    });
  });

  describe('Interrupt Handling', () => {
    it('should save state on SIGINT during active session', async () => {
      await hiveMindCommand(['init'], {});
      
      // Spawn swarm
      await hiveMindCommand(['spawn', 'Test interrupt handling'], {
        name: 'interrupt-test'
      });
      
      // Get session ID
      let sessionId;
      const sessionCall = consoleLogSpy.mock.calls.find(call => 
        call[0] && call[0].includes('Session ID:')
      );
      if (sessionCall && sessionCall[1]) {
        sessionId = sessionCall[1];
      }
      
      // Set up auto-save
      const autoSave = new AutoSaveMiddleware(sessionId);
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'important' });
      
      // Simulate SIGINT
      const sigintListeners = process.listeners('SIGINT');
      const autoSaveListener = sigintListeners[sigintListeners.length - 1];
      
      // Mock process.exit to prevent actual exit
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      await autoSaveListener();
      
      // Restore
      process.exit = originalExit;
      autoSave.stop();
      
      // Check that session was paused
      const sessionManager = new HiveMindSessionManager(tempDir);
      const session = sessionManager.getSession(sessionId);
      
      // Session should have checkpoint data
      expect(session.checkpoint_data).toBeTruthy();
      sessionManager.close();
    });
  });

  describe('Claude Code Integration', () => {
    it('should generate correct prompt for resumed session', async () => {
      const { execSync } = require('child_process');
      execSync.mockImplementation(() => {
        throw new Error('Claude not found');
      });
      
      await hiveMindCommand(['init'], {});
      
      // Create complex session
      const sessionManager = new HiveMindSessionManager(tempDir);
      const db = new Database(path.join(tempDir, '.hive-mind', 'hive.db'));
      
      const swarmId = 'swarm-claude-test';
      db.prepare('INSERT INTO swarms (id, name, objective, queen_type) VALUES (?, ?, ?, ?)').run(
        swarmId, 'Claude Test Swarm', 'Build microservices', 'adaptive'
      );
      
      const sessionId = sessionManager.createSession(swarmId, 'Claude Test Swarm', 'Build microservices', {
        queenType: 'adaptive',
        maxWorkers: 6
      });
      
      // Add agents
      const agentTypes = ['architect', 'coder', 'coder', 'tester', 'analyst', 'coordinator'];
      agentTypes.forEach((type, i) => {
        db.prepare('INSERT INTO agents (id, swarm_id, name, type, role, status) VALUES (?, ?, ?, ?, ?, ?)').run(
          `agent-${i}`, swarmId, `${type} ${i}`, type, 'worker', i < 2 ? 'active' : 'idle'
        );
      });
      
      // Add tasks
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status, priority) VALUES (?, ?, ?, ?, ?)').run(
        'task-1', swarmId, 'Design service architecture', 'completed', 1
      );
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status, priority) VALUES (?, ?, ?, ?, ?)').run(
        'task-2', swarmId, 'Implement user service', 'in_progress', 1
      );
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status, priority) VALUES (?, ?, ?, ?, ?)').run(
        'task-3', swarmId, 'Implement auth service', 'pending', 1
      );
      
      db.close();
      
      // Add checkpoint
      await sessionManager.saveCheckpoint(sessionId, 'claude-checkpoint', {
        completedServices: ['gateway'],
        inProgressServices: ['user-service'],
        pendingServices: ['auth-service', 'payment-service']
      });
      
      sessionManager.pauseSession(sessionId);
      sessionManager.close();
      
      // Resume with Claude flag
      jest.clearAllMocks();
      await hiveMindCommand(['resume', sessionId], { claude: true });
      
      // Should save prompt file
      const promptFileCall = consoleLogSpy.mock.calls.find(call =>
        call[0] && call[0].includes('Session context saved to:')
      );
      expect(promptFileCall).toBeTruthy();
      
      if (promptFileCall && promptFileCall[1]) {
        const promptFile = promptFileCall[1];
        const promptContent = fs.readFileSync(promptFile, 'utf8');
        
        // Verify prompt contains session context
        expect(promptContent).toContain('RESUMING HIVE MIND SESSION');
        expect(promptContent).toContain(sessionId);
        expect(promptContent).toContain('Build microservices');
        expect(promptContent).toContain('adaptive');
        expect(promptContent).toContain('checkpoint');
        expect(promptContent).toContain('gateway');
        expect(promptContent).toContain('user-service');
      }
    });
  });

  describe('Error Recovery', () => {
    it('should handle corrupted session gracefully', async () => {
      await hiveMindCommand(['init'], {});
      
      // Create corrupted session
      const db = new Database(path.join(tempDir, '.hive-mind', 'hive.db'));
      
      // Insert session with invalid JSON in checkpoint_data
      db.prepare(`
        INSERT INTO sessions (id, swarm_id, swarm_name, objective, status, checkpoint_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'corrupted-session',
        'swarm-corrupted',
        'Corrupted Swarm',
        'Test corruption',
        'paused',
        '{invalid json'
      );
      
      db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run(
        'swarm-corrupted', 'Corrupted Swarm', 'Test corruption'
      );
      
      db.close();
      
      // Try to resume
      jest.clearAllMocks();
      await hiveMindCommand(['resume', 'corrupted-session'], {});
      
      // Should show error but not crash
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resume session')
      );
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should recover from incomplete session data', async () => {
      await hiveMindCommand(['init'], {});
      
      const sessionManager = new HiveMindSessionManager(tempDir);
      const db = new Database(path.join(tempDir, '.hive-mind', 'hive.db'));
      
      // Create session without swarm
      const sessionId = 'incomplete-session';
      db.prepare(`
        INSERT INTO sessions (id, swarm_id, swarm_name, objective, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(sessionId, 'missing-swarm', 'Incomplete Swarm', 'Test incomplete', 'paused');
      
      db.close();
      
      // Resume should handle missing swarm data
      jest.clearAllMocks();
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session resumed successfully!')
      );
      
      sessionManager.close();
    });
  });

  describe('Session Archival', () => {
    it('should not resume archived sessions', async () => {
      await hiveMindCommand(['init'], {});
      
      const sessionManager = new HiveMindSessionManager(tempDir);
      
      // Create and complete old session
      const sessionId = sessionManager.createSession('swarm-old', 'Old Swarm', 'Old objective');
      sessionManager.completeSession(sessionId);
      
      // Archive it
      await sessionManager.archiveSessions(0); // Archive immediately
      sessionManager.close();
      
      // Try to resume
      jest.clearAllMocks();
      await hiveMindCommand(['resume', sessionId], {});
      
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session ' + sessionId + ' not found')
      );
    });
  });
});