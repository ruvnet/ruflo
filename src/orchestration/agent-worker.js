/**
 * Agent Worker Implementation
 * Runs in separate worker thread to provide true parallelization
 * Handles individual agent lifecycle and task execution
 */

import { parentPort, workerData } from 'worker_threads';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Agent Worker Class
 * Manages individual agent execution and communication
 */
class AgentWorker extends EventEmitter {
  constructor(config) {
    super();
    
    this.agentId = config.agentId;
    this.swarmId = config.swarmId;
    this.coordinationPort = config.coordinationPort;
    this.config = config.config;
    
    // Agent state
    this.state = 'initializing';
    this.currentTask = null;
    this.capabilities = this.config.capabilities || [];
    this.resources = this.config.resources || {};
    this.strategy = this.config.strategy || 'adaptive';
    
    // Communication
    this.coordinationSocket = null;
    this.peerConnections = new Map();
    this.messageQueue = [];
    
    // Execution context
    this.processes = new Map();
    this.workingDirectory = null;
    this.environmentVars = { ...process.env };
    
    // Performance metrics
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      averageTaskTime: 0,
      errorRate: 0,
      currentLoad: 0,
      memoryUsage: 0,
      cpuUsage: 0
    };
    
    // Health tracking
    this.lastHeartbeat = new Date();
    this.healthStatus = 'healthy';
    this.healthIssues = [];
    
