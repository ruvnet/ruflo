import { EventEmitter } from 'events';
import {
  Proposal,
  GovernanceError,
  MCPTool,
  MCPResource
} from '../types/index.js';

export interface MCPGovernanceEvents {
  'mcp:proposal:created': [string, any]; // proposalId, mcpData
  'mcp:vote:cast': [string, string, any]; // proposalId, voter, mcpData
  'mcp:execution:triggered': [string, any]; // proposalId, executionResult
  'mcp:external:called': [string, string, any]; // proposalId, toolName, result
}

export interface MCPGovernanceConfig {
  enableExternalCalls: boolean;
  allowedTools: string[];
  requireSignature: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface ExternalGovernanceCall {
  id: string;
  proposalId: string;
  toolName: string;
  parameters: any;
  result?: any;
  error?: string;
  timestamp: Date;
  retryCount: number;
  status: 'pending' | 'success' | 'failed' | 'timeout';
}

export class MCPGovernanceIntegration extends EventEmitter {
  private config: MCPGovernanceConfig;
  private externalCalls = new Map<string, ExternalGovernanceCall>();
  private mcpTools = new Map<string, MCPTool>();
  private mcpResources = new Map<string, MCPResource>();

  constructor(config: Partial<MCPGovernanceConfig> = {}) {
    super();

    this.config = {
      enableExternalCalls: true,
      allowedTools: [],
      requireSignature: false,
      timeoutMs: 30000,
      maxRetries: 3,
      ...config
    };

    this.setupEventHandlers();
    this.initializeMCPTools();
  }

  private setupEventHandlers(): void {
    this.on('mcp:proposal:created', (proposalId, data) => {
      console.log(`MCP proposal created: ${proposalId}`);
    });

    this.on('mcp:execution:triggered', (proposalId, result) => {
      console.log(`MCP execution triggered for proposal: ${proposalId}`);
    });
  }

  /**
   * Initialize MCP tools for governance
   */
  private initializeMCPTools(): void {
    // Governance proposal creation tool
    this.registerTool({
      name: 'governance:create-proposal',
      description: 'Create a new governance proposal via MCP',
      inputSchema: {
        parse: (params: any) => params // Simplified for example
      } as any,
      handler: async (params: any) => {
        return this.handleCreateProposal(params);
      }
    });

    // Governance voting tool
    this.registerTool({
      name: 'governance:cast-vote',
      description: 'Cast a vote on a governance proposal via MCP',
      inputSchema: {
        parse: (params: any) => params
      } as any,
      handler: async (params: any) => {
        return this.handleCastVote(params);
      }
    });

    // Governance execution tool
    this.registerTool({
      name: 'governance:execute-proposal',
      description: 'Execute a passed governance proposal via MCP',
      inputSchema: {
        parse: (params: any) => params
      } as any,
      handler: async (params: any) => {
        return this.handleExecuteProposal(params);
      }
    });

    // External system integration tool
    this.registerTool({
      name: 'governance:external-call',
      description: 'Make external system calls for governance',
      inputSchema: {
        parse: (params: any) => params
      } as any,
      handler: async (params: any) => {
        return this.handleExternalCall(params);
      }
    });

    // Governance status query tool
    this.registerTool({
      name: 'governance:get-status',
      description: 'Get governance system status and metrics',
      inputSchema: {
        parse: (params: any) => params
      } as any,
      handler: async (params: any) => {
        return this.handleGetStatus(params);
      }
    });
  }

  /**
   * Register an MCP tool
   */
  registerTool(tool: MCPTool): void {
    this.mcpTools.set(tool.name, tool);
  }

  /**
   * Register an MCP resource
   */
  registerResource(resource: MCPResource): void {
    this.mcpResources.set(resource.uri, resource);
  }

