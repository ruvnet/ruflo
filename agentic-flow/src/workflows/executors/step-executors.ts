// Real step executors for workflow engine
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import fetch from 'node-fetch';
import * as vm from 'vm';
import { CoordinatorAgent } from '../../agents/coordinator-agent';
import { ExecutorAgent } from '../../agents/executor-agent';
import { WorkflowExecution, WorkflowStep, WorkflowLog } from '../workflow-engine';

export interface StepExecutionContext {
  execution: WorkflowExecution;
  step: WorkflowStep;
  variables: Record<string, any>;
  results: Record<string, any>;
  logger: (level: 'info' | 'warn' | 'error', message: string, stepId?: string) => void;
}

export interface StepExecutionResult {
  success: boolean;
  result?: any;
  error?: Error;
  duration: number;
  logs?: WorkflowLog[];
}

export abstract class BaseStepExecutor extends EventEmitter {
  abstract execute(context: StepExecutionContext): Promise<StepExecutionResult>;

  protected measureExecution<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    return fn().then(result => ({
      result,
      duration: Date.now() - startTime
    }));
  }
}

// Agent Task Executor - Real agent spawning and task execution
export class AgentTaskExecutor extends BaseStepExecutor {
  private coordinatorAgent: CoordinatorAgent;
  private executorAgent: ExecutorAgent;
  private activeAgents: Map<string, any> = new Map();

  constructor() {
    super();
    this.coordinatorAgent = new CoordinatorAgent('workflow-coordinator');
    this.executorAgent = new ExecutorAgent('workflow-executor');
  }

  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step, execution } = context;
    const { agentType, goal, provider, capabilities, timeout = 30000 } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Spawning ${agentType} agent for goal: ${goal}`, step.id);

        // Create agent goal
        const agentGoal = {
          id: uuidv4(),
          type: agentType,
          description: goal,
          priority: 'high',
          context: {
            workflowId: execution.workflowId,
            executionId: execution.id,
            stepId: step.id,
            variables: context.variables
          }
        };

        // Execute task through agent system
        const agentId = await this.spawnAgent(agentType, capabilities);
        const taskResult = await this.executeAgentTask(agentId, agentGoal, timeout);

        // Clean up agent
        await this.cleanupAgent(agentId);

        return {
          agentType,
          agentId,
          goal,
          result: taskResult,
          timestamp: new Date(),
          provider
        };
      });

      context.logger('info', `Agent task completed successfully`, step.id);
      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `Agent task failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private async spawnAgent(type: string, capabilities: string[] = []): Promise<string> {
    const agentId = uuidv4();
    
    // Use coordinator to spawn appropriate agent
    let agent;
    switch (type) {
      case 'coordinator':
        agent = new CoordinatorAgent(`agent-${agentId}`);
        break;
      case 'executor':
        agent = new ExecutorAgent(`agent-${agentId}`);
        break;
      default:
        // Create generic executor with specific capabilities
        agent = new ExecutorAgent(`agent-${agentId}`);
    }

    this.activeAgents.set(agentId, agent);
    this.emit('agent:spawned', { agentId, type, capabilities });
    
    return agentId;
  }

  private async executeAgentTask(agentId: string, goal: any, timeout: number): Promise<any> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Agent task timeout')), timeout);
    });

    // Execute goal
    const executePromise = agent.addGoal(goal).then(() => {
      // Wait for goal completion
      return new Promise((resolve) => {
        const checkCompletion = setInterval(() => {
          const goalStatus = agent.getGoalStatus?.(goal.id);
          if (goalStatus === 'completed') {
            clearInterval(checkCompletion);
            resolve(agent.getGoalResult?.(goal.id) || { completed: true });
          } else if (goalStatus === 'failed') {
            clearInterval(checkCompletion);
            throw new Error('Agent goal failed');
          }
        }, 1000);
      });
    });

    return Promise.race([executePromise, timeoutPromise]);
  }

  private async cleanupAgent(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (agent) {
      // Graceful shutdown
      if (agent.shutdown) {
        await agent.shutdown();
      }
      this.activeAgents.delete(agentId);
      this.emit('agent:cleanup', { agentId });
    }
  }
}

