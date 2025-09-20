/**
 * Enhanced AIME Dashboard Integration
 * 
 * Extends existing AIME dashboard with master integration capabilities
 * Provides unified view of all AIME components and real-time coordination
 * 
 * Phase 3 Integration - Backend Reliability Focus
 */

import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Enhanced Dashboard Integration Manager
 * Provides enterprise-grade dashboard capabilities for AIME
 */
export class EnhancedDashboardIntegration extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      port: options.port || 3001,
      enableWebSocket: true,
      enableMetrics: true,
      enableSecurity: true,
      updateInterval: 5000,
      ...options
    };

    this.logger = options.logger || console;
    
    // Component references
    this.progressManager = options.progressManager;
    this.dualPlanningSystem = options.dualPlanningSystem;
    this.toolBundleOrganizer = options.toolBundleOrganizer;
    this.actorFactory = options.actorFactory;

    // Server instances
    this.expressApp = null;
    this.httpServer = null;
    this.webSocketServer = null;

    // Dashboard state
    this.dashboardState = {
      initialized: false,
      connectedClients: 0,
      lastUpdate: null,
      activeComponents: {
        dualPlanning: false,
        progressTracking: false,
        actorManagement: false,
        toolOrganization: false
      }
    };

    // Real-time metrics
    this.metrics = {
      plansActive: 0,
      actorsSpawned: 0,
      toolBundlesLoaded: 0,
      progressUpdates: 0,
      responseTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      networkLatency: 0
    };

    // Circuit breaker for reliability
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      timeout: 30000,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };

    this.logger.info('📊 Enhanced AIME Dashboard Integration initialized');
  }

  /**
   * Initialize the enhanced dashboard
   */
  async initialize() {
    try {
      this.logger.info('🚀 Starting Enhanced AIME Dashboard...');

      // Setup Express application
      await this._setupExpressApp();

      // Setup WebSocket server
      if (this.options.enableWebSocket) {
        await this._setupWebSocketServer();
      }

      // Setup component integrations
      await this._setupComponentIntegrations();

      // Setup metrics collection
      if (this.options.enableMetrics) {
        await this._setupMetricsCollection();
      }

      // Setup security features
      if (this.options.enableSecurity) {
        await this._setupSecurity();
      }

      // Start the server
      await this._startServer();

      this.dashboardState.initialized = true;
      this.dashboardState.lastUpdate = new Date().toISOString();

      this.logger.info(`✅ Enhanced AIME Dashboard running on port ${this.options.port}`);

      return {
        success: true,
        port: this.options.port,
        url: `http://localhost:${this.options.port}`,
        websocket: this.options.enableWebSocket
      };

    } catch (error) {
      this.logger.error('❌ Enhanced Dashboard initialization failed:', error);
      throw error;
    }
  }

  /**
   * Setup Express application with AIME routes
   */
  async _setupExpressApp() {
    this.expressApp = express();

    // Middleware
    this.expressApp.use(express.json({ limit: '10mb' }));
    this.expressApp.use(express.urlencoded({ extended: true }));

    // CORS for development
    this.expressApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Static files for dashboard UI
    const dashboardUIPath = join(__dirname, 'dashboard-ui');
    this.expressApp.use('/ui', express.static(dashboardUIPath));

    // API Routes
    this._setupAPIRoutes();

    this.logger.info('🌐 Express application configured');
  }

  /**
   * Setup API routes for AIME dashboard
   */
  _setupAPIRoutes() {
    // Dashboard status endpoint
    this.expressApp.get('/api/status', async (req, res) => {
      try {
        const status = await this._getComprehensiveStatus();
        res.json({
          success: true,
          status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get status');
      }
    });

    // Dual planning endpoints
    this.expressApp.post('/api/plans', async (req, res) => {
      try {
        if (!this.dualPlanningSystem) {
          throw new Error('Dual Planning System not available');
        }

        const { missionObjective, options } = req.body;
        const plan = await this.dualPlanningSystem.createDualPlan(missionObjective, options);
        
        this.metrics.plansActive++;
        this._broadcastUpdate('planCreated', plan);

        res.json({
          success: true,
          plan,
          message: 'Dual plan created successfully'
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to create plan');
      }
    });

    this.expressApp.get('/api/plans/:planId', async (req, res) => {
      try {
        const { planId } = req.params;
        const planStatus = await this._getPlanStatus(planId);
        
        res.json({
          success: true,
          status: planStatus
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get plan status');
      }
    });

    // Actor management endpoints
    this.expressApp.post('/api/actors', async (req, res) => {
      try {
        if (!this.actorFactory) {
          throw new Error('Actor Factory not available');
        }

        const actorSpec = req.body;
        const result = await this.actorFactory.createDynamicActor(actorSpec);
        
        this.metrics.actorsSpawned++;
        this._broadcastUpdate('actorCreated', result);

        res.json(result);
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to create actor');
      }
    });

    this.expressApp.get('/api/actors', async (req, res) => {
      try {
        const actors = await this._getActiveActors();
        res.json({
          success: true,
          actors
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get actors');
      }
    });

    // Tool bundle endpoints
    this.expressApp.get('/api/tool-bundles', async (req, res) => {
      try {
        if (!this.toolBundleOrganizer) {
          throw new Error('Tool Bundle Organizer not available');
        }

        const bundles = Array.from(this.toolBundleOrganizer.bundles.entries()).map(([id, bundle]) => ({
          id,
          name: bundle.name,
          category: bundle.category,
          toolCount: bundle.tools.length,
          loadingStrategy: bundle.loadingStrategy,
          priority: bundle.priority
        }));

        res.json({
          success: true,
          bundles
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get tool bundles');
      }
    });

    // Progress tracking endpoints
    this.expressApp.get('/api/progress/:missionId', async (req, res) => {
      try {
        if (!this.progressManager) {
          throw new Error('Progress Manager not available');
        }

        const { missionId } = req.params;
        const progress = await this.progressManager.getMissionProgress(missionId);
        
        res.json({
          success: true,
          progress
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get progress');
      }
    });

    // Metrics endpoint
    this.expressApp.get('/api/metrics', async (req, res) => {
      try {
        const metrics = await this._getEnhancedMetrics();
        res.json({
          success: true,
          metrics
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Failed to get metrics');
      }
    });

    // Health check endpoint
    this.expressApp.get('/api/health', async (req, res) => {
      try {
        const health = await this._performHealthCheck();
        res.json({
          success: true,
          health,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this._handleAPIError(res, error, 'Health check failed');
      }
    });

    // Dashboard UI route
    this.expressApp.get('/', (req, res) => {
      res.redirect('/ui');
    });

    this.logger.info('🛣️ API routes configured');
  }

  /**
   * Setup WebSocket server for real-time updates
   */
  async _setupWebSocketServer() {
    this.webSocketClients = new Set();

    // WebSocket setup will be completed when HTTP server starts
    this.logger.info('🔌 WebSocket server prepared');
  }

  /**
   * Setup component integrations
   */
  async _setupComponentIntegrations() {
    // Progress Manager integration
    if (this.progressManager) {
      this.progressManager.on('progressUpdate', (data) => {
        this.metrics.progressUpdates++;
        this._broadcastUpdate('progressUpdate', data);
      });
      this.dashboardState.activeComponents.progressTracking = true;
    }

    // Dual Planning System integration
    if (this.dualPlanningSystem) {
      this.dualPlanningSystem.on('planCreated', (plan) => {
        this._broadcastUpdate('planCreated', plan);
      });
      this.dualPlanningSystem.on('planUpdated', (plan) => {
        this._broadcastUpdate('planUpdated', plan);
      });
      this.dashboardState.activeComponents.dualPlanning = true;
    }

    // Actor Factory integration
    if (this.actorFactory) {
      this.actorFactory.on('actorCreated', (actor) => {
        this._broadcastUpdate('actorCreated', actor);
      });
      this.dashboardState.activeComponents.actorManagement = true;
    }

    // Tool Bundle Organizer integration
    if (this.toolBundleOrganizer) {
      this.dashboardState.activeComponents.toolOrganization = true;
    }

    this.logger.info('🔗 Component integrations configured');
  }

  /**
   * Setup metrics collection
   */
  async _setupMetricsCollection() {
    // Collect metrics every update interval
    this.metricsInterval = setInterval(async () => {
      try {
        await this._collectMetrics();
        this._broadcastUpdate('metricsUpdate', this.metrics);
      } catch (error) {
        this.logger.error('❌ Metrics collection failed:', error);
      }
    }, this.options.updateInterval);

    this.logger.info('📊 Metrics collection configured');
  }

  /**
   * Setup security features
   */
  async _setupSecurity() {
    // Rate limiting
    const rateLimit = {};
    
    this.expressApp.use((req, res, next) => {
      const clientIP = req.ip;
      const now = Date.now();
      
      if (!rateLimit[clientIP]) {
        rateLimit[clientIP] = [];
      }
      
      // Clean old requests (older than 1 minute)
      rateLimit[clientIP] = rateLimit[clientIP].filter(time => now - time < 60000);
      
      // Check rate limit (max 100 requests per minute)
      if (rateLimit[clientIP].length >= 100) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded'
        });
      }
      
      rateLimit[clientIP].push(now);
      next();
    });

    // Request size limiting
    this.expressApp.use((req, res, next) => {
      if (req.method === 'POST' && req.get('Content-Length') > 10 * 1024 * 1024) {
        return res.status(413).json({
          success: false,
          error: 'Request too large'
        });
      }
      next();
    });

    this.logger.info('🛡️ Security features configured');
  }

  /**
   * Start the HTTP server
   */
  async _startServer() {
    return new Promise((resolve, reject) => {
      this.httpServer = this.expressApp.listen(this.options.port, (error) => {
        if (error) {
          reject(error);
          return;
        }

        // Setup WebSocket server on HTTP server
        if (this.options.enableWebSocket) {
          this.webSocketServer = new WebSocketServer({ 
            server: this.httpServer,
            path: '/ws'
          });

          this.webSocketServer.on('connection', (ws, req) => {
            this.dashboardState.connectedClients++;
            this.webSocketClients.add(ws);

            ws.on('close', () => {
              this.dashboardState.connectedClients--;
              this.webSocketClients.delete(ws);
            });

            ws.on('error', (error) => {
              this.logger.error('WebSocket error:', error);
              this.webSocketClients.delete(ws);
            });

            // Send initial state
            ws.send(JSON.stringify({
              type: 'initial',
              data: {
                status: this.dashboardState,
                metrics: this.metrics
              }
            }));
          });
        }

        this.logger.info(`🌐 HTTP server listening on port ${this.options.port}`);
        resolve();
      });

      this.httpServer.on('error', (error) => {
        this.logger.error('HTTP server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Broadcast update to all WebSocket clients
   */
  _broadcastUpdate(type, data) {
    if (!this.webSocketClients || this.webSocketClients.size === 0) {
      return;
    }

    const message = JSON.stringify({
      type,
      data,
      timestamp: new Date().toISOString()
    });

    this.webSocketClients.forEach((ws) => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
        }
      } catch (error) {
        this.logger.error('WebSocket broadcast error:', error);
        this.webSocketClients.delete(ws);
      }
    });
  }

  /**
   * Collect performance metrics
   */
  async _collectMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024; // MB
    this.metrics.cpuUsage = (cpuUsage.user + cpuUsage.system) / 1000; // ms

    // Update component-specific metrics
    if (this.progressManager) {
      this.metrics.progressUpdates = this.progressManager.getUpdateCount?.() || this.metrics.progressUpdates;
    }

    if (this.toolBundleOrganizer) {
      this.metrics.toolBundlesLoaded = this.toolBundleOrganizer.bundles.size;
    }
  }

  /**
   * Get comprehensive status
   */
  async _getComprehensiveStatus() {
    return {
      dashboard: this.dashboardState,
      components: this.dashboardState.activeComponents,
      metrics: this.metrics,
      health: await this._performHealthCheck(),
      circuitBreaker: this.circuitBreaker
    };
  }

  /**
   * Perform health check
   */
  async _performHealthCheck() {
    const health = {
      overall: 'healthy',
      components: {},
      issues: []
    };

    try {
      // Check Progress Manager
      if (this.progressManager) {
        health.components.progressManager = 'healthy';
      } else {
        health.components.progressManager = 'unavailable';
        health.issues.push('Progress Manager not available');
      }

      // Check Dual Planning System
      if (this.dualPlanningSystem) {
        health.components.dualPlanningSystem = 'healthy';
      } else {
        health.components.dualPlanningSystem = 'unavailable';
        health.issues.push('Dual Planning System not available');
      }

      // Check Actor Factory
      if (this.actorFactory) {
        health.components.actorFactory = 'healthy';
      } else {
        health.components.actorFactory = 'unavailable';
        health.issues.push('Actor Factory not available');
      }

      // Check Tool Bundle Organizer
      if (this.toolBundleOrganizer) {
        health.components.toolBundleOrganizer = 'healthy';
      } else {
        health.components.toolBundleOrganizer = 'unavailable';
        health.issues.push('Tool Bundle Organizer not available');
      }

      // Check circuit breaker
      if (this.circuitBreaker.state === 'OPEN') {
        health.overall = 'degraded';
        health.issues.push('Circuit breaker is open');
      }

      // Check memory usage
      if (this.metrics.memoryUsage > 1000) { // > 1GB
        health.overall = 'warning';
        health.issues.push('High memory usage detected');
      }

      // Overall health assessment
      if (health.issues.length > 2) {
        health.overall = 'unhealthy';
      } else if (health.issues.length > 0) {
        health.overall = 'warning';
      }

    } catch (error) {
      health.overall = 'error';
      health.issues.push(`Health check failed: ${error.message}`);
    }

    return health;
  }

  /**
   * Handle API errors with circuit breaker pattern
   */
  _handleAPIError(res, error, message) {
    this.circuitBreaker.failures++;
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      setTimeout(() => {
        this.circuitBreaker.state = 'HALF_OPEN';
        this.circuitBreaker.failures = 0;
      }, this.circuitBreaker.timeout);
    }

    this.logger.error(`❌ API Error: ${message}`, error);
    
    res.status(500).json({
      success: false,
      error: message,
      details: error.message,
      circuitBreaker: this.circuitBreaker.state
    });
  }

  /**
   * Get enhanced metrics
   */
  async _getEnhancedMetrics() {
    return {
      ...this.metrics,
      dashboard: {
        connectedClients: this.dashboardState.connectedClients,
        uptime: Date.now() - (this.startTime || Date.now()),
        requestCount: this.requestCount || 0
      },
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime()
      }
    };
  }

  /**
   * Get plan status
   */
  async _getPlanStatus(planId) {
    // Implementation would retrieve actual plan status
    // For now, return mock data
    return {
      planId,
      status: 'in_progress',
      progress: 45,
      phases: {
        total: 4,
        completed: 1,
        inProgress: 1,
        pending: 2
      },
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Get active actors
   */
  async _getActiveActors() {
    if (this.actorFactory && this.actorFactory.getActiveActors) {
      return await this.actorFactory.getActiveActors();
    }
    return [];
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.logger.info('🧹 Cleaning up Enhanced Dashboard Integration...');

    try {
      // Clear intervals
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }

      // Close WebSocket connections
      if (this.webSocketClients) {
        this.webSocketClients.forEach(ws => {
          try {
            ws.close();
          } catch (error) {
            // Ignore close errors
          }
        });
        this.webSocketClients.clear();
      }

      // Close WebSocket server
      if (this.webSocketServer) {
        this.webSocketServer.close();
      }

      // Close HTTP server
      if (this.httpServer) {
        await new Promise((resolve) => {
          this.httpServer.close(resolve);
        });
      }

      // Remove event listeners
      this.removeAllListeners();

      this.logger.info('✅ Enhanced Dashboard Integration cleanup complete');

    } catch (error) {
      this.logger.error('❌ Dashboard cleanup failed:', error);
    }
  }
}

export default EnhancedDashboardIntegration;