  /**
   * Handle proposal creation via MCP
   */
  private async handleCreateProposal(params: {
    title: string;
    description: string;
    proposer: string;
    type: string;
    category: string;
    executionData?: any;
    externalCallbacks?: string[];
  }): Promise<any> {
    try {
      const proposalId = `mcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create proposal data with MCP integration
      const proposalData = {
        id: proposalId,
        title: params.title,
        description: params.description,
        proposer: params.proposer,
        type: params.type as any,
        category: params.category as any,
        executionData: params.executionData,
        metadata: {
          tags: ['mcp-created'],
          priority: 'medium' as any,
          estimatedImpact: 'moderate' as any,
          riskLevel: 'medium' as any,
          externalReferences: params.externalCallbacks || []
        },
        requiredApprovals: []
      };

      this.emit('mcp:proposal:created', proposalId, proposalData);

      return {
        success: true,
        proposalId,
        message: 'Proposal created successfully via MCP',
        mcpIntegration: true
      };
    } catch (error) {
      throw new GovernanceError('Failed to create proposal via MCP', { error: error.message });
    }
  }

  /**
   * Handle vote casting via MCP
   */
  private async handleCastVote(params: {
    proposalId: string;
    voter: string;
    choice: 'for' | 'against' | 'abstain';
    reason?: string;
    signature?: string;
  }): Promise<any> {
    try {
      // Validate signature if required
      if (this.config.requireSignature && !params.signature) {
        throw new GovernanceError('Signature required for MCP voting');
      }

      const voteData = {
        voter: params.voter,
        choice: params.choice,
        reason: params.reason,
        signature: params.signature,
        mcpIntegration: true,
        timestamp: new Date()
      };

      this.emit('mcp:vote:cast', params.proposalId, params.voter, voteData);

      return {
        success: true,
        proposalId: params.proposalId,
        voter: params.voter,
        choice: params.choice,
        message: 'Vote cast successfully via MCP'
      };
    } catch (error) {
      throw new GovernanceError('Failed to cast vote via MCP', { error: error.message });
    }
  }

  /**
   * Handle proposal execution via MCP
   */
  private async handleExecuteProposal(params: {
    proposalId: string;
    executor: string;
    externalCalls?: Array<{
      tool: string;
      parameters: any;
    }>;
  }): Promise<any> {
    try {
      const executionResults: any[] = [];

      // Execute external calls if provided
      if (params.externalCalls && this.config.enableExternalCalls) {
        for (const call of params.externalCalls) {
          if (this.isToolAllowed(call.tool)) {
            const result = await this.executeExternalCall(params.proposalId, call.tool, call.parameters);
            executionResults.push(result);
          } else {
            throw new GovernanceError(`External tool not allowed: ${call.tool}`);
          }
        }
      }

      const executionData = {
        proposalId: params.proposalId,
        executor: params.executor,
        executionResults,
        timestamp: new Date(),
        mcpIntegration: true
      };

      this.emit('mcp:execution:triggered', params.proposalId, executionData);

      return {
        success: true,
        proposalId: params.proposalId,
        executionResults,
        message: 'Proposal executed successfully via MCP'
      };
    } catch (error) {
      throw new GovernanceError('Failed to execute proposal via MCP', { error: error.message });
    }
  }

  /**
   * Handle external system calls
   */
  private async handleExternalCall(params: {
    proposalId: string;
    toolName: string;
    parameters: any;
    requester: string;
  }): Promise<any> {
    try {
      if (!this.config.enableExternalCalls) {
        throw new GovernanceError('External calls are disabled');
      }

      if (!this.isToolAllowed(params.toolName)) {
        throw new GovernanceError(`Tool not allowed: ${params.toolName}`);
      }

      const result = await this.executeExternalCall(
        params.proposalId,
        params.toolName,
        params.parameters
      );

      return {
        success: true,
        proposalId: params.proposalId,
        toolName: params.toolName,
        result,
        message: 'External call executed successfully'
      };
    } catch (error) {
      throw new GovernanceError('Failed to execute external call', { error: error.message });
    }
  }

  /**
   * Handle governance status queries
   */
  private async handleGetStatus(params: {
    includeMetrics?: boolean;
    includeActiveCalls?: boolean;
  }): Promise<any> {
    try {
      const status = {
        mcpIntegration: {
          enabled: true,
          externalCallsEnabled: this.config.enableExternalCalls,
          registeredTools: this.mcpTools.size,
          registeredResources: this.mcpResources.size,
          allowedTools: this.config.allowedTools
        },
        timestamp: new Date()
      };

      if (params.includeMetrics) {
        (status as any).metrics = this.getIntegrationMetrics();
      }

      if (params.includeActiveCalls) {
        (status as any).activeCalls = this.getActiveCalls();
      }

      return status;
    } catch (error) {
      throw new GovernanceError('Failed to get governance status', { error: error.message });
    }
  }

  /**
   * Execute an external call with retry logic
   */
  private async executeExternalCall(
    proposalId: string,
    toolName: string,
    parameters: any
  ): Promise<any> {
    const callId = `${proposalId}-${toolName}-${Date.now()}`;

    const externalCall: ExternalGovernanceCall = {
      id: callId,
      proposalId,
      toolName,
      parameters,
      timestamp: new Date(),
      retryCount: 0,
      status: 'pending'
    };

    this.externalCalls.set(callId, externalCall);

    try {
      const tool = this.mcpTools.get(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Execute with timeout
      const result = await Promise.race([
        tool.handler(parameters),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), this.config.timeoutMs)
        )
      ]);

      externalCall.result = result;
      externalCall.status = 'success';

      this.emit('mcp:external:called', proposalId, toolName, result);

      return result;
    } catch (error) {
      externalCall.error = error.message;
      externalCall.status = 'failed';

      // Retry logic
      if (externalCall.retryCount < this.config.maxRetries) {
        externalCall.retryCount++;
        externalCall.status = 'pending';

        // Exponential backoff
        const delay = Math.pow(2, externalCall.retryCount) * 1000;
        setTimeout(() => {
          this.executeExternalCall(proposalId, toolName, parameters);
        }, delay);
      } else {
        externalCall.status = 'failed';
      }

      throw error;
    }
  }

  /**
   * Check if a tool is allowed for external calls
   */
  private isToolAllowed(toolName: string): boolean {
    if (this.config.allowedTools.length === 0) {
      return true; // If no restrictions, allow all
    }
    return this.config.allowedTools.includes(toolName);
  }

  /**
   * Get integration metrics
   */
  private getIntegrationMetrics(): any {
    const calls = Array.from(this.externalCalls.values());
    const successfulCalls = calls.filter(call => call.status === 'success').length;
    const failedCalls = calls.filter(call => call.status === 'failed').length;
    const pendingCalls = calls.filter(call => call.status === 'pending').length;

    return {
      totalCalls: calls.length,
      successfulCalls,
      failedCalls,
      pendingCalls,
      successRate: calls.length > 0 ? successfulCalls / calls.length : 0,
      avgRetryCount: calls.length > 0 ? calls.reduce((sum, call) => sum + call.retryCount, 0) / calls.length : 0
    };
  }

  /**
   * Get active external calls
   */
  private getActiveCalls(): ExternalGovernanceCall[] {
    return Array.from(this.externalCalls.values())
      .filter(call => call.status === 'pending')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get all MCP tools
   */
  getMCPTools(): MCPTool[] {
    return Array.from(this.mcpTools.values());
  }

  /**
   * Get all MCP resources
   */
  getMCPResources(): MCPResource[] {
    return Array.from(this.mcpResources.values());
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<MCPGovernanceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): MCPGovernanceConfig {
    return { ...this.config };
  }

  /**
   * Clean up completed external calls
   */
  cleanupCompletedCalls(olderThan: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)): number {
    let cleanedCount = 0;

    for (const [id, call] of this.externalCalls.entries()) {
      if (call.status !== 'pending' && call.timestamp < olderThan) {
        this.externalCalls.delete(id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get external call by ID
   */
  getExternalCall(callId: string): ExternalGovernanceCall | undefined {
    return this.externalCalls.get(callId);
  }

  /**
   * Get external calls for a proposal
   */
  getProposalCalls(proposalId: string): ExternalGovernanceCall[] {
    return Array.from(this.externalCalls.values())
      .filter(call => call.proposalId === proposalId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
}

export default MCPGovernanceIntegration;