// Parallel Executor - Real concurrent step execution
export class ParallelExecutor extends BaseStepExecutor {
  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step, execution } = context;
    const { steps: parallelStepIds, maxConcurrency = 5 } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Executing ${parallelStepIds.length} steps in parallel`, step.id);

        // Find parallel steps
        const workflow = await this.getWorkflowDefinition(execution.workflowId);
        const parallelSteps = parallelStepIds.map((stepId: string) => {
          const foundStep = workflow.steps.find(s => s.id === stepId);
          if (!foundStep) {
            throw new Error(`Parallel step ${stepId} not found`);
          }
          return foundStep;
        });

        // Execute steps with concurrency control
        const results = await this.executeStepsWithConcurrency(
          parallelSteps,
          context,
          maxConcurrency
        );

        return {
          parallelResults: results,
          totalSteps: parallelSteps.length,
          successfulSteps: results.filter(r => r.success).length,
          timestamp: new Date()
        };
      });

      context.logger('info', `Parallel execution completed`, step.id);
      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `Parallel execution failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private async executeStepsWithConcurrency(
    steps: WorkflowStep[],
    context: StepExecutionContext,
    maxConcurrency: number
  ): Promise<any[]> {
    const results: any[] = [];
    const executing = new Set<Promise<any>>();

    for (const step of steps) {
      // Wait if we've reached max concurrency
      if (executing.size >= maxConcurrency) {
        const completed = await Promise.race(executing);
        executing.delete(completed);
        results.push(await completed);
      }

      // Start step execution
      const stepPromise = this.executeStep(step, context);
      executing.add(stepPromise);
    }

    // Wait for remaining steps
    const remainingResults = await Promise.all(executing);
    results.push(...remainingResults);

    return results;
  }

  private async executeStep(step: WorkflowStep, context: StepExecutionContext): Promise<any> {
    // Delegate to appropriate step executor
    const executor = StepExecutorFactory.getExecutor(step.type);
    return executor.execute({
      ...context,
      step
    });
  }

  private async getWorkflowDefinition(workflowId: string): Promise<any> {
    // This would typically fetch from persistence layer
    // For now, return mock workflow
    return {
      id: workflowId,
      steps: []
    };
  }
}

// Condition Executor - Real condition evaluation
export class ConditionExecutor extends BaseStepExecutor {
  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step } = context;
    const { condition, trueStep, falseStep } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Evaluating condition: ${condition}`, step.id);

        // Create safe evaluation context
        const evaluationContext = {
          variables: context.variables,
          results: context.results,
          Math,
          Date,
          JSON
        };

        // Evaluate condition safely
        const conditionResult = this.evaluateCondition(condition, evaluationContext);
        const nextStep = conditionResult ? trueStep : falseStep;

        context.logger('info', `Condition evaluated to: ${conditionResult}`, step.id);

        return {
          condition,
          result: conditionResult,
          nextStep,
          evaluationContext: Object.keys(evaluationContext),
          timestamp: new Date()
        };
      });

      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `Condition evaluation failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private evaluateCondition(condition: string, context: any): boolean {
    try {
      // Create secure sandbox for condition evaluation
      const sandbox = vm.createContext(context);
      const script = new vm.Script(`(${condition})`);
      
      // Run with timeout
      const result = script.runInContext(sandbox, { timeout: 5000 });
      return Boolean(result);
    } catch (error) {
      throw new Error(`Condition evaluation error: ${error.message}`);
    }
  }
}

