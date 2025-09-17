import { StateGraph, END, START } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { EventEmitter } from 'events';
import { Workflow, WorkflowNode, WorkflowEdge, WorkflowError } from '../types/index.js';
import { getConfig } from '../config/index.js';
import GovernanceSystem from '../governance/index.js';
import RAGSystem from '../rag/index.js';
import NL2SQLEngine from '../nl2sql/index.js';

export interface WorkflowState {
  messages: BaseMessage[];
  data: Record<string, any>;
  currentNode: string;
  completed: boolean;
  error?: string;
  metadata?: Record<string, any>;
  context?: Record<string, any>;
  ragResults?: any[];
  sqlResults?: any[];
  parallelResults?: Map<string, any>;
  governanceApproval?: {
    required: boolean;
    proposalId?: string;
    approved?: boolean;
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  state: WorkflowState;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  progress: number;
  metrics: ExecutionMetrics;
  error?: string;
}

export interface ExecutionMetrics {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  executionTime: number;
  memoryUsage: number;
  resourceUsage: Record<string, any>;
  parallelExecutions: number;
}

export interface WorkflowEvents {
  'workflow:started': [WorkflowExecution];
  'workflow:node:enter': [string, WorkflowNode, WorkflowState];
  'workflow:node:exit': [string, WorkflowNode, WorkflowState];
  'workflow:node:error': [string, WorkflowNode, Error];
  'workflow:paused': [WorkflowExecution];
  'workflow:resumed': [WorkflowExecution];
  'workflow:completed': [WorkflowExecution];
  'workflow:failed': [WorkflowExecution, Error];
  'workflow:cancelled': [WorkflowExecution];
  'governance:approval:required': [string, any];
  'governance:approval:received': [string, boolean];
  'rag:context:injected': [string, any[]];
  'sql:query:executed': [string, any];
}

export class EnhancedLangGraphOrchestrator extends EventEmitter {
  private config = getConfig().langgraph;
  private workflows = new Map<string, StateGraph<WorkflowState>>();
  private activeExecutions = new Map<string, WorkflowExecution>();
  private pausedExecutions = new Map<string, WorkflowExecution>();
  private governanceSystem: GovernanceSystem;
  private ragSystem: RAGSystem;
  private nl2sqlEngine: NL2SQLEngine;
  private functionRegistry = new Map<string, Function>();
  private workflowMemory = new Map<string, Record<string, any>>();
  private parallelExecutionPool = new Map<string, Promise<any>[]>();

  constructor(
    governanceSystem?: GovernanceSystem,
    ragSystem?: RAGSystem,
    nl2sqlEngine?: NL2SQLEngine
  ) {
    super();
    this.governanceSystem = governanceSystem || new GovernanceSystem();
    this.ragSystem = ragSystem || new RAGSystem();
    this.nl2sqlEngine = nl2sqlEngine || new NL2SQLEngine();

    this.setupLogging();
    this.setupIntegrations();
    this.registerBuiltinFunctions();
  }

  private setupLogging(): void {
    if (this.config.enableLogging) {
      console.log('Enhanced LangGraph Orchestrator initialized with logging enabled');
    }
  }

  private setupIntegrations(): void {
    // Setup governance integration
    this.governanceSystem.on('proposal:executed', (proposalId) => {
      this.emit('governance:approval:received', proposalId, true);
    });

    this.governanceSystem.on('proposal:rejected', (proposalId) => {
      this.emit('governance:approval:received', proposalId, false);
    });

    // Setup workflow lifecycle events
    this.on('workflow:started', (execution) => {
      this.logEvent('Workflow started', { executionId: execution.id, workflowId: execution.workflowId });
    });

    this.on('workflow:completed', (execution) => {
      this.logEvent('Workflow completed', {
        executionId: execution.id,
        duration: execution.endTime ? execution.endTime.getTime() - execution.startTime.getTime() : 0
      });
    });
  }

  private registerBuiltinFunctions(): void {
    // Register built-in workflow functions
    this.functionRegistry.set('validate_input', this.validateInput.bind(this));
    this.functionRegistry.set('process_data', this.processData.bind(this));
    this.functionRegistry.set('generate_response', this.generateResponse.bind(this));
    this.functionRegistry.set('rag_search', this.executeRAGSearch.bind(this));
    this.functionRegistry.set('sql_query', this.executeSQLQuery.bind(this));
    this.functionRegistry.set('governance_check', this.checkGovernanceApproval.bind(this));
    this.functionRegistry.set('parallel_execute', this.executeParallel.bind(this));
    this.functionRegistry.set('wait_for_approval', this.waitForApproval.bind(this));
  }

