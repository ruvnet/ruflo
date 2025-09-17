import { Document, SearchResult, RAGQuery } from '../../types/index.js';

export interface HookContext {
  operation: 'search' | 'ingest' | 'update' | 'delete';
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface WorkflowContext {
  workflowId: string;
  currentStep: string;
  previousSteps: string[];
  variables: Record<string, any>;
  executionContext: Record<string, any>;
}

export interface GovernanceContext {
  proposalId?: string;
  voteId?: string;
  governance: Record<string, any>;
  permissions: string[];
}

export type HookCallback<T> = (data: T, context: HookContext) => Promise<T>;

export class IntegrationHooks {
  private preSearchHooks: HookCallback<RAGQuery>[] = [];
  private postSearchHooks: HookCallback<SearchResult[]>[] = [];
  private preIngestHooks: HookCallback<{ content: string; metadata: Record<string, any> }>[] = [];
  private postIngestHooks: HookCallback<Document>[] = [];
  private contextInjectors: Array<(query: RAGQuery) => Promise<Record<string, any>>> = [];

  // Pre-operation hooks
  addPreSearchHook(hook: HookCallback<RAGQuery>): void {
    this.preSearchHooks.push(hook);
  }

  addPostSearchHook(hook: HookCallback<SearchResult[]>): void {
    this.postSearchHooks.push(hook);
  }

  addPreIngestHook(hook: HookCallback<{ content: string; metadata: Record<string, any> }>): void {
    this.preIngestHooks.push(hook);
  }

  addPostIngestHook(hook: HookCallback<Document>): void {
    this.postIngestHooks.push(hook);
  }

  addContextInjector(injector: (query: RAGQuery) => Promise<Record<string, any>>): void {
    this.contextInjectors.push(injector);
  }

  // Hook execution
  async executePreSearchHooks(query: RAGQuery, context: HookContext): Promise<RAGQuery> {
    let modifiedQuery = { ...query };

    for (const hook of this.preSearchHooks) {
      modifiedQuery = await hook(modifiedQuery, context);
    }

    return modifiedQuery;
  }

  async executePostSearchHooks(results: SearchResult[], context: HookContext): Promise<SearchResult[]> {
    let modifiedResults = [...results];

    for (const hook of this.postSearchHooks) {
      modifiedResults = await hook(modifiedResults, context);
    }

    return modifiedResults;
  }

  async executePreIngestHooks(
    data: { content: string; metadata: Record<string, any> },
    context: HookContext
  ): Promise<{ content: string; metadata: Record<string, any> }> {
    let modifiedData = { ...data };

    for (const hook of this.preIngestHooks) {
      modifiedData = await hook(modifiedData, context);
    }

    return modifiedData;
  }

  async executePostIngestHooks(document: Document, context: HookContext): Promise<Document> {
    let modifiedDocument = { ...document };

    for (const hook of this.postIngestHooks) {
      modifiedDocument = await hook(modifiedDocument, context);
    }

    return modifiedDocument;
  }

  async injectContext(query: RAGQuery): Promise<Record<string, any>> {
    const injectedContext: Record<string, any> = {};

    for (const injector of this.contextInjectors) {
      try {
        const context = await injector(query);
        Object.assign(injectedContext, context);
      } catch (error) {
        console.warn('Context injection failed:', error.message);
      }
    }

    return injectedContext;
  }

  // Built-in integration hooks for LALO components

  // Workflow integration
  setupWorkflowIntegration(): void {
    // Pre-search hook to inject workflow context
    this.addPreSearchHook(async (query: RAGQuery, context: HookContext) => {
      if (context.metadata?.workflowContext) {
        const workflowCtx = context.metadata.workflowContext as WorkflowContext;

        // Enhance query with workflow context
        const enhancedQuery = {
          ...query,
          query: this.enhanceQueryWithWorkflowContext(query.query, workflowCtx),
          filters: {
            ...query.filters,
            workflowId: workflowCtx.workflowId,
            relevantToStep: workflowCtx.currentStep
          }
        };

        return enhancedQuery;
      }

      return query;
    });

    // Post-search hook to score results based on workflow relevance
    this.addPostSearchHook(async (results: SearchResult[], context: HookContext) => {
      if (context.metadata?.workflowContext) {
        const workflowCtx = context.metadata.workflowContext as WorkflowContext;

        return results.map(result => ({
          ...result,
          score: this.calculateWorkflowRelevanceScore(result, workflowCtx),
          metadata: {
            ...result.document.metadata,
            workflowRelevance: this.analyzeWorkflowRelevance(result, workflowCtx)
          }
        })).sort((a, b) => b.score - a.score);
      }

      return results;
    });

    // Context injector for workflow templates
    this.addContextInjector(async (query: RAGQuery) => {
      if (query.filters?.category === 'workflow_template') {
        return {
          workflowTemplates: await this.getRelevantWorkflowTemplates(query.query),
          commonPatterns: await this.getCommonWorkflowPatterns()
        };
      }
      return {};
    });
  }

