#!/usr/bin/env tsx

import { EnhancedLangGraphOrchestrator } from '../enhanced-orchestrator.js';
import { exampleWorkflows } from './workflows.js';
import GovernanceSystem from '../../governance/index.js';
import RAGSystem from '../../rag/index.js';
import NL2SQLEngine from '../../nl2sql/index.js';
import { getConfig, validateEnvironment } from '../../config/index.js';

/**
 * Demonstration script for the Enhanced LangGraph Orchestrator
 *
 * This script shows how to:
 * 1. Initialize the orchestrator with integrated systems
 * 2. Register workflows with various complexity levels
 * 3. Execute workflows with different features (RAG, SQL, Governance)
 * 4. Monitor execution progress and metrics
 * 5. Handle errors and manage workflow lifecycle
 */

async function runEnhancedLangGraphDemo(): Promise<void> {
  console.log('🚀 Enhanced LangGraph Orchestrator Demo\n');

  try {
    // Validate environment
    validateEnvironment();

    // Initialize integrated systems
    console.log('📋 Initializing integrated systems...');
    const governanceSystem = new GovernanceSystem();
    const ragSystem = new RAGSystem();
    const nl2sqlEngine = new NL2SQLEngine();

    // Initialize the enhanced orchestrator
    const orchestrator = new EnhancedLangGraphOrchestrator(
      governanceSystem,
      ragSystem,
      nl2sqlEngine
    );

    // Setup event listeners to monitor workflow execution
    setupEventListeners(orchestrator);

    // Initialize some test data
    await initializeTestData(governanceSystem, ragSystem, nl2sqlEngine);

    console.log('✅ Systems initialized successfully\n');

    // Demo 1: Basic workflow execution
    console.log('📝 Demo 1: Basic Processing Workflow');
    await demoBasicWorkflow(orchestrator);
    console.log('');

    // Demo 2: RAG-enhanced workflow
    console.log('🔍 Demo 2: RAG-Enhanced Workflow');
    await demoRAGWorkflow(orchestrator);
    console.log('');

    // Demo 3: SQL query workflow
    console.log('💾 Demo 3: SQL Query Workflow');
    await demoSQLWorkflow(orchestrator);
    console.log('');

    // Demo 4: Governance workflow
    console.log('🏛️ Demo 4: Governance Approval Workflow');
    await demoGovernanceWorkflow(orchestrator, governanceSystem);
    console.log('');

    // Demo 5: Parallel processing workflow
    console.log('⚡ Demo 5: Parallel Processing Workflow');
    await demoParallelWorkflow(orchestrator);
    console.log('');

    // Demo 6: Comprehensive workflow
    console.log('🎯 Demo 6: Comprehensive Workflow (All Features)');
    await demoComprehensiveWorkflow(orchestrator);
    console.log('');

    // Demo 7: Error handling
    console.log('⚠️ Demo 7: Error Handling');
    await demoErrorHandling(orchestrator);
    console.log('');

    // Demo 8: Execution management
    console.log('📊 Demo 8: Execution Management & Metrics');
    await demoExecutionManagement(orchestrator);
    console.log('');

    console.log('🎉 All demos completed successfully!');

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    process.exit(1);
  }
}

/**
 * Setup event listeners to monitor workflow execution
 */
function setupEventListeners(orchestrator: EnhancedLangGraphOrchestrator): void {
  orchestrator.on('workflow:started', (execution) => {
    console.log(`   📤 Workflow started: ${execution.id} (${execution.workflowId})`);
  });

  orchestrator.on('workflow:completed', (execution) => {
    const duration = execution.endTime ?
      execution.endTime.getTime() - execution.startTime.getTime() : 0;
    console.log(`   ✅ Workflow completed: ${execution.id} (${duration}ms)`);
  });

  orchestrator.on('workflow:failed', (execution, error) => {
    console.log(`   ❌ Workflow failed: ${execution.id} - ${error.message}`);
  });

  orchestrator.on('workflow:paused', (execution) => {
    console.log(`   ⏸️ Workflow paused: ${execution.id}`);
  });

  orchestrator.on('workflow:resumed', (execution) => {
    console.log(`   ▶️ Workflow resumed: ${execution.id}`);
  });

  orchestrator.on('rag:context:injected', (executionId, results) => {
    console.log(`   🔍 RAG context injected: ${executionId} (${results.length} documents)`);
  });

  orchestrator.on('sql:query:executed', (executionId, result) => {
    console.log(`   💾 SQL query executed: ${executionId} (confidence: ${result.confidence})`);
  });

  orchestrator.on('governance:approval:received', (executionId, approved) => {
    console.log(`   🏛️ Governance approval: ${executionId} (${approved ? 'approved' : 'denied'})`);
  });
}

