import { EventEmitter } from 'events';
import { LangGraphOrchestrator } from './langgraph/index.js';
import { GovernanceSystem } from './governance/index.js';
import { RAGSystem } from './rag/index.js';
import { NL2SQLEngine } from './nl2sql/index.js';
import { LALOMCPServer } from './mcp/server.js';
import { LALOConfig, Workflow, Proposal, Document, SQLQuery, LALOError } from './types/index.js';
import { getConfig } from './config/index.js';

export interface LALOEvents {
  'system:ready': [];
  'system:error': [Error];
  'workflow:executed': [string, any];
  'proposal:created': [string];
  'document:added': [string];
  'query:executed': [string, SQLQuery];
}

/**
 * Main LALO System - Orchestrates all components
 */
export class LALOSystem extends EventEmitter {
  private config: LALOConfig;
  private initialized = false;

  // Core Components
  public readonly langgraph: LangGraphOrchestrator;
  public readonly governance: GovernanceSystem;
  public readonly rag: RAGSystem;
  public readonly nl2sql: NL2SQLEngine;
  public readonly mcp: LALOMCPServer;

  constructor(config?: Partial<LALOConfig>) {
    super();
    this.config = { ...getConfig(), ...config };

    // Initialize components
    this.langgraph = new LangGraphOrchestrator();
    this.governance = new GovernanceSystem(this.config.governance);
    this.rag = new RAGSystem(this.config.rag);
    this.nl2sql = new NL2SQLEngine(this.config.nl2sql);
    this.mcp = new LALOMCPServer();

    this.setupEventHandlers();
  }

  /**
   * Initialize the LALO system
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      console.log('🔧 Initializing LALO components...');

      // Initialize governance system with default voting powers
      this.setupDefaultGovernance();

      // Load default schemas for NL2SQL
      await this.setupDefaultSchemas();

      // Start MCP server
      await this.startMCPServer();

      this.initialized = true;
      this.emit('system:ready');

      console.log('✅ LALO system initialized successfully');
    } catch (error) {
      this.emit('system:error', error);
      throw new LALOError(`Failed to initialize LALO system: ${error.message}`, 'INIT_ERROR', { error });
    }
  }

  /**
   * Setup event handlers for cross-component communication
   */
  private setupEventHandlers(): void {
    // Governance events
    this.governance.on('proposal:created', (proposal) => {
      this.emit('proposal:created', proposal.id);
      console.log(`📋 New proposal created: ${proposal.title}`);
    });

    this.governance.on('proposal:executed', async (proposalId) => {
      const proposal = this.governance.getProposal(proposalId);
      if (proposal?.type === 'workflow' && proposal.executionData) {
        try {
          await this.executeWorkflowFromProposal(proposal);
        } catch (error) {
          console.error(`Failed to execute workflow from proposal ${proposalId}:`, error);
        }
      }
    });

    // Error handling
    this.on('error', (error) => {
      console.error('LALO System Error:', error);
    });
  }

  /**
   * Execute a workflow through the governance system
   */
  async executeGovernedWorkflow(
    workflowId: string,
    input: Record<string, any>,
    proposer: string,
    title?: string,
    description?: string
  ): Promise<string> {
    try {
      // Create governance proposal for workflow execution
      const proposalId = await this.governance.createProposal(
        title || `Execute workflow: ${workflowId}`,
        description || `Proposal to execute workflow ${workflowId} with provided input`,
        proposer,
        'workflow',
        { workflowId, input }
      );

      return proposalId;
    } catch (error) {
      throw new LALOError(`Failed to create workflow proposal: ${error.message}`, 'WORKFLOW_PROPOSAL_ERROR', {
        workflowId,
        proposer,
        error
      });
    }
  }

  /**
   * Execute workflow from approved proposal
   */
  private async executeWorkflowFromProposal(proposal: Proposal): Promise<any> {
    if (!proposal.executionData?.workflowId) {
      throw new Error('Proposal missing workflow execution data');
    }

    const { workflowId, input } = proposal.executionData;
    const result = await this.langgraph.executeWorkflow(workflowId, input);

    this.emit('workflow:executed', workflowId, result);
    return result;
  }

  /**
   * Create and register a new workflow
   */
  async createWorkflow(workflow: Workflow): Promise<void> {
    try {
      await this.langgraph.registerWorkflow(workflow);
      console.log(`📊 Workflow registered: ${workflow.name} (${workflow.id})`);
    } catch (error) {
      throw new LALOError(`Failed to create workflow: ${error.message}`, 'WORKFLOW_CREATE_ERROR', {
        workflowId: workflow.id,
        error
      });
    }
  }

  /**
   * Add document to RAG system with governance proposal (if required)
   */
  async addDocument(
    content: string,
    metadata?: Record<string, any>,
    source?: string,
    requireGovernance = false,
    proposer?: string
  ): Promise<string> {
    try {
      if (requireGovernance && proposer) {
        // Create governance proposal for document addition
        const proposalId = await this.governance.createProposal(
          `Add document to knowledge base`,
          `Proposal to add document from source: ${source || 'unknown'}`,
          proposer,
          'config',
          { action: 'add_document', content, metadata, source }
        );
        return proposalId;
      } else {
        // Direct addition
        const documentId = await this.rag.addDocument(content, metadata, source);
        this.emit('document:added', documentId);
        console.log(`📄 Document added: ${documentId}`);
        return documentId;
      }
    } catch (error) {
      throw new LALOError(`Failed to add document: ${error.message}`, 'DOCUMENT_ADD_ERROR', {
        source,
        requireGovernance,
        error
      });
    }
  }

