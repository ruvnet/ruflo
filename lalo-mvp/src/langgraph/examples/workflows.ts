import { Workflow } from '../../types/index.js';

/**
 * Example workflow demonstrating basic sequential processing
 */
export const basicProcessingWorkflow: Workflow = {
  id: 'basic-processing',
  name: 'Basic Data Processing Workflow',
  description: 'A simple workflow that validates, processes, and generates output',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start Processing'
    },
    {
      id: 'validate',
      type: 'task',
      name: 'Validate Input',
      function: 'validate_input'
    },
    {
      id: 'process',
      type: 'task',
      name: 'Process Data',
      function: 'process_data'
    },
    {
      id: 'generate',
      type: 'task',
      name: 'Generate Response',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete Processing'
    }
  ],
  edges: [
    { from: 'start', to: 'validate' },
    { from: 'validate', to: 'process' },
    { from: 'process', to: 'generate' },
    { from: 'generate', to: 'end' }
  ],
  metadata: {
    category: 'data-processing',
    version: '1.0.0',
    author: 'LALO System'
  }
};

/**
 * Example workflow with RAG context injection
 */
export const ragEnhancedWorkflow: Workflow = {
  id: 'rag-enhanced',
  name: 'RAG Enhanced Workflow',
  description: 'Workflow that uses RAG for context-aware processing',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start RAG Workflow'
    },
    {
      id: 'rag_search',
      type: 'task',
      name: 'Search Knowledge Base',
      function: 'rag_search'
    },
    {
      id: 'context_analysis',
      type: 'task',
      name: 'Analyze Context',
      function: 'process_data'
    },
    {
      id: 'enhanced_response',
      type: 'task',
      name: 'Generate Enhanced Response',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete RAG Processing'
    }
  ],
  edges: [
    { from: 'start', to: 'rag_search' },
    { from: 'rag_search', to: 'context_analysis' },
    { from: 'context_analysis', to: 'enhanced_response' },
    { from: 'enhanced_response', to: 'end' }
  ],
  metadata: {
    category: 'knowledge-retrieval',
    version: '1.0.0',
    author: 'LALO System',
    requiresRAG: true
  }
};

/**
 * Example workflow with SQL query execution
 */
export const sqlQueryWorkflow: Workflow = {
  id: 'sql-query',
  name: 'Natural Language to SQL Workflow',
  description: 'Converts natural language to SQL and executes queries',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start SQL Workflow'
    },
    {
      id: 'sql_conversion',
      type: 'task',
      name: 'Convert to SQL',
      function: 'sql_query'
    },
    {
      id: 'validation',
      type: 'task',
      name: 'Validate Query',
      function: 'validate_input'
    },
    {
      id: 'execution',
      type: 'task',
      name: 'Execute Query',
      function: 'process_data'
    },
    {
      id: 'format_results',
      type: 'task',
      name: 'Format Results',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete SQL Processing'
    }
  ],
  edges: [
    { from: 'start', to: 'sql_conversion' },
    { from: 'sql_conversion', to: 'validation' },
    { from: 'validation', to: 'execution' },
    { from: 'execution', to: 'format_results' },
    { from: 'format_results', to: 'end' }
  ],
  metadata: {
    category: 'data-query',
    version: '1.0.0',
    author: 'LALO System',
    requiresSQL: true
  }
};

/**
 * Example workflow with governance approval
 */
export const governanceWorkflow: Workflow = {
  id: 'governance-approval',
  name: 'Governance Approval Workflow',
  description: 'Workflow requiring governance approval for execution',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start Governance Workflow'
    },
    {
      id: 'governance_check',
      type: 'task',
      name: 'Check Governance',
      function: 'governance_check'
    },
    {
      id: 'approval_decision',
      type: 'decision',
      name: 'Approval Decision',
      condition: 'data.governanceApproved',
      next: ['approved_action', 'rejected_action']
    },
    {
      id: 'wait_approval',
      type: 'task',
      name: 'Wait for Approval',
      function: 'wait_for_approval'
    },
    {
      id: 'approved_action',
      type: 'task',
      name: 'Execute Approved Action',
      function: 'process_data'
    },
    {
      id: 'rejected_action',
      type: 'task',
      name: 'Handle Rejection',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete Governance Process'
    }
  ],
  edges: [
    { from: 'start', to: 'governance_check' },
    { from: 'governance_check', to: 'approval_decision' },
    { from: 'approval_decision', to: 'approved_action', condition: 'data.governanceApproved' },
    { from: 'approval_decision', to: 'wait_approval' },
    { from: 'wait_approval', to: 'approved_action' },
    { from: 'approved_action', to: 'end' },
    { from: 'rejected_action', to: 'end' }
  ],
  metadata: {
    category: 'governance',
    version: '1.0.0',
    author: 'LALO System',
    requiresGovernance: true
  }
};

