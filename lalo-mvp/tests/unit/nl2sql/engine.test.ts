/**
 * NL2SQL Engine Unit Tests
 * Tests for natural language to SQL conversion, query generation, and validation
 */

import { NL2SQLEngine, SchemaAnalyzer, QueryGenerator, QueryValidator } from '../../../src/nl2sql';

describe('NL2SQL Engine', () => {
  let nl2sqlEngine: NL2SQLEngine;
  let mockSchema: any;
  let schemaAnalyzer: SchemaAnalyzer;
  let queryGenerator: QueryGenerator;
  let queryValidator: QueryValidator;

  beforeEach(() => {
    mockSchema = {
      tables: {
        users: {
          columns: {
            id: { type: 'INTEGER', primaryKey: true },
            name: { type: 'VARCHAR(255)', nullable: false },
            email: { type: 'VARCHAR(255)', unique: true },
            created_at: { type: 'TIMESTAMP', defaultValue: 'CURRENT_TIMESTAMP' },
            department_id: { type: 'INTEGER', foreignKey: 'departments.id' }
          },
          indexes: ['email', 'department_id']
        },
        departments: {
          columns: {
            id: { type: 'INTEGER', primaryKey: true },
            name: { type: 'VARCHAR(100)', nullable: false },
            budget: { type: 'DECIMAL(10,2)' }
          }
        },
        sales: {
          columns: {
            id: { type: 'INTEGER', primaryKey: true },
            user_id: { type: 'INTEGER', foreignKey: 'users.id' },
            amount: { type: 'DECIMAL(10,2)', nullable: false },
            sale_date: { type: 'DATE', nullable: false }
          }
        }
      },
      relationships: [
        { from: 'users.department_id', to: 'departments.id', type: 'many-to-one' },
        { from: 'sales.user_id', to: 'users.id', type: 'many-to-one' }
      ]
    };

    schemaAnalyzer = new SchemaAnalyzer(mockSchema);
    queryGenerator = new QueryGenerator({
      dialect: 'postgresql',
      maxComplexity: 5,
      optimizations: true
    });
    queryValidator = new QueryValidator({
      allowedOperations: ['SELECT', 'INSERT', 'UPDATE'],
      maxJoins: 3,
      securityChecks: true
    });

    nl2sqlEngine = new NL2SQLEngine({
      schema: mockSchema,
      analyzer: schemaAnalyzer,
      generator: queryGenerator,
      validator: queryValidator
    });
  });

  describe('Natural Language Processing', () => {
    test('should parse simple queries correctly', async () => {
      const naturalQuery = 'Show me all users';

      const parseResult = await nl2sqlEngine.parseQuery(naturalQuery);

      expect(parseResult.intent).toBe('SELECT');
      expect(parseResult.entities).toContainEqual({
        type: 'table',
        value: 'users',
        confidence: expect.any(Number)
      });
      expect(parseResult.operation).toBe('list_all');
    });

    test('should handle complex queries with joins', async () => {
      const naturalQuery = 'Get all users with their department names and total sales';

      const parseResult = await nl2sqlEngine.parseQuery(naturalQuery);

      expect(parseResult.entities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'table', value: 'users' }),
          expect.objectContaining({ type: 'table', value: 'departments' }),
          expect.objectContaining({ type: 'table', value: 'sales' })
        ])
      );
      expect(parseResult.aggregations).toContain('SUM');
      expect(parseResult.joins).toHaveLength(2);
    });

    test('should identify filter conditions', async () => {
      const naturalQuery = 'Show users created after January 1st, 2023 with salary greater than 50000';

      const parseResult = await nl2sqlEngine.parseQuery(naturalQuery);

      expect(parseResult.filters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            column: 'created_at',
            operator: '>',
            value: expect.any(Date)
          }),
          expect.objectContaining({
            column: 'salary',
            operator: '>',
            value: 50000
          })
        ])
      );
    });

    test('should handle aggregation queries', async () => {
      const naturalQuery = 'What is the average salary by department?';

      const parseResult = await nl2sqlEngine.parseQuery(naturalQuery);

      expect(parseResult.aggregations).toContain('AVG');
      expect(parseResult.groupBy).toContain('department');
      expect(parseResult.intent).toBe('AGGREGATE');
    });

    test('should detect temporal expressions', async () => {
      const naturalQuery = 'Show sales for last month';

      const parseResult = await nl2sqlEngine.parseQuery(naturalQuery);

      expect(parseResult.temporal).toEqual(
        expect.objectContaining({
          type: 'relative',
          period: 'month',
          offset: -1
        })
      );
    });
  });

  describe('SQL Generation', () => {
    test('should generate basic SELECT queries', async () => {
      const naturalQuery = 'Show all users';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql.trim()).toBe('SELECT * FROM users;');
    });

    test('should generate queries with WHERE clauses', async () => {
      const naturalQuery = 'Show users from engineering department';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('WHERE');
      expect(sql).toContain('departments.name = \'engineering\'');
      expect(sql).toContain('JOIN departments');
    });

    test('should generate aggregation queries', async () => {
      const naturalQuery = 'Count users by department';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('COUNT(*)');
      expect(sql).toContain('GROUP BY');
      expect(sql).toContain('departments.name');
    });

    test('should handle date range queries', async () => {
      const naturalQuery = 'Show sales between January 1 and March 31, 2023';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('WHERE');
      expect(sql).toContain('sale_date BETWEEN');
      expect(sql).toContain('2023-01-01');
      expect(sql).toContain('2023-03-31');
    });

    test('should generate JOIN queries correctly', async () => {
      const naturalQuery = 'Show user names with their department names';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('JOIN departments');
      expect(sql).toContain('ON users.department_id = departments.id');
      expect(sql).toContain('users.name');
      expect(sql).toContain('departments.name');
    });

    test('should handle ORDER BY clauses', async () => {
      const naturalQuery = 'Show users ordered by creation date descending';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('created_at DESC');
    });

    test('should apply LIMIT when requested', async () => {
      const naturalQuery = 'Show top 10 users by sales amount';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('LIMIT 10');
      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('amount DESC');
    });
  });

  describe('Query Validation', () => {
    test('should validate generated SQL syntax', async () => {
      const sql = 'SELECT users.name, departments.name FROM users JOIN departments ON users.department_id = departments.id;';

      const validation = await queryValidator.validate(sql);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should detect SQL injection attempts', async () => {
      const maliciousQuery = 'Show users where name = \'admin\'; DROP TABLE users; --\'';

      const validation = await queryValidator.validate(maliciousQuery);

      expect(validation.isValid).toBe(false);
      expect(validation.securityIssues).toContainEqual(
        expect.objectContaining({
          type: 'injection_attempt',
          severity: 'high'
        })
      );
    });

    test('should enforce complexity limits', async () => {
      const complexQuery = `
        SELECT u1.name FROM users u1
        JOIN departments d1 ON u1.department_id = d1.id
        JOIN sales s1 ON u1.id = s1.user_id
        JOIN users u2 ON u2.department_id = d1.id
        JOIN sales s2 ON u2.id = s2.user_id
        WHERE u1.id != u2.id;
      `;

      const validation = await queryValidator.validate(complexQuery);

      if (validation.complexity > queryValidator.maxComplexity) {
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toContainEqual(
          expect.objectContaining({
            type: 'complexity_exceeded'
          })
        );
      }
    });

    test('should validate column existence', async () => {
      const invalidQuery = 'SELECT nonexistent_column FROM users;';

      const validation = await queryValidator.validate(invalidQuery, mockSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContainEqual(
        expect.objectContaining({
          type: 'unknown_column',
          column: 'nonexistent_column'
        })
      );
    });

    test('should validate table references', async () => {
      const invalidQuery = 'SELECT * FROM nonexistent_table;';

      const validation = await queryValidator.validate(invalidQuery, mockSchema);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContainEqual(
        expect.objectContaining({
          type: 'unknown_table',
          table: 'nonexistent_table'
        })
      );
    });
  });

  describe('Schema Analysis', () => {
    test('should analyze table relationships', () => {
      const relationships = schemaAnalyzer.getTableRelationships('users');

      expect(relationships).toContainEqual({
        table: 'departments',
        type: 'many-to-one',
        via: 'department_id'
      });
      expect(relationships).toContainEqual({
        table: 'sales',
        type: 'one-to-many',
        via: 'user_id'
      });
    });

    test('should suggest relevant columns for queries', () => {
      const query = 'user information';

      const suggestions = schemaAnalyzer.suggestColumns(query);

      expect(suggestions).toContainEqual(
        expect.objectContaining({
          table: 'users',
          column: 'name',
          relevance: expect.any(Number)
        })
      );
    });

    test('should identify primary and foreign keys', () => {
      const keyInfo = schemaAnalyzer.getKeyInformation('users');

      expect(keyInfo.primaryKey).toBe('id');
      expect(keyInfo.foreignKeys).toContainEqual({
        column: 'department_id',
        references: 'departments.id'
      });
    });

    test('should analyze column data types', () => {
      const columnInfo = schemaAnalyzer.getColumnInfo('users', 'email');

      expect(columnInfo.type).toBe('VARCHAR(255)');
      expect(columnInfo.unique).toBe(true);
      expect(columnInfo.nullable).toBe(true); // Default when not specified
    });
  });

  describe('Query Optimization', () => {
    test('should optimize JOIN order', async () => {
      const naturalQuery = 'Show users with departments and their total sales';

      const optimizedSQL = await nl2sqlEngine.generateOptimizedSQL(naturalQuery);

      // Should prefer smaller tables first in JOINs
      expect(optimizedSQL).toMatch(/users.*departments.*sales|departments.*users.*sales/);
    });

    test('should suggest indexes for performance', async () => {
      const naturalQuery = 'Show users created after 2023-01-01';

      const result = await nl2sqlEngine.generateSQLWithSuggestions(naturalQuery);

      expect(result.suggestions).toContainEqual(
        expect.objectContaining({
          type: 'index',
          table: 'users',
          column: 'created_at'
        })
      );
    });

    test('should apply query rewriting for performance', async () => {
      const inefficientQuery = 'Show users where department name is "engineering"';

      const optimized = await nl2sqlEngine.optimizeQuery(inefficientQuery);

      // Should prefer EXISTS over IN for subqueries when appropriate
      expect(optimized.sql).toBeDefined();
      expect(optimized.improvementEstimate).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle ambiguous queries gracefully', async () => {
      const ambiguousQuery = 'Show me data';

      const result = await nl2sqlEngine.generateSQL(ambiguousQuery);

      expect(result).toContain('-- Ambiguous query');
      // Should provide clarification suggestions
    });

    test('should handle unsupported operations', async () => {
      const unsupportedQuery = 'Delete all users';

      await expect(nl2sqlEngine.generateSQL(unsupportedQuery))
        .rejects.toThrow('DELETE operations not supported');
    });

    test('should provide helpful error messages', async () => {
      const invalidQuery = 'Show users from unknown_table';

      try {
        await nl2sqlEngine.generateSQL(invalidQuery);
      } catch (error: any) {
        expect(error.message).toContain('Table "unknown_table" not found');
        expect(error.suggestions).toContainEqual(
          expect.objectContaining({
            table: 'users',
            similarity: expect.any(Number)
          })
        );
      }
    });
  });

  describe('Multi-dialect Support', () => {
    test('should generate PostgreSQL-specific syntax', async () => {
      nl2sqlEngine.setDialect('postgresql');
      const naturalQuery = 'Show users created in the last 30 days';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('INTERVAL \'30 days\'');
      expect(sql).toContain('NOW()');
    });

    test('should generate MySQL-specific syntax', async () => {
      nl2sqlEngine.setDialect('mysql');
      const naturalQuery = 'Show users created in the last 30 days';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('DATE_SUB(NOW(), INTERVAL 30 DAY)');
    });

    test('should handle dialect-specific functions', async () => {
      nl2sqlEngine.setDialect('sqlite');
      const naturalQuery = 'Show current date';

      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('datetime(\'now\')');
    });
  });

  describe('Confidence Scoring', () => {
    test('should provide confidence scores for generated queries', async () => {
      const naturalQuery = 'Show all users with their departments';

      const result = await nl2sqlEngine.generateSQLWithConfidence(naturalQuery);

      expect(result.confidence).toBeGreaterThan(0.8); // High confidence for clear query
      expect(result.sql).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    test('should indicate low confidence for ambiguous queries', async () => {
      const ambiguousQuery = 'Show data from last time';

      const result = await nl2sqlEngine.generateSQLWithConfidence(ambiguousQuery);

      expect(result.confidence).toBeLessThan(0.6); // Low confidence
      expect(result.clarificationNeeded).toBe(true);
    });
  });

  describe('Learning and Adaptation', () => {
    test('should learn from user feedback', async () => {
      const naturalQuery = 'Show active users';
      const generatedSQL = 'SELECT * FROM users WHERE status = \'active\';';
      const correctedSQL = 'SELECT * FROM users WHERE active = true;';

      await nl2sqlEngine.provideFeedback({
        naturalQuery,
        generatedSQL,
        correctedSQL,
        rating: 3, // Partially correct
        corrections: [{
          field: 'status',
          correctedField: 'active',
          correctedType: 'boolean'
        }]
      });

      // Should improve future generations
      const improvedSQL = await nl2sqlEngine.generateSQL(naturalQuery);
      expect(improvedSQL).toContain('active = true');
    });

    test('should maintain query history for learning', () => {
      const history = nl2sqlEngine.getQueryHistory();

      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            naturalQuery: expect.any(String),
            generatedSQL: expect.any(String),
            timestamp: expect.any(Date),
            success: expect.any(Boolean)
          })
        ])
      );
    });
  });

  describe('Hive Mind Integration', () => {
    test('should share successful query patterns with hive', async () => {
      const naturalQuery = 'Show top performing users this quarter';
      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      const shareSpy = jest.spyOn(nl2sqlEngine, 'sharePattern');

      await nl2sqlEngine.recordSuccessfulQuery(naturalQuery, sql, {
        executionTime: 250,
        resultCount: 15,
        userSatisfaction: 0.9
      });

      expect(shareSpy).toHaveBeenCalledWith({
        pattern: expect.objectContaining({
          type: 'ranking_query',
          temporal: 'quarter',
          aggregation: 'performance'
        }),
        effectiveness: 0.9
      });
    });

    test('should learn from collective query intelligence', async () => {
      const hivePatterns = [
        {
          naturalPhrase: 'top performers',
          sqlPattern: 'ORDER BY performance_metric DESC LIMIT N',
          confidence: 0.95
        },
        {
          naturalPhrase: 'this quarter',
          sqlPattern: 'WHERE date >= date_trunc(\'quarter\', current_date)',
          confidence: 0.92
        }
      ];

      await nl2sqlEngine.incorporateHivePatterns(hivePatterns);

      const naturalQuery = 'Show top performers this quarter';
      const sql = await nl2sqlEngine.generateSQL(naturalQuery);

      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('DESC LIMIT');
      expect(sql).toContain('date_trunc');
    });

    test('should coordinate schema knowledge across nodes', async () => {
      const sharedSchemaInsights = {
        commonJoins: [
          { tables: ['users', 'departments'], frequency: 0.8 },
          { tables: ['users', 'sales'], frequency: 0.6 }
        ],
        performantPatterns: [
          { pattern: 'user_department_sales', avgExecutionTime: 45 }
        ]
      };

      await nl2sqlEngine.syncSchemaInsights(sharedSchemaInsights);

      const insights = nl2sqlEngine.getSchemaInsights();
      expect(insights.commonJoins).toContainEqual(
        expect.objectContaining({
          tables: ['users', 'departments'],
          frequency: 0.8
        })
      );
    });
  });
});