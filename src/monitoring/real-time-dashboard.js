/**
 * Real-Time System Monitoring Dashboard
 * 
 * Production-ready monitoring dashboard with WebSocket streaming,
 * real-time metrics visualization, and system health monitoring.
 */

import { EventEmitter } from 'events';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class RealTimeMonitoringDashboard extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.config = {
      port: options.port || 3456,
      updateInterval: options.updateInterval || 1000, // 1 second
      historySize: options.historySize || 300, // 5 minutes at 1s intervals
      alertThresholds: {
        cpu: options.cpuThreshold || 0.8,
        memory: options.memoryThreshold || 0.85,
        errorRate: options.errorRateThreshold || 0.1,
        responseTime: options.responseTimeThreshold || 1000
      },
      ...options
    };
    
    // Express app
    this.app = express();
    this.server = null;
    this.wss = null;
    
    // Connected clients
    this.clients = new Set();
    
    // System components
    this.components = new Map();
    this.componentStatus = new Map();
    
    // Metrics storage
    this.metrics = {
      system: {
        cpu: [],
        memory: [],
        network: [],
        disk: []
      },
      swarm: {
        activeAgents: [],
        taskQueue: [],
        successRate: [],
        avgResponseTime: []
      },
      performance: {
        throughput: [],
        latency: [],
        errors: [],
        bottlenecks: []
      },
      lifecycle: {
        agentStates: {},
        births: [],
        retirements: [],
        evolutions: []
      },
      workflow: {
        running: [],
        completed: [],
        failed: [],
        avgDuration: []
      }
    };
    
    // Alerts
    this.activeAlerts = new Map();
    this.alertHistory = [];
    
    // Update intervals
    this.updateIntervals = new Map();
    
    this._initialize();
  }
  
  /**
   * Initialize the monitoring dashboard
   */
  async _initialize() {
    // Set up Express routes
    this._setupRoutes();
    
    // Create HTTP server
    this.server = createServer(this.app);
    
    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });
    
    // Set up WebSocket handlers
    this._setupWebSocketHandlers();
    
    // Start metric collection
    this._startMetricCollection();
    
    // Start server
    await this._startServer();
  }
  
  /**
   * Set up Express routes
   */
  _setupRoutes() {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'dashboard-ui')));
    
    // API routes
    this.app.get('/api/status', (req, res) => {
      res.json(this._getSystemStatus());
    });
    
    this.app.get('/api/metrics/:category', (req, res) => {
      const category = req.params.category;
      if (this.metrics[category]) {
        res.json(this.metrics[category]);
      } else {
        res.status(404).json({ error: 'Metric category not found' });
      }
    });
    
    this.app.get('/api/alerts', (req, res) => {
      res.json({
        active: Array.from(this.activeAlerts.values()),
        history: this.alertHistory.slice(-100)
      });
    });
    
    this.app.get('/api/components', (req, res) => {
      const components = Array.from(this.components.entries()).map(([id, component]) => ({
        id,
        ...component,
        status: this.componentStatus.get(id) || 'unknown'
      }));
      res.json(components);
    });
  }
  
  /**
   * Set up WebSocket handlers
   */
  _setupWebSocketHandlers() {
    this.wss.on('connection', (ws) => {
      const clientId = Date.now().toString();
      
      // Add to clients
      this.clients.add({
        id: clientId,
        ws,
        subscriptions: new Set(['all'])
      });
      
      // Send initial data - WebSocket is guaranteed to be open in 'connection' event
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          status: this._getSystemStatus(),
          metrics: this._getRecentMetrics(),
          components: Array.from(this.components.values()),
          alerts: Array.from(this.activeAlerts.values())
        }
      }));
      
      // Handle messages
      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message);
          this._handleClientMessage(clientId, msg);
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
      });
      
      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(
          Array.from(this.clients).find(c => c.id === clientId)
        );
      });
      
      // Handle errors
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
  }
  
  /**
   * Handle client messages
   */
  _handleClientMessage(clientId, message) {
    const client = Array.from(this.clients).find(c => c.id === clientId);
    if (!client) return;
    
    switch (message.type) {
      case 'subscribe':
        if (message.channels) {
          message.channels.forEach(channel => client.subscriptions.add(channel));
        }
        break;
        
      case 'unsubscribe':
        if (message.channels) {
          message.channels.forEach(channel => client.subscriptions.delete(channel));
        }
        break;
        
      case 'command':
        this._handleCommand(message.command, message.params)
          .then(result => {
            client.ws.send(JSON.stringify({
              type: 'command-result',
              command: message.command,
              result
            }));
          })
          .catch(error => {
            client.ws.send(JSON.stringify({
              type: 'command-error',
              command: message.command,
              error: error.message
            }));
          });
        break;
    }
  }
  
  /**
   * Start metric collection
   */
  _startMetricCollection() {
    // Delay metric collection to ensure init messages are sent first
    setTimeout(() => {
      // System metrics
      this.updateIntervals.set('system', setInterval(() => {
        this._collectSystemMetrics();
      }, this.config.updateInterval));
      
      // Component metrics
      this.updateIntervals.set('components', setInterval(() => {
        this._collectComponentMetrics();
      }, this.config.updateInterval * 2));
      
      // Alert monitoring
      this.updateIntervals.set('alerts', setInterval(() => {
        this._checkAlerts();
      }, this.config.updateInterval * 5));
    }, 200); // Give time for WebSocket connections to initialize
  }
  
  /**
   * Collect system metrics
   */
  async _collectSystemMetrics() {
    // CPU usage
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const cpuUsage = 1 - (totalIdle / totalTick);
    this._addMetric('system', 'cpu', {
      value: cpuUsage,
      timestamp: Date.now()
    });
    
    // Memory usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = (totalMem - freeMem) / totalMem;
    
    this._addMetric('system', 'memory', {
      value: memUsage,
      used: totalMem - freeMem,
      total: totalMem,
      timestamp: Date.now()
    });
    
    // Network (placeholder - would need actual implementation)
    this._addMetric('system', 'network', {
      in: Math.random() * 1000000, // bytes/sec
      out: Math.random() * 500000,
      timestamp: Date.now()
    });
    
    // Broadcast to clients
    this._broadcast('system-metrics', {
      cpu: cpuUsage,
      memory: memUsage,
      timestamp: Date.now()
    });
  }
  
  /**
   * Collect component metrics
   */
  async _collectComponentMetrics() {
    for (const [componentId, component] of this.components) {
      if (component.getMetrics) {
        try {
          const metrics = await component.getMetrics();
          
          // Update component-specific metrics
          if (component.type === 'swarm') {
            this._updateSwarmMetrics(metrics);
          } else if (component.type === 'performance') {
            this._updatePerformanceMetrics(metrics);
          } else if (component.type === 'lifecycle') {
            this._updateLifecycleMetrics(metrics);
          } else if (component.type === 'workflow') {
            this._updateWorkflowMetrics(metrics);
          }
          
          // Update status
          this.componentStatus.set(componentId, 'healthy');
          
        } catch (error) {
          this.componentStatus.set(componentId, 'error');
          this._createAlert('component-error', {
            component: componentId,
            error: error.message
          });
        }
      }
    }
    
    // Broadcast component status
    this._broadcast('component-status', 
      Array.from(this.componentStatus.entries()).map(([id, status]) => ({ id, status }))
    );
  }
  
  /**
   * Update swarm metrics
   */
  _updateSwarmMetrics(metrics) {
    this._addMetric('swarm', 'activeAgents', {
      value: metrics.activeAgents || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('swarm', 'taskQueue', {
      value: metrics.queuedTasks || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('swarm', 'successRate', {
      value: metrics.successRate || 1.0,
      timestamp: Date.now()
    });
    
    this._addMetric('swarm', 'avgResponseTime', {
      value: metrics.avgResponseTime || 0,
      timestamp: Date.now()
    });
    
    this._broadcast('swarm-metrics', metrics);
  }
  
  /**
   * Update performance metrics
   */
  _updatePerformanceMetrics(metrics) {
    this._addMetric('performance', 'throughput', {
      value: metrics.throughput || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('performance', 'latency', {
      value: metrics.avgLatency || 0,
      p50: metrics.p50Latency || 0,
      p95: metrics.p95Latency || 0,
      p99: metrics.p99Latency || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('performance', 'errors', {
      value: metrics.errorRate || 0,
      count: metrics.errorCount || 0,
      timestamp: Date.now()
    });
    
    if (metrics.bottlenecks && metrics.bottlenecks.length > 0) {
      this._addMetric('performance', 'bottlenecks', {
        items: metrics.bottlenecks,
        timestamp: Date.now()
      });
    }
    
    this._broadcast('performance-metrics', metrics);
  }
  
  /**
   * Update lifecycle metrics
   */
  _updateLifecycleMetrics(metrics) {
    // Agent states
    this.metrics.lifecycle.agentStates = metrics.byState || {};
    
    // Track births
    if (metrics.births) {
      this._addMetric('lifecycle', 'births', {
        count: metrics.births,
        timestamp: Date.now()
      });
    }
    
    // Track retirements
    if (metrics.retirements) {
      this._addMetric('lifecycle', 'retirements', {
        count: metrics.retirements,
        timestamp: Date.now()
      });
    }
    
    // Track evolutions
    if (metrics.evolutions) {
      this._addMetric('lifecycle', 'evolutions', {
        count: metrics.evolutions,
        avgGeneration: metrics.avgGeneration || 1,
        timestamp: Date.now()
      });
    }
    
    this._broadcast('lifecycle-metrics', metrics);
  }
  
  /**
   * Update workflow metrics
   */
  _updateWorkflowMetrics(metrics) {
    this._addMetric('workflow', 'running', {
      value: metrics.runningWorkflows || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('workflow', 'completed', {
      value: metrics.completedWorkflows || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('workflow', 'failed', {
      value: metrics.failedWorkflows || 0,
      timestamp: Date.now()
    });
    
    this._addMetric('workflow', 'avgDuration', {
      value: metrics.avgWorkflowDuration || 0,
      timestamp: Date.now()
    });
    
    this._broadcast('workflow-metrics', metrics);
  }
  
  /**
   * Check for alerts
   */
  _checkAlerts() {
    // CPU alert
    const recentCPU = this._getRecentAverage('system', 'cpu', 10);
    if (recentCPU > this.config.alertThresholds.cpu) {
      this._createAlert('high-cpu', {
        value: recentCPU,
        threshold: this.config.alertThresholds.cpu
      });
    } else {
      this._clearAlert('high-cpu');
    }
    
    // Memory alert
    const recentMemory = this._getRecentAverage('system', 'memory', 10);
    if (recentMemory > this.config.alertThresholds.memory) {
      this._createAlert('high-memory', {
        value: recentMemory,
        threshold: this.config.alertThresholds.memory
      });
    } else {
      this._clearAlert('high-memory');
    }
    
    // Error rate alert
    const recentErrors = this._getRecentAverage('performance', 'errors', 10);
    if (recentErrors > this.config.alertThresholds.errorRate) {
      this._createAlert('high-error-rate', {
        value: recentErrors,
        threshold: this.config.alertThresholds.errorRate
      });
    } else {
      this._clearAlert('high-error-rate');
    }
    
    // Response time alert
    const recentResponseTime = this._getRecentAverage('swarm', 'avgResponseTime', 10);
    if (recentResponseTime > this.config.alertThresholds.responseTime) {
      this._createAlert('slow-response', {
        value: recentResponseTime,
        threshold: this.config.alertThresholds.responseTime
      });
    } else {
      this._clearAlert('slow-response');
    }
  }
  
  /**
   * Create or update an alert
   */
  _createAlert(type, data) {
    const existing = this.activeAlerts.get(type);
    
    const alert = {
      id: type,
      type,
      severity: this._getAlertSeverity(type),
      message: this._getAlertMessage(type, data),
      data,
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now()
    };
    
    this.activeAlerts.set(type, alert);
    
    if (!existing) {
      this.alertHistory.push({
        ...alert,
        status: 'created'
      });
      
      this._broadcast('alert-created', alert);
      this.emit('alert', alert);
    }
  }
  
  /**
   * Clear an alert
   */
  _clearAlert(type) {
    const alert = this.activeAlerts.get(type);
    if (alert) {
      this.activeAlerts.delete(type);
      
      this.alertHistory.push({
        ...alert,
        status: 'cleared',
        clearedAt: Date.now()
      });
      
      this._broadcast('alert-cleared', { id: type });
    }
  }
  
  /**
   * Get alert severity
   */
  _getAlertSeverity(type) {
    const severities = {
      'high-cpu': 'warning',
      'high-memory': 'warning',
      'high-error-rate': 'critical',
      'slow-response': 'warning',
      'component-error': 'critical'
    };
    
    return severities[type] || 'info';
  }
  
  /**
   * Get alert message
   */
  _getAlertMessage(type, data) {
    const messages = {
      'high-cpu': `CPU usage is ${(data.value * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(1)}%)`,
      'high-memory': `Memory usage is ${(data.value * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(1)}%)`,
      'high-error-rate': `Error rate is ${(data.value * 100).toFixed(1)}% (threshold: ${(data.threshold * 100).toFixed(1)}%)`,
      'slow-response': `Average response time is ${data.value.toFixed(0)}ms (threshold: ${data.threshold}ms)`,
      'component-error': `Component ${data.component} error: ${data.error}`
    };
    
    return messages[type] || `Alert: ${type}`;
  }
  
  /**
   * Add metric to storage
   */
  _addMetric(category, type, data) {
    // Ensure category exists
    if (!this.metrics[category]) {
      this.metrics[category] = {};
    }
    
    // Ensure type array exists
    if (!this.metrics[category][type]) {
      this.metrics[category][type] = [];
    }
    
    this.metrics[category][type].push(data);
    
    // Trim to history size
    if (this.metrics[category][type].length > this.config.historySize) {
      this.metrics[category][type].shift();
    }
  }
  
  /**
   * Get recent average of a metric
   */
  _getRecentAverage(category, type, samples) {
    if (!this.metrics[category] || !this.metrics[category][type]) {
      return 0;
    }
    
    const metrics = this.metrics[category][type];
    const recent = metrics.slice(-samples);
    
    if (recent.length === 0) return 0;
    
    const sum = recent.reduce((acc, m) => acc + (m.value || 0), 0);
    return sum / recent.length;
  }
  
  /**
   * Get recent metrics
   */
  _getRecentMetrics(duration = 60) {
    const cutoff = Date.now() - (duration * 1000);
    const recent = {};
    
    for (const [category, types] of Object.entries(this.metrics)) {
      recent[category] = {};
      
      for (const [type, data] of Object.entries(types)) {
        if (Array.isArray(data)) {
          recent[category][type] = data.filter(m => 
            (m.timestamp || 0) > cutoff
          );
        } else {
          recent[category][type] = data;
        }
      }
    }
    
    return recent;
  }
  
  /**
   * Get system status
   */
  _getSystemStatus() {
    const cpuUsage = this._getRecentAverage('system', 'cpu', 1);
    const memUsage = this._getRecentAverage('system', 'memory', 1);
    
    return {
      healthy: this.activeAlerts.size === 0,
      uptime: process.uptime(),
      timestamp: Date.now(),
      system: {
        cpu: cpuUsage,
        memory: memUsage,
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version
      },
      components: {
        total: this.components.size,
        healthy: Array.from(this.componentStatus.values())
          .filter(status => status === 'healthy').length
      },
      alerts: {
        active: this.activeAlerts.size,
        critical: Array.from(this.activeAlerts.values())
          .filter(a => a.severity === 'critical').length
      }
    };
  }
  
  /**
   * Broadcast to all connected clients
   */
  _broadcast(type, data, channel = 'all') {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    
    for (const client of this.clients) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('all')) {
        if (client.ws.readyState === 1) { // WebSocket.OPEN
          client.ws.send(message);
        }
      }
    }
  }
  
  /**
   * Handle commands from clients
   */
  async _handleCommand(command, params) {
    switch (command) {
      case 'clear-alerts':
        this.activeAlerts.clear();
        this._broadcast('alerts-cleared', {});
        return { success: true };
        
      case 'reset-metrics':
        for (const category of Object.values(this.metrics)) {
          for (const type of Object.keys(category)) {
            if (Array.isArray(category[type])) {
              category[type] = [];
            }
          }
        }
        return { success: true };
        
      case 'snapshot':
        return {
          metrics: this.metrics,
          alerts: Array.from(this.activeAlerts.values()),
          components: Array.from(this.components.values()),
          timestamp: Date.now()
        };
        
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }
  
  /**
   * Register a component for monitoring
   */
  registerComponent(id, component) {
    this.components.set(id, {
      id,
      name: component.name || id,
      type: component.type || 'generic',
      getMetrics: component.getMetrics.bind(component),
      registeredAt: Date.now()
    });
    
    this.componentStatus.set(id, 'initializing');
    
    this._broadcast('component-registered', { id, name: component.name });
    
    this.emit('component-registered', { id });
  }
  
  /**
   * Unregister a component
   */
  unregisterComponent(id) {
    this.components.delete(id);
    this.componentStatus.delete(id);
    
    this._broadcast('component-unregistered', { id });
    
    this.emit('component-unregistered', { id });
  }
  
  /**
   * Start the monitoring server
   */
  async _startServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, '127.0.0.1', (error) => {
        if (error) {
          reject(error);
        } else {
          console.log(`Monitoring dashboard running at http://localhost:${this.config.port}`);
          // Give server time to fully initialize
          setTimeout(() => {
            this.emit('server-started', { port: this.config.port });
            resolve();
          }, 100);
        }
      });
    });
  }
  
  /**
   * Stop the monitoring dashboard
   */
  async stop() {
    // Clear intervals
    for (const interval of this.updateIntervals.values()) {
      clearInterval(interval);
    }
    
    // Close WebSocket connections
    for (const client of this.clients) {
      client.ws.close();
    }
    
    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }
    
    // Close HTTP server
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.emit('server-stopped');
          resolve();
        });
      });
    }
  }
}

// Export singleton getter
let instance = null;

export function getMonitoringDashboard(options) {
  if (!instance) {
    instance = new RealTimeMonitoringDashboard(options);
  }
  return instance;
}