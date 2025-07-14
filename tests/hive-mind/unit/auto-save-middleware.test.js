/**
 * AutoSaveMiddleware Tests
 * Tests for automatic session state saving functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AutoSaveMiddleware, createAutoSaveMiddleware } from '../../../src/cli/simple-commands/hive-mind/auto-save-middleware.js';
import { HiveMindSessionManager } from '../../../src/cli/simple-commands/hive-mind/session-manager.js';
import path from 'path';
import fs from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Mock HiveMindSessionManager
jest.mock('../../../src/cli/simple-commands/hive-mind/session-manager.js');

describe('AutoSaveMiddleware', () => {
  let autoSave;
  let mockSessionManager;
  let sessionId;
  let tempDir;

  beforeEach(() => {
    // Create temporary directory
    tempDir = mkdtempSync(path.join(tmpdir(), 'auto-save-test-'));
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup mock session manager
    mockSessionManager = {
      saveCheckpoint: jest.fn().mockResolvedValue('checkpoint-123'),
      updateSessionProgress: jest.fn(),
      logSessionEvent: jest.fn(),
      close: jest.fn()
    };
    
    HiveMindSessionManager.mockImplementation(() => mockSessionManager);
    
    sessionId = 'test-session-123';
    autoSave = new AutoSaveMiddleware(sessionId, 100); // 100ms interval for testing
  });

  afterEach(() => {
    // Stop auto-save
    if (autoSave && autoSave.isActive) {
      autoSave.stop();
    }
    
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize with correct settings', () => {
      expect(autoSave.sessionId).toBe(sessionId);
      expect(autoSave.saveInterval).toBe(100);
      expect(autoSave.pendingChanges).toEqual([]);
      expect(autoSave.isActive).toBe(false);
    });

    it('should create session manager instance', () => {
      expect(HiveMindSessionManager).toHaveBeenCalled();
    });
  });

  describe('Start/Stop Operations', () => {
    it('should start monitoring when start() is called', () => {
      jest.useFakeTimers();
      autoSave.start();
      
      expect(autoSave.isActive).toBe(true);
      expect(autoSave.saveTimer).toBeTruthy();
    });

    it('should not start multiple times', () => {
      jest.useFakeTimers();
      autoSave.start();
      const firstTimer = autoSave.saveTimer;
      
      autoSave.start();
      expect(autoSave.saveTimer).toBe(firstTimer);
    });

    it('should stop monitoring when stop() is called', () => {
      jest.useFakeTimers();
      autoSave.start();
      autoSave.stop();
      
      expect(autoSave.isActive).toBe(false);
      expect(autoSave.saveTimer).toBeNull();
    });

    it('should perform final save on stop if changes pending', async () => {
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'test' });
      
      await autoSave.stop();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
    });

    it('should close session manager on stop', () => {
      autoSave.stop();
      expect(mockSessionManager.close).toHaveBeenCalled();
    });
  });

  describe('Change Tracking', () => {
    it('should track changes correctly', () => {
      autoSave.trackChange('task_updated', { taskId: 'task-1', status: 'completed' });
      
      expect(autoSave.pendingChanges.length).toBe(1);
      expect(autoSave.pendingChanges[0].type).toBe('task_updated');
      expect(autoSave.pendingChanges[0].data).toEqual({ taskId: 'task-1', status: 'completed' });
      expect(autoSave.pendingChanges[0].timestamp).toBeTruthy();
    });

    it('should trigger immediate save for critical changes', async () => {
      autoSave.start();
      
      await autoSave.trackChange('task_completed', { taskId: 'task-1' });
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
      expect(autoSave.pendingChanges.length).toBe(0); // Changes cleared after save
    });

    it('should trigger immediate save for agent_spawned', async () => {
      autoSave.start();
      
      await autoSave.trackChange('agent_spawned', { agentId: 'agent-1' });
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
    });

    it('should trigger immediate save for consensus_reached', async () => {
      autoSave.start();
      
      await autoSave.trackChange('consensus_reached', { decision: 'approved' });
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
    });
  });

  describe('Specialized Tracking Methods', () => {
    it('should track task progress', () => {
      autoSave.trackTaskProgress('task-123', 'in_progress', null);
      
      expect(autoSave.pendingChanges.length).toBe(1);
      expect(autoSave.pendingChanges[0].type).toBe('task_progress');
      expect(autoSave.pendingChanges[0].data).toEqual({
        taskId: 'task-123',
        status: 'in_progress',
        result: null
      });
    });

    it('should track agent activity', () => {
      autoSave.trackAgentActivity('agent-456', 'task_assigned', { taskId: 'task-789' });
      
      expect(autoSave.pendingChanges.length).toBe(1);
      expect(autoSave.pendingChanges[0].type).toBe('agent_activity');
      expect(autoSave.pendingChanges[0].data).toEqual({
        agentId: 'agent-456',
        activity: 'task_assigned',
        data: { taskId: 'task-789' }
      });
    });

    it('should track memory updates', () => {
      autoSave.trackMemoryUpdate('config.maxWorkers', 10, 'config');
      
      expect(autoSave.pendingChanges.length).toBe(1);
      expect(autoSave.pendingChanges[0].type).toBe('memory_update');
      expect(autoSave.pendingChanges[0].data).toEqual({
        key: 'config.maxWorkers',
        value: 10,
        type: 'config'
      });
    });

    it('should track consensus decisions', () => {
      const votes = { for: 5, against: 2, abstain: 1 };
      autoSave.trackConsensusDecision('feature-approval', 'approved', votes);
      
      expect(autoSave.pendingChanges.length).toBe(1);
      expect(autoSave.pendingChanges[0].type).toBe('consensus_reached');
      expect(autoSave.pendingChanges[0].data).toEqual({
        topic: 'feature-approval',
        decision: 'approved',
        votes: votes
      });
    });
  });

  describe('Periodic Auto-Save', () => {
    it('should save changes periodically', async () => {
      jest.useFakeTimers();
      autoSave.start();
      
      // Add some changes
      autoSave.trackChange('test_change_1', { data: 'test1' });
      autoSave.trackChange('test_change_2', { data: 'test2' });
      
      // Advance timer to trigger save
      jest.advanceTimersByTime(150);
      
      // Wait for async save to complete
      await Promise.resolve();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
    });

    it('should not save if no pending changes', async () => {
      jest.useFakeTimers();
      autoSave.start();
      
      // Advance timer without adding changes
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      
      expect(mockSessionManager.saveCheckpoint).not.toHaveBeenCalled();
    });

    it('should clear pending changes after successful save', async () => {
      autoSave.trackChange('test_change', { data: 'test' });
      expect(autoSave.pendingChanges.length).toBe(1);
      
      await autoSave.performAutoSave();
      
      expect(autoSave.pendingChanges.length).toBe(0);
    });
  });

  describe('Auto-Save Data Processing', () => {
    it('should group changes by type correctly', async () => {
      autoSave.trackTaskProgress('task-1', 'completed');
      autoSave.trackTaskProgress('task-2', 'in_progress');
      autoSave.trackAgentActivity('agent-1', 'idle');
      autoSave.trackMemoryUpdate('key1', 'value1');
      
      let capturedCheckpointData;
      mockSessionManager.saveCheckpoint.mockImplementation((sid, name, data) => {
        capturedCheckpointData = data;
        return Promise.resolve('checkpoint-id');
      });
      
      await autoSave.performAutoSave();
      
      expect(capturedCheckpointData.changesByType.task_progress).toHaveLength(2);
      expect(capturedCheckpointData.changesByType.agent_activity).toHaveLength(1);
      expect(capturedCheckpointData.changesByType.memory_update).toHaveLength(1);
    });

    it('should calculate completion percentage correctly', async () => {
      autoSave.trackTaskProgress('task-1', 'completed');
      autoSave.trackTaskProgress('task-2', 'completed');
      autoSave.trackTaskProgress('task-3', 'in_progress');
      autoSave.trackTaskProgress('task-4', 'pending');
      
      await autoSave.performAutoSave();
      
      expect(mockSessionManager.updateSessionProgress).toHaveBeenCalledWith(sessionId, 50);
    });

    it('should include statistics in checkpoint', async () => {
      autoSave.trackTaskProgress('task-1', 'completed');
      autoSave.trackAgentActivity('agent-1', 'working');
      autoSave.trackMemoryUpdate('key1', 'value1');
      autoSave.trackConsensusDecision('topic1', 'approved', {});
      
      let capturedCheckpointData;
      mockSessionManager.saveCheckpoint.mockImplementation((sid, name, data) => {
        capturedCheckpointData = data;
        return Promise.resolve('checkpoint-id');
      });
      
      await autoSave.performAutoSave();
      
      expect(capturedCheckpointData.statistics).toEqual({
        tasksProcessed: 1,
        tasksCompleted: 1,
        memoryUpdates: 1,
        agentActivities: 1,
        consensusDecisions: 1
      });
    });

    it('should log all changes as session events', async () => {
      autoSave.trackChange('test_change_1', { data: 'test1' });
      autoSave.trackChange('test_change_2', { data: 'test2', agentId: 'agent-1' });
      
      await autoSave.performAutoSave();
      
      expect(mockSessionManager.logSessionEvent).toHaveBeenCalledTimes(2);
      expect(mockSessionManager.logSessionEvent).toHaveBeenCalledWith(
        sessionId,
        'info',
        'Auto-save: test_change_1',
        null,
        { data: 'test1' }
      );
      expect(mockSessionManager.logSessionEvent).toHaveBeenCalledWith(
        sessionId,
        'info',
        'Auto-save: test_change_2',
        'agent-1',
        { data: 'test2', agentId: 'agent-1' }
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle save errors gracefully', async () => {
      mockSessionManager.saveCheckpoint.mockRejectedValue(new Error('Save failed'));
      
      autoSave.trackChange('test_change', { data: 'test' });
      
      // Should not throw
      await expect(autoSave.performAutoSave()).resolves.not.toThrow();
      
      // Changes should be preserved for retry
      expect(autoSave.pendingChanges.length).toBe(1);
    });

    it('should continue operating after save error', async () => {
      jest.useFakeTimers();
      mockSessionManager.saveCheckpoint.mockRejectedValueOnce(new Error('Save failed'));
      
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'test' });
      
      // First save fails
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      
      expect(autoSave.pendingChanges.length).toBe(1); // Changes preserved
      
      // Second save succeeds
      mockSessionManager.saveCheckpoint.mockResolvedValue('checkpoint-id');
      jest.advanceTimersByTime(150);
      await Promise.resolve();
      
      expect(autoSave.pendingChanges.length).toBe(0); // Changes cleared
    });
  });

  describe('Force Save', () => {
    it('should perform immediate save when forceSave() is called', async () => {
      autoSave.trackChange('test_change', { data: 'test' });
      
      await autoSave.forceSave();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
      expect(autoSave.pendingChanges.length).toBe(0);
    });

    it('should do nothing if no pending changes', async () => {
      await autoSave.forceSave();
      
      expect(mockSessionManager.saveCheckpoint).not.toHaveBeenCalled();
    });
  });

  describe('Status Methods', () => {
    it('should report pending changes count', () => {
      expect(autoSave.getPendingChangesCount()).toBe(0);
      
      autoSave.trackChange('change1', {});
      autoSave.trackChange('change2', {});
      
      expect(autoSave.getPendingChangesCount()).toBe(2);
    });

    it('should report auto-save active status', () => {
      expect(autoSave.isAutoSaveActive()).toBe(false);
      
      autoSave.start();
      expect(autoSave.isAutoSaveActive()).toBe(true);
      
      autoSave.stop();
      expect(autoSave.isAutoSaveActive()).toBe(false);
    });
  });

  describe('createAutoSaveMiddleware Factory', () => {
    it('should create middleware with default settings', () => {
      const middleware = createAutoSaveMiddleware('session-456');
      
      expect(middleware).toBeInstanceOf(AutoSaveMiddleware);
      expect(middleware.sessionId).toBe('session-456');
      expect(middleware.saveInterval).toBe(30000); // Default
      expect(middleware.isActive).toBe(true); // Auto-started
      
      middleware.stop();
    });

    it('should create middleware with custom interval', () => {
      const middleware = createAutoSaveMiddleware('session-789', { saveInterval: 5000 });
      
      expect(middleware.saveInterval).toBe(5000);
      
      middleware.stop();
    });

    it('should not auto-start if specified', () => {
      const middleware = createAutoSaveMiddleware('session-999', { autoStart: false });
      
      expect(middleware.isActive).toBe(false);
    });
  });

  describe('Process Exit Handlers', () => {
    it('should save on SIGINT', async () => {
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'test' });
      
      // Simulate SIGINT
      const sigintListeners = process.listeners('SIGINT');
      const autoSaveListener = sigintListeners[sigintListeners.length - 1];
      
      // Mock process.exit to prevent actual exit
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      await autoSaveListener();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalled();
      
      // Restore
      process.exit = originalExit;
    });

    it('should save on SIGTERM', async () => {
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'test' });
      
      // Simulate SIGTERM
      const sigtermListeners = process.listeners('SIGTERM');
      const autoSaveListener = sigtermListeners[sigtermListeners.length - 1];
      
      // Mock process.exit
      const originalExit = process.exit;
      process.exit = jest.fn();
      
      await autoSaveListener();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalled();
      
      // Restore
      process.exit = originalExit;
    });

    it('should save on beforeExit', async () => {
      autoSave.start();
      autoSave.trackChange('test_change', { data: 'test' });
      
      // Simulate beforeExit
      const beforeExitListeners = process.listeners('beforeExit');
      const autoSaveListener = beforeExitListeners[beforeExitListeners.length - 1];
      
      await autoSaveListener();
      
      expect(mockSessionManager.saveCheckpoint).toHaveBeenCalled();
    });
  });
});