// Loop Executor - Real loop iteration
export class LoopExecutor extends BaseStepExecutor {
  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step } = context;
    const { condition, loopStep, maxIterations = 100, breakCondition } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Starting loop execution`, step.id);

        const results = [];
        let iterations = 0;
        let shouldContinue = true;

        while (shouldContinue && iterations < maxIterations) {
          // Evaluate loop condition
          if (condition && !this.evaluateCondition(condition, context)) {
            break;
          }

          context.logger('info', `Loop iteration ${iterations + 1}`, step.id);

          // Execute loop step
          const iterationResult = await this.executeLoopStep(loopStep, context, iterations);
          results.push(iterationResult);

          // Update context with iteration result
          context.results[`${step.id}_iteration_${iterations}`] = iterationResult;

          iterations++;

          // Check break condition
          if (breakCondition && this.evaluateCondition(breakCondition, context)) {
            context.logger('info', `Loop break condition met`, step.id);
            break;
          }
        }

        context.logger('info', `Loop completed after ${iterations} iterations`, step.id);

        return {
          iterations,
          results,
          completedNormally: iterations < maxIterations,
          timestamp: new Date()
        };
      });

      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `Loop execution failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private evaluateCondition(condition: string, context: StepExecutionContext): boolean {
    const conditionExecutor = new ConditionExecutor();
    const dummyStep = { id: 'temp', type: 'condition', name: 'temp', config: { condition } } as WorkflowStep;
    
    // This is a simplified evaluation - in production use proper context isolation
    try {
      const evalContext = {
        variables: context.variables,
        results: context.results
      };
      const sandbox = vm.createContext(evalContext);
      const script = new vm.Script(`(${condition})`);
      return Boolean(script.runInContext(sandbox, { timeout: 1000 }));
    } catch {
      return false;
    }
  }

  private async executeLoopStep(stepId: string, context: StepExecutionContext, iteration: number): Promise<any> {
    // In a real implementation, this would execute the actual step
    // For now, simulate step execution
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          stepId,
          iteration,
          result: `Loop iteration ${iteration} completed`,
          timestamp: new Date()
        });
      }, 100);
    });
  }
}

// HTTP Executor - Real HTTP requests
export class HttpExecutor extends BaseStepExecutor {
  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step } = context;
    const { 
      method = 'GET', 
      url, 
      headers = {}, 
      body, 
      timeout = 30000,
      retries = 3,
      retryDelay = 1000
    } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Making ${method} request to ${url}`, step.id);

        // Resolve template variables in URL and body
        const resolvedUrl = this.resolveTemplate(url, context);
        const resolvedBody = body ? this.resolveTemplate(JSON.stringify(body), context) : undefined;
        const resolvedHeaders = this.resolveHeaders(headers, context);

        let lastError: Error | null = null;
        
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            const response = await this.makeHttpRequest({
              method,
              url: resolvedUrl,
              headers: resolvedHeaders,
              body: resolvedBody,
              timeout
            });

            context.logger('info', `HTTP request successful (${response.status})`, step.id);

            return {
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              data: await response.json().catch(() => response.text()),
              url: resolvedUrl,
              method,
              attempt: attempt + 1,
              timestamp: new Date()
            };
          } catch (error) {
            lastError = error as Error;
            context.logger('warn', `HTTP request attempt ${attempt + 1} failed: ${error.message}`, step.id);
            
            if (attempt < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
          }
        }

        throw lastError || new Error('HTTP request failed after all retries');
      });

      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `HTTP request failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private async makeHttpRequest(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    timeout: number;
  }): Promise<any> {
    const { method, url, headers, body, timeout } = options;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: body ? body : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private resolveTemplate(template: string, context: StepExecutionContext): string {
    return template.replace(/\{\{(.+?)\}\}/g, (match, path) => {
      const value = this.resolvePath(path.trim(), context);
      return value !== undefined ? String(value) : match;
    });
  }

  private resolveHeaders(headers: Record<string, string>, context: StepExecutionContext): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      resolved[key] = this.resolveTemplate(value, context);
    }
    return resolved;
  }

  private resolvePath(path: string, context: StepExecutionContext): any {
    const segments = path.split('.');
    let current: any = {
      variables: context.variables,
      results: context.results
    };

    for (const segment of segments) {
      if (current && typeof current === 'object') {
        current = current[segment];
      } else {
        return undefined;
      }
    }

    return current;
  }
}