  // Governance integration
  setupGovernanceIntegration(): void {
    // Pre-search hook for governance queries
    this.addPreSearchHook(async (query: RAGQuery, context: HookContext) => {
      if (context.metadata?.governanceContext) {
        const govCtx = context.metadata.governanceContext as GovernanceContext;

        return {
          ...query,
          query: this.enhanceQueryWithGovernanceContext(query.query, govCtx),
          filters: {
            ...query.filters,
            category: 'governance',
            permissions: govCtx.permissions
          }
        };
      }

      return query;
    });

    // Pre-ingest hook for governance documents
    this.addPreIngestHook(async (data, context: HookContext) => {
      if (context.metadata?.category === 'governance') {
        return {
          ...data,
          content: this.preprocessGovernanceContent(data.content),
          metadata: {
            ...data.metadata,
            indexed_at: new Date().toISOString(),
            governance_version: await this.getGovernanceVersion(),
            access_level: this.determineAccessLevel(data.content)
          }
        };
      }

      return data;
    });

    // Context injector for governance policies
    this.addContextInjector(async (query: RAGQuery) => {
      if (query.filters?.category === 'governance') {
        return {
          currentPolicies: await this.getCurrentGovernancePolicies(),
          activeProposals: await this.getActiveProposals(),
          votingHistory: await this.getRelevantVotingHistory(query.query)
        };
      }
      return {};
    });
  }

  // NL2SQL integration
  setupNL2SQLIntegration(): void {
    // Context injector for SQL schema information
    this.addContextInjector(async (query: RAGQuery) => {
      if (query.filters?.category === 'sql_schema' || this.isNL2SQLQuery(query.query)) {
        return {
          schemaInfo: await this.getRelevantSchemas(query.query),
          sampleQueries: await this.getSampleSQLQueries(query.query),
          tableRelationships: await this.getTableRelationships()
        };
      }
      return {};
    });

    // Post-search hook to enhance SQL-related results
    this.addPostSearchHook(async (results: SearchResult[], context: HookContext) => {
      if (context.metadata?.isNL2SQL) {
        return results.map(result => {
          if (result.document.metadata.category === 'sql_schema') {
            return {
              ...result,
              metadata: {
                ...result.document.metadata,
                sqlContext: this.extractSQLContext(result.document.content)
              }
            };
          }
          return result;
        });
      }

      return results;
    });
  }

  // MCP integration
  setupMCPIntegration(): void {
    // Hook to integrate with MCP tool results
    this.addContextInjector(async (query: RAGQuery) => {
      if (query.filters?.source === 'mcp' || context.metadata?.mcpContext) {
        return {
          mcpToolResults: await this.getMCPToolResults(query.query),
          availableTools: await this.getAvailableMCPTools(),
          mcpState: await this.getMCPState()
        };
      }
      return {};
    });

    // Pre-ingest hook for MCP-generated content
    this.addPreIngestHook(async (data, context: HookContext) => {
      if (context.metadata?.source === 'mcp') {
        return {
          ...data,
          metadata: {
            ...data.metadata,
            mcp_tool: context.metadata.mcpTool,
            mcp_timestamp: new Date().toISOString(),
            mcp_session: context.metadata.mcpSession
          }
        };
      }

      return data;
    });
  }

  // Helper methods for workflow integration
  private enhanceQueryWithWorkflowContext(query: string, workflowCtx: WorkflowContext): string {
    const contextTerms = [
      `workflow: ${workflowCtx.workflowId}`,
      `step: ${workflowCtx.currentStep}`,
      ...Object.keys(workflowCtx.variables).map(key => `${key}: ${workflowCtx.variables[key]}`)
    ];

    return `${query} ${contextTerms.join(' ')}`;
  }