  private logEvent(message: string, data?: any): void {
    if (this.config.enableLogging) {
      console.log(`[Enhanced LangGraph] ${message}`, data || '');
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
   * Execute a workflow with given input and advanced options
   */
  async executeWorkflow(
    workflowId: string,
    input: Record<string, any>,
    options?: {
      timeout?: number;
      retries?: number;
      requireGovernance?: boolean;
      context?: Record<string, any>;
      enableRAG?: boolean;
      enableSQL?: boolean;
      pauseOnError?: boolean;
    }
  ): Promise<WorkflowState> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError(`Workflow not found: ${workflowId}`);
    }

    const executionId = `${workflowId}-${Date.now()}`;
    const timeout = options?.timeout || this.config.timeout;
    const retries = options?.retries || this.config.maxRetries;

    // Check governance approval if required
    if (options?.requireGovernance) {
      const approvalRequired = await this.checkGovernanceRequirement(workflowId, input);
      if (approvalRequired && !await this.hasGovernanceApproval(workflowId)) {
        throw new WorkflowError(`Governance approval required for workflow: ${workflowId}`);
      }
    }

    try {
      const initialState: WorkflowState = {
        messages: [],
        data: input,
        currentNode: 'start',
        completed: false,
        context: options?.context || {},
        metadata: {
          executionId,
          startTime: Date.now(),
          enableRAG: options?.enableRAG || false,
          enableSQL: options?.enableSQL || false,
          pauseOnError: options?.pauseOnError || false
        },
        ragResults: [],
        sqlResults: [],
        parallelResults: new Map(),
        governanceApproval: {
          required: options?.requireGovernance || false
        }
      };

      const execution: WorkflowExecution = {
        id: executionId,
        workflowId,
        state: initialState,
        status: 'running',
        startTime: new Date(),
        progress: 0,
        metrics: {
          totalNodes: this.countWorkflowNodes(workflowId),
          completedNodes: 0,
          failedNodes: 0,
          executionTime: 0,
          memoryUsage: 0,
          resourceUsage: {},
          parallelExecutions: 0
        }
      };

      this.activeExecutions.set(executionId, execution);
      this.emit('workflow:started', execution);

      const result = await this.executeWithRetries(workflow, initialState, retries, timeout, execution);

      execution.status = 'completed';
      execution.endTime = new Date();
      execution.progress = 100;
      execution.metrics.executionTime = execution.endTime.getTime() - execution.startTime.getTime();

      this.emit('workflow:completed', execution);
      this.activeExecutions.delete(executionId);

      return result;
    } catch (error) {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.status = 'failed';
        execution.error = error.message;
        execution.endTime = new Date();
        this.emit('workflow:failed', execution, error);
      }
      this.activeExecutions.delete(executionId);
      throw new WorkflowError(`Workflow execution failed: ${error.message}`, {
        workflowId,
        executionId,
        error: error.message
      });
    }
  }

