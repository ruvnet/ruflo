/**
 * AIME Progress Dashboard Web Server
 * Real-time visualization of mission progress and agent coordination
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ProgressManagementModule } from './progress-management.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AIMEDashboardServer {
  constructor(options = {}) {
    this.port = options.port || 5173;
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.progressManager = new ProgressManagementModule({
      sessionId: options.sessionId || `dashboard_${Date.now()}`
    });
    
    this.connectedClients = new Set();
    this.setupRoutes();
    this.setupSocketHandlers();
    this.setupProgressListeners();
  }

  setupRoutes() {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'dashboard-ui')));
    this.app.use(express.json());

    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard-ui', 'index.html'));
    });

    // API endpoints
    this.app.get('/api/progress', (req, res) => {
      res.json({
        progressList: Object.fromEntries(this.progressManager.progressList),
        realtimeUpdates: Object.fromEntries(this.progressManager.realtimeUpdates),
        markdown: this.progressManager.generateMarkdownProgressList(),
        sessionId: this.progressManager.sessionId,
        timestamp: new Date().toISOString()
      });
    });

    this.app.post('/api/progress/update', (req, res) => {
      try {
        const { agentId, taskId, updateData } = req.body;
        const result = this.progressManager.updateProgress(agentId, taskId, updateData);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.post('/api/progress/initialize', (req, res) => {
      try {
        const { taskStructure } = req.body;
        const markdown = this.progressManager.initializeProgressList(taskStructure);
        res.json({ success: true, markdown });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Dashboard client connected: ${socket.id}`);
      this.connectedClients.add(socket.id);

      // Send initial data to new client
      socket.emit('initialData', {
        progressList: Object.fromEntries(this.progressManager.progressList),
        realtimeUpdates: Object.fromEntries(this.progressManager.realtimeUpdates),
        markdown: this.progressManager.generateMarkdownProgressList(),
        sessionId: this.progressManager.sessionId
      });

      socket.on('disconnect', () => {
        console.log(`🔌 Dashboard client disconnected: ${socket.id}`);
        this.connectedClients.delete(socket.id);
      });

      // Handle client requests
      socket.on('requestUpdate', () => {
        socket.emit('progressUpdate', {
          progressList: Object.fromEntries(this.progressManager.progressList),
          markdown: this.progressManager.generateMarkdownProgressList(),
          timestamp: new Date().toISOString()
        });
      });
    });
  }

  setupProgressListeners() {
    // Listen to progress manager events and broadcast to dashboard clients
    this.progressManager.on('realtimeUpdate', (data) => {
      this.io.emit('realtimeUpdate', data);
    });

    this.progressManager.on('taskCompleted', (data) => {
      this.io.emit('taskCompleted', data);
    });

    this.progressManager.on('obstacleEncountered', (data) => {
      this.io.emit('obstacleEncountered', data);
    });

    this.progressManager.on('progressListInitialized', (data) => {
      this.io.emit('progressListInitialized', data);
    });

    this.progressManager.on('syncUpdate', (data) => {
      this.io.emit('syncUpdate', data);
    });
  }

  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🚀 AIME Dashboard Server running on http://localhost:${this.port}`);
        console.log(`📊 Real-time progress tracking active`);
        console.log(`🎯 Session ID: ${this.progressManager.sessionId}`);
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('🛑 AIME Dashboard Server stopped');
        resolve();
      });
    });
  }

  // Method to inject progress updates (for testing)
  injectProgressUpdate(agentId, taskId, updateData) {
    return this.progressManager.updateProgress(agentId, taskId, updateData);
  }

  // Method to initialize with sample data (for testing)
  initializeWithSampleData() {
    const sampleTasks = {
      'research_flights': {
        title: 'Research Flight Options to Tokyo',
        description: 'Find budget-friendly flights to Tokyo for specified dates',
        priority: 'high',
        dependencies: [],
        estimatedDuration: 1800, // 30 minutes in seconds
        completionCriteria: [
          { type: 'output_exists', description: 'Flight options found' },
          { type: 'quality_threshold', threshold: 0.8, description: 'Minimum quality score' }
        ]
      },
      'research_hotels': {
        title: 'Find Budget Hotels in Tokyo',
        description: 'Research affordable accommodation options in Tokyo',
        priority: 'high',
        dependencies: ['research_flights'],
        estimatedDuration: 2400, // 40 minutes
        completionCriteria: [
          { type: 'output_exists', description: 'Hotel options found' },
          { type: 'file_created', path: './hotels.json', description: 'Hotel data file created' }
        ]
      },
      'create_itinerary': {
        title: 'Create Complete Travel Itinerary',
        description: 'Combine flight and hotel information into final itinerary',
        priority: 'medium',
        dependencies: ['research_flights', 'research_hotels'],
        estimatedDuration: 1200, // 20 minutes
        completionCriteria: [
          { type: 'file_created', path: './itinerary.pdf', description: 'Final itinerary PDF' }
        ]
      }
    };

    return this.progressManager.initializeProgressList(sampleTasks);
  }
}

export default AIMEDashboardServer;