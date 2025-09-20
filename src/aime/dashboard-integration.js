/**
 * AIME Dashboard Integration
 * Seamlessly integrates AIME progress management with existing MCP observability dashboard
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ProgressManagementModule } from './progress-management.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class AIMEDashboardIntegration {
  constructor(options = {}) {
    this.port = options.port || 3001;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.progressManager = new ProgressManagementModule({
      sessionId: `aime_${Date.now()}`,
      persistPath: join(dirname(__dirname), 'aime_dashboard_data')
    });
    
    this.activeConnections = new Set();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupProgressIntegration();
  }

  setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.static('public'));

    // API endpoint to get current AIME status
    this.app.get('/api/aime/status', (req, res) => {
      const statusCounts = this.progressManager.getStatusCounts();
      const recentUpdates = this.getRecentUpdates();
      
      res.json({
        success: true,
        data: {
          overview: statusCounts,
          recentUpdates,
          activeOperations: this.getActiveOperations(),
          completedTasks: this.getCompletedTasks(),
          missionObjectives: this.getMissionObjectives(),
          timestamp: new Date().toISOString()
        }
      });
    });

    // API endpoint to update progress
    this.app.post('/api/aime/progress', (req, res) => {
      try {
        const { agentId, taskId, updateData } = req.body;
        const result = this.progressManager.updateProgress(agentId, taskId, updateData);
        
        // Broadcast to all connected dashboards
        this.io.emit('progressUpdate', {
          taskId,
          agentId,
          updateData,
          result,
          timestamp: new Date().toISOString()
        });
        
        res.json(result);
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // API endpoint to initialize new task structure
    this.app.post('/api/aime/initialize', (req, res) => {
      try {
        const { taskStructure } = req.body;
        const markdown = this.progressManager.initializeProgressList(taskStructure);
        
        this.io.emit('progressListInitialized', {
          taskStructure,
          markdown,
          timestamp: new Date().toISOString()
        });
        
        res.json({
          success: true,
          markdown,
          taskCount: Object.keys(taskStructure).length
        });
      } catch (error) {
        res.status(400).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        service: 'AIME Dashboard Integration',
        connections: this.activeConnections.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      // Use stderr to prevent JSON-RPC interference
      console.error(`🔗 Dashboard connected: ${socket.id}`);
      this.activeConnections.add(socket);

      // Send current state immediately upon connection
      socket.emit('initialState', {
        overview: this.progressManager.getStatusCounts(),
        activeOperations: this.getActiveOperations(),
        completedTasks: this.getCompletedTasks(),
        missionObjectives: this.getMissionObjectives()
      });

      socket.on('disconnect', () => {
        // Use stderr to prevent JSON-RPC interference
        console.error(`🔌 Dashboard disconnected: ${socket.id}`);
        this.activeConnections.delete(socket);
      });

      // Handle real-time progress requests
      socket.on('requestProgress', (data) => {
        socket.emit('progressData', {
          progressList: this.progressManager.generateMarkdownProgressList(),
          timestamp: new Date().toISOString()
        });
      });

      // Handle mission control commands
      socket.on('missionCommand', (data) => {
        this.handleMissionCommand(data, socket);
      });
    });
  }

  setupProgressIntegration() {
    // Listen to progress manager events and broadcast to dashboards
    this.progressManager.on('realtimeUpdate', (data) => {
      this.io.emit('progressUpdate', {
        ...data,
        activeOperations: this.getActiveOperations(),
        completedTasks: this.getCompletedTasks(),
        missionObjectives: this.getMissionObjectives()
      });
    });

    this.progressManager.on('taskCompleted', (data) => {
      this.io.emit('taskCompleted', {
        ...data,
        completionReport: this.progressManager.generateConclusionReport(
          data.taskId, 
          data.agentId, 
          data.completionData
        )
      });
    });

    this.progressManager.on('obstacleEncountered', (data) => {
      this.io.emit('obstacleAlert', data);
    });

    this.progressManager.on('progressListInitialized', (data) => {
      this.io.emit('missionInitialized', data);
    });
  }

  getActiveOperations() {
    const tasks = Array.from(this.progressManager.progressList.values())
      .filter(task => task.status === 'in_progress' || task.status === 'pending')
      .map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        progress: task.progressPercentage,
        agent: task.assignedAgent,
        priority: task.priority,
        dependencies: task.dependencies.length,
        estimatedDuration: task.estimatedDuration
      }));
    
    return tasks.sort((a, b) => {
      if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
      if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return 0;
    });
  }

  getCompletedTasks() {
    const tasks = Array.from(this.progressManager.progressList.values())
      .filter(task => task.status === 'completed')
      .map(task => ({
        id: task.id,
        title: task.title,
        duration: this.progressManager.calculateTaskDuration(task.id),
        completedAt: task.actualEndTime,
        agent: task.assignedAgent,
        efficiency: this.progressManager.calculateEfficiency(task.id)
      }));
    
    return tasks
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 10); // Show last 10 completed tasks
  }

  getMissionObjectives() {
    const statusCounts = this.progressManager.getStatusCounts();
    const totalTasks = statusCounts.total;
    const completedTasks = statusCounts.completed;
    const inProgressTasks = statusCounts.in_progress;
    
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    
    return {
      aimiIntegration: {
        status: completionPercentage >= 75 ? 'operational' : completionPercentage >= 50 ? 'warning' : 'pending',
        percentage: completionPercentage,
        label: `${completionPercentage}% Complete`
      },
      realtimeProgress: {
        status: inProgressTasks > 0 ? 'operational' : 'idle',
        label: inProgressTasks > 0 ? 'Operational' : 'Idle',
        activeTasks: inProgressTasks
      },
      dynamicActors: {
        status: this.hasActiveDynamicActors() ? 'operational' : 'pending',
        label: this.hasActiveDynamicActors() ? 'Active' : 'Pending',
        count: this.getActiveDynamicActorCount()
      }
    };
  }

  getRecentUpdates(limit = 20) {
    return Array.from(this.progressManager.realtimeUpdates.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
      .map(update => ({
        taskId: update.taskId,
        agentId: update.agentId,
        type: update.updateType,
        message: update.message,
        timestamp: update.timestamp,
        status: update.status
      }));
  }

  hasActiveDynamicActors() {
    return Array.from(this.progressManager.progressList.values())
      .some(task => task.assignedAgent && task.status === 'in_progress');
  }

  getActiveDynamicActorCount() {
    const uniqueAgents = new Set(
      Array.from(this.progressManager.progressList.values())
        .filter(task => task.assignedAgent && task.status === 'in_progress')
        .map(task => task.assignedAgent)
    );
    return uniqueAgents.size;
  }

  handleMissionCommand(data, socket) {
    const { command, payload } = data;
    
    try {
      switch (command) {
        case 'pauseTask':
          this.pauseTask(payload.taskId, socket.id);
          break;
        case 'resumeTask':
          this.resumeTask(payload.taskId, socket.id);
          break;
        case 'prioritizeTask':
          this.prioritizeTask(payload.taskId, payload.priority, socket.id);
          break;
        case 'reassignTask':
          this.reassignTask(payload.taskId, payload.agentId, socket.id);
          break;
        default:
          socket.emit('commandError', { 
            error: `Unknown command: ${command}` 
          });
      }
    } catch (error) {
      socket.emit('commandError', { 
        error: error.message,
        command,
        payload 
      });
    }
  }

  pauseTask(taskId, socketId) {
    const task = this.progressManager.progressList.get(taskId);
    if (task && task.status === 'in_progress') {
      task.status = 'blocked';
      task.updatedAt = new Date().toISOString();
      
      this.io.emit('taskPaused', { 
        taskId, 
        pausedBy: socketId,
        timestamp: new Date().toISOString()
      });
    }
  }

  resumeTask(taskId, socketId) {
    const task = this.progressManager.progressList.get(taskId);
    if (task && task.status === 'blocked') {
      task.status = 'in_progress';
      task.updatedAt = new Date().toISOString();
      
      this.io.emit('taskResumed', { 
        taskId, 
        resumedBy: socketId,
        timestamp: new Date().toISOString()
      });
    }
  }

  prioritizeTask(taskId, newPriority, socketId) {
    const task = this.progressManager.progressList.get(taskId);
    if (task) {
      const oldPriority = task.priority;
      task.priority = newPriority;
      task.updatedAt = new Date().toISOString();
      
      this.io.emit('taskPrioritized', { 
        taskId, 
        oldPriority,
        newPriority,
        prioritizedBy: socketId,
        timestamp: new Date().toISOString()
      });
    }
  }

  reassignTask(taskId, newAgentId, socketId) {
    const task = this.progressManager.progressList.get(taskId);
    if (task) {
      const oldAgent = task.assignedAgent;
      task.assignedAgent = newAgentId;
      task.updatedAt = new Date().toISOString();
      
      this.io.emit('taskReassigned', { 
        taskId, 
        oldAgent,
        newAgent: newAgentId,
        reassignedBy: socketId,
        timestamp: new Date().toISOString()
      });
    }
  }

  async initialize() {
    try {
      // Initialize sample data for demonstration
      await this.initializeSampleData();
      // Use stderr to prevent JSON-RPC interference
      console.error('📊 AIME Dashboard Integration initialized');
    } catch (error) {
      // Already using stderr for errors - keep as is
      console.error('❌ Failed to initialize AIME Dashboard Integration:', error);
      throw error;
    }
  }

  async start() {
    try {
      // Initialize sample data for demonstration
      await this.initializeSampleData();
      
      this.server.listen(this.port, () => {
        // Use stderr to prevent JSON-RPC interference
        console.error(`🎯 AIME Dashboard Integration running on port ${this.port}`);
        // Use stderr to prevent JSON-RPC interference
        console.error(`📊 Dashboard integration: http://localhost:${this.port}`);
        // Use stderr to prevent JSON-RPC interference
        console.error(`🔗 Socket.IO connections: 0`);
        // Use stderr to prevent JSON-RPC interference
        console.error(`✨ Ready to integrate with existing MCP observability dashboard`);
      });
    } catch (error) {
      // Already using stderr for errors - keep as is
      console.error('❌ Failed to start AIME Dashboard Integration:', error);
    }
  }

  async initializeSampleData() {
    // Initialize with our current AIME implementation phases
    const sampleTaskStructure = {
      'phase1_progress': {
        title: 'Phase 1: Enhanced Progress Management',
        description: 'Create real-time progress system with centralized state management',
        priority: 'high',
        dependencies: [],
        subtasks: ['phase1_1_update_tool', 'phase1_2_dashboard', 'phase1_3_memory_sync'],
        completionCriteria: [
          { type: 'output_exists', description: 'Progress management module created' },
          { type: 'output_exists', description: 'UpdateProgress tool implemented' },
          { type: 'output_exists', description: 'Dashboard integration complete' }
        ],
        estimatedDuration: 14400000, // 4 hours in milliseconds
        contextData: { phase: 1, type: 'infrastructure' }
      },
      'phase1_1_update_tool': {
        title: 'UpdateProgress Tool Implementation',
        description: 'Core tool for Dynamic Actors to report real-time status',
        priority: 'high',
        dependencies: [],
        completionCriteria: [
          { type: 'file_created', path: '/Users/marc/Documents/Cline/MCP/claude-flow-mcp/src/aime/update-progress-tool.js' }
        ],
        estimatedDuration: 9000000, // 2.5 hours
        contextData: { phase: 1, subphase: 1, type: 'tool' }
      },
      'phase1_2_dashboard': {
        title: 'Dashboard Integration',
        description: 'Integrate AIME features into existing MCP observability dashboard',
        priority: 'high',
        dependencies: ['phase1_1_update_tool'],
        completionCriteria: [
          { type: 'output_exists', description: 'Dashboard updated with AIME section' }
        ],
        estimatedDuration: 7200000, // 2 hours
        contextData: { phase: 1, subphase: 2, type: 'integration' }
      },
      'phase2_factory': {
        title: 'Phase 2: Dynamic Actor Factory',
        description: 'On-demand agent creation with specialized tool bundles',
        priority: 'high',
        dependencies: ['phase1_progress'],
        subtasks: ['phase2_1_bundles', 'phase2_2_personas', 'phase2_3_orchestration'],
        completionCriteria: [
          { type: 'output_exists', description: 'Actor factory implemented' }
        ],
        estimatedDuration: 18000000, // 5 hours
        contextData: { phase: 2, type: 'architecture' }
      },
      'phase3_planner': {
        title: 'Phase 3: Reactive Dynamic Planner',
        description: 'Dual strategic/tactical output system with real-time adaptation',
        priority: 'high',
        dependencies: ['phase2_factory'],
        subtasks: ['phase3_1_dual_output', 'phase3_2_adaptation', 'phase3_3_recovery'],
        completionCriteria: [
          { type: 'output_exists', description: 'Dynamic planner implemented' }
        ],
        estimatedDuration: 21600000, // 6 hours
        contextData: { phase: 3, type: 'intelligence' }
      }
    };

    this.progressManager.initializeProgressList(sampleTaskStructure);

    // Mark some tasks as completed
    this.progressManager.updateProgress('system', 'phase1_1_update_tool', {
      status: 'completed',
      progressPercentage: 100,
      type: 'completion',
      message: 'UpdateProgress tool successfully implemented with full validation',
      outputs: ['update-progress-tool.js'],
      filePaths: ['/Users/marc/Documents/Cline/MCP/claude-flow-mcp/src/aime/update-progress-tool.js'],
      qualityScore: 95,
      resourceUtilization: 85,
      outcome: 'Tool created and ready for Dynamic Actor integration',
      insights: ['Real-time progress reporting enables continuous coordination', 'Event-driven architecture supports scalable progress tracking']
    });

    // Set current task as in progress
    this.progressManager.updateProgress('aime-integrator', 'phase1_2_dashboard', {
      status: 'in_progress',
      progressPercentage: 85,
      type: 'progress',
      message: 'Dashboard integration nearly complete - AIME section added successfully',
      artifacts: ['enhanced-dashboard.html', 'socket-integration.js'],
      contextData: { integrationMethod: 'existing-dashboard-enhancement' }
    });
  }

  async stop() {
    // Use stderr to prevent JSON-RPC interference
    console.error('🛑 Shutting down AIME Dashboard Integration...');
    this.server.close();
    this.activeConnections.clear();
  }
}

export default AIMEDashboardIntegration;