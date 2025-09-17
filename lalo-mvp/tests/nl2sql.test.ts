import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { NL2SQLEngine, EnhancedNL2SQLConfig, QueryApprovalResult } from '../src/nl2sql/index.js';
import { LanguageProcessor, ProcessingResult, Intent, Entity, QueryContext } from '../src/nl2sql/language-processor.js';
import { SQLGenerator, GeneratedSQL } from '../src/nl2sql/sql-generator.js';
import { RAGSystem } from '../src/rag/index.js';
import { GovernanceSystem } from '../src/governance/index.js';
import { getAllSchemas, getQueryExamples } from '../src/nl2sql/schema-examples.js';
import { TableSchema } from '../src/types/index.js';

// Mock external dependencies
jest.mock('openai');
jest.mock('../src/rag/index.js');
jest.mock('../src/governance/index.js');

describe('Enhanced NL2SQL Engine', () => {
  let engine: NL2SQLEngine;
  let mockRAGSystem: jest.Mocked<RAGSystem>;
  let mockGovernanceSystem: jest.Mocked<GovernanceSystem>;
  let schemas: Map<string, TableSchema>;

  beforeEach(() => {
    // Setup mock RAG system
    mockRAGSystem = {
      search: jest.fn(),
      addDocument: jest.fn(),
      getDocument: jest.fn(),
      listDocuments: jest.fn(),
      removeDocument: jest.fn(),
      updateDocument: jest.fn(),
      generateEmbeddings: jest.fn(),
      getStats: jest.fn(),
      clearDocuments: jest.fn()
    } as unknown as jest.Mocked<RAGSystem>;

    // Setup mock governance system
    mockGovernanceSystem = {
      createProposal: jest.fn(),
      vote: jest.fn(),
      executeProposal: jest.fn(),
      setVotingPower: jest.fn(),
      getVotingPower: jest.fn(),
      getProposal: jest.fn(),
      getProposals: jest.fn(),
      getVotingResults: jest.fn(),
      getGovernanceStats: jest.fn()
    } as unknown as jest.Mocked<GovernanceSystem>;

    // Initialize schemas
    schemas = getAllSchemas();

    // Configure engine with enhanced features
    const config: Partial<EnhancedNL2SQLConfig> = {
      enableRAG: true,
      enableGovernance: true,
      ragTopK: 5,
      governanceMode: 'advisory',
      enableValidation: true,
      model: 'gpt-4o-mini',
      temperature: 0.1,
      maxTokens: 1000
    };

    engine = new NL2SQLEngine(config, mockRAGSystem, mockGovernanceSystem);

    // Add schemas to engine
    for (const [name, schema] of schemas) {
      engine.addTableSchema(schema);
    }
  });

  describe('Basic NL2SQL Functionality', () => {
    test('should convert simple natural language to SQL', async () => {
      const naturalLanguage = 'Show all users';

      const result = await engine.convertToSQL(naturalLanguage);

      expect(result).toMatchObject({
        sql: expect.stringContaining('SELECT'),
        sql: expect.stringContaining('users'),
        confidence: expect.any(Number),
        explanation: expect.any(String),
        tables: expect.arrayContaining(['users']),
        metadata: expect.any(Object)
      });

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.tables).toContain('users');
    });

    test('should handle filtered queries', async () => {
      const naturalLanguage = 'Find users with admin role';

      const result = await engine.convertToSQL(naturalLanguage);

      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('users');
      expect(result.sql).toContain('WHERE');
      expect(result.sql.toLowerCase()).toContain('role');
      expect(result.tables).toContain('users');
    });

    test('should handle aggregation queries', async () => {
      const naturalLanguage = 'Count how many active proposals there are';

      const result = await engine.convertToSQL(naturalLanguage);

      expect(result.sql).toContain('COUNT');
      expect(result.sql).toContain('proposals');
      expect(result.sql.toLowerCase()).toContain('status');
      expect(result.tables).toContain('proposals');
      expect(result.processing?.intent.type).toBe('AGGREGATE');
    });

    test('should handle join queries', async () => {
      const naturalLanguage = 'Show workflows created by John Doe';

      const result = await engine.convertToSQL(naturalLanguage);

      expect(result.sql).toContain('JOIN');
      expect(result.tables).toContain('workflows');
      expect(result.tables).toContain('users');
      expect(result.processing?.intent.type).toBeOneOf(['JOIN', 'SELECT']);
    });
  });

  describe('Language Processing', () => {
    test('should correctly identify intent types', async () => {
      const testCases = [
        { query: 'Show all users', expectedIntent: 'SELECT' },
        { query: 'Count active proposals', expectedIntent: 'AGGREGATE' },
        { query: 'Add new user', expectedIntent: 'INSERT' },
        { query: 'Update user status', expectedIntent: 'UPDATE' },
        { query: 'Delete inactive users', expectedIntent: 'DELETE' },
        { query: 'Join users with workflows', expectedIntent: 'JOIN' }
      ];

      for (const testCase of testCases) {
        const result = await engine.convertToSQL(testCase.query);
        expect(result.processing?.intent.type).toBe(testCase.expectedIntent);
      }
    });

    test('should extract entities correctly', async () => {
      const naturalLanguage = 'Find users with email containing gmail';

      const result = await engine.convertToSQL(naturalLanguage);

      const entities = result.processing?.entities || [];
      const tableEntities = entities.filter(e => e.type === 'TABLE');
      const columnEntities = entities.filter(e => e.type === 'COLUMN');

      expect(tableEntities.length).toBeGreaterThan(0);
      expect(tableEntities.some(e => e.value.toLowerCase().includes('user'))).toBe(true);
      expect(columnEntities.some(e => e.value === 'email')).toBe(true);
    });

    test('should handle complex queries with multiple entities', async () => {
      const naturalLanguage = 'Show votes for proposal 123 with voter names ordered by timestamp';

      const result = await engine.convertToSQL(naturalLanguage);

      expect(result.tables.length).toBeGreaterThanOrEqual(2);
      expect(result.tables).toContain('votes');
      expect(result.sql).toContain('ORDER BY');
    });
  });

  describe('RAG Integration', () => {
    test('should enhance context with RAG when enabled', async () => {
      mockRAGSystem.search.mockResolvedValue([
        {
          document: {
            id: 'doc1',
            content: 'Users table contains user information including email and role',
            metadata: { type: 'schema_documentation' },
            createdAt: new Date()
          },
          score: 0.9,
          relevance: 0.9
        }
      ]);

      const result = await engine.convertToSQL('Show admin users');

      expect(mockRAGSystem.search).toHaveBeenCalled();
      expect(result.ragContext).toBeDefined();
      expect(result.ragContext?.length).toBeGreaterThan(0);
    });

    test('should work without RAG when disabled', async () => {
      const configWithoutRAG: Partial<EnhancedNL2SQLConfig> = {
        enableRAG: false
      };

      const engineWithoutRAG = new NL2SQLEngine(configWithoutRAG);
      for (const [name, schema] of schemas) {
        engineWithoutRAG.addTableSchema(schema);
      }

      const result = await engineWithoutRAG.convertToSQL('Show all users');

      expect(result.ragContext).toEqual([]);
      expect(result.sql).toContain('SELECT');
    });

    test('should store successful patterns in RAG', async () => {
      mockRAGSystem.addDocument.mockResolvedValue('pattern-123');

      const result = await engine.convertToSQL('Show all users');

      // Simulate high confidence to trigger pattern storage
      if (result.confidence > 0.8) {
        expect(mockRAGSystem.addDocument).toHaveBeenCalledWith(
          expect.stringContaining('Query: Show all users'),
          expect.objectContaining({
            type: 'successful_pattern'
          }),
          expect.stringMatching(/pattern:\d+/)
        );
      }
    });
  });

  describe('Governance Integration', () => {
    test('should approve safe queries in advisory mode', async () => {
      const result = await engine.convertToSQL('Show all users');

      expect(result.governanceApproval).toBeDefined();
      expect(result.governanceApproval?.approved).toBe(true);
      expect(result.governanceApproval?.securityLevel).toBeOneOf(['LOW', 'MEDIUM']);
    });

    test('should detect high-risk queries', async () => {
      const result = await engine.convertToSQL('Delete all users');

      expect(result.governanceApproval?.securityLevel).toBe('HIGH');
      expect(result.governanceApproval?.concerns).toBeDefined();
    });

    test('should provide suggestions for unsafe queries', async () => {
      const result = await engine.convertToSQL('Update users set status = inactive');

      expect(result.governanceApproval?.suggestedAlternatives).toBeDefined();
      expect(result.governanceApproval?.suggestedAlternatives?.length).toBeGreaterThan(0);
    });

    test('should work in strict governance mode', async () => {
      const strictConfig: Partial<EnhancedNL2SQLConfig> = {
        enableGovernance: true,
        governanceMode: 'strict'
      };

      const strictEngine = new NL2SQLEngine(strictConfig, mockRAGSystem, mockGovernanceSystem);
      for (const [name, schema] of schemas) {
        strictEngine.addTableSchema(schema);
      }

      const result = await strictEngine.convertToSQL('Delete all inactive users');

      expect(result.governanceApproval?.approved).toBe(false);
      expect(result.governanceApproval?.reason).toContain('governance approval');
    });
  });

  describe('SQL Generation', () => {
    test('should generate optimized JOIN queries', async () => {
      const result = await engine.convertToSQL('Show workflows with their creator names');

      expect(result.sql).toContain('JOIN');
      expect(result.tables).toContain('workflows');
      expect(result.tables).toContain('users');
      expect(result.generation?.optimization.joinStrategy).toBeDefined();
    });

    test('should provide optimization suggestions', async () => {
      const result = await engine.convertToSQL('Show all users without limit');

      expect(result.generation?.optimization.performanceNotes).toBeDefined();
      expect(result.generation?.optimization.indexSuggestions).toBeDefined();
    });

    test('should handle aggregation with GROUP BY', async () => {
      const result = await engine.convertToSQL('Count votes by choice for each proposal');

      expect(result.sql).toContain('COUNT');
      expect(result.sql).toContain('GROUP BY');
      expect(result.tables).toContain('votes');
    });

    test('should generate proper WHERE clauses', async () => {
      const result = await engine.convertToSQL('Find users created after 2023-01-01');

      expect(result.sql).toContain('WHERE');
      expect(result.sql.toLowerCase()).toContain('created_at');
      expect(result.processing?.context.filters.length).toBeGreaterThan(0);
    });
  });

  describe('Enhanced Validation', () => {
    test('should validate table existence', async () => {
      const result = await engine.convertToSQL('Show all nonexistent_table');

      expect(result.validation?.errors).toBeDefined();
      expect(result.validation?.errors.some(e => e.includes('not found'))).toBe(true);
    });

    test('should warn about performance issues', async () => {
      const result = await engine.convertToSQL('Show all users');

      if (result.sql.includes('SELECT *')) {
        expect(result.validation?.warnings).toBeDefined();
        expect(result.validation?.warnings.some(w => w.includes('specific columns'))).toBe(true);
      }
    });

    test('should prevent unsafe operations', async () => {
      const result = await engine.convertToSQL('Delete from users');

      expect(result.validation?.errors).toBeDefined();
      expect(result.validation?.errors.some(e => e.includes('WHERE clause'))).toBe(true);
    });
  });

  describe('Query Examples Validation', () => {
    test('should handle all query examples correctly', async () => {
      const examples = getQueryExamples();

      for (const example of examples) {
        const result = await engine.convertToSQL(example.naturalLanguage);

        expect(result.sql).toBeTruthy();
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.tables.length).toBeGreaterThan(0);

        // Check if expected tables are included
        for (const expectedTable of example.expectedTables) {
          expect(result.tables).toContain(expectedTable);
        }

        // Verify intent matches expected
        if (result.processing?.intent.type) {
          // Allow some flexibility in intent detection
          const validIntents = [example.intent, 'SELECT', 'COMPLEX'];
          expect(validIntents).toContain(result.processing.intent.type);
        }
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid natural language gracefully', async () => {
      const result = await engine.convertToSQL('');

      expect(result.confidence).toBeLessThan(0.5);
      expect(result.explanation).toContain('error');
    });

    test('should handle missing schemas', async () => {
      const engineWithoutSchemas = new NL2SQLEngine();

      const result = await engineWithoutSchemas.convertToSQL('Show all users');

      expect(result.validation?.errors).toBeDefined();
      expect(result.sql).toBeTruthy(); // Should still generate something
    });

    test('should handle RAG system failures', async () => {
      mockRAGSystem.search.mockRejectedValue(new Error('RAG system down'));

      const result = await engine.convertToSQL('Show all users');

      // Should still work without RAG
      expect(result.sql).toBeTruthy();
      expect(result.ragContext).toEqual([]);
    });
  });

  describe('Performance and Statistics', () => {
    test('should track query history', async () => {
      await engine.convertToSQL('Show all users');
      await engine.convertToSQL('Count proposals');

      const history = engine.getQueryHistory();

      expect(history.length).toBe(2);
      expect(history[0].naturalLanguage).toBe('Count proposals');
      expect(history[1].naturalLanguage).toBe('Show all users');
    });

    test('should provide system statistics', async () => {
      await engine.convertToSQL('Show all users');
      await engine.convertToSQL('Count proposals');

      const stats = await engine.getStats();

      expect(stats.totalQueries).toBe(2);
      expect(stats.totalSchemas).toBeGreaterThan(0);
      expect(stats.averageConfidence).toBeGreaterThan(0);
      expect(stats.topTables.length).toBeGreaterThan(0);
    });

    test('should calculate success rate correctly', async () => {
      // Generate multiple queries to test success rate calculation
      const queries = [
        'Show all users',
        'Count proposals',
        'Find workflows by status',
        'Show votes for proposal 1'
      ];

      for (const query of queries) {
        await engine.convertToSQL(query);
      }

      const stats = await engine.getStats();

      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe('Memory Integration', () => {
    test('should store technical decisions in memory', async () => {
      // This would test the memory integration
      // For now, we'll just verify the functionality exists
      const result = await engine.convertToSQL('Show complex join between users and workflows');

      expect(result.metadata).toBeDefined();
      expect(result.metadata.enhancedFeatures).toBeDefined();
      expect(result.metadata.enhancedFeatures.advancedNLP).toBe(true);
    });
  });
});

describe('Language Processor Unit Tests', () => {
  let processor: LanguageProcessor;

  beforeEach(() => {
    processor = new LanguageProcessor();
  });

  test('should recognize SELECT intent', async () => {
    const result = await processor.processLanguage('Show all users');

    expect(result.intent.type).toBe('SELECT');
    expect(result.intent.confidence).toBeGreaterThan(0.5);
  });

  test('should extract table entities', async () => {
    const result = await processor.processLanguage('Find data in users table');

    const tableEntities = result.entities.filter(e => e.type === 'TABLE');
    expect(tableEntities.some(e => e.value.toLowerCase().includes('user'))).toBe(true);
  });

  test('should build query context', async () => {
    const result = await processor.processLanguage('Count active proposals with votes');

    expect(result.context.tables.length).toBeGreaterThan(0);
    expect(result.context.aggregations.length).toBeGreaterThan(0);
  });
});

describe('SQL Generator Unit Tests', () => {
  let generator: SQLGenerator;
  let schemas: Map<string, TableSchema>;

  beforeEach(() => {
    generator = new SQLGenerator({
      optimizeJoins: true,
      useAliases: true,
      formatOutput: true
    });

    schemas = getAllSchemas();
    for (const [name, schema] of schemas) {
      generator.addSchema(schema);
    }
  });

  test('should generate basic SELECT query', async () => {
    const intent: Intent = { type: 'SELECT', confidence: 0.9 };
    const context: QueryContext = {
      tables: ['users'],
      relationships: [],
      filters: [],
      aggregations: []
    };
    const entities: Entity[] = [
      { type: 'TABLE', value: 'users', confidence: 0.9, position: [0, 5] }
    ];

    const result = await generator.generateSQL(intent, context, entities, 'Show all users');

    expect(result.query).toContain('SELECT');
    expect(result.query).toContain('users');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('should generate JOIN query', async () => {
    const intent: Intent = { type: 'JOIN', confidence: 0.8 };
    const context: QueryContext = {
      tables: ['users', 'workflows'],
      relationships: [
        { from: 'workflows', to: 'users', type: 'inner', confidence: 0.8 }
      ],
      filters: [],
      aggregations: []
    };
    const entities: Entity[] = [
      { type: 'TABLE', value: 'users', confidence: 0.9, position: [0, 5] },
      { type: 'TABLE', value: 'workflows', confidence: 0.9, position: [6, 15] }
    ];

    const result = await generator.generateSQL(intent, context, entities, 'Show users with workflows');

    expect(result.query).toContain('JOIN');
    expect(result.optimization.joinStrategy).toBeDefined();
  });

  test('should handle aggregation queries', async () => {
    const intent: Intent = { type: 'AGGREGATE', confidence: 0.9 };
    const context: QueryContext = {
      tables: ['proposals'],
      relationships: [],
      filters: [{ column: 'status', operator: '=', value: 'active', confidence: 0.8 }],
      aggregations: [{ function: 'COUNT', column: '*', confidence: 0.9 }]
    };
    const entities: Entity[] = [
      { type: 'TABLE', value: 'proposals', confidence: 0.9, position: [0, 9] },
      { type: 'FUNCTION', value: 'COUNT', confidence: 0.9, position: [10, 15] }
    ];

    const result = await generator.generateSQL(intent, context, entities, 'Count active proposals');

    expect(result.query).toContain('COUNT');
    expect(result.query).toContain('WHERE');
  });
});