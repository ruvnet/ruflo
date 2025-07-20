import { EventEmitter } from 'events';
import { createMachine, interpret, State } from 'xstate';
import { v4 as uuidv4 } from 'uuid';
import { WorkflowStateManager, SQLiteWorkflowStateStore } from './persistence/workflow-state-manager';

export interface WorkflowStep {
  id: string;
  type: 'agent-task' | 'parallel' | 'condition' | 'loop' | 'http' | 'script';
  name: string;
  config: any;
  next?: string[];
  onSuccess?: string;
  onFailure?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: WorkflowStep[];
  variables: Record<string, any>;
  triggers: WorkflowTrigger[];
}

export interface WorkflowTrigger {
  type: 'manual' | 'scheduled' | 'event' | 'webhook';
  config: any;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  currentStep?: string;
  variables: Record<string, any>;
  results: Record<string, any>;
  logs: WorkflowLog[];
}

export interface WorkflowLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
  stepId?: string;
  data?: any;
}

export class WorkflowEngine extends EventEmitter {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private machines: Map<string, any> = new Map();
  private stateManager: WorkflowStateManager;
  private enablePersistence: boolean;

  constructor(options: { enablePersistence?: boolean; dbPath?: string } = {}) {
    super();
    this.enablePersistence = options.enablePersistence ?? true;
    
    if (this.enablePersistence) {
      const store = new SQLiteWorkflowStateStore(options.dbPath);
      this.stateManager = new WorkflowStateManager(store);
      this.setupStateManagerEvents();
    }
  }

  async createWorkflow(definition: WorkflowDefinition): Promise<void> {
    // Validate workflow definition
    this.validateWorkflow(definition);
    
    // Create XState machine
    const machine = this.createStateMachine(definition);
    
    // Store workflow and machine
    this.workflows.set(definition.id, definition);
    this.machines.set(definition.id, machine);
    
    // Persist workflow definition
    if (this.enablePersistence) {
      await this.stateManager.saveWorkflow(definition);
    }
    
    this.emit('workflow:created', { workflowId: definition.id });
  }