/**
 * Example workflow with parallel execution
 */
export const parallelProcessingWorkflow: Workflow = {
  id: 'parallel-processing',
  name: 'Parallel Processing Workflow',
  description: 'Workflow demonstrating parallel task execution',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start Parallel Workflow'
    },
    {
      id: 'data_split',
      type: 'task',
      name: 'Split Data',
      function: 'process_data'
    },
    {
      id: 'parallel_tasks',
      type: 'parallel',
      name: 'Execute Parallel Tasks',
      function: 'parallel_execute',
      next: ['task_a', 'task_b', 'task_c']
    },
    {
      id: 'task_a',
      type: 'task',
      name: 'Task A',
      function: 'process_data'
    },
    {
      id: 'task_b',
      type: 'task',
      name: 'Task B',
      function: 'process_data'
    },
    {
      id: 'task_c',
      type: 'task',
      name: 'Task C',
      function: 'process_data'
    },
    {
      id: 'merge_results',
      type: 'task',
      name: 'Merge Results',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete Parallel Processing'
    }
  ],
  edges: [
    { from: 'start', to: 'data_split' },
    { from: 'data_split', to: 'parallel_tasks' },
    { from: 'parallel_tasks', to: 'merge_results' },
    { from: 'merge_results', to: 'end' }
  ],
  metadata: {
    category: 'parallel-processing',
    version: '1.0.0',
    author: 'LALO System',
    parallelExecution: true
  }
};

/**
 * Complex workflow combining all features
 */
export const comprehensiveWorkflow: Workflow = {
  id: 'comprehensive',
  name: 'Comprehensive LALO Workflow',
  description: 'Complex workflow demonstrating all enhanced features',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start Comprehensive Workflow'
    },
    {
      id: 'input_validation',
      type: 'task',
      name: 'Validate Input',
      function: 'validate_input'
    },
    {
      id: 'governance_check',
      type: 'task',
      name: 'Governance Check',
      function: 'governance_check'
    },
    {
      id: 'approval_gate',
      type: 'decision',
      name: 'Approval Gate',
      condition: 'data.governanceApproved',
      next: ['continue_processing', 'wait_approval']
    },
    {
      id: 'wait_approval',
      type: 'task',
      name: 'Wait for Approval',
      function: 'wait_for_approval'
    },
    {
      id: 'continue_processing',
      type: 'parallel',
      name: 'Parallel Processing',
      next: ['rag_branch', 'sql_branch']
    },
    {
      id: 'rag_branch',
      type: 'task',
      name: 'RAG Processing',
      function: 'rag_search'
    },
    {
      id: 'sql_branch',
      type: 'task',
      name: 'SQL Processing',
      function: 'sql_query'
    },
    {
      id: 'merge_contexts',
      type: 'task',
      name: 'Merge Contexts',
      function: 'process_data'
    },
    {
      id: 'quality_check',
      type: 'decision',
      name: 'Quality Check',
      condition: 'data.qualityScore > 0.8',
      next: ['finalize', 'retry_processing']
    },
    {
      id: 'retry_processing',
      type: 'task',
      name: 'Retry Processing',
      function: 'process_data'
    },
    {
      id: 'finalize',
      type: 'task',
      name: 'Finalize Response',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete Comprehensive Processing'
    }
  ],
  edges: [
    { from: 'start', to: 'input_validation' },
    { from: 'input_validation', to: 'governance_check' },
    { from: 'governance_check', to: 'approval_gate' },
    { from: 'approval_gate', to: 'continue_processing', condition: 'data.governanceApproved' },
    { from: 'approval_gate', to: 'wait_approval' },
    { from: 'wait_approval', to: 'continue_processing' },
    { from: 'continue_processing', to: 'merge_contexts' },
    { from: 'rag_branch', to: 'merge_contexts' },
    { from: 'sql_branch', to: 'merge_contexts' },
    { from: 'merge_contexts', to: 'quality_check' },
    { from: 'quality_check', to: 'finalize', condition: 'data.qualityScore > 0.8' },
    { from: 'quality_check', to: 'retry_processing' },
    { from: 'retry_processing', to: 'quality_check' },
    { from: 'finalize', to: 'end' }
  ],
  metadata: {
    category: 'comprehensive',
    version: '1.0.0',
    author: 'LALO System',
    requiresRAG: true,
    requiresSQL: true,
    requiresGovernance: true,
    parallelExecution: true,
    complexity: 'high'
  }
};

