/**
 * AIME Progress Management Module
 * Implements real-time progress tracking and centralized state management
 * Based on AIME paper: "single source of truth" for system-wide coordination
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class ProgressManagementModule extends EventEmitter {
  constructor(options = {}) {
    super();
    this.progressList = new Map(); // Main progress storage
    this.realtimeUpdates = new Map(); // Real-time status updates
    this.taskHierarchy = new Map(); // Task dependency structure
    this.completionCriteria = new Map(); // Task completion validation
    this.artifactPointers = new Map(); // Reference pointers to outputs
    this.sessionId = options.sessionId || `session_${Date.now()}`;
    this.persistPath = options.persistPath || './aime_progress_data';
    this.syncInterval = options.syncInterval || 1000; // 1 second real-time sync
    
    this.initializeModule();
  }

  async initializeModule() {
    try {
      await fs.mkdir(this.persistPath, { recursive: true });
      await this.loadPersistedData();
      this.startRealtimeSync();
      // Use stderr to prevent JSON-RPC interference
      console.error(`✅ AIME Progress Management Module initialized for session: ${this.sessionId}`);
    } catch (error) {
      console.error('❌ Failed to initialize Progress Management Module:', error);
    }
  }

  /**
   * Initialize progress list from Dynamic Planner
   * Implements AIME paper's task decomposition structure
   */
  initializeProgressList(taskStructure) {
    const timestamp = new Date().toISOString();
    
    // Create hierarchical task structure as per AIME specification
    for (const [taskId, taskData] of Object.entries(taskStructure)) {
      this.progressList.set(taskId, {
        id: taskId,
        title: taskData.title,
        description: taskData.description,
        status: 'pending', // pending, in_progress, completed, failed, blocked
        priority: taskData.priority || 'medium',
        dependencies: taskData.dependencies || [],
        subtasks: taskData.subtasks || [],
        completionCriteria: taskData.completionCriteria || [],
        assignedAgent: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        estimatedDuration: taskData.estimatedDuration,
        actualStartTime: null,
        actualEndTime: null,
        progressPercentage: 0,
        milestones: [],
        artifacts: [],
        contextData: taskData.contextData || {}
      });
      
      // Set completion criteria for validation
      if (taskData.completionCriteria) {
        this.completionCriteria.set(taskId, taskData.completionCriteria);
      }
    }

    this.emit('progressListInitialized', {
      sessionId: this.sessionId,
      taskCount: this.progressList.size,
      timestamp
    });

    return this.generateMarkdownProgressList();
  }

  /**
   * UpdateProgress tool implementation for Dynamic Actors
   * Core AIME innovation: Real-time progress reporting during execution
   */
  updateProgress(agentId, taskId, updateData) {
    const timestamp = new Date().toISOString();
    const task = this.progressList.get(taskId);
    
    if (!task) {
      throw new Error(`Task ${taskId} not found in progress list`);
    }

    // Store real-time update
    const updateKey = `${taskId}_${Date.now()}`;
    this.realtimeUpdates.set(updateKey, {
      agentId,
      taskId,
      timestamp,
      updateType: updateData.type || 'progress', // progress, milestone, obstacle, completion
      status: updateData.status,
      message: updateData.message,
      progressPercentage: updateData.progressPercentage,
      artifacts: updateData.artifacts || [],
      contextData: updateData.contextData || {}
    });

    // Update main task record
    const updatedTask = {
      ...task,
      status: updateData.status || task.status,
      progressPercentage: updateData.progressPercentage || task.progressPercentage,
      updatedAt: timestamp,
      assignedAgent: agentId
    };

    // Handle milestone completion
    if (updateData.type === 'milestone') {
      updatedTask.milestones.push({
        name: updateData.milestone,
        completedAt: timestamp,
        message: updateData.message
      });
    }

    // Handle obstacle reporting
    if (updateData.type === 'obstacle') {
      this.emit('obstacleEncountered', {
        taskId,
        agentId,
        obstacle: updateData.message,
        severity: updateData.severity || 'medium',
        timestamp,
        contextData: updateData.contextData
      });
    }

    // Handle task completion
    if (updateData.status === 'completed') {
      updatedTask.actualEndTime = timestamp;
      updatedTask.progressPercentage = 100;
      
      // Validate completion criteria
      if (this.validateTaskCompletion(taskId, updateData)) {
        this.emit('taskCompleted', {
          taskId,
          agentId,
          completionData: updateData,
          timestamp
        });
      } else {
        updatedTask.status = 'failed';
        this.emit('taskValidationFailed', {
          taskId,
          agentId,
          reason: 'Completion criteria not met',
          timestamp
        });
      }
    }

    // Handle task start
    if (updateData.status === 'in_progress' && !task.actualStartTime) {
      updatedTask.actualStartTime = timestamp;
    }

    this.progressList.set(taskId, updatedTask);

    // Emit real-time update for subscribers
    this.emit('realtimeUpdate', {
      taskId,
      agentId,
      updateData,
      timestamp,
      progressList: this.generateMarkdownProgressList()
    });

    return {
      success: true,
      taskId,
      updatedTask,
      markdownUpdate: this.generateTaskMarkdown(taskId)
    };
  }

  /**
   * Generate structured conclusion report when task completes
   * Implements AIME paper's three-part conclusion format
   */
  generateConclusionReport(taskId, agentId, completionData) {
    const task = this.progressList.get(taskId);
    const realtimeHistory = Array.from(this.realtimeUpdates.values())
      .filter(update => update.taskId === taskId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      // 1. Status Update - explicit progress list update
      statusUpdate: {
        taskId,
        status: 'completed',
        progressPercentage: 100,
        completedAt: new Date().toISOString(),
        completionValidated: this.validateTaskCompletion(taskId, completionData)
      },

      // 2. Conclusion Summary - narrative summary with context
      conclusionSummary: {
        taskTitle: task.title,
        executingAgent: agentId,
        finalOutcome: completionData.outcome || 'Task completed successfully',
        obstaclesEncountered: realtimeHistory
          .filter(u => u.updateType === 'obstacle')
          .map(u => u.message),
        keyInsights: completionData.insights || [],
        executionDuration: this.calculateTaskDuration(taskId),
        milestonesAchieved: task.milestones.length,
        performanceMetrics: {
          efficiency: this.calculateEfficiency(taskId),
          qualityScore: completionData.qualityScore || null,
          resourceUtilization: completionData.resourceUtilization || null
        }
      },

      // 3. Reference Pointers - structured artifacts and outputs
      referencePointers: {
        primaryOutputs: completionData.outputs || [],
        filePaths: completionData.filePaths || [],
        urls: completionData.urls || [],
        databaseRecords: completionData.databaseRecords || [],
        searchResults: completionData.searchResults || [],
        generatedArtifacts: task.artifacts,
        traceabilityData: {
          sessionId: this.sessionId,
          taskId,
          agentId,
          startTime: task.actualStartTime,
          endTime: task.actualEndTime,
          realtimeUpdateCount: realtimeHistory.length
        }
      }
    };
  }

  /**
   * Generate live markdown progress list (AIME format)
   * Human-readable and machine-parsable progress representation
   */
  generateMarkdownProgressList() {
    const tasks = Array.from(this.progressList.values())
      .sort((a, b) => a.priority === 'high' ? -1 : 1);

    let markdown = `# 🎯 AIME Mission Progress Dashboard\n`;
    markdown += `**Session:** ${this.sessionId}\n`;
    markdown += `**Last Updated:** ${new Date().toISOString()}\n`;
    markdown += `**Total Tasks:** ${tasks.length}\n\n`;

    // Progress Overview
    const statusCounts = this.getStatusCounts();
    markdown += `## 📊 Progress Overview\n`;
    markdown += `   ├── Total Tasks: ${statusCounts.total}\n`;
    markdown += `   ├── ✅ Completed: ${statusCounts.completed} (${Math.round(statusCounts.completed/statusCounts.total*100)}%)\n`;
    markdown += `   ├── 🔄 In Progress: ${statusCounts.in_progress} (${Math.round(statusCounts.in_progress/statusCounts.total*100)}%)\n`;
    markdown += `   ├── ⭕ Pending: ${statusCounts.pending} (${Math.round(statusCounts.pending/statusCounts.total*100)}%)\n`;
    markdown += `   └── ❌ Failed/Blocked: ${statusCounts.failed + statusCounts.blocked} (${Math.round((statusCounts.failed + statusCounts.blocked)/statusCounts.total*100)}%)\n\n`;

    // Group tasks by status
    const groupedTasks = this.groupTasksByStatus();

    // Pending Tasks
    if (groupedTasks.pending.length > 0) {
      markdown += `## 📋 Pending Tasks (${groupedTasks.pending.length})\n`;
      groupedTasks.pending.forEach(task => {
        const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
        markdown += `   └── ${priority} ${task.id}: ${task.title} [${task.priority.toUpperCase()}] ▶\n`;
      });
      markdown += '\n';
    }

    // In Progress Tasks
    if (groupedTasks.in_progress.length > 0) {
      markdown += `## 🔄 In Progress (${groupedTasks.in_progress.length})\n`;
      groupedTasks.in_progress.forEach(task => {
        const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
        const deps = task.dependencies.length > 0 ? ` ↳ ${task.dependencies.length} deps` : '';
        markdown += `   ├── ${priority} ${task.id}: ${task.title} [${task.progressPercentage}%]${deps} ▶\n`;
        if (task.assignedAgent) {
          markdown += `       └── 👤 Agent: ${task.assignedAgent}\n`;
        }
      });
      markdown += '\n';
    }

    // Completed Tasks
    if (groupedTasks.completed.length > 0) {
      markdown += `## ✅ Completed (${groupedTasks.completed.length})\n`;
      groupedTasks.completed.forEach(task => {
        const duration = this.calculateTaskDuration(task.id);
        markdown += `   ├── ✅ ${task.id}: ${task.title} [${duration}]\n`;
      });
      markdown += '\n';
    }

    // Failed/Blocked Tasks
    if (groupedTasks.failed.length > 0 || groupedTasks.blocked.length > 0) {
      markdown += `## ❌ Failed/Blocked (${groupedTasks.failed.length + groupedTasks.blocked.length})\n`;
      [...groupedTasks.failed, ...groupedTasks.blocked].forEach(task => {
        markdown += `   ├── ❌ ${task.id}: ${task.title} [${task.status.toUpperCase()}]\n`;
      });
      markdown += '\n';
    }

    markdown += `\n*Priority indicators: 🔴 HIGH/CRITICAL, 🟡 MEDIUM, 🟢 LOW*\n`;
    markdown += `*Dependencies: ↳ X deps | Actionable: ▶*\n`;

    return markdown;
  }

  /**
   * Real-time synchronization system
   * Ensures all components have up-to-date progress information
   */
  startRealtimeSync() {
    setInterval(() => {
      this.persistProgressData();
      this.emit('syncUpdate', {
        timestamp: new Date().toISOString(),
        activeUpdates: this.realtimeUpdates.size,
        activeTasks: this.progressList.size
      });
    }, this.syncInterval);
  }

  // Helper methods
  validateTaskCompletion(taskId, completionData) {
    const criteria = this.completionCriteria.get(taskId);
    if (!criteria || criteria.length === 0) return true;
    
    // Implement completion criteria validation logic
    return criteria.every(criterion => {
      switch (criterion.type) {
        case 'output_exists':
          return completionData.outputs && completionData.outputs.length > 0;
        case 'file_created':
          return completionData.filePaths && completionData.filePaths.includes(criterion.path);
        case 'quality_threshold':
          return completionData.qualityScore >= criterion.threshold;
        default:
          return true;
      }
    });
  }

  calculateTaskDuration(taskId) {
    const task = this.progressList.get(taskId);
    if (!task.actualStartTime || !task.actualEndTime) return 'Unknown';
    
    const start = new Date(task.actualStartTime);
    const end = new Date(task.actualEndTime);
    const durationMs = end - start;
    
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  }

  calculateEfficiency(taskId) {
    const task = this.progressList.get(taskId);
    if (!task.estimatedDuration || !task.actualStartTime || !task.actualEndTime) return null;
    
    const actualDuration = new Date(task.actualEndTime) - new Date(task.actualStartTime);
    const estimatedDuration = task.estimatedDuration * 1000; // Convert to ms
    
    return Math.round((estimatedDuration / actualDuration) * 100) / 100;
  }

  getStatusCounts() {
    const counts = { total: 0, completed: 0, in_progress: 0, pending: 0, failed: 0, blocked: 0 };
    
    for (const task of this.progressList.values()) {
      counts.total++;
      counts[task.status]++;
    }
    
    return counts;
  }

  groupTasksByStatus() {
    const groups = { pending: [], in_progress: [], completed: [], failed: [], blocked: [] };
    
    for (const task of this.progressList.values()) {
      groups[task.status].push(task);
    }
    
    return groups;
  }

  generateTaskMarkdown(taskId) {
    const task = this.progressList.get(taskId);
    if (!task) return '';
    
    const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
    const status = task.status === 'completed' ? '✅' : 
                  task.status === 'in_progress' ? '🔄' : 
                  task.status === 'failed' ? '❌' : '⭕';
    
    return `${status} ${priority} **${task.title}** [${task.progressPercentage}%]\n   └── Status: ${task.status} | Agent: ${task.assignedAgent || 'Unassigned'}`;
  }

  async persistProgressData() {
    try {
      const data = {
        progressList: Object.fromEntries(this.progressList),
        realtimeUpdates: Object.fromEntries(this.realtimeUpdates),
        sessionId: this.sessionId,
        lastSync: new Date().toISOString()
      };
      
      const filePath = path.join(this.persistPath, `progress_${this.sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to persist progress data:', error);
    }
  }

  async loadPersistedData() {
    try {
      const filePath = path.join(this.persistPath, `progress_${this.sessionId}.json`);
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      
      this.progressList = new Map(Object.entries(data.progressList || {}));
      this.realtimeUpdates = new Map(Object.entries(data.realtimeUpdates || {}));
    } catch (error) {
      // No existing data, start fresh
      // Use stderr to prevent JSON-RPC interference
      console.error('No existing progress data found, starting fresh');
    }
  }
}

export default ProgressManagementModule;