    this.log(`🤖 Agent worker initialized: ${this.agentId}`);
  }
  
  /**
   * Initialize the agent worker
   */
  async initialize() {
    try {
      this.log('🚀 Initializing agent worker...');
      
      // Create working directory
      await this.createWorkingDirectory();
      
      // Connect to coordination server
      await this.connectToCoordinator();
      
      // Register with swarm
      await this.registerWithSwarm();
      
      // Start health monitoring
      this.startHealthMonitoring();
      
      // Start performance monitoring
      this.startPerformanceMonitoring();
      
      this.state = 'idle';
      this.log('✅ Agent worker initialization complete');
      
    } catch (error) {
      this.log('❌ Failed to initialize agent worker:', error);
      this.notifyParent('error', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Create isolated working directory for this agent
   */
  async createWorkingDirectory() {
    this.workingDirectory = path.join(process.cwd(), 'agent-workspaces', this.agentId);
    
    try {
      await fs.mkdir(this.workingDirectory, { recursive: true });
      
      // Create subdirectories
      await Promise.all([
        fs.mkdir(path.join(this.workingDirectory, 'temp'), { recursive: true }),
        fs.mkdir(path.join(this.workingDirectory, 'output'), { recursive: true }),
        fs.mkdir(path.join(this.workingDirectory, 'logs'), { recursive: true })
      ]);
      
      this.log(`📁 Working directory created: ${this.workingDirectory}`);
      
    } catch (error) {
      this.log('❌ Failed to create working directory:', error);
      throw error;
    }
  }
  
  /**
   * Connect to the swarm coordination server
   */
  async connectToCoordinator() {
    return new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:${this.coordinationPort}`;
      
      this.coordinationSocket = new WebSocket(wsUrl, {
        headers: {
          'x-agent-id': this.agentId,
          'x-swarm-id': this.swarmId
        }
      });
      
      this.coordinationSocket.on('open', () => {
        this.log(`🔗 Connected to coordination server: ${wsUrl}`);
        this.startHeartbeat();
        resolve();
      });
      
      this.coordinationSocket.on('message', (data) => {
        this.handleCoordinatorMessage(data);
      });
      
      this.coordinationSocket.on('close', () => {
        this.log('🔌 Coordination connection closed');
        this.attemptReconnection();
      });
      
      this.coordinationSocket.on('error', (error) => {
        this.log('❌ Coordination connection error:', error);
        reject(error);
      });
      
      // Connection timeout
      setTimeout(() => {
        if (this.coordinationSocket.readyState !== WebSocket.OPEN) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }
  
  /**
   * Register this agent with the swarm
   */
  async registerWithSwarm() {
    const registrationData = {
      type: 'register',
      data: {
        name: this.config.name,
        type: this.config.type,
        capabilities: this.capabilities,
        resources: {
          ...this.resources,
          workingDirectory: this.workingDirectory,
          pid: process.pid
        },
        strategy: this.strategy,
        version: '1.0.0',
        startTime: new Date().toISOString()
      }
    };
    
    this.sendToCoordinator(registrationData);
    this.log('📝 Registration sent to swarm coordinator');
  }
  
  /**
   * Handle messages from the coordinator
   */
  async handleCoordinatorMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'welcome':
          this.log(`👋 Welcome message received from swarm: ${message.swarmId}`);
          break;
          
        case 'task_assignment':
          await this.handleTaskAssignment(message);
          break;
          
        case 'topology_update':
          await this.handleTopologyUpdate(message);
          break;
          
        case 'peer_connection':
          await this.handlePeerConnection(message);
          break;
          
        case 'shutdown':
          await this.handleShutdown(message);
          break;
          
        case 'pause':
          this.pauseExecution();
          break;
          
        case 'resume':
          this.resumeExecution();
          break;
          
        default:
          this.log(`❓ Unknown message type: ${message.type}`);
      }
      
    } catch (error) {
      this.log('❌ Error handling coordinator message:', error);
    }
  }
  
  /**
   * Handle task assignment from coordinator
   */
  async handleTaskAssignment(message) {
    const { task, swarmContext } = message;
    
    if (this.state !== 'idle') {
      this.sendToCoordinator({
        type: 'task_error',
        data: {
          taskId: task.id,
          error: `Agent not available (state: ${this.state})`,
          canRetry: true
        }
      });
      return;
    }
    
    this.log(`📋 Task assigned: ${task.id} - ${task.description}`);
    
    this.currentTask = task;
    this.state = 'busy';
    
    try {
      // Execute the task
      const result = await this.executeTask(task, swarmContext);
      
      // Send successful result
      this.sendToCoordinator({
        type: 'task_result',
        data: {
          taskId: task.id,
          result,
          metrics: {
            executionTime: Date.now() - new Date(task.assignedAt).getTime(),
            memoryUsed: process.memoryUsage().heapUsed,
            cpuTime: process.cpuUsage()
          }
        }
      });
      
      this.metrics.tasksCompleted++;
      this.log(`✅ Task completed: ${task.id}`);
      
    } catch (error) {
      // Send error result
      this.sendToCoordinator({
        type: 'task_error',
        data: {
          taskId: task.id,
          error: error.message,
          canRetry: this.isRetryableError(error)
        }
      });
      
      this.metrics.tasksFailed++;
      this.log(`❌ Task failed: ${task.id} - ${error.message}`);
    }
    
    // Reset state
    this.currentTask = null;
    this.state = 'idle';
    
    // Update performance metrics
    this.updatePerformanceMetrics();
  }
  
  /**
   * Execute a task using appropriate strategy
   */
  async executeTask(task, swarmContext) {
    const executionContext = {
      taskId: task.id,
      workingDirectory: this.workingDirectory,
      swarmContext,
      capabilities: this.capabilities,
      resources: this.resources,
      timeout: task.timeout || 300000
    };
    
    switch (task.type) {
      case 'shell_command':
        return this.executeShellCommand(task, executionContext);
        
      case 'file_operation':
        return this.executeFileOperation(task, executionContext);
        
      case 'code_execution':
        return this.executeCode(task, executionContext);
        
      case 'data_processing':
        return this.processData(task, executionContext);
        
      case 'ai_inference':
        return this.performAIInference(task, executionContext);
        
      case 'coordination_task':
        return this.performCoordinationTask(task, executionContext);
        
      default:
        return this.executeGenericTask(task, executionContext);
    }
  }
  
  /**
   * Execute shell command task
   */
  async executeShellCommand(task, context) {
    const { command, args, options } = task.parameters;
    
    return new Promise((resolve, reject) => {
      const process = spawn(command, args || [], {
        cwd: context.workingDirectory,
        env: this.environmentVars,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: context.timeout,
        ...options
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            stdout,
            stderr,
            exitCode: code,
            executedAt: new Date().toISOString()
          });
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
        }
      });
      
      process.on('error', (error) => {
        reject(error);
      });
      
      // Handle timeout
      const timeoutHandle = setTimeout(() => {
        process.kill('SIGTERM');
        reject(new Error('Command execution timeout'));
      }, context.timeout);
      
      process.on('exit', () => {
        clearTimeout(timeoutHandle);
      });
      
      // Store process reference for potential termination
      this.processes.set(context.taskId, process);
    });
  }
  
  /**
   * Execute file operation task
   */
  async executeFileOperation(task, context) {
    const { operation, source, destination, content, options } = task.parameters;
    
    switch (operation) {
      case 'read':
        const data = await fs.readFile(path.resolve(context.workingDirectory, source), 'utf8');
        return { success: true, content: data, operation };
        
      case 'write':
        await fs.writeFile(path.resolve(context.workingDirectory, destination), content);
        return { success: true, operation, written: content.length };
        
      case 'copy':
        await fs.copyFile(
          path.resolve(context.workingDirectory, source),
          path.resolve(context.workingDirectory, destination)
        );
        return { success: true, operation, source, destination };
        
      case 'delete':
        await fs.unlink(path.resolve(context.workingDirectory, source));
        return { success: true, operation, deleted: source };
        
      case 'mkdir':
        await fs.mkdir(path.resolve(context.workingDirectory, destination), { recursive: true });
        return { success: true, operation, created: destination };
        
      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }
  }
  
  /**
   * Execute code (JavaScript, Python, etc.)
   */
  async executeCode(task, context) {
    const { language, code, inputs } = task.parameters;
    
    switch (language) {
      case 'javascript':
        return this.executeJavaScript(code, inputs, context);
        
      case 'python':
        return this.executePython(code, inputs, context);
        
      case 'shell':
        return this.executeShell(code, inputs, context);
        
      default:
        throw new Error(`Unsupported language: ${language}`);
    }
  }
  
  /**
   * Execute JavaScript code in isolated context
   */
  async executeJavaScript(code, inputs, context) {
    // Create a sandboxed execution environment
    const sandbox = {
      console,
      inputs,
      require: (module) => {
        // Whitelist allowed modules
        const allowedModules = ['fs', 'path', 'crypto', 'util'];
        if (allowedModules.includes(module)) {
          return require(module);
        }
        throw new Error(`Module not allowed: ${module}`);
      },
      process: {
        cwd: () => context.workingDirectory,
        env: this.environmentVars
      }
    };
    
    try {
      // Execute code with timeout
      const vm = require('vm');
      const script = new vm.Script(code);
      const vmContext = vm.createContext(sandbox);
      
      const result = script.runInContext(vmContext, {
        timeout: context.timeout,
        displayErrors: true
      });
      
      return {
        success: true,
        result,
        language: 'javascript',
        executedAt: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`JavaScript execution error: ${error.message}`);
    }
  }
  
  /**
   * Process data task
   */
  async processData(task, context) {
    const { operation, data, parameters } = task.parameters;
    
    switch (operation) {
      case 'transform':
        return this.transformData(data, parameters);
        
      case 'aggregate':
        return this.aggregateData(data, parameters);
        
      case 'filter':
        return this.filterData(data, parameters);
        
      case 'sort':
        return this.sortData(data, parameters);
        
      default:
        throw new Error(`Unknown data operation: ${operation}`);
    }
  }
  
  /**
   * Perform AI inference task (placeholder for future AI integration)
   */
  async performAIInference(task, context) {
    const { model, prompt, parameters } = task.parameters;
    
    // This is a placeholder for actual AI model integration
    // In a real implementation, this would call actual AI APIs
    
    return {
      success: true,
      model,
      prompt,
      result: "AI inference result placeholder",
      confidence: 0.85,
      executedAt: new Date().toISOString()
    };
  }
  
  /**
   * Perform coordination task with other agents
   */
  async performCoordinationTask(task, context) {
    const { operation, targetAgents, message } = task.parameters;
    
    switch (operation) {
      case 'broadcast':
        return this.broadcastToPeers(message);
        
      case 'gather':
        return this.gatherFromPeers(message);
        
      case 'synchronize':
        return this.synchronizeWithPeers(targetAgents);
        
      default:
        throw new Error(`Unknown coordination operation: ${operation}`);
    }
  }
  
  /**
   * Execute generic task
   */
  async executeGenericTask(task, context) {
    // Generic task execution logic
    const result = {
      success: true,
      taskId: task.id,
      type: task.type,
      description: task.description,
      executedAt: new Date().toISOString(),
      context: {
        agentId: this.agentId,
        workingDirectory: context.workingDirectory
      }
    };
    
    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
    
    return result;
  }
  
  /**
   * Send message to coordinator
   */
  sendToCoordinator(message) {
    if (this.coordinationSocket && this.coordinationSocket.readyState === WebSocket.OPEN) {
      this.coordinationSocket.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }
  
  /**
   * Start heartbeat to coordinator
   */
  startHeartbeat() {
    const heartbeatInterval = setInterval(() => {
      if (this.coordinationSocket && this.coordinationSocket.readyState === WebSocket.OPEN) {
        this.sendToCoordinator({
          type: 'heartbeat',
          data: {
            timestamp: new Date().toISOString(),
            state: this.state,
            currentTask: this.currentTask?.id || null,
            metrics: this.metrics,
            health: {
              status: this.healthStatus,
              issues: this.healthIssues
            }
          }
        });
        
        this.lastHeartbeat = new Date();
      }
    }, 5000); // Every 5 seconds
    
    // Store interval reference for cleanup
    this.heartbeatInterval = heartbeatInterval;
  }
  
  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    const healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 10000); // Every 10 seconds
    
    this.healthCheckInterval = healthCheckInterval;
  }
  
  /**
   * Perform health check
   */
  performHealthCheck() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Update metrics
    this.metrics.memoryUsage = memoryUsage.heapUsed;
    this.metrics.cpuUsage = cpuUsage.user + cpuUsage.system;
    
    // Check for health issues
    const issues = [];
    
    // Memory usage check (warn if > 100MB)
    if (memoryUsage.heapUsed > 100 * 1024 * 1024) {
      issues.push(`High memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
    }
    
    // Error rate check
    if (this.metrics.errorRate > 0.2) {
      issues.push(`High error rate: ${(this.metrics.errorRate * 100).toFixed(1)}%`);
    }
    
    // Update health status
    this.healthStatus = issues.length === 0 ? 'healthy' : 'warning';
    this.healthIssues = issues;
  }
  
  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    const performanceInterval = setInterval(() => {
      this.updatePerformanceMetrics();
    }, 15000); // Every 15 seconds
    
    this.performanceInterval = performanceInterval;
  }
  
  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    const totalTasks = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    
    if (totalTasks > 0) {
      this.metrics.errorRate = this.metrics.tasksFailed / totalTasks;
      this.metrics.averageTaskTime = this.metrics.totalExecutionTime / this.metrics.tasksCompleted || 0;
    }
    
    // Calculate current load (0-1 scale)
    this.metrics.currentLoad = this.state === 'busy' ? 1 : 0;
  }
  
  /**
   * Determine if error is retryable
   */
  isRetryableError(error) {
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /temporary/i,
      /busy/i
    ];
    
    return retryablePatterns.some(pattern => pattern.test(error.message));
  }
  
  /**
   * Attempt reconnection to coordinator
   */
  async attemptReconnection() {
    if (this.state === 'terminated') {
      return;
    }
    
    this.log('🔄 Attempting reconnection to coordinator...');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      await this.connectToCoordinator();
      await this.registerWithSwarm();
      
      // Send queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        this.sendToCoordinator(message);
      }
      
      this.log('✅ Reconnected to coordinator');
      
    } catch (error) {
      this.log('❌ Reconnection failed:', error);
      setTimeout(() => this.attemptReconnection(), 10000); // Retry in 10 seconds
    }
  }
  
  /**
   * Handle shutdown request
   */
  async handleShutdown(message) {
    this.log('🛑 Shutdown requested');
    this.state = 'terminated';
    
    // Stop all intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    if (this.performanceInterval) clearInterval(this.performanceInterval);
    
    // Terminate running processes
    for (const process of this.processes.values()) {
      process.kill('SIGTERM');
    }
    
    // Close connections
    if (this.coordinationSocket) {
      this.coordinationSocket.close();
    }
    
    // Notify parent thread
    this.notifyParent('shutdown', { agentId: this.agentId });
    
    // Exit worker thread
    process.exit(0);
  }
  
  /**
   * Notify parent thread
   */
  notifyParent(type, data) {
    if (parentPort) {
      parentPort.postMessage({ type, data });
    }
  }
  
  /**
   * Log message with agent context
   */
  log(message, ...args) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [Agent:${this.agentId}] ${message}`, ...args);
    
    // Also notify parent
    this.notifyParent('log', { message, args, timestamp });
  }
}

// Initialize agent worker if running as worker thread
if (workerData) {
  const agent = new AgentWorker(workerData);
  
  // Handle messages from parent thread
  if (parentPort) {
    parentPort.on('message', async (message) => {
      switch (message.type) {
        case 'initialize':
          try {
            await agent.initialize();
            parentPort.postMessage({ type: 'initialized', data: { agentId: agent.agentId } });
          } catch (error) {
            parentPort.postMessage({ type: 'error', data: { error: error.message } });
          }
          break;
          
        case 'shutdown':
          await agent.handleShutdown(message);
          break;
          
        default:
          agent.log(`Unknown parent message: ${message.type}`);
      }
    });
  }
  
  // Initialize immediately
  agent.initialize().catch(error => {
    console.error('Failed to initialize agent worker:', error);
    process.exit(1);
  });
}

export { AgentWorker };
export default AgentWorker;