/**
 * Initialize test data for demonstrations
 */
async function initializeTestData(
  governance: GovernanceSystem,
  rag: RAGSystem,
  nl2sql: NL2SQLEngine
): Promise<void> {
  // Setup governance voting power
  governance.setVotingPower('admin', 100);
  governance.setVotingPower('user1', 50);
  governance.setVotingPower('user2', 30);

  // Add some documents to RAG system
  await rag.addDocument(
    'The LALO system integrates LangGraph workflows with governance, RAG, and NL2SQL capabilities. ' +
    'It provides a comprehensive platform for managing complex AI workflows with proper oversight and context.',
    { type: 'system_doc', category: 'overview' },
    'lalo_overview'
  );

  await rag.addDocument(
    'LangGraph workflows support sequential, parallel, and conditional execution patterns. ' +
    'Nodes can be of type start, end, task, decision, or parallel, with edges defining the flow.',
    { type: 'technical_doc', category: 'workflows' },
    'langgraph_guide'
  );

  // Add sample table schemas for NL2SQL
  await nl2sql.addTableSchema({
    name: 'users',
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true, description: 'User ID' },
      { name: 'name', type: 'VARCHAR(255)', nullable: false, primaryKey: false, description: 'User name' },
      { name: 'email', type: 'VARCHAR(255)', nullable: false, primaryKey: false, description: 'User email' },
      { name: 'created_at', type: 'TIMESTAMP', nullable: false, primaryKey: false, description: 'Creation timestamp' }
    ],
    relationships: [],
    description: 'User account information'
  });

  await nl2sql.addTableSchema({
    name: 'workflows',
    columns: [
      { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true, description: 'Workflow ID' },
      { name: 'name', type: 'VARCHAR(255)', nullable: false, primaryKey: false, description: 'Workflow name' },
      { name: 'status', type: 'VARCHAR(50)', nullable: false, primaryKey: false, description: 'Workflow status' },
      { name: 'user_id', type: 'INTEGER', nullable: false, primaryKey: false, foreignKey: 'users.id', description: 'Owner user ID' }
    ],
    relationships: [
      { table: 'workflows', column: 'user_id', referencedTable: 'users', referencedColumn: 'id', type: 'many-to-one' }
    ],
    description: 'Workflow execution records'
  });
}

/**
 * Demo 1: Basic workflow execution
 */
async function demoBasicWorkflow(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.basicProcessingWorkflow);

  const input = {
    data: 'Hello, World!',
    user: 'demo_user',
    timestamp: new Date().toISOString()
  };

  const result = await orchestrator.executeWorkflow(
    'basic-processing',
    input,
    { timeout: 10000 }
  );

  console.log(`   Result: ${JSON.stringify(result.data, null, 2)}`);
}

/**
 * Demo 2: RAG-enhanced workflow
 */
async function demoRAGWorkflow(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.ragEnhancedWorkflow);

  const input = {
    query: 'How does LangGraph workflow execution work?',
    context: 'system documentation'
  };

  const result = await orchestrator.executeWorkflow(
    'rag-enhanced',
    input,
    {
      enableRAG: true,
      timeout: 15000
    }
  );

  console.log(`   Query: ${input.query}`);
  console.log(`   RAG Results: ${result.ragResults?.length || 0} documents found`);
  console.log(`   Enhanced Context: ${result.data.enrichedContext ? 'Available' : 'None'}`);
}

/**
 * Demo 3: SQL query workflow
 */
async function demoSQLWorkflow(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.sqlQueryWorkflow);

  const input = {
    naturalLanguage: 'Show me all users who created workflows',
    context: { include_timestamps: true }
  };

  const result = await orchestrator.executeWorkflow(
    'sql-query',
    input,
    {
      enableSQL: true,
      timeout: 15000
    }
  );

  console.log(`   Query: ${input.naturalLanguage}`);
  console.log(`   Generated SQL: ${result.data.sqlQuery || 'None generated'}`);
  console.log(`   Confidence: ${result.data.sqlConfidence || 0}`);
}

/**
 * Demo 4: Governance workflow
 */