/**
 * Error handling workflow
 */
export const errorHandlingWorkflow: Workflow = {
  id: 'error-handling',
  name: 'Error Handling Workflow',
  description: 'Workflow demonstrating comprehensive error handling',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start Error Handling Demo'
    },
    {
      id: 'risky_operation',
      type: 'task',
      name: 'Risky Operation',
      function: 'process_data'
    },
    {
      id: 'error_check',
      type: 'decision',
      name: 'Check for Errors',
      condition: 'data.error',
      next: ['error_handler', 'success_path']
    },
    {
      id: 'error_handler',
      type: 'task',
      name: 'Handle Error',
      function: 'generate_response'
    },
    {
      id: 'retry_decision',
      type: 'decision',
      name: 'Retry Decision',
      condition: 'data.retryCount < 3',
      next: ['retry_operation', 'final_error']
    },
    {
      id: 'retry_operation',
      type: 'task',
      name: 'Retry Operation',
      function: 'process_data'
    },
    {
      id: 'success_path',
      type: 'task',
      name: 'Success Processing',
      function: 'generate_response'
    },
    {
      id: 'final_error',
      type: 'task',
      name: 'Final Error Handling',
      function: 'generate_response'
    },
    {
      id: 'end',
      type: 'end',
      name: 'Complete Error Handling'
    }
  ],
  edges: [
    { from: 'start', to: 'risky_operation' },
    { from: 'risky_operation', to: 'error_check' },
    { from: 'error_check', to: 'success_path', condition: '!data.error' },
    { from: 'error_check', to: 'error_handler', condition: 'data.error' },
    { from: 'error_handler', to: 'retry_decision' },
    { from: 'retry_decision', to: 'retry_operation', condition: 'data.retryCount < 3' },
    { from: 'retry_decision', to: 'final_error' },
    { from: 'retry_operation', to: 'error_check' },
    { from: 'success_path', to: 'end' },
    { from: 'final_error', to: 'end' }
  ],
  metadata: {
    category: 'error-handling',
    version: '1.0.0',
    author: 'LALO System',
    demonstratesErrorHandling: true
  }
};

// Export all workflows
export const exampleWorkflows = {
  basicProcessingWorkflow,
  ragEnhancedWorkflow,
  sqlQueryWorkflow,
  governanceWorkflow,
  parallelProcessingWorkflow,
  comprehensiveWorkflow,
  errorHandlingWorkflow
};

// Workflow categories for easy filtering
export const workflowCategories = {
  'data-processing': [basicProcessingWorkflow],
  'knowledge-retrieval': [ragEnhancedWorkflow],
  'data-query': [sqlQueryWorkflow],
  'governance': [governanceWorkflow],
  'parallel-processing': [parallelProcessingWorkflow],
  'comprehensive': [comprehensiveWorkflow],
  'error-handling': [errorHandlingWorkflow]
};

// Workflow metadata helper
export function getWorkflowMetadata(workflowId: string) {
  const workflow = Object.values(exampleWorkflows).find(w => w.id === workflowId);
  return workflow?.metadata;
}

// Workflow complexity levels
export function getWorkflowComplexity(workflowId: string): 'low' | 'medium' | 'high' {
  const workflow = Object.values(exampleWorkflows).find(w => w.id === workflowId);
  if (!workflow) return 'low';

  const nodeCount = workflow.nodes.length;
  const hasParallel = workflow.nodes.some(n => n.type === 'parallel');
  const hasDecision = workflow.nodes.some(n => n.type === 'decision');
  const requiresIntegrations = workflow.metadata?.requiresRAG ||
                              workflow.metadata?.requiresSQL ||
                              workflow.metadata?.requiresGovernance;

  if (nodeCount > 10 || (hasParallel && hasDecision && requiresIntegrations)) {
    return 'high';
  } else if (nodeCount > 5 || hasParallel || hasDecision || requiresIntegrations) {
    return 'medium';
  } else {
    return 'low';
  }
}