  private calculateWorkflowRelevanceScore(result: SearchResult, workflowCtx: WorkflowContext): number {
    let score = result.score;

    // Boost score for documents related to current workflow
    if (result.document.metadata.workflowId === workflowCtx.workflowId) {
      score *= 1.5;
    }

    // Boost score for documents related to current step
    if (result.document.metadata.step === workflowCtx.currentStep) {
      score *= 1.3;
    }

    // Boost score for documents with matching variables
    const matchingVars = Object.keys(workflowCtx.variables).filter(
      key => result.document.content.includes(workflowCtx.variables[key])
    );
    score *= (1 + matchingVars.length * 0.1);

    return Math.min(score, 1); // Cap at 1
  }

  private analyzeWorkflowRelevance(result: SearchResult, workflowCtx: WorkflowContext): Record<string, any> {
    return {
      workflowMatch: result.document.metadata.workflowId === workflowCtx.workflowId,
      stepRelevance: result.document.metadata.step === workflowCtx.currentStep,
      variableMatches: Object.keys(workflowCtx.variables).filter(
        key => result.document.content.includes(workflowCtx.variables[key])
      )
    };
  }

  // Helper methods for governance integration
  private enhanceQueryWithGovernanceContext(query: string, govCtx: GovernanceContext): string {
    const contextTerms = [];

    if (govCtx.proposalId) {
      contextTerms.push(`proposal: ${govCtx.proposalId}`);
    }

    if (govCtx.permissions.length > 0) {
      contextTerms.push(`permissions: ${govCtx.permissions.join(' ')}`);
    }

    return `${query} ${contextTerms.join(' ')}`;
  }

  private preprocessGovernanceContent(content: string): string {
    // Add governance-specific preprocessing
    // Extract key terms, normalize policy language, etc.
    return content
      .replace(/\b(SHALL|MUST|REQUIRED)\b/g, '[MANDATORY] $1')
      .replace(/\b(SHOULD|RECOMMENDED)\b/g, '[ADVISORY] $1')
      .replace(/\b(MAY|OPTIONAL)\b/g, '[OPTIONAL] $1');
  }

  private determineAccessLevel(content: string): string {
    if (content.includes('CONFIDENTIAL') || content.includes('RESTRICTED')) {
      return 'restricted';
    }
    if (content.includes('INTERNAL')) {
      return 'internal';
    }
    return 'public';
  }

  // Helper methods for NL2SQL integration
  private isNL2SQLQuery(query: string): boolean {
    const sqlKeywords = ['select', 'from', 'where', 'join', 'table', 'database', 'query'];
    return sqlKeywords.some(keyword => query.toLowerCase().includes(keyword));
  }

  private extractSQLContext(content: string): Record<string, any> {
    const tables = (content.match(/Table: (\w+)/g) || []).map(match =>
      match.replace('Table: ', '')
    );

    const columns = (content.match(/- (\w+) \(/g) || []).map(match =>
      match.replace(/- (\w+) \(/, '$1')
    );

    return { tables, columns };
  }

  // Placeholder methods for external data (would be implemented with actual data sources)
  private async getRelevantWorkflowTemplates(query: string): Promise<any[]> {
    // Implementation would fetch from workflow template storage
    return [];
  }

  private async getCommonWorkflowPatterns(): Promise<any[]> {
    // Implementation would analyze historical workflow data
    return [];
  }

  private async getGovernanceVersion(): Promise<string> {
    return '1.0.0';
  }

  private async getCurrentGovernancePolicies(): Promise<any[]> {
    return [];
  }

  private async getActiveProposals(): Promise<any[]> {
    return [];
  }

  private async getRelevantVotingHistory(query: string): Promise<any[]> {
    return [];
  }

  private async getRelevantSchemas(query: string): Promise<any[]> {
    return [];
  }

  private async getSampleSQLQueries(query: string): Promise<any[]> {
    return [];
  }

  private async getTableRelationships(): Promise<any[]> {
    return [];
  }

  private async getMCPToolResults(query: string): Promise<any[]> {
    return [];
  }

  private async getAvailableMCPTools(): Promise<any[]> {
    return [];
  }

  private async getMCPState(): Promise<any> {
    return {};
  }

  // Hook management
  removeAllHooks(): void {
    this.preSearchHooks.length = 0;
    this.postSearchHooks.length = 0;
    this.preIngestHooks.length = 0;
    this.postIngestHooks.length = 0;
    this.contextInjectors.length = 0;
  }

  getHookCounts(): { preSearch: number; postSearch: number; preIngest: number; postIngest: number; contextInjectors: number } {
    return {
      preSearch: this.preSearchHooks.length,
      postSearch: this.postSearchHooks.length,
      preIngest: this.preIngestHooks.length,
      postIngest: this.postIngestHooks.length,
      contextInjectors: this.contextInjectors.length
    };
  }
}