  /**
   * Build a StateGraph from workflow definition with enhanced features
   */
  private buildGraph(workflow: Workflow): StateGraph<WorkflowState> {
    const graph = new StateGraph<WorkflowState>({
      channels: {
        messages: [],
        data: {},
        currentNode: "",
        completed: false,
        error: undefined,
        metadata: {},
        context: {},
        ragResults: [],
        sqlResults: [],
        parallelResults: new Map(),
        governanceApproval: { required: false }
      }
    });

    // Add nodes with enhanced capabilities
    for (const node of workflow.nodes) {
      if (node.type === 'start') {
        graph.addNode('start', this.createStartNode(node));
      } else if (node.type === 'end') {
        graph.addNode('end', this.createEndNode(node));
      } else if (node.type === 'decision') {
        graph.addNode(node.id, this.createDecisionNode(node));
      } else if (node.type === 'parallel') {
        graph.addNode(node.id, this.createParallelNode(node));
      } else {
        graph.addNode(node.id, this.createTaskNode(node));
      }
    }

    // Add edges with enhanced conditional support
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
   * Create enhanced start node function
   */
  private createStartNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      this.emit('workflow:node:enter', state.metadata?.executionId || '', node, state);

      if (this.config.enableLogging) {
        console.log(`Starting workflow node: ${node.name}`);
      }

      const updatedState = {
        currentNode: node.id,
        metadata: {
          ...state.metadata,
          nodeStartTime: Date.now()
        }
      };

      this.emit('workflow:node:exit', state.metadata?.executionId || '', node, { ...state, ...updatedState });
      return updatedState;
    };
  }

  /**
   * Create enhanced end node function
   */
  private createEndNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      this.emit('workflow:node:enter', state.metadata?.executionId || '', node, state);

      if (this.config.enableLogging) {
        console.log(`Ending workflow node: ${node.name}`);
      }

      const updatedState = {
        currentNode: node.id,
        completed: true,
        metadata: {
          ...state.metadata,
          endTime: Date.now(),
          duration: Date.now() - (state.metadata?.startTime || 0)
        }
      };

      this.emit('workflow:node:exit', state.metadata?.executionId || '', node, { ...state, ...updatedState });
      return updatedState;
    };
  }

  /**
   * Create decision node for complex branching
   */
  private createDecisionNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      this.emit('workflow:node:enter', state.metadata?.executionId || '', node, state);

      if (this.config.enableLogging) {
        console.log(`Executing decision node: ${node.name}`);
      }

      try {
        let result = state.data;

        // Execute decision logic
        if (node.function) {
          result = await this.executeFunction(node.function, state.data, state);
        }

        // Evaluate conditions for next nodes
        const nextNode = this.evaluateDecisionConditions(node, result);

        const updatedState = {
          currentNode: node.id,
          data: result,
          metadata: {
            ...state.metadata,
            [`${node.id}_decision`]: nextNode,
            [`${node.id}_completed`]: Date.now()
          }
        };

        this.emit('workflow:node:exit', state.metadata?.executionId || '', node, { ...state, ...updatedState });
        return updatedState;
      } catch (error) {
        this.emit('workflow:node:error', state.metadata?.executionId || '', node, error);
        throw new WorkflowError(`Decision node failed: ${node.name}`, {
          nodeId: node.id,
          error: error.message
        });
      }
    };
  }

  /**
   * Create parallel node for concurrent execution
   */
  private createParallelNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      this.emit('workflow:node:enter', state.metadata?.executionId || '', node, state);

      if (this.config.enableLogging) {
        console.log(`Executing parallel node: ${node.name}`);
      }

      try {
        let result = state.data;

        // Execute parallel tasks
        if (node.next && Array.isArray(node.next)) {
          result = await this.executeParallelTasks(node.next, state);
        } else if (node.function) {
          result = await this.executeFunction(node.function, state.data, state);
        }

        const updatedState = {
          currentNode: node.id,
          data: result,
          metadata: {
            ...state.metadata,
            [`${node.id}_completed`]: Date.now(),
            parallelExecutions: (state.metadata?.parallelExecutions || 0) + 1
          }
        };

        this.emit('workflow:node:exit', state.metadata?.executionId || '', node, { ...state, ...updatedState });
        return updatedState;
      } catch (error) {
        this.emit('workflow:node:error', state.metadata?.executionId || '', node, error);
        throw new WorkflowError(`Parallel node failed: ${node.name}`, {
          nodeId: node.id,
          error: error.message
        });
      }
    };
  }

  /**
   * Create task node function with enhanced capabilities
   */
  private createTaskNode(node: WorkflowNode) {
    return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
      this.emit('workflow:node:enter', state.metadata?.executionId || '', node, state);

      if (this.config.enableLogging) {
        console.log(`Executing task node: ${node.name}`);
      }

      try {
        let result = state.data;

        // Execute the function if specified
        if (node.function) {
          result = await this.executeFunction(node.function, state.data, state);
        }

        const updatedState = {
          currentNode: node.id,
          data: result,
          metadata: {
            ...state.metadata,
            [`${node.id}_completed`]: Date.now()
          }
        };

        this.emit('workflow:node:exit', state.metadata?.executionId || '', node, { ...state, ...updatedState });
        return updatedState;
      } catch (error) {
        this.emit('workflow:node:error', state.metadata?.executionId || '', node, error);

        if (state.metadata?.pauseOnError) {
          await this.pauseExecution(state.metadata.executionId);
        }

        throw new WorkflowError(`Task node failed: ${node.name}`, {
          nodeId: node.id,
          error: error.message
        });
      }
    };
  }

  /**
   * Create enhanced condition function for conditional edges
   */
  private createConditionFunction(condition: string) {
    return (state: WorkflowState): string => {
      try {
        const result = this.evaluateCondition(condition, state);
        return result ? 'true' : 'false';
      } catch (error) {
        console.error(`Condition evaluation failed: ${condition}`, error);
        return 'false';
      }
    };
  }

  /**
   * Execute a function by name with error handling and integration support
   */
  private async executeFunction(functionName: string, data: any, state?: WorkflowState): Promise<any> {
    const func = this.functionRegistry.get(functionName);
    if (!func) {
      throw new Error(`Unknown function: ${functionName}`);
    }

    try {
      return await func(data, state);
    } catch (error) {
      throw new WorkflowError(`Function execution failed: ${functionName}`, {
        functionName,
        error: error.message,
        data
      });
    }
  }

  /**
   * Execute workflow with retry logic and enhanced monitoring
   */
  private async executeWithRetries(
    graph: StateGraph<WorkflowState>,
    initialState: WorkflowState,
    retries: number,
    timeout: number,
    execution?: WorkflowExecution
  ): Promise<WorkflowState> {
    let lastError: Error;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const startTime = Date.now();

        const result = await Promise.race([
          this.executeWithMonitoring(graph, initialState, execution),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Workflow timeout')), timeout)
          )
        ]);

        if (execution) {
          execution.metrics.executionTime = Date.now() - startTime;
        }

        return result;
      } catch (error) {
        lastError = error;
        if (execution) {
          execution.metrics.failedNodes++;
        }

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
   * Execute workflow with monitoring and progress tracking
   */
  private async executeWithMonitoring(
    graph: StateGraph<WorkflowState>,
    initialState: WorkflowState,
    execution?: WorkflowExecution
  ): Promise<WorkflowState> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    const result = await graph.invoke(initialState);

    // Update metrics
    if (execution) {
      execution.metrics.executionTime = Date.now() - startTime;
      execution.metrics.memoryUsage = process.memoryUsage().heapUsed - startMemory.heapUsed;
      execution.metrics.completedNodes++;
      execution.progress = Math.min(100, (execution.metrics.completedNodes / execution.metrics.totalNodes) * 100);
    }

    return result;
  }

  // Enhanced Integration Methods

  /**
   * Execute RAG search within workflow
   */
  private async executeRAGSearch(data: any, state?: WorkflowState): Promise<any> {
    if (!state?.metadata?.enableRAG) {
      return data;
    }

    try {
      const query = data.query || data.searchQuery || JSON.stringify(data);
      const results = await this.ragSystem.search({
        query,
        topK: data.topK || 5,
        filters: data.filters
      });

      if (state) {
        state.ragResults = results;
        this.emit('rag:context:injected', state.metadata?.executionId || '', results);
      }

      return {
        ...data,
        ragResults: results,
        enrichedContext: results.map(r => r.document.content).join('\n')
      };
    } catch (error) {
      throw new WorkflowError('RAG search failed', { error: error.message, data });
    }
  }

  /**
   * Execute SQL query within workflow
   */
  private async executeSQLQuery(data: any, state?: WorkflowState): Promise<any> {
    if (!state?.metadata?.enableSQL) {
      return data;
    }

    try {
      const query = data.naturalLanguage || data.query;
      if (!query) {
        throw new Error('No query provided for SQL execution');
      }

      const sqlResult = await this.nl2sqlEngine.convertToSQL(query, data.context);

      if (state) {
        state.sqlResults = state.sqlResults || [];
        state.sqlResults.push(sqlResult);
        this.emit('sql:query:executed', state.metadata?.executionId || '', sqlResult);
      }

      return {
        ...data,
        sqlQuery: sqlResult.sql,
        sqlConfidence: sqlResult.confidence,
        sqlExplanation: sqlResult.explanation,
        sqlValidation: sqlResult.validation
      };
    } catch (error) {
      throw new WorkflowError('SQL query execution failed', { error: error.message, data });
    }
  }

  /**
   * Check governance approval requirement
   */
  private async checkGovernanceApproval(data: any, state?: WorkflowState): Promise<any> {
    if (!state?.governanceApproval?.required) {
      return data;
    }

    try {
      const proposalId = state.governanceApproval.proposalId;
      if (!proposalId) {
        throw new Error('No proposal ID for governance approval');
      }

      const proposal = this.governanceSystem.getProposal(proposalId);
      if (!proposal) {
        throw new Error(`Proposal not found: ${proposalId}`);
      }

      const approved = proposal.status === 'passed' || proposal.status === 'executed';
      state.governanceApproval.approved = approved;

      this.emit('governance:approval:received', state.metadata?.executionId || '', approved);

      return {
        ...data,
        governanceApproved: approved,
        proposalStatus: proposal.status
      };
    } catch (error) {
      throw new WorkflowError('Governance approval check failed', { error: error.message, data });
    }
  }

  /**
   * Execute parallel tasks
   */
  private async executeParallel(data: any, state?: WorkflowState): Promise<any> {
    const tasks = data.tasks || [];
    if (tasks.length === 0) {
      return data;
    }

    try {
      const promises = tasks.map(async (task: any) => {
        if (task.function) {
          return await this.executeFunction(task.function, task.data || data, state);
        }
        return task.data || task;
      });

      const results = await Promise.all(promises);

      if (state) {
        state.parallelResults = state.parallelResults || new Map();
        state.parallelResults.set(Date.now().toString(), results);
        if (state.metadata) {
          state.metadata.parallelExecutions = (state.metadata.parallelExecutions || 0) + 1;
        }
      }

      return {
        ...data,
        parallelResults: results,
        parallelCount: results.length
      };
    } catch (error) {
      throw new WorkflowError('Parallel execution failed', { error: error.message, data });
    }
  }

  /**
   * Wait for governance approval
   */
  private async waitForApproval(data: any, state?: WorkflowState): Promise<any> {
    if (!state?.governanceApproval?.required) {
      return data;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Governance approval timeout'));
      }, 300000); // 5 minutes timeout

      const checkApproval = () => {
        if (state.governanceApproval?.approved === true) {
          clearTimeout(timeout);
          resolve({ ...data, approved: true });
        } else if (state.governanceApproval?.approved === false) {
          clearTimeout(timeout);
          reject(new Error('Governance approval denied'));
        } else {
          setTimeout(checkApproval, 1000); // Check every second
        }
      };

      checkApproval();
    });
  }

  /**
   * Execute parallel tasks for parallel nodes
   */
  private async executeParallelTasks(taskIds: string[], state: WorkflowState): Promise<any> {
    const promises = taskIds.map(async (taskId) => {
      // In a real implementation, you would execute the task node here
      // For now, we'll simulate parallel execution
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({ taskId, completed: true, timestamp: Date.now() });
        }, Math.random() * 1000);
      });
    });

    const results = await Promise.all(promises);
    return {
      ...state.data,
      parallelResults: results
    };
  }

  /**
   * Evaluate decision conditions for branching
   */
  private evaluateDecisionConditions(node: WorkflowNode, data: any): string {
    if (!node.condition) {
      return node.next ? (Array.isArray(node.next) ? node.next[0] : node.next) : 'end';
    }

    // Enhanced condition evaluation
    try {
      const conditionResult = this.evaluateCondition(node.condition, { data } as WorkflowState);
      if (node.next) {
        if (Array.isArray(node.next)) {
          return conditionResult ? node.next[0] : (node.next[1] || 'end');
        }
        return conditionResult ? node.next : 'end';
      }
      return 'end';
    } catch (error) {
      console.error('Decision condition evaluation failed:', error);
      return 'end';
    }
  }

  /**
   * Enhanced condition evaluator
   */
  private evaluateCondition(condition: string, state: WorkflowState): boolean {
    try {
      // Enhanced condition parsing
      if (condition.includes('data.')) {
        const path = condition.replace('data.', '');
        const value = this.getNestedValue(state.data, path);
        return Boolean(value);
      }

      if (condition.includes('ragResults.length')) {
        return (state.ragResults?.length || 0) > 0;
      }

      if (condition.includes('sqlResults.length')) {
        return (state.sqlResults?.length || 0) > 0;
      }

      if (condition.includes('governanceApproval.approved')) {
        return state.governanceApproval?.approved === true;
      }

      // Add more complex condition evaluations as needed
      return false;
    } catch (error) {
      console.error('Condition evaluation error:', error);
      return false;
    }
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  // Execution Management Methods

  /**
   * Pause workflow execution
   */
  async pauseExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'paused';
      this.pausedExecutions.set(executionId, execution);
      this.activeExecutions.delete(executionId);
      this.emit('workflow:paused', execution);
      return true;
    }
    return false;
  }

  /**
   * Resume workflow execution
   */
  async resumeExecution(executionId: string): Promise<boolean> {
    const execution = this.pausedExecutions.get(executionId);
    if (execution && execution.status === 'paused') {
      execution.status = 'running';
      this.activeExecutions.set(executionId, execution);
      this.pausedExecutions.delete(executionId);
      this.emit('workflow:resumed', execution);
      return true;
    }
    return false;
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId) || this.pausedExecutions.get(executionId);
    if (execution) {
      execution.status = 'cancelled';
      execution.endTime = new Date();
      this.emit('workflow:cancelled', execution);
      this.activeExecutions.delete(executionId);
      this.pausedExecutions.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Get active executions with detailed information
   */
  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.activeExecutions.get(executionId) || this.pausedExecutions.get(executionId);
  }

  /**
   * Get execution metrics
   */
  getExecutionMetrics(executionId: string): ExecutionMetrics | undefined {
    const execution = this.getExecution(executionId);
    return execution?.metrics;
  }

  /**
   * Get registered workflows
   */
  getWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Register a custom function for workflow execution
   */
  registerFunction(name: string, func: Function): void {
    this.functionRegistry.set(name, func);
  }

  /**
   * Get workflow memory
   */
  getWorkflowMemory(workflowId: string): Record<string, any> | undefined {
    return this.workflowMemory.get(workflowId);
  }

  /**
   * Set workflow memory
   */
  setWorkflowMemory(workflowId: string, memory: Record<string, any>): void {
    this.workflowMemory.set(workflowId, memory);
  }

  // Utility Methods

  /**
   * Count total nodes in a workflow
   */
  private countWorkflowNodes(workflowId: string): number {
    // This would need to be implemented based on how workflows are stored
    // For now, return a default value
    return 10;
  }

  /**
   * Check if governance requirement exists for workflow
   */
  private async checkGovernanceRequirement(workflowId: string, input: any): Promise<boolean> {
    // Implement logic to determine if governance is required
    // This could be based on workflow type, input data, or other criteria
    return false;
  }

  /**
   * Check if governance approval exists for workflow
   */
  private async hasGovernanceApproval(workflowId: string): Promise<boolean> {
    // Implement logic to check for existing governance approval
    return false;
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
   * Get comprehensive system metrics
   */
  getSystemMetrics(): {
    activeExecutions: number;
    pausedExecutions: number;
    registeredWorkflows: number;
    registeredFunctions: number;
    totalExecutions: number;
    averageExecutionTime: number;
    memoryUsage: NodeJS.MemoryUsage;
  } {
    const memoryUsage = process.memoryUsage();
    const allExecutions = [...this.activeExecutions.values(), ...this.pausedExecutions.values()];
    const completedExecutions = allExecutions.filter(e => e.status === 'completed');
    const averageExecutionTime = completedExecutions.length > 0
      ? completedExecutions.reduce((sum, e) => sum + e.metrics.executionTime, 0) / completedExecutions.length
      : 0;

    return {
      activeExecutions: this.activeExecutions.size,
      pausedExecutions: this.pausedExecutions.size,
      registeredWorkflows: this.workflows.size,
      registeredFunctions: this.functionRegistry.size,
      totalExecutions: allExecutions.length,
      averageExecutionTime,
      memoryUsage
    };
  }

  /**
   * Clear completed executions from memory
   */
  cleanupCompletedExecutions(): number {
    const before = this.activeExecutions.size;
    const toDelete: string[] = [];

    for (const [id, execution] of this.activeExecutions.entries()) {
      if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
        toDelete.push(id);
      }
    }

    toDelete.forEach(id => this.activeExecutions.delete(id));
    return before - this.activeExecutions.size;
  }
}

export default EnhancedLangGraphOrchestrator;

// Export additional types for external use
export type {
  WorkflowExecution,
  ExecutionMetrics,
  WorkflowEvents
};