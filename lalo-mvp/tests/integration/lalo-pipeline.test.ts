/**
 * LALO MVP Integration Tests
 * Tests for end-to-end component interactions and data flows
 */

import { LALOPipeline, LangGraphWorkflow, GovernanceEngine, MCPCoordinator, RAGEngine, NL2SQLEngine } from '../../src';

describe('LALO Pipeline Integration', () => {
  let laloPipeline: LALOPipeline;
  let langGraph: LangGraphWorkflow;
  let governance: GovernanceEngine;
  let mcpCoordinator: MCPCoordinator;
  let ragEngine: RAGEngine;
  let nl2sqlEngine: NL2SQLEngine;

  beforeEach(async () => {
    // Initialize all components
    governance = new GovernanceEngine({
      strictMode: true,
      auditEnabled: true
    });

    mcpCoordinator = new MCPCoordinator({
      topology: 'mesh',
      maxNodes: 5
    });

    ragEngine = new RAGEngine({
      vectorStore: global.mockVectorStore,
      embedder: global.mockEmbedder,
      maxResults: 10
    });

    nl2sqlEngine = new NL2SQLEngine({
      schema: global.testDatabase.schema,
      dialect: 'postgresql'
    });

    langGraph = new LangGraphWorkflow({
      nodes: ['auth', 'validate', 'process', 'respond'],
      edges: [
        { from: 'auth', to: 'validate' },
        { from: 'validate', to: 'process' },
        { from: 'process', to: 'respond' }
      ]
    });

    laloPipeline = new LALOPipeline({
      langGraph,
      governance,
      mcpCoordinator,
      ragEngine,
      nl2sqlEngine
    });

    await laloPipeline.initialize();
  });

  afterEach(async () => {
    await laloPipeline.cleanup();
  });

  describe('Complete Query Processing Pipeline', () => {
    test('should process natural language query end-to-end', async () => {
      const userQuery = {
        text: 'Show me all users in the engineering department created last month',
        user: global.testUtils.createMockUser({
          role: 'analyst',
          permissions: ['read:users', 'read:departments']
        }),
        context: {
          sessionId: 'test-session-123',
          requestId: 'req-456'
        }
      };

      const result = await laloPipeline.processQuery(userQuery);

      // Verify all components were involved
      expect(result.governance.validated).toBe(true);
      expect(result.langGraph.completed).toBe(true);
      expect(result.mcp.coordinated).toBe(true);
      expect(result.rag.documentsRetrieved).toBeGreaterThan(0);
      expect(result.nl2sql.query).toContain('SELECT');
      expect(result.nl2sql.query).toContain('engineering');
      expect(result.nl2sql.query).toContain('created_at');

      // Verify data flow
      expect(result.data).toBeDefined();
      expect(result.metadata.executionTime).toBeGreaterThan(0);
      expect(result.metadata.componentsUsed).toEqual(['governance', 'langGraph', 'mcp', 'rag', 'nl2sql']);
    });

    test('should handle complex queries with RAG context enrichment', async () => {
      const complexQuery = {
        text: 'What are the best practices for database optimization based on our documentation?',
        user: global.testUtils.createMockUser({
          role: 'developer',
          permissions: ['read:docs', 'read:analytics']
        }),
        requiresRAG: true
      };

      // Pre-populate RAG with relevant documents
      await ragEngine.storeDocument({
        id: 'doc-1',
        content: 'Database optimization best practices include indexing, query optimization, and connection pooling.',
        metadata: { type: 'documentation', category: 'database' }
      });

      const result = await laloPipeline.processQuery(complexQuery);

      expect(result.rag.documentsRetrieved).toBeGreaterThan(0);
      expect(result.rag.context).toContain('optimization');
      expect(result.response).toContain('indexing');
      expect(result.nl2sql.applicable).toBe(false); // This query doesn't need SQL
    });

    test('should enforce governance policies throughout pipeline', async () => {
      const restrictedQuery = {
        text: 'Show me all user passwords and social security numbers',
        user: global.testUtils.createMockUser({
          role: 'viewer', // Low privilege user
          permissions: ['read:basic']
        })
      };

      const result = await laloPipeline.processQuery(restrictedQuery);

      expect(result.governance.validated).toBe(false);
      expect(result.governance.reason).toContain('insufficient permissions');
      expect(result.status).toBe('denied');
      expect(result.auditLog).toBeDefined();
    });
  });

  describe('LangGraph + Governance Integration', () => {
    test('should validate permissions at each workflow step', async () => {
      const workflowConfig = {
        nodes: ['authenticate', 'authorize', 'execute', 'audit'],
        governanceCheckpoints: ['authorize', 'execute']
      };

      langGraph.addGovernanceCheckpoints(workflowConfig.governanceCheckpoints);

      const context = {
        user: global.testUtils.createMockUser({ role: 'user' }),
        action: 'read:sensitive_data',
        resource: { type: 'database', classification: 'confidential' }
      };

      await langGraph.setContext(context);
      await langGraph.start();

      // Should be blocked at authorize step
      expect(langGraph.getCurrentState()).toBe('authorize');
      expect(langGraph.isBlocked()).toBe(true);

      const blockReason = langGraph.getBlockReason();
      expect(blockReason.type).toBe('governance_failure');
      expect(blockReason.checkpoint).toBe('authorize');
    });

    test('should handle dynamic permission escalation', async () => {
      const escalationWorkflow = {
        nodes: ['request', 'check_permissions', 'escalate', 'approve', 'execute'],
        escalationTrigger: 'insufficient_permissions'
      };

      const restrictedContext = {
        user: global.testUtils.createMockUser({ role: 'user' }),
        action: 'admin:delete_user',
        escalationRequired: true
      };

      const result = await langGraph.executeWithEscalation(restrictedContext);

      expect(result.escalated).toBe(true);
      expect(result.approvalRequired).toBe(true);
      expect(result.escalationRequest).toBeDefined();
    });
  });

  describe('RAG + NL2SQL Integration', () => {
    test('should use RAG context to improve SQL generation', async () => {
      // Store schema documentation in RAG
      await ragEngine.storeDocument({
        id: 'schema-doc',
        content: `
          The users table contains employee information.
          The 'status' column uses values: 'active', 'inactive', 'pending'.
          The 'department_id' links to departments table.
          For performance queries, always include created_at index.
        `,
        metadata: { type: 'schema_documentation' }
      });

      const queryWithContext = {
        text: 'Show active users with their department names',
        useRAGContext: true
      };

      const pipeline = new RAGNLSQLPipeline({ ragEngine, nl2sqlEngine });
      const result = await pipeline.process(queryWithContext);

      expect(result.rag.contextUsed).toBe(true);
      expect(result.sql).toContain('status = \'active\''); // Should use correct enum value
      expect(result.sql).toContain('JOIN departments'); // Should include department join
      expect(result.optimizationHints).toContain('created_at index');
    });

    test('should validate SQL against RAG-provided constraints', async () => {
      // Store business rules in RAG
      await ragEngine.storeDocument({
        id: 'business-rules',
        content: `
          Business Rule: Only show data for current fiscal year.
          Business Rule: Salary information requires approval level 3+.
          Business Rule: PII data must be masked for external reports.
        `,
        metadata: { type: 'business_rules' }
      });

      const sensitiveQuery = {
        text: 'Generate report with all employee salaries for external audit',
        user: global.testUtils.createMockUser({ approvalLevel: 2 })
      };

      const result = await laloPipeline.processQuery(sensitiveQuery);

      expect(result.businessRulesViolated).toBe(true);
      expect(result.requiredApprovalLevel).toBe(3);
      expect(result.dataMaskingRequired).toBe(true);
    });
  });

  describe('MCP Coordination Across Components', () => {
    test('should coordinate distributed query processing', async () => {
      const distributedQuery = {
        text: 'Comprehensive analysis of user behavior patterns across all systems',
        requiresDistributedProcessing: true
      };

      // Register multiple processing nodes
      const nodes = [
        { id: 'node-analytics', capabilities: ['analytics', 'ml'] },
        { id: 'node-database', capabilities: ['sql', 'data_access'] },
        { id: 'node-documents', capabilities: ['rag', 'search'] }
      ];

      for (const node of nodes) {
        await mcpCoordinator.registerNode(node);
      }

      const result = await laloPipeline.processDistributedQuery(distributedQuery);

      expect(result.coordination.nodesUsed).toHaveLength(3);
      expect(result.coordination.taskDistribution).toBeDefined();
      expect(result.results.analytics).toBeDefined();
      expect(result.results.database).toBeDefined();
      expect(result.results.documents).toBeDefined();
    });

    test('should handle node failures and failover', async () => {
      const criticalQuery = {
        text: 'Emergency: Show system health status',
        priority: 'critical',
        requiresFailover: true
      };

      // Simulate node failure
      await mcpCoordinator.simulateNodeFailure('primary-node');

      const result = await laloPipeline.processQuery(criticalQuery);

      expect(result.coordination.failoverOccurred).toBe(true);
      expect(result.coordination.backupNodeUsed).toBeDefined();
      expect(result.status).toBe('completed'); // Should still complete
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle component failures gracefully', async () => {
      const query = {
        text: 'Show user statistics',
        user: global.testUtils.createMockUser()
      };

      // Simulate RAG engine failure
      jest.spyOn(ragEngine, 'retrieve').mockRejectedValue(new Error('RAG service unavailable'));

      const result = await laloPipeline.processQuery(query);

      expect(result.status).toBe('partial_success');
      expect(result.errors.rag).toBeDefined();
      expect(result.fallbackUsed).toBe(true);
      expect(result.nl2sql.query).toBeDefined(); // Should still generate SQL
    });

    test('should implement circuit breaker pattern', async () => {
      const queries = Array(10).fill(null).map((_, i) => ({
        text: `Test query ${i}`,
        user: global.testUtils.createMockUser()
      }));

      // Simulate persistent failures
      jest.spyOn(nl2sqlEngine, 'generateSQL').mockRejectedValue(new Error('Service down'));

      const results = await Promise.all(
        queries.map(query => laloPipeline.processQuery(query))
      );

      // Circuit breaker should open after threshold
      const circuitBreakerStatus = laloPipeline.getCircuitBreakerStatus('nl2sql');
      expect(circuitBreakerStatus.state).toBe('open');
      expect(circuitBreakerStatus.failureCount).toBeGreaterThan(5);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle concurrent requests efficiently', async () => {
      const concurrentQueries = Array(20).fill(null).map((_, i) => ({
        text: `Concurrent query ${i}`,
        user: global.testUtils.createMockUser()
      }));

      const startTime = performance.now();

      const results = await Promise.all(
        concurrentQueries.map(query => laloPipeline.processQuery(query))
      );

      const executionTime = performance.now() - startTime;

      expect(results).toHaveLength(20);
      expect(results.every(r => r.status === 'completed')).toBe(true);
      expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should implement caching across components', async () => {
      const repeatedQuery = {
        text: 'Show department statistics',
        user: global.testUtils.createMockUser()
      };

      // First execution
      const result1 = await laloPipeline.processQuery(repeatedQuery);

      // Second execution (should use cache)
      const result2 = await laloPipeline.processQuery(repeatedQuery);

      expect(result1.metadata.cacheHit).toBe(false);
      expect(result2.metadata.cacheHit).toBe(true);
      expect(result2.metadata.executionTime).toBeLessThan(result1.metadata.executionTime);
    });
  });

  describe('Audit and Compliance', () => {
    test('should maintain comprehensive audit trail', async () => {
      const auditedQuery = {
        text: 'Access sensitive financial data',
        user: global.testUtils.createMockUser({
          role: 'financial_analyst',
          clearanceLevel: 'high'
        })
      };

      const result = await laloPipeline.processQuery(auditedQuery);

      const auditTrail = await governance.getAuditTrail(auditedQuery.user.id);
      const latestEntry = auditTrail[auditTrail.length - 1];

      expect(latestEntry.action).toBe('query_execution');
      expect(latestEntry.resource).toBe('financial_data');
      expect(latestEntry.components).toEqual(['governance', 'langGraph', 'mcp', 'rag', 'nl2sql']);
      expect(latestEntry.result).toBe('success');
      expect(latestEntry.dataAccessed).toBeDefined();
    });

    test('should implement data lineage tracking', async () => {
      const query = {
        text: 'Generate user engagement report',
        user: global.testUtils.createMockUser(),
        trackLineage: true
      };

      const result = await laloPipeline.processQuery(query);

      expect(result.dataLineage).toBeDefined();
      expect(result.dataLineage.sources).toContainEqual(
        expect.objectContaining({
          type: 'database',
          tables: expect.arrayContaining(['users'])
        })
      );
      expect(result.dataLineage.transformations).toBeDefined();
      expect(result.dataLineage.accessPattern).toBeDefined();
    });
  });

  describe('Hive Mind Collective Intelligence', () => {
    test('should coordinate learning across all components', async () => {
      const learningQuery = {
        text: 'What are the most effective marketing strategies?',
        user: global.testUtils.createMockUser(),
        enableLearning: true
      };

      const result = await laloPipeline.processQuery(learningQuery);

      // Each component should contribute to collective learning
      expect(result.learning.governance.patterns).toBeDefined();
      expect(result.learning.rag.relevancePatterns).toBeDefined();
      expect(result.learning.nl2sql.queryPatterns).toBeDefined();
      expect(result.learning.langGraph.workflowOptimizations).toBeDefined();

      // Shared learning should be updated
      const sharedLearning = await laloPipeline.getSharedLearning();
      expect(sharedLearning.patterns).toContainEqual(
        expect.objectContaining({
          type: 'marketing_analysis',
          effectiveness: expect.any(Number)
        })
      );
    });

    test('should adapt based on collective feedback', async () => {
      const feedbackData = {
        query: 'Show top performers',
        userSatisfaction: 0.9,
        corrections: {
          rag: { betterDocuments: ['performance-guide-v2'] },
          nl2sql: { improvedQuery: 'SELECT * FROM users ORDER BY performance_score DESC LIMIT 10' }
        }
      };

      await laloPipeline.incorporateCollectiveFeedback(feedbackData);

      // Process similar query to verify adaptation
      const adaptedQuery = {
        text: 'Display best performing employees',
        user: global.testUtils.createMockUser()
      };

      const result = await laloPipeline.processQuery(adaptedQuery);

      expect(result.adaptations.rag.documentPreferences).toContain('performance-guide-v2');
      expect(result.adaptations.nl2sql.queryImproved).toBe(true);
    });

    test('should maintain collective memory across sessions', async () => {
      const sessionData = {
        sessionId: 'session-123',
        userQueries: [
          'Show sales data',
          'Analyze user behavior',
          'Generate performance report'
        ],
        insights: {
          preferredQueryTypes: ['analytics', 'reporting'],
          commonPatterns: ['time_series_analysis']
        }
      };

      await laloPipeline.storeSessionLearning(sessionData);

      // Start new session
      const newSessionQuery = {
        text: 'Create analytics dashboard',
        user: global.testUtils.createMockUser(),
        sessionId: 'session-456'
      };

      const result = await laloPipeline.processQuery(newSessionQuery);

      // Should leverage previous session insights
      expect(result.collectiveMemory.applied).toBe(true);
      expect(result.collectiveMemory.insights).toContain('time_series_analysis');
    });
  });
});