#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  InitializeRequestSchema,
  PingRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import crypto from 'crypto';

import { LangGraphOrchestrator } from '../langgraph/index.js';
import { GovernanceSystem } from '../governance/index.js';
import { RAGSystem } from '../rag/index.js';
import { NL2SQLEngine } from '../nl2sql/index.js';
import { MCPTool, MCPResource, LALOError } from '../types/index.js';
import { getConfig, validateEnvironment } from '../config/index.js';

interface MCPServerMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  activeConnections: number;
  rateLimitHits: number;
  lastResetTime: Date;
}

interface MCPConnection {
  id: string;
  clientInfo?: any;
  connectedAt: Date;
  requestCount: number;
  lastActivity: Date;
}

class LALOMCPServer {
  private server: Server;
  private langGraph: LangGraphOrchestrator;
  private governance: GovernanceSystem;
  private rag: RAGSystem;
  private nl2sql: NL2SQLEngine;
  private tools: Map<string, MCPTool>;
  private resources: Map<string, MCPResource>;
  private rateLimiter: RateLimiterMemory;
  private metrics: MCPServerMetrics;
  private connections: Map<string, MCPConnection>;
  private healthStatus: Map<string, any>;
  private cache: Map<string, { data: any; expiry: number }>;
  private isInitialized: boolean = false;

  constructor() {
    // Validate environment first
    validateEnvironment();

    this.server = new Server(
      {
        name: 'lalo-mcp-server',
        version: '1.0.0',
        description: 'LALO MVP MCP Server - LangGraph + Governance + RAG + NL2SQL',
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
          resources: {
            subscribe: true,
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
          logging: {},
        },
      }
    );

    // Initialize collections
    this.tools = new Map();
    this.resources = new Map();
    this.connections = new Map();
    this.healthStatus = new Map();
    this.cache = new Map();

    // Initialize metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      activeConnections: 0,
      rateLimitHits: 0,
      lastResetTime: new Date()
    };

    // Initialize rate limiter (100 requests per minute per client)
    this.rateLimiter = new RateLimiterMemory({
      keyGenerator: (req) => req.id || 'anonymous',
      points: 100,
      duration: 60,
    });

    // Initialize LALO components
    this.langGraph = new LangGraphOrchestrator();
    this.governance = new GovernanceSystem();
    this.rag = new RAGSystem();
    this.nl2sql = new NL2SQLEngine();

