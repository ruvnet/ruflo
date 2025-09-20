/**
 * Workflow Coordinator - MCP Server Lifecycle Management
 * 
 * This module manages the lifecycle of MCP servers used in design cloning workflows:
 * - Dynamic MCP server spawning and shutdown
 * - Health monitoring and recovery
 * - Resource optimization and load balancing
 * - Connection pooling and caching
 * - Performance monitoring and bottleneck detection
 */

import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../core/logger.js';
import { MCPError } from '../utils/errors.js';

/**
 * MCP Server States
 */
export const ServerState = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  ERROR: 'error',
  RECOVERY: 'recovery'
};

/**
 * MCP Server Configuration
 */
export const MCP_SERVER_CONFIGS = {
  'website-scraper-mcp': {
    name: 'website-scraper-mcp',
    executable: 'python3',
    script: '/Users/marc/Documents/Cline/MCP/website-scraper-mcp/server.py',
    args: [],
    env: { PYTHONPATH: '/Users/marc/Documents/Cline/MCP/website-scraper-mcp' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 512,
    maxCpuPercent: 50,
    priority: 'high',
    autoRestart: true,
    dependencies: ['beautifulsoup4', 'selenium', 'requests']
  },
  'image-gen-mcp': {
    name: 'image-gen-mcp',
    executable: 'python3',
    script: '/Users/marc/Documents/Cline/MCP/image-gen-mcp/server.py',
    args: [],
    env: { PYTHONPATH: '/Users/marc/Documents/Cline/MCP/image-gen-mcp' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 1024,
    maxCpuPercent: 80,
    priority: 'high',
    autoRestart: true,
    dependencies: ['torch', 'diffusers', 'transformers']
  },
  'design-analysis-mcp': {
    name: 'design-analysis-mcp',
    executable: 'python3',
    script: '/Users/marc/Documents/Cline/MCP/design-analysis-mcp/server.py',
    args: [],
    env: { PYTHONPATH: '/Users/marc/Documents/Cline/MCP/design-analysis-mcp' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 768,
    maxCpuPercent: 60,
    priority: 'high',
    autoRestart: true,
    dependencies: ['opencv-python', 'pillow', 'transformers']
  },
  'code-structure-mcp': {
    name: 'code-structure-mcp',
    executable: 'node',
    script: '/Users/marc/Documents/Cline/MCP/code-structure-mcp/server.js',
    args: [],
    env: { NODE_PATH: '/Users/marc/Documents/Cline/MCP/code-structure-mcp/node_modules' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 256,
    maxCpuPercent: 30,
    priority: 'medium',
    autoRestart: true,
    dependencies: ['@babel/parser', 'typescript', 'prettier']
  },
  'asset-manager-mcp': {
    name: 'asset-manager-mcp',
    executable: 'node',
    script: '/Users/marc/Documents/Cline/MCP/asset-manager-mcp/server.js',
    args: [],
    env: { NODE_PATH: '/Users/marc/Documents/Cline/MCP/asset-manager-mcp/node_modules' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 256,
    maxCpuPercent: 40,
    priority: 'medium',
    autoRestart: true,
    dependencies: ['sharp', 'fs-extra', 'mime-types']
  },
  'browser-extension-mcp': {
    name: 'browser-extension-mcp',
    executable: 'node',
    script: '/Users/marc/Documents/Cline/MCP/browser-extension-mcp/server.js',
    args: [],
    env: { NODE_PATH: '/Users/marc/Documents/Cline/MCP/browser-extension-mcp/node_modules' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 512,
    maxCpuPercent: 50,
    priority: 'medium',
    autoRestart: true,
    dependencies: ['puppeteer', 'playwright', 'chrome-launcher']
  },
  'enhanced-memory-mcp': {
    name: 'enhanced-memory-mcp',
    executable: 'python3',
    script: '/Users/marc/Documents/Cline/MCP/enhanced-memory-mcp/server.py',
    args: [],
    env: { PYTHONPATH: '/Users/marc/Documents/Cline/MCP/enhanced-memory-mcp' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 384,
    maxCpuPercent: 30,
    priority: 'high',
    autoRestart: true,
    dependencies: ['sqlite3', 'numpy', 'scikit-learn']
  },
  'component-library-mcp': {
    name: 'component-library-mcp',
    executable: 'node',
    script: '/Users/marc/Documents/Cline/MCP/component-library-mcp/server.js',
    args: [],
    env: { NODE_PATH: '/Users/marc/Documents/Cline/MCP/component-library-mcp/node_modules' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 384,
    maxCpuPercent: 40,
    priority: 'high',
    autoRestart: true,
    dependencies: ['react', 'typescript', '@storybook/react']
  },
  'project-generator-mcp': {
    name: 'project-generator-mcp',
    executable: 'node',
    script: '/Users/marc/Documents/Cline/MCP/project-generator-mcp/server.js',
    args: [],
    env: { NODE_PATH: '/Users/marc/Documents/Cline/MCP/project-generator-mcp/node_modules' },
    healthCheckEndpoint: '/health',
    maxMemoryMB: 256,
    maxCpuPercent: 30,
    priority: 'medium',
    autoRestart: true,
    dependencies: ['next', 'react', 'typescript']
  }
};

/**
 * MCP Server Instance
 */
class MCPServerInstance {
  constructor(config, coordinator) {
    this.config = config;
    this.coordinator = coordinator;
    this.logger = coordinator.logger;
    
    this.process = null;
    this.state = ServerState.STOPPED;
    this.pid = null;
    this.port = null;
    this.startTime = null;
    this.restartCount = 0;
    this.lastHealthCheck = null;
    this.healthCheckFailures = 0;
    
    // Performance metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      totalResponseTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      uptime: 0
    };
    
    // Connection pool
    this.connections = new Map();
    this.maxConnections = 10;
    this.activeConnections = 0;
    
    this.logger.debug('MCP Server instance created', { name: this.config.name });
  }

  /**
   * Start the MCP server
   */
  async start() {
    if (this.state === ServerState.RUNNING) {
      this.logger.warn('MCP Server already running', { name: this.config.name });
      return;
    }

    this.logger.info('Starting MCP Server', { name: this.config.name });
    this.state = ServerState.STARTING;

    try {
      // Check if script exists
      await this.validateServerScript();

      // Assign port
      this.port = await this.coordinator.getAvailablePort();

      // Start process
      this.process = spawn(this.config.executable, [
        this.config.script,
        '--port', this.port.toString(),
        ...this.config.args
      ], {
        env: { 
          ...process.env, 
          ...this.config.env,
          MCP_SERVER_PORT: this.port.toString()
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.pid = this.process.pid;
      this.startTime = Date.now();

      // Setup process event handlers
      this.setupProcessHandlers();

      // Wait for server to be ready
      await this.waitForServerReady();

      this.state = ServerState.RUNNING;
      this.logger.info('MCP Server started successfully', { 
        name: this.config.name, 
        pid: this.pid, 
        port: this.port 
      });

      this.coordinator.emit('serverStarted', this);

    } catch (error) {
      this.state = ServerState.ERROR;
      this.logger.error('Failed to start MCP Server', { 
        name: this.config.name, 
        error: error.message 
      });
      
      this.coordinator.emit('serverStartFailed', this, error);
      throw new MCPError(`Failed to start MCP server ${this.config.name}: ${error.message}`);
    }
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    if (this.state === ServerState.STOPPED) {
      return;
    }

    this.logger.info('Stopping MCP Server', { name: this.config.name, pid: this.pid });
    this.state = ServerState.STOPPING;

    try {
      if (this.process) {
        // Close all connections gracefully
        await this.closeAllConnections();

        // Send SIGTERM first
        this.process.kill('SIGTERM');

        // Wait for graceful shutdown
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            // Force kill if not stopped gracefully
            if (this.process && !this.process.killed) {
              this.process.kill('SIGKILL');
            }
            resolve();
          }, 5000);

          this.process.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }

      this.process = null;
      this.pid = null;
      this.port = null;
      this.state = ServerState.STOPPED;

      this.logger.info('MCP Server stopped', { name: this.config.name });
      this.coordinator.emit('serverStopped', this);

    } catch (error) {
      this.logger.error('Error stopping MCP Server', { 
        name: this.config.name, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Restart the MCP server
   */
  async restart() {
    this.logger.info('Restarting MCP Server', { name: this.config.name });
    
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    await this.start();
    
    this.restartCount++;
    this.coordinator.emit('serverRestarted', this);
  }

  /**
   * Validate server script exists
   */
  async validateServerScript() {
    try {
      await fs.access(this.config.script);
    } catch (error) {
      throw new Error(`Server script not found: ${this.config.script}`);
    }
  }

  /**
   * Setup process event handlers
   */
  setupProcessHandlers() {
    this.process.on('exit', (code, signal) => {
      this.logger.info('MCP Server process exited', { 
        name: this.config.name, 
        code, 
        signal,
        pid: this.pid
      });

      this.state = ServerState.STOPPED;
      this.process = null;
      this.pid = null;

      // Auto-restart if configured and not a normal shutdown
      if (this.config.autoRestart && code !== 0 && this.restartCount < 3) {
        this.logger.info('Auto-restarting MCP Server', { name: this.config.name });
        setTimeout(() => this.start().catch(error => {
          this.logger.error('Auto-restart failed', { name: this.config.name, error });
        }), 5000);
      }

      this.coordinator.emit('serverExited', this, code, signal);
    });

    this.process.on('error', (error) => {
      this.logger.error('MCP Server process error', { 
        name: this.config.name, 
        error: error.message 
      });
      this.state = ServerState.ERROR;
      this.coordinator.emit('serverError', this, error);
    });

    // Log stdout/stderr for debugging
    this.process.stdout.on('data', (data) => {
      this.logger.debug('MCP Server stdout', { 
        name: this.config.name, 
        data: data.toString().trim() 
      });
    });

    this.process.stderr.on('data', (data) => {
      this.logger.debug('MCP Server stderr', { 
        name: this.config.name, 
        data: data.toString().trim() 
      });
    });
  }

  /**
   * Wait for server to be ready
   */
  async waitForServerReady(maxAttempts = 30) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try to connect to health endpoint
        const response = await fetch(`http://localhost:${this.port}${this.config.healthCheckEndpoint}`, {
          method: 'GET',
          timeout: 2000
        });

        if (response.ok) {
          this.lastHealthCheck = Date.now();
          this.healthCheckFailures = 0;
          return;
        }
      } catch (error) {
        this.logger.debug('Health check failed, retrying...', { 
          name: this.config.name, 
          attempt, 
          error: error.message 
        });
      }
    }

    throw new Error(`Server failed to become ready after ${maxAttempts} attempts`);
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    if (this.state !== ServerState.RUNNING) {
      return false;
    }

    try {
      const response = await fetch(`http://localhost:${this.port}${this.config.healthCheckEndpoint}`, {
        method: 'GET',
        timeout: 3000
      });

      if (response.ok) {
        this.lastHealthCheck = Date.now();
        this.healthCheckFailures = 0;
        
        // Update metrics if health endpoint provides them
        const healthData = await response.json().catch(() => ({}));
        this.updateMetricsFromHealth(healthData);
        
        return true;
      } else {
        this.healthCheckFailures++;
        return false;
      }
    } catch (error) {
      this.healthCheckFailures++;
      this.logger.debug('Health check failed', { 
        name: this.config.name, 
        error: error.message,
        failures: this.healthCheckFailures
      });
      return false;
    }
  }

  /**
   * Update metrics from health check data
   */
  updateMetricsFromHealth(healthData) {
    if (healthData.memory) {
      this.metrics.memoryUsage = healthData.memory;
    }
    if (healthData.cpu) {
      this.metrics.cpuUsage = healthData.cpu;
    }
    if (this.startTime) {
      this.metrics.uptime = Date.now() - this.startTime;
    }
  }

  /**
   * Close all connections
   */
  async closeAllConnections() {
    const closePromises = Array.from(this.connections.values()).map(connection => {
      return new Promise(resolve => {
        connection.close();
        connection.once('close', resolve);
        setTimeout(resolve, 1000); // Force close after 1 second
      });
    });

    await Promise.all(closePromises);
    this.connections.clear();
    this.activeConnections = 0;
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      name: this.config.name,
      state: this.state,
      pid: this.pid,
      port: this.port,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      restartCount: this.restartCount,
      lastHealthCheck: this.lastHealthCheck,
      healthCheckFailures: this.healthCheckFailures,
      metrics: { ...this.metrics },
      connections: {
        active: this.activeConnections,
        max: this.maxConnections,
        total: this.connections.size
      }
    };
  }
}

/**
 * Workflow Coordinator - Main class
 */
export class WorkflowCoordinator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = options.logger || createLogger('WorkflowCoordinator');
    this.servers = new Map();
    this.portRange = { min: 8000, max: 9000 };
    this.usedPorts = new Set();
    
    // Health monitoring
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    this.healthCheckTimer = null;
    
    // Performance monitoring
    this.performanceMetrics = {
      totalServersStarted: 0,
      totalServersRestarted: 0,
      totalServerFailures: 0,
      averageStartupTime: 0,
      totalStartupTime: 0
    };
    
    // Lifecycle management
    this.serverStartupQueue = [];
    this.serverShutdownQueue = [];
    this.maxConcurrentStartups = options.maxConcurrentStartups || 3;
    this.processingStartups = false;
    
    this.logger.info('Workflow Coordinator initialized');
  }

  /**
   * Initialize the coordinator
   */
  async initialize() {
    this.logger.info('🚀 Initializing Workflow Coordinator...');

    try {
      // Start health check monitoring
      this.startHealthChecking();

      // Create server instances but don't start them yet
      for (const [name, config] of Object.entries(MCP_SERVER_CONFIGS)) {
        const serverInstance = new MCPServerInstance(config, this);
        this.servers.set(name, serverInstance);
      }

      this.logger.info('✅ Workflow Coordinator initialized successfully');
      this.emit('initialized');

    } catch (error) {
      this.logger.error('❌ Failed to initialize Workflow Coordinator', { error });
      throw error;
    }
  }

  /**
   * Start required servers for workflow
   */
  async startServersForWorkflow(workflowType, priority = 'normal') {
    const requiredServers = this.getRequiredServersForWorkflow(workflowType);
    
    this.logger.info('Starting servers for workflow', { 
      workflowType, 
      servers: requiredServers, 
      priority 
    });

    const startPromises = requiredServers.map(serverName => {
      return this.startServer(serverName, priority);
    });

    try {
      await Promise.all(startPromises);
      this.logger.info('✅ All servers started for workflow', { workflowType });
    } catch (error) {
      this.logger.error('❌ Failed to start servers for workflow', { workflowType, error });
      throw error;
    }
  }

  /**
   * Get required servers for specific workflow type
   */
  getRequiredServersForWorkflow(workflowType) {
    const serverMapping = {
      'gemini-style': [
        'design-analysis-mcp',
        'code-structure-mcp',
        'component-library-mcp',
        'project-generator-mcp',
        'asset-manager-mcp'
      ],
      'figma-style': [
        'design-analysis-mcp',
        'enhanced-memory-mcp',
        'component-library-mcp'
      ],
      'website-scraping': [
        'website-scraper-mcp',
        'browser-extension-mcp',
        'design-analysis-mcp',
        'code-structure-mcp',
        'asset-manager-mcp',
        'component-library-mcp',
        'project-generator-mcp'
      ]
    };

    return serverMapping[workflowType] || [];
  }

  /**
   * Start a specific server
   */
  async startServer(serverName, priority = 'normal') {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new MCPError(`Server not found: ${serverName}`);
    }

    if (server.state === ServerState.RUNNING) {
      this.logger.debug('Server already running', { serverName });
      return server;
    }

    // Add to startup queue based on priority
    return new Promise((resolve, reject) => {
      const queueItem = {
        server,
        priority,
        resolve,
        reject,
        queueTime: Date.now()
      };

      if (priority === 'high') {
        this.serverStartupQueue.unshift(queueItem);
      } else {
        this.serverStartupQueue.push(queueItem);
      }

      this.processStartupQueue();
    });
  }

  /**
   * Process server startup queue
   */
  async processStartupQueue() {
    if (this.processingStartups || this.serverStartupQueue.length === 0) {
      return;
    }

    this.processingStartups = true;

    try {
      while (this.serverStartupQueue.length > 0) {
        // Process up to maxConcurrentStartups at once
        const batch = this.serverStartupQueue.splice(0, this.maxConcurrentStartups);
        
        const startupPromises = batch.map(async (queueItem) => {
          const startTime = Date.now();
          
          try {
            await queueItem.server.start();
            
            // Update performance metrics
            const startupTime = Date.now() - startTime;
            this.performanceMetrics.totalServersStarted++;
            this.performanceMetrics.totalStartupTime += startupTime;
            this.performanceMetrics.averageStartupTime = 
              this.performanceMetrics.totalStartupTime / this.performanceMetrics.totalServersStarted;

            queueItem.resolve(queueItem.server);
          } catch (error) {
            this.performanceMetrics.totalServerFailures++;
            queueItem.reject(error);
          }
        });

        await Promise.allSettled(startupPromises);
      }
    } finally {
      this.processingStartups = false;
    }
  }

  /**
   * Stop a specific server
   */
  async stopServer(serverName) {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new MCPError(`Server not found: ${serverName}`);
    }

    await server.stop();
    
    // Release port
    if (server.port) {
      this.usedPorts.delete(server.port);
    }
  }

  /**
   * Stop all servers
   */
  async stopAllServers() {
    this.logger.info('🛑 Stopping all MCP servers...');

    const stopPromises = Array.from(this.servers.values()).map(server => {
      return server.stop().catch(error => {
        this.logger.error('Error stopping server', { name: server.config.name, error });
      });
    });

    await Promise.all(stopPromises);
    this.usedPorts.clear();

    this.logger.info('✅ All MCP servers stopped');
  }

  /**
   * Get available port
   */
  async getAvailablePort() {
    for (let port = this.portRange.min; port <= this.portRange.max; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available ports');
  }

  /**
   * Start health checking
   */
  startHealthChecking() {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckInterval);

    this.logger.debug('Health checking started', { 
      interval: `${this.healthCheckInterval}ms` 
    });
  }

  /**
   * Stop health checking
   */
  stopHealthChecking() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      this.logger.debug('Health checking stopped');
    }
  }

  /**
   * Perform health checks on all running servers
   */
  async performHealthChecks() {
    const runningServers = Array.from(this.servers.values())
      .filter(server => server.state === ServerState.RUNNING);

    if (runningServers.length === 0) {
      return;
    }

    this.logger.debug('Performing health checks', { 
      serverCount: runningServers.length 
    });

    const healthCheckPromises = runningServers.map(async (server) => {
      try {
        const isHealthy = await server.performHealthCheck();
        
        if (!isHealthy && server.healthCheckFailures >= 3) {
          this.logger.warn('Server health check failing, attempting restart', { 
            name: server.config.name,
            failures: server.healthCheckFailures
          });
          
          // Attempt restart for unhealthy servers
          if (server.config.autoRestart) {
            await server.restart();
            this.performanceMetrics.totalServersRestarted++;
          }
        }
      } catch (error) {
        this.logger.error('Health check error', { 
          name: server.config.name, 
          error: error.message 
        });
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Get server status
   */
  getServerStatus(serverName) {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new MCPError(`Server not found: ${serverName}`);
    }
    return server.getStatus();
  }

  /**
   * Get all servers status
   */
  getAllServersStatus() {
    const status = {};
    for (const [name, server] of this.servers) {
      status[name] = server.getStatus();
    }
    return status;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      ...this.performanceMetrics,
      activeServers: Array.from(this.servers.values())
        .filter(server => server.state === ServerState.RUNNING).length,
      totalServers: this.servers.size,
      usedPorts: this.usedPorts.size,
      queuedStartups: this.serverStartupQueue.length
    };
  }

  /**
   * Optimize server resources
   */
  async optimizeResources() {
    this.logger.info('🔧 Optimizing server resources...');

    const serverStatuses = this.getAllServersStatus();
    const optimizations = [];

    for (const [name, status] of Object.entries(serverStatuses)) {
      if (status.state === ServerState.RUNNING) {
        // Check memory usage
        if (status.metrics.memoryUsage > this.servers.get(name).config.maxMemoryMB) {
          optimizations.push({
            server: name,
            issue: 'high_memory',
            action: 'restart',
            threshold: this.servers.get(name).config.maxMemoryMB,
            current: status.metrics.memoryUsage
          });
        }

        // Check CPU usage
        if (status.metrics.cpuUsage > this.servers.get(name).config.maxCpuPercent) {
          optimizations.push({
            server: name,
            issue: 'high_cpu',
            action: 'throttle',
            threshold: this.servers.get(name).config.maxCpuPercent,
            current: status.metrics.cpuUsage
          });
        }

        // Check connection pool
        if (status.connections.active > status.connections.max * 0.9) {
          optimizations.push({
            server: name,
            issue: 'connection_pool_full',
            action: 'expand_pool',
            current: status.connections.active,
            max: status.connections.max
          });
        }
      }
    }

    // Apply optimizations
    for (const optimization of optimizations) {
      try {
        await this.applyOptimization(optimization);
      } catch (error) {
        this.logger.error('Failed to apply optimization', { optimization, error });
      }
    }

    this.logger.info('✅ Resource optimization completed', { 
      optimizationsApplied: optimizations.length 
    });

    return optimizations;
  }

  /**
   * Apply specific optimization
   */
  async applyOptimization(optimization) {
    const server = this.servers.get(optimization.server);
    if (!server) return;

    switch (optimization.action) {
      case 'restart':
        this.logger.info('Restarting server due to resource issue', { 
          server: optimization.server, 
          issue: optimization.issue 
        });
        await server.restart();
        break;

      case 'throttle':
        this.logger.info('Throttling server due to high CPU', { 
          server: optimization.server 
        });
        // In a real implementation, you would implement CPU throttling
        break;

      case 'expand_pool':
        this.logger.info('Expanding connection pool', { 
          server: optimization.server 
        });
        server.maxConnections = Math.min(server.maxConnections * 1.5, 50);
        break;
    }
  }

  /**
   * Shutdown the coordinator
   */
  async shutdown() {
    this.logger.info('🛑 Shutting down Workflow Coordinator...');

    // Stop health checking
    this.stopHealthChecking();

    // Stop all servers
    await this.stopAllServers();

    this.emit('shutdown');
    this.logger.info('✅ Workflow Coordinator shutdown completed');
  }
}

export default WorkflowCoordinator;