async function demoGovernanceWorkflow(
  orchestrator: EnhancedLangGraphOrchestrator,
  governance: GovernanceSystem
): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.governanceWorkflow);

  // Create a proposal for the workflow
  const proposalId = await governance.createProposal(
    'Execute Governance Demo Workflow',
    'Demonstration of governance-controlled workflow execution',
    'admin',
    'workflow',
    { workflowId: 'governance-approval' }
  );

  // Vote on the proposal
  await governance.vote(proposalId, 'admin', 'for', 'Demo approval');
  await governance.vote(proposalId, 'user1', 'for', 'Support demo');

  const input = {
    operation: 'sensitive_data_processing',
    user: 'demo_user',
    proposalId
  };

  try {
    const result = await orchestrator.executeWorkflow(
      'governance-approval',
      input,
      {
        requireGovernance: true,
        timeout: 20000
      }
    );

    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Governance Status: ${result.data.proposalStatus || 'Unknown'}`);
    console.log(`   Approved: ${result.data.governanceApproved || false}`);
  } catch (error) {
    console.log(`   Governance check failed: ${error.message}`);
  }
}

/**
 * Demo 5: Parallel processing workflow
 */
async function demoParallelWorkflow(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.parallelProcessingWorkflow);

  const input = {
    dataset: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    operation: 'square',
    parallelism: 3
  };

  const result = await orchestrator.executeWorkflow(
    'parallel-processing',
    input,
    { timeout: 15000 }
  );

  console.log(`   Input Dataset: ${input.dataset.join(', ')}`);
  console.log(`   Parallel Results: ${result.data.parallelResults ? 'Computed' : 'None'}`);
  console.log(`   Parallel Count: ${result.data.parallelCount || 0}`);
}

/**
 * Demo 6: Comprehensive workflow combining all features
 */
async function demoComprehensiveWorkflow(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  await orchestrator.registerWorkflow(exampleWorkflows.comprehensiveWorkflow);

  const input = {
    query: 'What are the best practices for LangGraph workflows?',
    operation: 'comprehensive_analysis',
    user: 'power_user',
    qualityThreshold: 0.8
  };

  const result = await orchestrator.executeWorkflow(
    'comprehensive',
    input,
    {
      enableRAG: true,
      enableSQL: true,
      requireGovernance: false, // Simplified for demo
      timeout: 30000
    }
  );

  console.log(`   Query: ${input.query}`);
  console.log(`   RAG Results: ${result.ragResults?.length || 0} documents`);
  console.log(`   SQL Results: ${result.sqlResults?.length || 0} queries`);
  console.log(`   Quality Score: ${result.data.qualityScore || 'Not calculated'}`);
  console.log(`   Final Status: ${result.completed ? 'Completed' : 'In Progress'}`);
}

/**
 * Demo 7: Error handling
 */
async function demoErrorHandling(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  // Register a custom function that might fail
  orchestrator.registerFunction('risky_operation', async (data: any) => {
    if (Math.random() < 0.5) {
      throw new Error('Simulated operation failure');
    }
    return { ...data, risky_result: 'success' };
  });

  await orchestrator.registerWorkflow(exampleWorkflows.errorHandlingWorkflow);

  const input = {
    operation: 'risky_task',
    retryCount: 0,
    maxRetries: 3
  };

  try {
    const result = await orchestrator.executeWorkflow(
      'error-handling',
      input,
      {
        pauseOnError: false,
        timeout: 15000,
        retries: 2
      }
    );

    console.log(`   Operation: ${input.operation}`);
    console.log(`   Result: ${result.data.risky_result || 'Failed'}`);
    console.log(`   Retry Count: ${result.data.retryCount || 0}`);
  } catch (error) {
    console.log(`   Error handled: ${error.message}`);
  }
}

/**
 * Demo 8: Execution management and metrics
 */
async function demoExecutionManagement(orchestrator: EnhancedLangGraphOrchestrator): Promise<void> {
  // Show system metrics
  const systemMetrics = orchestrator.getSystemMetrics();
  console.log('   System Metrics:');
  console.log(`   - Active Executions: ${systemMetrics.activeExecutions}`);
  console.log(`   - Registered Workflows: ${systemMetrics.registeredWorkflows}`);
  console.log(`   - Registered Functions: ${systemMetrics.registeredFunctions}`);
  console.log(`   - Total Executions: ${systemMetrics.totalExecutions}`);
  console.log(`   - Average Execution Time: ${Math.round(systemMetrics.averageExecutionTime)}ms`);
  console.log(`   - Memory Usage: ${Math.round(systemMetrics.memoryUsage.heapUsed / 1024 / 1024)}MB`);

  // Show registered workflows
  const workflows = orchestrator.getWorkflows();
  console.log(`   Registered Workflows: ${workflows.join(', ')}`);

  // Cleanup completed executions
  const cleanedUp = orchestrator.cleanupCompletedExecutions();
  console.log(`   Cleaned up ${cleanedUp} completed executions`);
}

/**
 * Main execution function
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runEnhancedLangGraphDemo().catch(console.error);
}

export { runEnhancedLangGraphDemo };