    this.setupHandlers();
    this.registerTools();
    this.registerResources();
    this.startHealthMonitoring();
  }

  private setupHandlers(): void {
    // Initialize handler
    this.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const connectionId = this.generateConnectionId();
      const connection: MCPConnection = {
        id: connectionId,
        clientInfo: request.params.clientInfo,
        connectedAt: new Date(),
        requestCount: 0,
        lastActivity: new Date()
      };

      this.connections.set(connectionId, connection);
      this.metrics.activeConnections = this.connections.size;

      this.isInitialized = true;

      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
          logging: {}
        },
        serverInfo: {
          name: 'lalo-mcp-server',
          version: '1.0.0',
          description: 'LALO MVP MCP Server - Enhanced with security and performance'
        }
      };
    });

    // Ping handler for health checks
    this.server.setRequestHandler(PingRequestSchema, async () => {
      return {};
    });

    // Tools handlers with enhanced security
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const startTime = Date.now();
      try {
        await this.checkRateLimit(request);

        const tools = Array.from(this.tools.values()).map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema._def,
        }));

        this.updateMetrics(startTime, true);

        return { tools };
      } catch (error) {
        this.updateMetrics(startTime, false);
        throw this.createMCPError(error);
      }
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const { name, arguments: args } = request.params;

      try {
        await this.checkRateLimit(request);

        const tool = this.tools.get(name);
        if (!tool) {
          throw new LALOError(`Tool not found: ${name}`, 'TOOL_NOT_FOUND');
        }

        // Input validation and sanitization
        const validatedArgs = tool.inputSchema.parse(args);

        // Check cache first
        const cacheKey = this.generateCacheKey(name, validatedArgs);
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.updateMetrics(startTime, true);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(cached, null, 2),
            }],
            isError: false
          };
        }

        // Execute tool with timeout
        const result = await this.executeWithTimeout(
          () => tool.handler(validatedArgs),
          30000 // 30 second timeout
        );

        // Cache successful results for non-mutating operations
        if (this.isCacheable(name)) {
          this.setCache(cacheKey, result, 5 * 60 * 1000); // 5 minute cache
        }

        this.updateMetrics(startTime, true);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
          isError: false
        };
      } catch (error) {
        this.updateMetrics(startTime, false);

        const mcpError = this.createMCPError(error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: mcpError.message, code: error.code }, null, 2),
          }],
          isError: true
        };
      }
    });

    // Resources handlers with caching
    this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      const startTime = Date.now();
      try {
        await this.checkRateLimit(request);

        const resources = Array.from(this.resources.values()).map(resource => ({
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        }));

        this.updateMetrics(startTime, true);

        return { resources };
      } catch (error) {
        this.updateMetrics(startTime, false);
        throw this.createMCPError(error);
      }
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const startTime = Date.now();
      const { uri } = request.params;

      try {
        await this.checkRateLimit(request);

        const resource = this.resources.get(uri);
        if (!resource) {
          throw new LALOError(`Resource not found: ${uri}`, 'RESOURCE_NOT_FOUND');
        }

        // Check cache first
        const cached = this.getFromCache(`resource:${uri}`);
        if (cached) {
          this.updateMetrics(startTime, true);
          return {
            contents: [{
              uri,
              mimeType: resource.mimeType || 'application/json',
              text: typeof cached === 'string' ? cached : JSON.stringify(cached, null, 2),
            }],
          };
        }

        const content = await this.executeWithTimeout(
          () => resource.handler(),
          15000 // 15 second timeout for resources
        );

        // Cache resource content for 2 minutes
        this.setCache(`resource:${uri}`, content, 2 * 60 * 1000);

        this.updateMetrics(startTime, true);

        return {
          contents: [{
            uri,
            mimeType: resource.mimeType || 'application/json',
            text: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
          }],
        };
      } catch (error) {
        this.updateMetrics(startTime, false);
        throw this.createMCPError(error);
      }
    });

    // Logging handler
    this.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      const { level } = request.params;
      console.log(`Logging level set to: ${level}`);
      return {};
    });
  }

  private registerTools(): void {
    // Core LALO System Tools
    this.registerTool({
      name: 'execute_workflow',
      description: 'Execute a workflow through the governance-controlled LALO system',
      inputSchema: z.object({
        workflowId: z.string().min(1, 'Workflow ID is required'),
        input: z.record(z.any()),
        governanceBypass: z.boolean().default(false),
        options: z.object({
          timeout: z.number().min(1000).max(300000).optional(),
          retries: z.number().min(0).max(5).optional(),
          priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
        }).optional(),
      }),
      handler: async (params) => {
        // Check if governance approval is required
        if (!params.governanceBypass) {
          const requiresApproval = await this.checkWorkflowRequiresApproval(params.workflowId);
          if (requiresApproval) {
            throw new LALOError(
              'Workflow execution requires governance approval',
              'GOVERNANCE_APPROVAL_REQUIRED',
              { workflowId: params.workflowId }
            );
          }
        }

        const result = await this.langGraph.executeWorkflow(
          params.workflowId,
          params.input,
          {
            ...params.options,
            metadata: {
              executedVia: 'mcp',
              timestamp: new Date().toISOString(),
              priority: params.options?.priority || 'medium'
            }
          }
        );

        return {
          success: true,
          executionId: result.metadata?.executionId,
          result: result.data,
          metadata: result.metadata
        };
      },
    });

    this.registerTool({
      name: 'create_proposal',
      description: 'Create a governance proposal for workflow changes or system updates',
      inputSchema: z.object({
        title: z.string().min(5).max(200),
        description: z.string().min(20).max(5000),
        proposer: z.string().min(1),
        type: z.enum(['workflow', 'config', 'governance', 'emergency', 'upgrade']),
        category: z.enum(['standard', 'critical', 'constitutional']).default('standard'),
        executionData: z.any().optional(),
        metadata: z.object({
          tags: z.array(z.string()).default([]),
          priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
          estimatedImpact: z.enum(['minimal', 'moderate', 'significant', 'major']).default('moderate'),
          riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
        }).default({}),
        dependencies: z.array(z.string()).default([]),
        requiredApprovals: z.array(z.string()).default([]),
      }),
      handler: async (params) => {
        const proposalId = await this.governance.createProposal(
          params.title,
          params.description,
          params.proposer,
          params.type,
          params.executionData
        );

        return {
          success: true,
          proposalId,
          status: 'active',
          votingPeriod: this.governance.config?.votingPeriod || 24 * 60 * 60 * 1000
        };
      },
    });

    this.registerTool({
      name: 'search_knowledge',
      description: 'Search the knowledge base using RAG-powered semantic search',
      inputSchema: z.object({
        query: z.string().min(1, 'Search query is required'),
        filters: z.record(z.any()).optional(),
        topK: z.number().min(1).max(50).default(10),
        threshold: z.number().min(0).max(1).default(0.7),
        includeMetadata: z.boolean().default(true),
        searchType: z.enum(['semantic', 'keyword', 'hybrid']).default('semantic'),
      }),
      handler: async (params) => {
        const results = await this.rag.search({
          query: params.query,
          filters: params.filters,
          topK: params.topK,
          threshold: params.threshold,
        });

        return {
          success: true,
          query: params.query,
          resultCount: results.length,
          results: results.map(result => ({
            content: result.document.content,
            score: result.score,
            relevance: result.relevance,
            metadata: params.includeMetadata ? result.document.metadata : undefined,
            source: result.document.source
          })),
          searchMetadata: {
            searchType: params.searchType,
            threshold: params.threshold,
            timestamp: new Date().toISOString()
          }
        };
      },
    });

    this.registerTool({
      name: 'nl2sql_query',
      description: 'Convert natural language to SQL using advanced NL2SQL engine',
      inputSchema: z.object({
        query: z.string().min(1, 'Natural language query is required'),
        context: z.record(z.any()).optional(),
        validate: z.boolean().default(true),
        explain: z.boolean().default(false),
        outputFormat: z.enum(['sql', 'explained', 'both']).default('both'),
      }),
      handler: async (params) => {
        const result = await this.nl2sql.convertToSQL(
          params.query,
          params.context,
          params.validate
        );

        const response: any = {
          success: true,
          naturalLanguage: params.query,
          sql: result.sql,
          confidence: result.confidence,
          tables: result.tables,
          metadata: result.metadata
        };

        if (params.explain || params.outputFormat === 'explained' || params.outputFormat === 'both') {
          response.explanation = {
            reasoning: `SQL query generated for: "${params.query}"`,
            tablesUsed: result.tables,
            complexity: result.metadata?.complexity || 'unknown',
            estimatedRows: result.metadata?.estimatedRows
          };
        }

        return response;
      },
    });

    this.registerTool({
      name: 'system_status',
      description: 'Get comprehensive LALO system health and status information',
      inputSchema: z.object({
        includeMetrics: z.boolean().default(true),
        includeConnections: z.boolean().default(false),
        includeHealth: z.boolean().default(true),
        detailed: z.boolean().default(false),
      }),
      handler: async (params) => {
        const status: any = {
          timestamp: new Date().toISOString(),
          server: {
            name: 'lalo-mcp-server',
            version: '1.0.0',
            uptime: process.uptime(),
            initialized: this.isInitialized
          }
        };

        if (params.includeHealth) {
          status.health = await this.getSystemHealth();
        }

        if (params.includeMetrics) {
          status.metrics = {
            ...this.metrics,
            cache: {
              size: this.cache.size,
              hitRate: this.calculateCacheHitRate()
            }
          };
        }

        if (params.includeConnections) {
          status.connections = {
            active: this.connections.size,
            details: params.detailed ? Array.from(this.connections.values()) : undefined
          };
        }

        if (params.detailed) {
          status.components = {
            langgraph: {
              workflows: this.langGraph.getWorkflows().length,
              activeExecutions: this.langGraph.getActiveExecutions().length,
            },
            governance: this.governance.getGovernanceStats(),
            rag: await this.rag.getStats(),
            nl2sql: await this.nl2sql.getStats(),
          };
        }

        return status;
      },
    });

    // Legacy and Extended Governance Tools
    this.registerTool({
      name: 'lalo_proposal_create',
      description: 'Create a new governance proposal (legacy interface)',
      inputSchema: z.object({
        title: z.string(),
        description: z.string(),
        proposer: z.string(),
        type: z.enum(['workflow', 'config', 'governance']),
        executionData: z.any().optional(),
      }),
      handler: async (params) => {
        const proposalId = await this.governance.createProposal(
          params.title,
          params.description,
          params.proposer,
          params.type,
          params.executionData
        );
        return { success: true, proposalId };
      },
    });

    this.registerTool({
      name: 'lalo_proposal_vote',
      description: 'Vote on a governance proposal',
      inputSchema: z.object({
        proposalId: z.string(),
        voter: z.string(),
        choice: z.enum(['for', 'against', 'abstain']),
        reason: z.string().optional(),
      }),
      handler: async (params) => {
        await this.governance.vote(
          params.proposalId,
          params.voter,
          params.choice,
          params.reason
        );
        return { success: true };
      },
    });

    this.registerTool({
      name: 'lalo_proposal_execute',
      description: 'Execute a passed proposal',
      inputSchema: z.object({
        proposalId: z.string(),
      }),
      handler: async (params) => {
        const result = await this.governance.executeProposal(params.proposalId);
        return { success: true, result };
      },
    });

    this.registerTool({
      name: 'lalo_voting_power_set',
      description: 'Set voting power for an address',
      inputSchema: z.object({
        address: z.string(),
        power: z.number().min(0),
      }),
      handler: async (params) => {
        this.governance.setVotingPower(params.address, params.power);
        return { success: true };
      },
    });

    // RAG Tools
    this.registerTool({
      name: 'lalo_document_add',
      description: 'Add a document to the RAG system',
      inputSchema: z.object({
        content: z.string(),
        metadata: z.record(z.any()).optional(),
        source: z.string().optional(),
      }),
      handler: async (params) => {
        const documentId = await this.rag.addDocument(
          params.content,
          params.metadata,
          params.source
        );
        return { success: true, documentId };
      },
    });

    this.registerTool({
      name: 'lalo_document_search',
      description: 'Search documents in the RAG system',
      inputSchema: z.object({
        query: z.string(),
        filters: z.record(z.any()).optional(),
        topK: z.number().optional(),
        threshold: z.number().optional(),
      }),
      handler: async (params) => {
        const results = await this.rag.search({
          query: params.query,
          filters: params.filters,
          topK: params.topK,
          threshold: params.threshold,
        });
        return { results };
      },
    });

    // NL2SQL Tools
    this.registerTool({
      name: 'lalo_nl2sql_convert',
      description: 'Convert natural language to SQL',
      inputSchema: z.object({
        query: z.string(),
        context: z.record(z.any()).optional(),
        validate: z.boolean().optional(),
      }),
      handler: async (params) => {
        const result = await this.nl2sql.convertToSQL(
          params.query,
          params.context,
          params.validate
        );
        return result;
      },
    });

    this.registerTool({
      name: 'lalo_schema_add',
      description: 'Add table schema for NL2SQL',
      inputSchema: z.object({
        schema: z.object({
          name: z.string(),
          columns: z.array(z.any()),
          relationships: z.array(z.any()).optional(),
          description: z.string().optional(),
        }),
      }),
      handler: async (params) => {
        await this.nl2sql.addTableSchema(params.schema);
        return { success: true };
      },
    });

    // Legacy System Tools
    this.registerTool({
      name: 'lalo_status',
      description: 'Get LALO system status (legacy interface)',
      inputSchema: z.object({}),
      handler: async () => {
        return {
          langgraph: {
            workflows: this.langGraph.getWorkflows().length,
            activeExecutions: this.langGraph.getActiveExecutions().length,
          },
          governance: this.governance.getGovernanceStats(),
          rag: await this.rag.getStats(),
          nl2sql: await this.nl2sql.getStats(),
          timestamp: new Date().toISOString(),
        };
      },
    });

    // Enhanced workflow management tools
    this.registerTool({
      name: 'lalo_workflow_create',
      description: 'Create a new workflow in LangGraph',
      inputSchema: z.object({
        workflow: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          nodes: z.array(z.any()),
          edges: z.array(z.any()),
        }),
      }),
      handler: async (params) => {
        await this.langGraph.registerWorkflow(params.workflow);
        return { success: true, workflowId: params.workflow.id };
      },
    });

    this.registerTool({
      name: 'lalo_workflow_execute',
      description: 'Execute a registered workflow',
      inputSchema: z.object({
        workflowId: z.string(),
        input: z.record(z.any()),
        options: z.object({
          timeout: z.number().optional(),
          retries: z.number().optional(),
        }).optional(),
      }),
      handler: async (params) => {
        const result = await this.langGraph.executeWorkflow(
          params.workflowId,
          params.input,
          params.options
        );
        return result;
      },
    });

    this.registerTool({
      name: 'lalo_workflow_list',
      description: 'List all registered workflows',
      inputSchema: z.object({}),
      handler: async () => {
        const workflows = this.langGraph.getWorkflows();
        const active = this.langGraph.getActiveExecutions();
        return { workflows, activeExecutions: active };
      },
    });
  }

  private registerResources(): void {
    this.registerResource({
      uri: 'lalo://workflows',
      name: 'LALO Workflows',
      description: 'List of all registered workflows',
      mimeType: 'application/json',
      handler: async () => {
        const workflows = this.langGraph.getWorkflows();
        const active = this.langGraph.getActiveExecutions();
        return { workflows, activeExecutions: active };
      },
    });

    this.registerResource({
      uri: 'lalo://proposals',
      name: 'Governance Proposals',
      description: 'List of all governance proposals',
      mimeType: 'application/json',
      handler: async () => {
        return this.governance.getProposals();
      },
    });

    this.registerResource({
      uri: 'lalo://governance/stats',
      name: 'Governance Statistics',
      description: 'Governance system statistics',
      mimeType: 'application/json',
      handler: async () => {
        return this.governance.getGovernanceStats();
      },
    });

    this.registerResource({
      uri: 'lalo://rag/stats',
      name: 'RAG System Statistics',
      description: 'RAG system statistics',
      mimeType: 'application/json',
      handler: async () => {
        return await this.rag.getStats();
      },
    });

    this.registerResource({
      uri: 'lalo://nl2sql/schemas',
      name: 'Database Schemas',
      description: 'Available database schemas for NL2SQL',
      mimeType: 'application/json',
      handler: async () => {
        return await this.nl2sql.getSchemas();
      },
    });
  }

  private registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  private registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
  }

  // Security and Performance Utilities
  private async checkRateLimit(request: any): Promise<void> {
    try {
      const key = request.id || 'anonymous';
      await this.rateLimiter.consume(key);
    } catch (rateLimiterRes) {
      this.metrics.rateLimitHits++;
      throw new LALOError(
        'Rate limit exceeded. Please slow down your requests.',
        'RATE_LIMIT_EXCEEDED',
        { retryAfter: rateLimiterRes.msBeforeNext }
      );
    }
  }

  private generateConnectionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private generateCacheKey(toolName: string, args: any): string {
    const argsHash = crypto.createHash('sha256')
      .update(JSON.stringify(args))
      .digest('hex').substring(0, 16);
    return `tool:${toolName}:${argsHash}`;
  }

  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCache(key: string, data: any, ttlMs: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlMs
    });

    // Clean up expired entries every 100 cache sets
    if (this.cache.size % 100 === 0) {
      this.cleanupCache();
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  private isCacheable(toolName: string): boolean {
    const nonCacheableTools = [
      'execute_workflow',
      'create_proposal',
      'lalo_proposal_create',
      'lalo_proposal_vote',
      'lalo_proposal_execute',
      'lalo_workflow_execute'
    ];
    return !nonCacheableTools.includes(toolName);
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new LALOError('Operation timeout', 'TIMEOUT')), timeoutMs)
      )
    ]);
  }

  private updateMetrics(startTime: number, success: boolean): void {
    const duration = Date.now() - startTime;
    this.metrics.totalRequests++;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    // Update average response time
    const totalTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + duration;
    this.metrics.averageResponseTime = totalTime / this.metrics.totalRequests;
  }

  private createMCPError(error: any): LALOError {
    if (error instanceof LALOError) {
      return error;
    }

    return new LALOError(
      error.message || 'An unexpected error occurred',
      error.code || 'UNKNOWN_ERROR',
      error.details
    );
  }

  private calculateCacheHitRate(): number {
    const totalCacheRequests = this.metrics.totalRequests;
    if (totalCacheRequests === 0) return 0;

    // This is simplified - in production, track actual cache hits
    return Math.min(0.85, this.cache.size / Math.max(1, totalCacheRequests));
  }

  private async checkWorkflowRequiresApproval(workflowId: string): Promise<boolean> {
    // Implement governance check logic
    // For now, assume all workflows require approval unless explicitly bypassed
    return true;
  }

  private async getSystemHealth(): Promise<any> {
    const health = {
      overall: 'healthy' as 'healthy' | 'degraded' | 'unhealthy',
      components: {} as Record<string, any>,
      timestamp: new Date().toISOString()
    };

    try {
      // Check LangGraph health
      health.components.langgraph = {
        status: 'healthy',
        activeExecutions: this.langGraph.getActiveExecutions().length,
        registeredWorkflows: this.langGraph.getWorkflows().length
      };
    } catch (error) {
      health.components.langgraph = {
        status: 'unhealthy',
        error: error.message
      };
      health.overall = 'degraded';
    }

    try {
      // Check Governance health
      const govStats = this.governance.getGovernanceStats();
      health.components.governance = {
        status: 'healthy',
        ...govStats
      };
    } catch (error) {
      health.components.governance = {
        status: 'unhealthy',
        error: error.message
      };
      health.overall = 'degraded';
    }

    try {
      // Check RAG health
      const ragStats = await this.rag.getStats();
      health.components.rag = {
        status: 'healthy',
        ...ragStats
      };
    } catch (error) {
      health.components.rag = {
        status: 'unhealthy',
        error: error.message
      };
      health.overall = 'degraded';
    }

    try {
      // Check NL2SQL health
      const nl2sqlStats = await this.nl2sql.getStats();
      health.components.nl2sql = {
        status: 'healthy',
        ...nl2sqlStats
      };
    } catch (error) {
      health.components.nl2sql = {
        status: 'unhealthy',
        error: error.message
      };
      health.overall = 'degraded';
    }

    // Check if any component is unhealthy
    const unhealthyComponents = Object.values(health.components)
      .filter((comp: any) => comp.status === 'unhealthy');

    if (unhealthyComponents.length > 0) {
      health.overall = 'unhealthy';
    }

    return health;
  }

  private startHealthMonitoring(): void {
    // Monitor health every 30 seconds
    setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        this.healthStatus.set('current', health);

        // Log health issues
        if (health.overall !== 'healthy') {
          console.warn('System health degraded:', health);
        }
      } catch (error) {
        console.error('Health monitoring error:', error);
      }
    }, 30000);

    // Clean up inactive connections every 5 minutes
    setInterval(() => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      for (const [id, connection] of this.connections.entries()) {
        if (connection.lastActivity.getTime() < fiveMinutesAgo) {
          this.connections.delete(id);
        }
      }
      this.metrics.activeConnections = this.connections.size;
    }, 5 * 60 * 1000);

    // Reset metrics daily
    setInterval(() => {
      this.metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        activeConnections: this.connections.size,
        rateLimitHits: 0,
        lastResetTime: new Date()
      };
    }, 24 * 60 * 60 * 1000);
  }

  async start(): Promise<void> {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      console.error('🚀 LALO MCP Server started successfully');
      console.error(`📊 Server capabilities: ${Object.keys(this.server.capabilities?.tools || {}).length} tool handlers`);
      console.error(`📋 Registered tools: ${this.tools.size}`);
      console.error(`📚 Registered resources: ${this.resources.size}`);
      console.error(`🔒 Security features: Rate limiting, Input validation, Error handling`);
      console.error(`⚡ Performance features: Caching, Timeouts, Health monitoring`);

    } catch (error) {
      console.error('❌ Failed to start LALO MCP Server:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      // Clean up resources
      this.cache.clear();
      this.connections.clear();
      this.healthStatus.clear();

      console.error('🛑 LALO MCP Server stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping LALO MCP Server:', error);
      throw error;
    }
  }

  // Public getters for monitoring
  get serverMetrics(): MCPServerMetrics {
    return { ...this.metrics };
  }

  get serverHealth(): any {
    return this.healthStatus.get('current') || { overall: 'unknown' };
  }

  get activeConnectionCount(): number {
    return this.connections.size;
  }
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new LALOMCPServer();

  // Graceful shutdown handling
  process.on('SIGINT', async () => {
    console.error('\n🔄 Received SIGINT, shutting down gracefully...');
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });

  process.on('SIGTERM', async () => {
    console.error('\n🔄 Received SIGTERM, shutting down gracefully...');
    try {
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  server.start().catch((error) => {
    console.error('💥 Failed to start LALO MCP Server:', error);
    process.exit(1);
  });
}

export { LALOMCPServer };
export default LALOMCPServer;