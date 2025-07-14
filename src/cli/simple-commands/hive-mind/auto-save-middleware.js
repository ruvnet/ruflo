/**
 * Auto-save middleware for Hive Mind swarms
 * Automatically saves session state during operations
 */

import { HiveMindSessionManager } from './session-manager.js';

export class AutoSaveMiddleware {
  constructor(sessionId, saveInterval = 30000) {
    this.sessionId = sessionId;
    this.saveInterval = saveInterval;
    this.sessionManager = new HiveMindSessionManager();
    this.saveTimer = null;
    this.pendingChanges = [];
    this.isActive = false;
  }

  /**
   * Start auto-save monitoring
   */
  start() {
    if (this.isActive) {
      return;
    }
    
    this.isActive = true;
    
    // Set up periodic saves
    this.saveTimer = setInterval(() => {
      if (this.pendingChanges.length > 0) {
        this.performAutoSave();
      }
    }, this.saveInterval);
    
    // Also save on process exit
    process.on('beforeExit', () => {
      this.performAutoSave();
    });
    
    process.on('SIGINT', () => {
      this.performAutoSave();
      process.exit();
    });
    
    process.on('SIGTERM', () => {
      this.performAutoSave();
      process.exit();
    });
  }

  /**
   * Stop auto-save monitoring
   */
  stop() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    this.isActive = false;
    
    // Final save
    if (this.pendingChanges.length > 0) {
      this.performAutoSave();
    }
    
    this.sessionManager.close();
  }

  /**
   * Track a change for auto-save
   */
  trackChange(changeType, data) {
    this.pendingChanges.push({
      type: changeType,
      data: data,
      timestamp: new Date().toISOString()
    });
    
    // Trigger immediate save for critical changes
    if (changeType === 'task_completed' || changeType === 'agent_spawned' || changeType === 'consensus_reached') {
      this.performAutoSave();
    }
  }

  /**
   * Track task progress
   */
  trackTaskProgress(taskId, status, result = null) {
    this.trackChange('task_progress', {
      taskId,
      status,
      result
    });
  }

  /**
   * Track agent activity
   */
  trackAgentActivity(agentId, activity, data = null) {
    this.trackChange('agent_activity', {
      agentId,
      activity,
      data
    });
  }

  /**
   * Track memory updates
   */
  trackMemoryUpdate(key, value, type = 'general') {
    this.trackChange('memory_update', {
      key,
      value,
      type
    });
  }

  /**
   * Track consensus decisions
   */
  trackConsensusDecision(topic, decision, votes) {
    this.trackChange('consensus_reached', {
      topic,
      decision,
      votes
    });
  }

  /**
   * Perform auto-save
   */
  async performAutoSave() {
    if (this.pendingChanges.length === 0) {
      return;
    }
    
    try {
      // Group changes by type
      const changesByType = this.pendingChanges.reduce((acc, change) => {
        if (!acc[change.type]) {
          acc[change.type] = [];
        }
        acc[change.type].push(change);
        return acc;
      }, {});
      
      // Calculate progress
      const taskProgress = changesByType.task_progress || [];
      const completedTasks = taskProgress.filter(t => t.data.status === 'completed').length;
      const totalTasks = taskProgress.length;
      const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      
      // Create checkpoint data
      const checkpointData = {
        timestamp: new Date().toISOString(),
        changeCount: this.pendingChanges.length,
        changesByType,
        statistics: {
          tasksProcessed: taskProgress.length,
          tasksCompleted: completedTasks,
          memoryUpdates: (changesByType.memory_update || []).length,
          agentActivities: (changesByType.agent_activity || []).length,
          consensusDecisions: (changesByType.consensus_reached || []).length
        }
      };
      
      // Save checkpoint
      const checkpointName = `auto-save-${Date.now()}`;
      await this.sessionManager.saveCheckpoint(this.sessionId, checkpointName, checkpointData);
      
      // Update session progress
      if (completionPercentage > 0) {
        this.sessionManager.updateSessionProgress(this.sessionId, completionPercentage);
      }
      
      // Log all changes as session events
      for (const change of this.pendingChanges) {
        this.sessionManager.logSessionEvent(
          this.sessionId,
          'info',
          `Auto-save: ${change.type}`,
          change.data.agentId || null,
          change.data
        );
      }
      
      // Clear pending changes
      this.pendingChanges = [];
      
    } catch (error) {
      console.error('Auto-save failed:', error);
      // Keep changes for next attempt
    }
  }

  /**
   * Force immediate save
   */
  async forceSave() {
    await this.performAutoSave();
  }

  /**
   * Get pending changes count
   */
  getPendingChangesCount() {
    return this.pendingChanges.length;
  }

  /**
   * Check if auto-save is active
   */
  isAutoSaveActive() {
    return this.isActive;
  }
}

/**
 * Create auto-save middleware for a session
 */
export function createAutoSaveMiddleware(sessionId, options = {}) {
  const saveInterval = options.saveInterval || 30000; // Default 30 seconds
  const middleware = new AutoSaveMiddleware(sessionId, saveInterval);
  
  if (options.autoStart !== false) {
    middleware.start();
  }
  
  return middleware;
}

// Export for use in swarm operations
export default AutoSaveMiddleware;