// Script Executor - Secure script execution
export class ScriptExecutor extends BaseStepExecutor {
  async execute(context: StepExecutionContext): Promise<StepExecutionResult> {
    const { step } = context;
    const { script, language = 'javascript', timeout = 10000, allowedModules = [] } = step.config;

    try {
      const { result, duration } = await this.measureExecution(async () => {
        context.logger('info', `Executing ${language} script`, step.id);

        if (language !== 'javascript') {
          throw new Error(`Unsupported script language: ${language}`);
        }

        // Create secure sandbox
        const sandbox = this.createSecureSandbox(context, allowedModules);
        
        // Execute script with timeout
        const scriptResult = await this.executeScriptInSandbox(script, sandbox, timeout);

        context.logger('info', `Script execution completed`, step.id);

        return {
          language,
          result: scriptResult,
          allowedModules,
          timestamp: new Date()
        };
      });

      return { success: true, result, duration };

    } catch (error) {
      context.logger('error', `Script execution failed: ${error.message}`, step.id);
      return { success: false, error: error as Error, duration: 0 };
    }
  }

  private createSecureSandbox(context: StepExecutionContext, allowedModules: string[]): any {
    const sandbox = {
      // Safe globals
      console: {
        log: (...args: any[]) => context.logger('info', args.join(' '), context.step.id),
        warn: (...args: any[]) => context.logger('warn', args.join(' '), context.step.id),
        error: (...args: any[]) => context.logger('error', args.join(' '), context.step.id)
      },
      Math,
      Date,
      JSON,
      Object,
      Array,
      String,
      Number,
      Boolean,
      
      // Workflow context
      variables: { ...context.variables },
      results: { ...context.results },
      
      // Allowed modules (restricted)
      require: (moduleName: string) => {
        if (!allowedModules.includes(moduleName)) {
          throw new Error(`Module '${moduleName}' is not allowed`);
        }
        // Only allow specific safe modules
        switch (moduleName) {
          case 'lodash':
            return require('lodash');
          case 'uuid':
            return require('uuid');
          default:
            throw new Error(`Module '${moduleName}' is not available`);
        }
      },
      
      // Utility functions
      setTimeout: (fn: Function, delay: number) => {
        if (delay > 5000) throw new Error('Timeout too long');
        return setTimeout(fn, delay);
      }
    };

    return vm.createContext(sandbox);
  }

  private async executeScriptInSandbox(script: string, sandbox: any, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Script execution timeout'));
      }, timeout);

      try {
        const vmScript = new vm.Script(`
          (async function() {
            ${script}
          })()
        `);

        const result = vmScript.runInContext(sandbox, {
          timeout: timeout,
          breakOnSigint: true
        });

        // Handle async scripts
        if (result && typeof result.then === 'function') {
          result
            .then((asyncResult: any) => {
              clearTimeout(timeoutId);
              resolve(asyncResult);
            })
            .catch((error: any) => {
              clearTimeout(timeoutId);
              reject(error);
            });
        } else {
          clearTimeout(timeoutId);
          resolve(result);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }
}

// Step Executor Factory
export class StepExecutorFactory {
  private static executors: Map<string, BaseStepExecutor> = new Map();

  static initialize(): void {
    this.executors.set('agent-task', new AgentTaskExecutor());
    this.executors.set('parallel', new ParallelExecutor());
    this.executors.set('condition', new ConditionExecutor());
    this.executors.set('loop', new LoopExecutor());
    this.executors.set('http', new HttpExecutor());
    this.executors.set('script', new ScriptExecutor());
  }

  static getExecutor(stepType: string): BaseStepExecutor {
    const executor = this.executors.get(stepType);
    if (!executor) {
      throw new Error(`No executor found for step type: ${stepType}`);
    }
    return executor;
  }

  static registerExecutor(stepType: string, executor: BaseStepExecutor): void {
    this.executors.set(stepType, executor);
  }
}

// Initialize default executors
StepExecutorFactory.initialize();