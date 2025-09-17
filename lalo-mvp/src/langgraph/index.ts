import { StateGraph, END, START } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { Workflow, WorkflowNode, WorkflowEdge, WorkflowError } from '../types/index.js';
import { getConfig } from '../config/index.js';

export interface WorkflowState {
  messages: BaseMessage[];
  data: Record<string, any>;
  currentNode: string;
  completed: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export class LangGraphOrchestrator {
  private config = getConfig().langgraph;
  private workflows = new Map<string, StateGraph<WorkflowState>>();
  private activeExecutions = new Map<string, any>();

  constructor() {
    this.setupLogging();
  }

  private setupLogging(): void {
    if (this.config.enableLogging) {
      console.log('LangGraph Orchestrator initialized with logging enabled');
    }
  }

  /**
   * Register a workflow for execution
   */
  async registerWorkflow(workflow: Workflow): Promise<void> {
    try {
      const graph = this.buildGraph(workflow);
      this.workflows.set(workflow.id, graph);

      if (this.config.enableLogging) {
        console.log(`Workflow registered: ${workflow.id}`);
      }
    } catch (error) {
      throw new WorkflowError(`Failed to register workflow: ${error.message}`, { workflow: workflow.id });
    }
  }

  /**
   * Execute a workflow with given input
   */
  async executeWorkflow(
    workflowId: string,
    input: Record<string, any>,
    options?: { timeout?: number; retries?: number }
  ): Promise<WorkflowState> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError(`Workflow not found: ${workflowId}`);
    }

    const executionId = `${workflowId}-${Date.now()}`;
    const timeout = options?.timeout || this.config.timeout;
    const retries = options?.retries || this.config.maxRetries;

    try {
      const initialState: WorkflowState = {
        messages: [],
        data: input,
        currentNode: 'start',
        completed: false,
        metadata: { executionId, startTime: Date.now() }
      };

      this.activeExecutions.set(executionId, { workflowId, startTime: Date.now() });

      const result = await this.executeWithRetries(workflow, initialState, retries, timeout);

      this.activeExecutions.delete(executionId);

      if (this.config.enableLogging) {
        console.log(`Workflow completed: ${executionId}`);
      }

      return result;
    } catch (error) {
      this.activeExecutions.delete(executionId);
      throw new WorkflowError(`Workflow execution failed: ${error.message}`, {
        workflowId,
        executionId,
        error: error.message
      });
    }
  }

  /**
   * Build a StateGraph from workflow definition
   */
  private buildGraph(workflow: Workflow): StateGraph<WorkflowState> {
    const graph = new StateGraph<WorkflowState>({
      channels: {
        messages: [],
        data: {},
        currentNode: "",
        completed: false,
        error: undefined,
        metadata: {}
      }
    });

    // Add nodes
    for (const node of workflow.nodes) {
      if (node.type === 'start') {
        graph.addNode('start', this.createStartNode(node));
      } else if (node.type === 'end') {
        graph.addNode('end', this.createEndNode(node));
      } else {
        graph.addNode(node.id, this.createTaskNode(node));
      }
    }

    // Add edges
    for (const edge of workflow.edges) {
      if (edge.condition) {
        graph.addConditionalEdges(
          edge.from,
          this.createConditionFunction(edge.condition),
          { true: edge.to, false: END }
        );
      } else {
        graph.addEdge(edge.from, edge.to);
      }
    }

    // Set entry point
    graph.setEntryPoint('start');

    return graph.compile();
  }

  /**
   * Create start node function
   */
  private createStartNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      if (this.config.enableLogging) {
        console.log(`Starting workflow node: ${node.name}`);
      }

      return {
        currentNode: node.id,
        metadata: {
          ...state.metadata,
          nodeStartTime: Date.now()
        }
      };
    };
  }

  /**
   * Create end node function
   */
  private createEndNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      if (this.config.enableLogging) {
        console.log(`Ending workflow node: ${node.name}`);
      }

      return {
        currentNode: node.id,
        completed: true,
        metadata: {
          ...state.metadata,
          endTime: Date.now(),
          duration: Date.now() - (state.metadata?.startTime || 0)
        }
      };
    };
  }

  /**
   * Create task node function
   */
  private createTaskNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      if (this.config.enableLogging) {
        console.log(`Executing task node: ${node.name}`);
      }

      try {
        let result = state.data;

        // Execute the function if specified
        if (node.function) {
          result = await this.executeFunction(node.function, state.data);
        }

        return {
          currentNode: node.id,
          data: result,
          metadata: {
            ...state.metadata,
            [`${node.id}_completed`]: Date.now()
          }
        };
      } catch (error) {
        throw new WorkflowError(`Task node failed: ${node.name}`, {
          nodeId: node.id,
          error: error.message
        });
      }
    };
  }

  /**
   * Create condition function for conditional edges
   */
  private createConditionFunction(condition: string) {
    return (state: WorkflowState): string => {
      try {
        // Simple condition evaluation - in production, use a safer evaluator
        const result = this.evaluateCondition(condition, state);
        return result ? 'true' : 'false';
      } catch (error) {
        console.error(`Condition evaluation failed: ${condition}`, error);
        return 'false';
      }
    };
  }

  /**
   * Execute a function by name with error handling
   */
  private async executeFunction(functionName: string, data: any): Promise<any> {
    // This is a simplified function executor
    // In production, implement a proper function registry
    switch (functionName) {
      case 'validate_input':
        return this.validateInput(data);
      case 'process_data':
        return this.processData(data);
      case 'generate_response':
        return this.generateResponse(data);
      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  /**
   * Simple condition evaluator
   */
  private evaluateCondition(condition: string, state: WorkflowState): boolean {
    // Simple condition parsing - enhance for production
    if (condition.includes('data.')) {
      const path = condition.replace('data.', '');
      const value = this.getNestedValue(state.data, path);
      return Boolean(value);
    }
    return false;
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Execute workflow with retry logic
   */
  private async executeWithRetries(
    graph: StateGraph<WorkflowState>,
    initialState: WorkflowState,
    retries: number,
    timeout: number
  ): Promise<WorkflowState> {
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await Promise.race([
          graph.invoke(initialState),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Workflow timeout')), timeout)
          )
        ]);
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          if (this.config.enableLogging) {
            console.log(`Workflow attempt ${attempt + 1} failed, retrying...`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * Sample function implementations
   */
  private async validateInput(data: any): Promise<any> {
    // Implement input validation logic
    return { ...data, validated: true };
  }

  private async processData(data: any): Promise<any> {
    // Implement data processing logic
    return { ...data, processed: true, timestamp: Date.now() };
  }

  private async generateResponse(data: any): Promise<any> {
    // Implement response generation logic
    return { ...data, response: 'Generated response', generated: true };
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): Array<{ executionId: string; workflowId: string; startTime: number }> {
    return Array.from(this.activeExecutions.entries()).map(([id, info]) => ({
      executionId: id,
      ...info
    }));
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    if (this.activeExecutions.has(executionId)) {
      this.activeExecutions.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Get registered workflows
   */
  getWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }
}

export default LangGraphOrchestrator;