  async executeWorkflow(workflowId: string, variables: Record<string, any> = {}): Promise<string> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const executionId = uuidv4();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      status: 'pending',
      startTime: new Date(),
      variables: { ...workflow.variables, ...variables },
      results: {},
      logs: []
    };

    this.executions.set(executionId, execution);
    
    // Persist initial execution state
    if (this.enablePersistence) {
      await this.stateManager.saveExecution(execution);
    }
    
    // Start execution
    this.startExecution(execution);
    
    return executionId;
  }

  private async startExecution(execution: WorkflowExecution): Promise<void> {
    const workflow = this.workflows.get(execution.workflowId)!;
    const machine = this.machines.get(execution.workflowId)!;
    
    execution.status = 'running';
    this.logExecution(execution, 'info', `Starting workflow execution`);
    
    try {
      const service = interpret(machine).onTransition((state) => {
        this.handleStateTransition(execution, state);
      });
      
      service.start();
      
      // Execute first step
      const firstStep = workflow.steps[0];
      if (firstStep) {
        await this.executeStep(execution, firstStep);
      }
      
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      this.logExecution(execution, 'error', `Workflow failed: ${error.message}`);
      this.emit('workflow:failed', { executionId: execution.id, error });
    }
  }

  private async executeStep(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    execution.currentStep = step.id;
    this.logExecution(execution, 'info', `Executing step: ${step.name}`, step.id);
    
    try {
      let result: any;
      
      switch (step.type) {
        case 'agent-task':
          result = await this.executeAgentTask(execution, step);
          break;
        case 'parallel':
          result = await this.executeParallel(execution, step);
          break;
        case 'condition':
          result = await this.executeCondition(execution, step);
          break;
        case 'loop':
          result = await this.executeLoop(execution, step);
          break;
        case 'http':
          result = await this.executeHttpRequest(execution, step);
          break;
        case 'script':
          result = await this.executeScript(execution, step);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
      
      execution.results[step.id] = result;
      this.logExecution(execution, 'info', `Step completed: ${step.name}`, step.id);
      
      // Persist execution state after step completion
      if (this.enablePersistence) {
        await this.stateManager.updateExecution(execution);
      }
      
      // Execute next steps
      await this.executeNextSteps(execution, step, result);
      
    } catch (error) {
      this.logExecution(execution, 'error', `Step failed: ${error.message}`, step.id);
      
      if (step.onFailure) {
        await this.executeNextStep(execution, step.onFailure);
      } else {
        throw error;
      }
    }
  }

  private async executeAgentTask(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('agent-task');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('Agent task execution failed');
    }
    
    return result.result;
  }

  private async executeParallel(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('parallel');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('Parallel execution failed');
    }
    
    return result.result;
  }

  private async executeCondition(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('condition');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('Condition evaluation failed');
    }
    
    // Handle next step execution based on condition result
    const { nextStep } = result.result;
    if (nextStep) {
      await this.executeNextStep(execution, nextStep);
    }
    
    return result.result;
  }

  private async executeLoop(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('loop');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('Loop execution failed');
    }
    
    return result.result;
  }

  private async executeHttpRequest(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('http');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('HTTP request failed');
    }
    
    return result.result;
  }

  private async executeScript(execution: WorkflowExecution, step: WorkflowStep): Promise<any> {
    const { StepExecutorFactory } = await import('./executors/step-executors');
    const executor = StepExecutorFactory.getExecutor('script');
    
    const context = {
      execution,
      step,
      variables: execution.variables,
      results: execution.results,
      logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => {
        this.logExecution(execution, level, message, stepId);
      }
    };

    const result = await executor.execute(context);
    if (!result.success) {
      throw result.error || new Error('Script execution failed');
    }
    
    return result.result;
  }

  private async executeNextSteps(execution: WorkflowExecution, step: WorkflowStep, result: any): Promise<void> {
    if (step.next) {
      for (const nextStepId of step.next) {
        await this.executeNextStep(execution, nextStepId);
      }
    } else if (step.onSuccess) {
      await this.executeNextStep(execution, step.onSuccess);
    } else {
      // No more steps, complete workflow
      execution.status = 'completed';
      execution.endTime = new Date();
      this.logExecution(execution, 'info', 'Workflow completed successfully');
      
      // Persist final state
      if (this.enablePersistence) {
        await this.stateManager.updateExecution(execution);
        await this.stateManager.cleanup(execution.id);
      }
      
      this.emit('workflow:completed', { executionId: execution.id });
    }
  }

  private async executeNextStep(execution: WorkflowExecution, stepId: string): Promise<any> {
    const workflow = this.workflows.get(execution.workflowId)!;
    const nextStep = workflow.steps.find(s => s.id === stepId);
    
    if (!nextStep) {
      throw new Error(`Next step ${stepId} not found`);
    }
    
    return this.executeStep(execution, nextStep);
  }

  private evaluateCondition(condition: string, execution: WorkflowExecution): boolean {
    // Simple condition evaluation
    // In a real implementation, this would use a proper expression evaluator
    const context = {
      variables: execution.variables,
      results: execution.results
    };
    
    try {
      // This is a simplified evaluation - use a proper expression parser in production
      return new Function('context', `with(context) { return ${condition}; }`)(context);
    } catch (error) {
      this.logExecution(execution, 'warn', `Condition evaluation failed: ${error.message}`);
      return false;
    }
  }

  private createStateMachine(workflow: WorkflowDefinition): any {
    const states: any = {};
    
    workflow.steps.forEach(step => {
      states[step.id] = {
        on: {
          COMPLETE: step.next ? step.next[0] : 'completed',
          FAIL: step.onFailure || 'failed'
        }
      };
    });
    
    states.completed = { type: 'final' };
    states.failed = { type: 'final' };
    
    return createMachine({
      id: workflow.id,
      initial: workflow.steps[0]?.id || 'completed',
      states
    });
  }

  private handleStateTransition(execution: WorkflowExecution, state: State<any>): void {
    this.logExecution(execution, 'info', `State transition: ${state.value}`);
    this.emit('workflow:state-change', { 
      executionId: execution.id, 
      state: state.value 
    });
  }

  private validateWorkflow(workflow: WorkflowDefinition): void {
    if (!workflow.id || !workflow.name || !workflow.steps.length) {
      throw new Error('Invalid workflow definition');
    }
    
    // Validate step references
    const stepIds = new Set(workflow.steps.map(s => s.id));
    workflow.steps.forEach(step => {
      if (step.next) {
        step.next.forEach(nextId => {
          if (!stepIds.has(nextId)) {
            throw new Error(`Invalid step reference: ${nextId}`);
          }
        });
      }
    });
  }

  private logExecution(execution: WorkflowExecution, level: 'info' | 'warn' | 'error', message: string, stepId?: string): void {
    const log: WorkflowLog = {
      timestamp: new Date(),
      level,
      message,
      stepId
    };
    
    execution.logs.push(log);
    this.emit('workflow:log', { executionId: execution.id, log });
    
    // Persist logs periodically (every 10 logs)
    if (this.enablePersistence && execution.logs.length % 10 === 0) {
      await this.stateManager.updateExecution(execution);
    }
  }

  // Public API methods
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  listExecutions(workflowId?: string): WorkflowExecution[] {
    const executions = Array.from(this.executions.values());
    return workflowId ? executions.filter(e => e.workflowId === workflowId) : executions;
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    
    execution.status = 'cancelled';
    execution.endTime = new Date();
    this.logExecution(execution, 'info', 'Execution cancelled');
    
    // Persist cancelled state
    if (this.enablePersistence) {
      await this.stateManager.updateExecution(execution);
      await this.stateManager.cleanup(execution.id);
    }
    
    this.emit('workflow:cancelled', { executionId });
  }

  // Workflow resume capability
  async resumeWorkflow(executionId: string): Promise<void> {
    if (!this.enablePersistence) {
      throw new Error('Persistence is disabled, cannot resume workflow');
    }

    // Load execution from persistence
    const execution = await this.stateManager.getExecution(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== 'paused' && execution.status !== 'failed') {
      throw new Error(`Cannot resume workflow in status ${execution.status}`);
    }

    // Load workflow definition
    const workflow = await this.stateManager.getWorkflow(execution.workflowId);
    if (!workflow) {
      throw new Error(`Workflow definition ${execution.workflowId} not found`);
    }

    // Restore to in-memory maps
    this.workflows.set(execution.workflowId, workflow);
    this.executions.set(executionId, execution);

    // Create XState machine
    const machine = this.createStateMachine(workflow);
    this.machines.set(execution.workflowId, machine);

    // Resume from current step
    execution.status = 'running';
    await this.stateManager.updateExecution(execution);

    if (execution.currentStep) {
      const currentStep = workflow.steps.find(s => s.id === execution.currentStep);
      if (currentStep) {
        this.logExecution(execution, 'info', `Resuming workflow from step: ${currentStep.name}`);
        await this.executeStep(execution, currentStep);
      }
    }

    this.emit('workflow:resumed', { executionId });
  }

  // Pause workflow execution
  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== 'running') {
      throw new Error(`Cannot pause workflow in status ${execution.status}`);
    }

    execution.status = 'paused';
    this.logExecution(execution, 'info', 'Workflow paused');

    if (this.enablePersistence) {
      await this.stateManager.updateExecution(execution);
      await this.stateManager.createSnapshot(executionId, execution);
    }

    this.emit('workflow:paused', { executionId });
  }

  // Enable auto-snapshots for running workflows
  async enableAutoSnapshots(executionId: string, intervalMs = 60000): Promise<void> {
    if (!this.enablePersistence) {
      throw new Error('Persistence is disabled, cannot enable auto-snapshots');
    }

    await this.stateManager.enableAutoSnapshots(executionId, intervalMs);
  }

  // Setup state manager event handlers
  private setupStateManagerEvents(): void {
    if (!this.stateManager) return;

    this.stateManager.on('execution:saved', (data) => {
      this.emit('persistence:execution-saved', data);
    });

    this.stateManager.on('execution:updated', (data) => {
      this.emit('persistence:execution-updated', data);
    });

    this.stateManager.on('snapshot:created', (data) => {
      this.emit('persistence:snapshot-created', data);
    });

    this.stateManager.on('workflow:saved', (data) => {
      this.emit('persistence:workflow-saved', data);
    });

    this.stateManager.on('error', (data) => {
      this.emit('persistence:error', data);
    });
  }

  // Cleanup and shutdown
  async shutdown(): Promise<void> {
    // Cancel all running executions
    for (const [executionId, execution] of this.executions) {
      if (execution.status === 'running') {
        await this.cancelExecution(executionId);
      }
    }

    // Shutdown state manager
    if (this.stateManager) {
      await this.stateManager.shutdown();
    }

    // Clear all data
    this.workflows.clear();
    this.executions.clear();
    this.machines.clear();

    this.removeAllListeners();
  }

  // Get workflow execution metrics
  getExecutionMetrics(executionId: string): any {
    const execution = this.executions.get(executionId);
    if (!execution) return null;

    const totalSteps = execution.results ? Object.keys(execution.results).length : 0;
    const duration = execution.endTime 
      ? execution.endTime.getTime() - execution.startTime.getTime()
      : Date.now() - execution.startTime.getTime();

    return {
      executionId,
      status: execution.status,
      totalSteps,
      duration,
      startTime: execution.startTime,
      endTime: execution.endTime,
      currentStep: execution.currentStep,
      logs: execution.logs.length,
      errors: execution.logs.filter(l => l.level === 'error').length
    };
  }

  // List all executions with optional filtering
  listExecutions(filter?: { status?: string; workflowId?: string }): WorkflowExecution[] {
    let executions = Array.from(this.executions.values());

    if (filter) {
      if (filter.status) {
        executions = executions.filter(e => e.status === filter.status);
      }
      if (filter.workflowId) {
        executions = executions.filter(e => e.workflowId === filter.workflowId);
      }
    }

    return executions;
  }
}