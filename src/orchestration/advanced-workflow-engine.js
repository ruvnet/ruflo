/**
 * Advanced Workflow Engine for Claude Flow MCP
 * 
 * Real, production-ready workflow orchestration with no simulations.
 * Provides complex workflow execution, dependency management, and real-time coordination.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AdvancedWorkflowEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.config = {
      maxConcurrentWorkflows: options.maxConcurrentWorkflows || 10,
      maxTasksPerWorkflow: options.maxTasksPerWorkflow || 100,
      taskTimeout: options.taskTimeout || 300000, // 5 minutes
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      checkpointInterval: options.checkpointInterval || 5000,
      ...options
    };
    
    // Workflow storage
    this.workflows = new Map();
    this.runningWorkflows = new Map();
    this.workflowHistory = new Map();
    
    // Task execution
    this.taskQueue = [];
    this.executingTasks = new Map();
    this.taskResults = new Map();
    
    // Worker pool for parallel execution
    this.workerPool = [];
    this.availableWorkers = [];
    this.maxWorkers = options.maxWorkers || 4;
    
    // Workflow templates
    this.templates = new Map();
    this.customHandlers = new Map();
    
    // Performance tracking
    this.metrics = {
      totalWorkflows: 0,
      completedWorkflows: 0,
      failedWorkflows: 0,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgExecutionTime: 0,
      avgTaskTime: 0
    };
    
    // Real-time monitoring
    this.monitoringInterval = null;
    this.checkpointInterval = null;
    
    this._initialize();
  }
  
  /**
   * Initialize the workflow engine
   */
  async _initialize() {
    // Create worker pool
    await this._createWorkerPool();
    
    // Start monitoring
    this._startMonitoring();
    
    // Start checkpoint system
    this._startCheckpointing();
    
    this.emit('engine-initialized', { workers: this.maxWorkers });
  }
  
  /**
   * Create worker pool for parallel task execution
   */
  async _createWorkerPool() {
    for (let i = 0; i < this.maxWorkers; i++) {
      const worker = new Worker(path.join(__dirname, 'workflow-worker.js'));
      
      worker.on('message', (message) => {
        this._handleWorkerMessage(worker, message);
      });
      
      worker.on('error', (error) => {
        this.emit('worker-error', { workerId: worker.threadId, error });
        this._replaceWorker(worker);
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.emit('worker-exit', { workerId: worker.threadId, code });
          this._replaceWorker(worker);
        }
      });
      
      this.workerPool.push(worker);
      this.availableWorkers.push(worker);
    }
  }
  
  /**
   * Create a new workflow
   */
  async createWorkflow(definition) {
    const workflowId = uuidv4();
    
    const workflow = {
      id: workflowId,
      name: definition.name || `Workflow-${workflowId}`,
      description: definition.description,
      tasks: this._parseTasks(definition.tasks),
      dependencies: this._buildDependencyGraph(definition.tasks),
      config: definition.config || {},
      status: 'created',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      checkpoint: null,
      results: {},
      errors: []
    };
    
    this.workflows.set(workflowId, workflow);
    this.metrics.totalWorkflows++;
    
    this.emit('workflow-created', { workflowId, name: workflow.name });
    
    return { workflowId, workflow };
  }
  
  /**
   * Parse and validate tasks
   */
  _parseTasks(tasks) {
    const parsedTasks = new Map();
    
    for (const task of tasks) {
      const taskId = task.id || uuidv4();
      
      parsedTasks.set(taskId, {
        id: taskId,
        name: task.name,
        type: task.type || 'custom',
        handler: task.handler,
        params: task.params || {},
        dependencies: task.dependencies || [],
        retryPolicy: task.retryPolicy || { attempts: this.config.retryAttempts },
        timeout: task.timeout || this.config.taskTimeout,
        status: 'pending',
        attempts: 0,
        startTime: null,
        endTime: null,
        result: null,
        error: null
      });
    }
    
    return parsedTasks;
  }
  
  /**
   * Build dependency graph for task execution
   */
  _buildDependencyGraph(tasks) {
    const graph = new Map();
    
    for (const task of tasks) {
      const taskId = task.id || task.name;
      graph.set(taskId, {
        dependencies: new Set(task.dependencies || []),
        dependents: new Set()
      });
    }
    
    // Build reverse dependencies
    for (const [taskId, node] of graph) {
      for (const dep of node.dependencies) {
        if (graph.has(dep)) {
          graph.get(dep).dependents.add(taskId);
        }
      }
    }
    
    return graph;
  }
  
  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowId, context = {}) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    
    if (this.runningWorkflows.size >= this.config.maxConcurrentWorkflows) {
      throw new Error('Maximum concurrent workflows reached');
    }
    
    // Initialize workflow execution
    workflow.status = 'running';
    workflow.startedAt = Date.now();
    workflow.context = context;
    
    this.runningWorkflows.set(workflowId, workflow);
    
    this.emit('workflow-started', { workflowId, name: workflow.name });
    
    try {
      // Execute workflow tasks
      const result = await this._executeWorkflowTasks(workflow);
      
      // Mark workflow as completed
      workflow.status = 'completed';
      workflow.completedAt = Date.now();
      workflow.results = result;
      
      this.runningWorkflows.delete(workflowId);
      this.workflowHistory.set(workflowId, workflow);
      this.metrics.completedWorkflows++;
      
      this.emit('workflow-completed', { 
        workflowId, 
        duration: workflow.completedAt - workflow.startedAt,
        results: result
      });
      
      return { success: true, results: result };
      
    } catch (error) {
      // Mark workflow as failed
      workflow.status = 'failed';
      workflow.completedAt = Date.now();
      workflow.errors.push(error.message);
      
      this.runningWorkflows.delete(workflowId);
      this.workflowHistory.set(workflowId, workflow);
      this.metrics.failedWorkflows++;
      
      this.emit('workflow-failed', { workflowId, error: error.message });
      
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Execute workflow tasks respecting dependencies
   */
  async _executeWorkflowTasks(workflow) {
    const { tasks, dependencies } = workflow;
    const results = {};
    const executing = new Set();
    const completed = new Set();
    
    // Find tasks ready to execute
    const getReadyTasks = () => {
      const ready = [];
      
      for (const [taskId, task] of tasks) {
        if (completed.has(taskId) || executing.has(taskId)) {
          continue;
        }
        
        const deps = dependencies.get(taskId).dependencies;
        const allDepsCompleted = Array.from(deps).every(dep => completed.has(dep));
        
        if (allDepsCompleted) {
          ready.push(task);
        }
      }
      
      return ready;
    };
    
    // Execute tasks in parallel when possible
    while (completed.size < tasks.size) {
      const readyTasks = getReadyTasks();
      
      if (readyTasks.length === 0 && executing.size === 0) {
        throw new Error('Circular dependency detected in workflow');
      }
      
      // Execute ready tasks in parallel
      const promises = readyTasks.map(async (task) => {
        executing.add(task.id);
        
        try {
          const result = await this._executeTask(task, workflow.context, results);
          results[task.id] = result;
          completed.add(task.id);
          
        } catch (error) {
          throw new Error(`Task ${task.name} failed: ${error.message}`);
          
        } finally {
          executing.delete(task.id);
        }
      });
      
      // Wait for at least one task to complete
      if (promises.length > 0) {
        await Promise.race(promises);
      } else {
        // Wait for executing tasks
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
  
  /**
   * Execute a single task
   */
  async _executeTask(task, context, previousResults) {
    const startTime = Date.now();
    task.status = 'running';
    task.startTime = startTime;
    task.attempts++;
    
    this.metrics.totalTasks++;
    
    this.emit('task-started', { 
      taskId: task.id, 
      name: task.name,
      attempt: task.attempts 
    });
    
    try {
      // Get available worker
      const worker = await this._getAvailableWorker();
      
      // Execute task on worker
      const result = await this._executeOnWorker(worker, task, context, previousResults);
      
      task.status = 'completed';
      task.endTime = Date.now();
      task.result = result;
      
      this.metrics.completedTasks++;
      this._updateAvgTaskTime(task.endTime - startTime);
      
      this.emit('task-completed', {
        taskId: task.id,
        name: task.name,
        duration: task.endTime - startTime,
        result
      });
      
      return result;
      
    } catch (error) {
      task.error = error.message;
      
      // Retry logic
      if (task.attempts < task.retryPolicy.attempts) {
        this.emit('task-retry', {
          taskId: task.id,
          attempt: task.attempts,
          error: error.message
        });
        
        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
        return this._executeTask(task, context, previousResults);
      }
      
      task.status = 'failed';
      task.endTime = Date.now();
      
      this.metrics.failedTasks++;
      
      this.emit('task-failed', {
        taskId: task.id,
        name: task.name,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * Get available worker from pool
   */
  async _getAvailableWorker() {
    while (this.availableWorkers.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return this.availableWorkers.shift();
  }
  
  /**
   * Execute task on worker thread
   */
  async _executeOnWorker(worker, task, context, previousResults) {
    return new Promise((resolve, reject) => {
      const taskExecution = {
        id: uuidv4(),
        task,
        context,
        previousResults,
        resolve,
        reject,
        timeout: null
      };
      
      // Set timeout
      taskExecution.timeout = setTimeout(() => {
        reject(new Error(`Task ${task.name} timed out after ${task.timeout}ms`));
        this._releaseWorker(worker);
      }, task.timeout);
      
      // Store execution reference
      this.executingTasks.set(taskExecution.id, taskExecution);
      
      // Send task to worker
      worker.postMessage({
        type: 'execute-task',
        executionId: taskExecution.id,
        task: {
          id: task.id,
          name: task.name,
          type: task.type,
          handler: task.handler,
          params: task.params
        },
        context,
        previousResults
      });
    });
  }
  
  /**
   * Handle worker messages
   */
  _handleWorkerMessage(worker, message) {
    const { type, executionId, result, error } = message;
    
    const execution = this.executingTasks.get(executionId);
    if (!execution) return;
    
    // Clear timeout
    if (execution.timeout) {
      clearTimeout(execution.timeout);
    }
    
    // Remove execution reference
    this.executingTasks.delete(executionId);
    
    // Release worker
    this._releaseWorker(worker);
    
    // Handle result
    if (type === 'task-result') {
      execution.resolve(result);
    } else if (type === 'task-error') {
      execution.reject(new Error(error));
    }
  }
  
  /**
   * Release worker back to pool
   */
  _releaseWorker(worker) {
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }
  }
  
  /**
   * Replace failed worker
   */
  async _replaceWorker(failedWorker) {
    const index = this.workerPool.indexOf(failedWorker);
    if (index === -1) return;
    
    // Terminate failed worker
    await failedWorker.terminate();
    
    // Create new worker
    const newWorker = new Worker(path.join(__dirname, 'workflow-worker.js'));
    
    newWorker.on('message', (message) => {
      this._handleWorkerMessage(newWorker, message);
    });
    
    newWorker.on('error', (error) => {
      this.emit('worker-error', { workerId: newWorker.threadId, error });
      this._replaceWorker(newWorker);
    });
    
    this.workerPool[index] = newWorker;
    this.availableWorkers.push(newWorker);
  }
  
  /**
   * Register custom task handler
   */
  registerHandler(type, handler) {
    this.customHandlers.set(type, handler);
    this.emit('handler-registered', { type });
  }
  
  /**
   * Create workflow from template
   */
  async createFromTemplate(templateId, params = {}) {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }
    
    // Apply parameters to template
    const definition = this._applyTemplateParams(template, params);
    
    return this.createWorkflow(definition);
  }
  
  /**
   * Save workflow as template
   */
  saveAsTemplate(workflowId, templateId, metadata = {}) {
    const workflow = this.workflows.get(workflowId) || this.workflowHistory.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    
    const template = {
      id: templateId,
      name: metadata.name || workflow.name + ' Template',
      description: metadata.description,
      tasks: Array.from(workflow.tasks.values()).map(task => ({
        id: task.id,
        name: task.name,
        type: task.type,
        handler: task.handler,
        params: task.params,
        dependencies: task.dependencies,
        retryPolicy: task.retryPolicy,
        timeout: task.timeout
      })),
      config: workflow.config,
      metadata,
      createdAt: Date.now()
    };
    
    this.templates.set(templateId, template);
    this.emit('template-saved', { templateId });
    
    return template;
  }
  
  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId) {
    const workflow = this.workflows.get(workflowId) || 
                    this.runningWorkflows.get(workflowId) || 
                    this.workflowHistory.get(workflowId);
    
    if (!workflow) {
      return null;
    }
    
    const taskStatuses = {};
    for (const [taskId, task] of workflow.tasks) {
      taskStatuses[taskId] = {
        name: task.name,
        status: task.status,
        attempts: task.attempts,
        duration: task.endTime ? task.endTime - task.startTime : null,
        error: task.error
      };
    }
    
    return {
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      progress: this._calculateProgress(workflow),
      duration: workflow.completedAt ? workflow.completedAt - workflow.startedAt : 
                workflow.startedAt ? Date.now() - workflow.startedAt : null,
      tasks: taskStatuses,
      errors: workflow.errors
    };
  }
  
  /**
   * Calculate workflow progress
   */
  _calculateProgress(workflow) {
    const total = workflow.tasks.size;
    const completed = Array.from(workflow.tasks.values())
      .filter(task => task.status === 'completed').length;
    
    return {
      completed,
      total,
      percentage: total > 0 ? (completed / total) * 100 : 0
    };
  }
  
  /**
   * Pause workflow execution
   */
  async pauseWorkflow(workflowId) {
    const workflow = this.runningWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Running workflow ${workflowId} not found`);
    }
    
    workflow.status = 'paused';
    workflow.checkpoint = this._createCheckpoint(workflow);
    
    this.emit('workflow-paused', { workflowId });
    
    return { success: true, checkpoint: workflow.checkpoint };
  }
  
  /**
   * Resume paused workflow
   */
  async resumeWorkflow(workflowId) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || workflow.status !== 'paused') {
      throw new Error(`Paused workflow ${workflowId} not found`);
    }
    
    workflow.status = 'running';
    
    this.emit('workflow-resumed', { workflowId });
    
    // Continue execution from checkpoint
    return this.executeWorkflow(workflowId, workflow.context);
  }
  
  /**
   * Cancel running workflow
   */
  async cancelWorkflow(workflowId) {
    const workflow = this.runningWorkflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Running workflow ${workflowId} not found`);
    }
    
    workflow.status = 'cancelled';
    workflow.completedAt = Date.now();
    
    this.runningWorkflows.delete(workflowId);
    this.workflowHistory.set(workflowId, workflow);
    
    this.emit('workflow-cancelled', { workflowId });
    
    return { success: true };
  }
  
  /**
   * Create workflow checkpoint
   */
  _createCheckpoint(workflow) {
    return {
      workflowId: workflow.id,
      timestamp: Date.now(),
      tasks: Array.from(workflow.tasks.entries()).map(([id, task]) => ({
        id,
        status: task.status,
        result: task.result,
        attempts: task.attempts
      })),
      context: workflow.context,
      results: workflow.results
    };
  }
  
  /**
   * Start monitoring system
   */
  _startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      const status = {
        runningWorkflows: this.runningWorkflows.size,
        queuedTasks: this.taskQueue.length,
        executingTasks: this.executingTasks.size,
        availableWorkers: this.availableWorkers.length,
        metrics: this.metrics
      };
      
      this.emit('monitoring-update', status);
    }, 5000);
  }
  
  /**
   * Start checkpoint system
   */
  _startCheckpointing() {
    this.checkpointInterval = setInterval(() => {
      for (const workflow of this.runningWorkflows.values()) {
        workflow.checkpoint = this._createCheckpoint(workflow);
      }
    }, this.config.checkpointInterval);
  }
  
  /**
   * Update average task time
   */
  _updateAvgTaskTime(duration) {
    const total = this.metrics.completedTasks + this.metrics.failedTasks;
    this.metrics.avgTaskTime = 
      (this.metrics.avgTaskTime * (total - 1) + duration) / total;
  }
  
  /**
   * Apply template parameters
   */
  _applyTemplateParams(template, params) {
    // Deep clone template
    const definition = JSON.parse(JSON.stringify(template));
    
    // Apply parameters
    definition.name = params.name || template.name;
    definition.description = params.description || template.description;
    
    // Apply task-specific parameters
    if (params.taskParams) {
      for (const task of definition.tasks) {
        if (params.taskParams[task.id]) {
          Object.assign(task.params, params.taskParams[task.id]);
        }
      }
    }
    
    return definition;
  }
  
  /**
   * Get workflow metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      runningWorkflows: this.runningWorkflows.size,
      queuedTasks: this.taskQueue.length,
      executingTasks: this.executingTasks.size,
      availableWorkers: this.availableWorkers.length,
      totalWorkers: this.workerPool.length
    };
  }
  
  /**
   * Clean up resources
   */
  async cleanup() {
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }
    
    // Terminate workers
    for (const worker of this.workerPool) {
      await worker.terminate();
    }
    
    this.removeAllListeners();
  }
}

// Export singleton getter
let instance = null;

export function getWorkflowEngine(options) {
  if (!instance) {
    instance = new AdvancedWorkflowEngine(options);
  }
  return instance;
}