/**
 * HiveMindSessionManager Tests
 * Comprehensive test suite for session persistence and resume functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HiveMindSessionManager } from '../../../src/cli/simple-commands/hive-mind/session-manager.js';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('HiveMindSessionManager', () => {
  let sessionManager;
  let tempDir;

  beforeEach(() => {
    // Create temporary directory for testing
    tempDir = mkdtempSync(path.join(tmpdir(), 'hive-mind-test-'));
    sessionManager = new HiveMindSessionManager(tempDir);
  });

  afterEach(() => {
    // Clean up
    if (sessionManager) {
      sessionManager.close();
    }
    // Remove temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should create required directories on initialization', () => {
      expect(fs.existsSync(tempDir)).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'sessions'))).toBe(true);
    });

    it('should initialize database schema correctly', () => {
      const db = new Database(path.join(tempDir, 'hive.db'));
      
      // Check sessions table
      const sessionsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      expect(sessionsTable).toBeTruthy();
      
      // Check session_checkpoints table
      const checkpointsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_checkpoints'").get();
      expect(checkpointsTable).toBeTruthy();
      
      // Check session_logs table
      const logsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_logs'").get();
      expect(logsTable).toBeTruthy();
      
      db.close();
    });

    it('should handle existing directories gracefully', () => {
      // Create new manager with same directory
      const newManager = new HiveMindSessionManager(tempDir);
      expect(() => newManager.close()).not.toThrow();
    });
  });

  describe('Session Creation', () => {
    it('should create a new session with correct data', () => {
      const swarmId = 'swarm-123';
      const swarmName = 'Test Swarm';
      const objective = 'Test objective';
      const metadata = { key: 'value' };
      
      const sessionId = sessionManager.createSession(swarmId, swarmName, objective, metadata);
      
      expect(sessionId).toMatch(/^session-\d+-[a-z0-9]+$/);
      
      // Verify session was created in database
      const session = sessionManager.getSession(sessionId);
      expect(session).toBeTruthy();
      expect(session.swarm_id).toBe(swarmId);
      expect(session.swarm_name).toBe(swarmName);
      expect(session.objective).toBe(objective);
      expect(session.metadata).toEqual(metadata);
      expect(session.status).toBe('active');
    });

    it('should log session creation event', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      const logs = sessionManager.getSessionLogs(sessionId);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].message).toBe('Session created');
      expect(logs[0].log_level).toBe('info');
    });

    it('should handle empty metadata', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      const session = sessionManager.getSession(sessionId);
      expect(session.metadata).toEqual({});
    });
  });

  describe('Checkpoint Management', () => {
    let sessionId;

    beforeEach(() => {
      sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
    });

    it('should save checkpoint successfully', async () => {
      const checkpointData = {
        agents: ['agent1', 'agent2'],
        tasks: { completed: 5, pending: 10 },
        memory: { key1: 'value1' }
      };
      
      const checkpointId = await sessionManager.saveCheckpoint(sessionId, 'test-checkpoint', checkpointData);
      
      expect(checkpointId).toMatch(/^checkpoint-\d+-[a-z0-9]+$/);
      
      // Verify checkpoint was saved
      const session = sessionManager.getSession(sessionId);
      expect(session.checkpoint_data).toEqual(checkpointData);
    });

    it('should save checkpoint file for backup', async () => {
      const checkpointData = { test: 'data' };
      await sessionManager.saveCheckpoint(sessionId, 'backup-test', checkpointData);
      
      const checkpointFile = path.join(tempDir, 'sessions', `${sessionId}-backup-test.json`);
      expect(fs.existsSync(checkpointFile)).toBe(true);
      
      const fileContent = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
      expect(fileContent.data).toEqual(checkpointData);
    });

    it('should update session timestamp on checkpoint save', async () => {
      const session1 = sessionManager.getSession(sessionId);
      const originalTimestamp = session1.updated_at;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await sessionManager.saveCheckpoint(sessionId, 'timestamp-test', { data: 'test' });
      
      const session2 = sessionManager.getSession(sessionId);
      expect(new Date(session2.updated_at).getTime()).toBeGreaterThan(new Date(originalTimestamp).getTime());
    });

    it('should handle multiple checkpoints', async () => {
      await sessionManager.saveCheckpoint(sessionId, 'checkpoint-1', { version: 1 });
      await sessionManager.saveCheckpoint(sessionId, 'checkpoint-2', { version: 2 });
      await sessionManager.saveCheckpoint(sessionId, 'checkpoint-3', { version: 3 });
      
      const session = sessionManager.getSession(sessionId);
      expect(session.checkpoints.length).toBe(3);
      expect(session.checkpoints[0].checkpoint_data.version).toBe(3); // Most recent first
    });
  });

  describe('Session Retrieval', () => {
    it('should get active sessions correctly', () => {
      // Create multiple sessions
      const sessionId1 = sessionManager.createSession('swarm-1', 'Swarm 1', 'Objective 1');
      const sessionId2 = sessionManager.createSession('swarm-2', 'Swarm 2', 'Objective 2');
      
      // Pause one session
      sessionManager.pauseSession(sessionId1);
      
      const activeSessions = sessionManager.getActiveSessions();
      expect(activeSessions.length).toBe(2);
      
      const session1 = activeSessions.find(s => s.id === sessionId1);
      const session2 = activeSessions.find(s => s.id === sessionId2);
      
      expect(session1.status).toBe('paused');
      expect(session2.status).toBe('active');
    });

    it('should return null for non-existent session', () => {
      const session = sessionManager.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should include full session details', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      // Add some test data
      sessionManager.logSessionEvent(sessionId, 'info', 'Test log 1');
      sessionManager.logSessionEvent(sessionId, 'warn', 'Test log 2');
      
      const session = sessionManager.getSession(sessionId);
      
      expect(session).toHaveProperty('swarm');
      expect(session).toHaveProperty('agents');
      expect(session).toHaveProperty('tasks');
      expect(session).toHaveProperty('checkpoints');
      expect(session).toHaveProperty('recentLogs');
      expect(session).toHaveProperty('statistics');
      
      expect(session.recentLogs.length).toBe(3); // Creation log + 2 test logs
    });
  });

  describe('Session Pause and Resume', () => {
    let sessionId;

    beforeEach(() => {
      sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
    });

    it('should pause session successfully', () => {
      const result = sessionManager.pauseSession(sessionId);
      expect(result).toBe(true);
      
      const session = sessionManager.getSession(sessionId);
      expect(session.status).toBe('paused');
      expect(session.paused_at).toBeTruthy();
    });

    it('should fail to pause non-existent session', () => {
      const result = sessionManager.pauseSession('non-existent');
      expect(result).toBe(false);
    });

    it('should resume paused session successfully', async () => {
      sessionManager.pauseSession(sessionId);
      
      const resumedSession = await sessionManager.resumeSession(sessionId);
      
      expect(resumedSession.status).toBe('active');
      
      const session = sessionManager.getSession(sessionId);
      expect(session.status).toBe('active');
      expect(session.resumed_at).toBeTruthy();
    });

    it('should throw error when resuming non-paused session', async () => {
      await expect(sessionManager.resumeSession(sessionId)).rejects.toThrow('is not paused');
    });

    it('should throw error when resuming non-existent session', async () => {
      await expect(sessionManager.resumeSession('non-existent')).rejects.toThrow('not found');
    });

    it('should log pause and resume events', async () => {
      sessionManager.pauseSession(sessionId);
      await sessionManager.resumeSession(sessionId);
      
      const logs = sessionManager.getSessionLogs(sessionId);
      const pauseLog = logs.find(l => l.message === 'Session paused');
      const resumeLog = logs.find(l => l.message === 'Session resumed');
      
      expect(pauseLog).toBeTruthy();
      expect(resumeLog).toBeTruthy();
    });
  });

  describe('Session Completion', () => {
    it('should mark session as completed', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      const result = sessionManager.completeSession(sessionId);
      expect(result).toBe(true);
      
      const session = sessionManager.getSession(sessionId);
      expect(session.status).toBe('completed');
      expect(session.completion_percentage).toBe(100);
    });

    it('should fail to complete non-existent session', () => {
      const result = sessionManager.completeSession('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Session Logging', () => {
    let sessionId;

    beforeEach(() => {
      sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
    });

    it('should log events with all fields', () => {
      const data = { key: 'value', number: 42 };
      sessionManager.logSessionEvent(sessionId, 'error', 'Test error', 'agent-123', data);
      
      const logs = sessionManager.getSessionLogs(sessionId);
      const errorLog = logs.find(l => l.message === 'Test error');
      
      expect(errorLog).toBeTruthy();
      expect(errorLog.log_level).toBe('error');
      expect(errorLog.agent_id).toBe('agent-123');
      expect(errorLog.data).toEqual(data);
    });

    it('should handle null agent_id and data', () => {
      sessionManager.logSessionEvent(sessionId, 'info', 'Simple message');
      
      const logs = sessionManager.getSessionLogs(sessionId);
      const simpleLog = logs.find(l => l.message === 'Simple message');
      
      expect(simpleLog).toBeTruthy();
      expect(simpleLog.agent_id).toBeNull();
      expect(simpleLog.data).toBeNull();
    });

    it('should retrieve logs with pagination', () => {
      // Create many logs
      for (let i = 0; i < 20; i++) {
        sessionManager.logSessionEvent(sessionId, 'info', `Log ${i}`);
      }
      
      const firstPage = sessionManager.getSessionLogs(sessionId, 10, 0);
      const secondPage = sessionManager.getSessionLogs(sessionId, 10, 10);
      
      expect(firstPage.length).toBe(10);
      expect(secondPage.length).toBe(10);
      expect(firstPage[0].message).not.toBe(secondPage[0].message);
    });
  });

  describe('Progress Tracking', () => {
    it('should update session progress', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      sessionManager.updateSessionProgress(sessionId, 75);
      
      const session = sessionManager.getSession(sessionId);
      expect(session.completion_percentage).toBe(75);
    });

    it('should calculate progress from tasks', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      // Need to create swarm and tasks in database for this test
      const db = new Database(path.join(tempDir, 'hive.db'));
      
      // Insert swarm
      db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run('swarm-123', 'Test Swarm', 'Test objective');
      
      // Insert tasks
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status) VALUES (?, ?, ?, ?)').run('task-1', 'swarm-123', 'Task 1', 'completed');
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status) VALUES (?, ?, ?, ?)').run('task-2', 'swarm-123', 'Task 2', 'completed');
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status) VALUES (?, ?, ?, ?)').run('task-3', 'swarm-123', 'Task 3', 'pending');
      db.prepare('INSERT INTO tasks (id, swarm_id, description, status) VALUES (?, ?, ?, ?)').run('task-4', 'swarm-123', 'Task 4', 'pending');
      
      db.close();
      
      const activeSessions = sessionManager.getActiveSessions();
      const session = activeSessions.find(s => s.id === sessionId);
      
      expect(session.completion_percentage).toBe(50); // 2 out of 4 tasks completed
    });
  });

  describe('Session Summary', () => {
    it('should generate comprehensive session summary', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      // Add some checkpoints
      sessionManager.saveCheckpoint(sessionId, 'checkpoint-1', { data: 'test' });
      
      const summary = sessionManager.generateSessionSummary(sessionId);
      
      expect(summary).toHaveProperty('sessionId');
      expect(summary).toHaveProperty('swarmName');
      expect(summary).toHaveProperty('objective');
      expect(summary).toHaveProperty('status');
      expect(summary).toHaveProperty('duration');
      expect(summary).toHaveProperty('statistics');
      expect(summary).toHaveProperty('tasksByType');
      expect(summary).toHaveProperty('checkpointCount');
      expect(summary).toHaveProperty('timeline');
      
      expect(summary.checkpointCount).toBe(1);
    });

    it('should return null for non-existent session', () => {
      const summary = sessionManager.generateSessionSummary('non-existent');
      expect(summary).toBeNull();
    });
  });

  describe('Session Export/Import', () => {
    it('should export session data to file', async () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      await sessionManager.saveCheckpoint(sessionId, 'export-test', { data: 'test' });
      sessionManager.logSessionEvent(sessionId, 'info', 'Export test log');
      
      const exportFile = await sessionManager.exportSession(sessionId);
      
      expect(fs.existsSync(exportFile)).toBe(true);
      
      const exportedData = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
      expect(exportedData.id).toBe(sessionId);
      expect(exportedData.checkpoints.length).toBe(1);
      expect(exportedData.recentLogs.length).toBeGreaterThan(0);
    });

    it('should export to custom path', async () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      const customPath = path.join(tempDir, 'custom-export.json');
      
      const exportFile = await sessionManager.exportSession(sessionId, customPath);
      
      expect(exportFile).toBe(customPath);
      expect(fs.existsSync(customPath)).toBe(true);
    });

    it('should throw error for non-existent session export', async () => {
      await expect(sessionManager.exportSession('non-existent')).rejects.toThrow('not found');
    });

    it('should import session data from file', async () => {
      // Create and export a session
      const originalSessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective', { custom: 'metadata' });
      await sessionManager.saveCheckpoint(originalSessionId, 'import-test', { checkpoint: 'data' });
      sessionManager.logSessionEvent(originalSessionId, 'warn', 'Import test log', 'agent-456');
      
      const exportFile = await sessionManager.exportSession(originalSessionId);
      
      // Import the session
      const newSessionId = await sessionManager.importSession(exportFile);
      
      expect(newSessionId).not.toBe(originalSessionId);
      
      const importedSession = sessionManager.getSession(newSessionId);
      expect(importedSession.swarm_name).toBe('Test Swarm');
      expect(importedSession.objective).toBe('Test objective');
      expect(importedSession.metadata).toEqual({ custom: 'metadata' });
      expect(importedSession.checkpoints.length).toBe(1);
      expect(importedSession.checkpoints[0].checkpoint_data).toEqual({ checkpoint: 'data' });
    });
  });

  describe('Session Archival', () => {
    it('should archive old completed sessions', async () => {
      const db = new Database(path.join(tempDir, 'hive.db'));
      
      // Create a completed session with old timestamp
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago
      
      db.prepare(`
        INSERT INTO sessions (id, swarm_id, swarm_name, objective, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('old-session', 'swarm-old', 'Old Swarm', 'Old objective', 'completed', oldDate.toISOString(), oldDate.toISOString());
      
      // Create swarm for the session
      db.prepare('INSERT INTO swarms (id, name, objective) VALUES (?, ?, ?)').run('swarm-old', 'Old Swarm', 'Old objective');
      
      db.close();
      
      const archivedCount = await sessionManager.archiveSessions(30);
      
      expect(archivedCount).toBe(1);
      
      // Check archive file exists
      const archiveFile = path.join(tempDir, 'sessions', 'archive', 'old-session-archive.json');
      expect(fs.existsSync(archiveFile)).toBe(true);
      
      // Check session was removed from database
      const session = sessionManager.getSession('old-session');
      expect(session).toBeNull();
    });

    it('should not archive active or recent sessions', async () => {
      const sessionId1 = sessionManager.createSession('swarm-1', 'Swarm 1', 'Objective 1');
      const sessionId2 = sessionManager.createSession('swarm-2', 'Swarm 2', 'Objective 2');
      
      sessionManager.completeSession(sessionId2);
      
      const archivedCount = await sessionManager.archiveSessions(30);
      
      expect(archivedCount).toBe(0);
      
      // Both sessions should still exist
      expect(sessionManager.getSession(sessionId1)).toBeTruthy();
      expect(sessionManager.getSession(sessionId2)).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', () => {
      // Close the database to simulate error
      sessionManager.close();
      
      expect(() => {
        sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      }).toThrow();
    });

    it('should handle corrupted checkpoint data', () => {
      const sessionId = sessionManager.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      // Manually insert corrupted checkpoint
      const db = new Database(path.join(tempDir, 'hive.db'));
      db.prepare(`
        INSERT INTO session_checkpoints (id, session_id, checkpoint_name, checkpoint_data)
        VALUES (?, ?, ?, ?)
      `).run('bad-checkpoint', sessionId, 'corrupted', 'not-json');
      db.close();
      
      // Should handle gracefully
      const session = sessionManager.getSession(sessionId);
      expect(() => {
        // Accessing checkpoints with corrupted data
        session.checkpoints;
      }).toThrow();
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple session managers safely', () => {
      const manager1 = new HiveMindSessionManager(tempDir);
      const manager2 = new HiveMindSessionManager(tempDir);
      
      const sessionId = manager1.createSession('swarm-123', 'Test Swarm', 'Test objective');
      
      // Both managers should see the session
      const session1 = manager1.getSession(sessionId);
      const session2 = manager2.getSession(sessionId);
      
      expect(session1).toBeTruthy();
      expect(session2).toBeTruthy();
      expect(session1.id).toBe(session2.id);
      
      manager1.close();
      manager2.close();
    });
  });
});