  /**
   * Enhanced NL2SQL with RAG context
   */
  async queryWithContext(
    naturalLanguage: string,
    useRAG = true,
    validate = true
  ): Promise<{
    sql: string;
    confidence: number;
    explanation: string;
    context?: any[];
    ragResults?: any[];
  }> {
    try {
      let context: any = {};
      let ragResults: any[] = [];

      // Get relevant context from RAG if enabled
      if (useRAG) {
        const searchResults = await this.rag.search({
          query: naturalLanguage,
          topK: 3,
          threshold: 0.7
        });

        ragResults = searchResults;
        context.ragContext = searchResults.map(result => ({
          content: result.document.content,
          score: result.score,
          metadata: result.document.metadata
        }));
      }

      // Convert to SQL with context
      const sqlResult = await this.nl2sql.convertToSQL(naturalLanguage, context, validate);

      // Create query record
      const queryId = `query-${Date.now()}`;
      const queryRecord: SQLQuery = {
        id: queryId,
        naturalLanguage,
        sql: sqlResult.sql,
        confidence: sqlResult.confidence,
        tables: sqlResult.tables,
        metadata: {
          ...sqlResult.metadata,
          ragEnabled: useRAG,
          ragResults: ragResults.length
        },
        createdAt: new Date()
      };

      this.emit('query:executed', queryId, queryRecord);

      return {
        ...sqlResult,
        context: context.ragContext,
        ragResults
      };
    } catch (error) {
      throw new LALOError(`Failed to process query: ${error.message}`, 'QUERY_ERROR', {
        naturalLanguage,
        useRAG,
        error
      });
    }
  }

  /**
   * Get comprehensive system status
   */
  async getSystemStatus(): Promise<{
    initialized: boolean;
    components: {
      langgraph: any;
      governance: any;
      rag: any;
      nl2sql: any;
      mcp: boolean;
    };
    uptime: number;
    timestamp: string;
  }> {
    const [ragStats, nl2sqlStats] = await Promise.all([
      this.rag.getStats(),
      this.nl2sql.getStats()
    ]);

    return {
      initialized: this.initialized,
      components: {
        langgraph: {
          workflows: this.langgraph.getWorkflows().length,
          activeExecutions: this.langgraph.getActiveExecutions().length
        },
        governance: this.governance.getGovernanceStats(),
        rag: ragStats,
        nl2sql: nl2sqlStats,
        mcp: true // MCP server status
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Setup default governance configuration
   */
  private setupDefaultGovernance(): void {
    // Set default voting powers for system initialization
    this.governance.setVotingPower('system', 10);
    this.governance.setVotingPower('admin', 5);
    console.log('🏛️ Default governance setup complete');
  }

  /**
   * Setup default database schemas for NL2SQL
   */
  private async setupDefaultSchemas(): Promise<void> {
    try {
      // Example user table schema
      await this.nl2sql.addTableSchema({
        name: 'users',
        description: 'User account information',
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: true, nullable: false, description: 'User ID' },
          { name: 'username', type: 'VARCHAR(50)', nullable: false, description: 'Username' },
          { name: 'email', type: 'VARCHAR(100)', nullable: false, description: 'Email address' },
          { name: 'created_at', type: 'TIMESTAMP', nullable: false, description: 'Account creation date' },
          { name: 'active', type: 'BOOLEAN', nullable: false, description: 'Account status' }
        ],
        relationships: []
      });

      // Example workflow table schema
      await this.nl2sql.addTableSchema({
        name: 'workflows',
        description: 'Workflow execution records',
        columns: [
          { name: 'id', type: 'VARCHAR(50)', primaryKey: true, nullable: false, description: 'Workflow ID' },
          { name: 'name', type: 'VARCHAR(100)', nullable: false, description: 'Workflow name' },
          { name: 'status', type: 'VARCHAR(20)', nullable: false, description: 'Execution status' },
          { name: 'created_by', type: 'INTEGER', foreignKey: 'users.id', nullable: false, description: 'Creator user ID' },
          { name: 'executed_at', type: 'TIMESTAMP', nullable: true, description: 'Execution timestamp' }
        ],
        relationships: [
          {
            table: 'workflows',
            column: 'created_by',
            referencedTable: 'users',
            referencedColumn: 'id',
            type: 'many-to-one'
          }
        ]
      });

      console.log('🗄️ Default database schemas loaded');
    } catch (error) {
      console.warn('⚠️ Failed to setup default schemas:', error.message);
    }
  }

  /**
   * Start MCP server
   */
  private async startMCPServer(): Promise<void> {
    try {
      // MCP server will start automatically when imported
      console.log('🔌 MCP server ready');
    } catch (error) {
      console.warn('⚠️ MCP server failed to start:', error.message);
    }
  }

  /**
   * Shutdown the LALO system
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      console.log('🛑 Shutting down LALO system...');

      // Cancel active workflow executions
      const activeExecutions = this.langgraph.getActiveExecutions();
      for (const execution of activeExecutions) {
        await this.langgraph.cancelExecution(execution.executionId);
      }

      this.initialized = false;
      console.log('✅ LALO system shutdown complete');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Check if system is ready
   */
  isReady(): boolean {
    return this.initialized;
  }
}

export default LALOSystem;