import { OpenAI } from 'openai';
import {
  SQLQuery,
  TableSchema,
  ColumnInfo,
  Relationship,
  NL2SQLConfig,
  NL2SQLError,
  Document,
  RAGQuery
} from '../types/index.js';
import { getConfig } from '../config/index.js';
import { LanguageProcessor, ProcessingResult } from './language-processor.js';
import { SQLGenerator, GeneratedSQL, SQLGenerationOptions } from './sql-generator.js';
import { RAGSystem } from '../rag/index.js';
import { GovernanceSystem } from '../governance/index.js';

export interface SQLValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface QueryApprovalResult {
  approved: boolean;
  reason?: string;
  suggestedAlternatives?: string[];
  securityLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface EnhancedNL2SQLConfig extends NL2SQLConfig {
  enableRAG?: boolean;
  enableGovernance?: boolean;
  ragTopK?: number;
  governanceMode?: 'strict' | 'advisory' | 'disabled';
  sqlGeneration?: SQLGenerationOptions;
}

export class NL2SQLEngine {
  private config: EnhancedNL2SQLConfig;
  private openai: OpenAI;
  private schemas = new Map<string, TableSchema>();
  private queryHistory: SQLQuery[] = [];
  private languageProcessor: LanguageProcessor;
  private sqlGenerator: SQLGenerator;
  private ragSystem?: RAGSystem;
  private governanceSystem?: GovernanceSystem;
  private approvedPatterns = new Map<string, string>();
  private securityPolicies = new Set<string>();

  constructor(
    config?: Partial<EnhancedNL2SQLConfig>,
    ragSystem?: RAGSystem,
    governanceSystem?: GovernanceSystem
  ) {
    this.config = {
      ...getConfig().nl2sql,
      enableRAG: true,
      enableGovernance: true,
      ragTopK: 5,
      governanceMode: 'advisory',
      sqlGeneration: {
        optimizeJoins: true,
        useAliases: true,
        formatOutput: true,
        preventCartesian: true,
        maxJoins: 5
      },
      ...config
    };

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.languageProcessor = new LanguageProcessor();
    this.sqlGenerator = new SQLGenerator(this.config.sqlGeneration);
    this.ragSystem = ragSystem;
    this.governanceSystem = governanceSystem;

    this.initializeApprovedPatterns();
    this.initializeSecurityPolicies();
  }

  /**
   * Convert natural language to SQL with enhanced processing
   */
  async convertToSQL(
    naturalLanguage: string,
    context?: Record<string, any>,
    validate = true
  ): Promise<{
    sql: string;
    confidence: number;
    explanation: string;
    tables: string[];
    metadata: Record<string, any>;
    validation?: SQLValidationResult;
    processing?: ProcessingResult;
    generation?: GeneratedSQL;
    ragContext?: Document[];
    governanceApproval?: QueryApprovalResult;
  }> {
    try {
      // Step 1: Enhance context with RAG if enabled
      const enhancedContext = await this.enhanceContextWithRAG(naturalLanguage, context);

      // Step 2: Process natural language with advanced NLP
      const processingResult = await this.languageProcessor.processLanguage(
        naturalLanguage,
        this.schemas
      );

      // Step 3: Generate SQL using enhanced generator
      const generationResult = await this.sqlGenerator.generateSQL(
        processingResult.intent,
        processingResult.context,
        processingResult.entities,
        naturalLanguage
      );

      // Step 4: Check governance approval if enabled
      const governanceApproval = await this.checkGovernanceApproval(
        generationResult.query,
        processingResult,
        enhancedContext.ragContext
      );

      // Step 5: Enhanced validation
      let validation: SQLValidationResult | undefined;
      if (validate && this.config.enableValidation) {
        validation = await this.validateSQLEnhanced(
          generationResult.query,
          processingResult.context.tables,
          generationResult.security
        );
      }

      // Store enhanced query in history
      const sqlQuery: SQLQuery = {
        id: this.generateQueryId(),
        naturalLanguage,
        sql: generationResult.query,
        confidence: Math.min(processingResult.confidence, generationResult.confidence),
        tables: processingResult.context.tables,
        metadata: {
          context: enhancedContext.originalContext,
          ragContext: enhancedContext.ragContext,
          processing: processingResult,
          generation: generationResult,
          governanceApproval,
          validation,
          enhancedFeatures: {
            ragEnabled: this.config.enableRAG,
            governanceEnabled: this.config.enableGovernance,
            advancedNLP: true
          }
        },
        createdAt: new Date(),
      };

      this.queryHistory.push(sqlQuery);

      // Store successful patterns for learning
      if (generationResult.confidence > 0.8) {
        await this.storeSuccessfulPattern(naturalLanguage, generationResult.query, processingResult);
      }

      return {
        sql: generationResult.query,
        confidence: Math.min(processingResult.confidence, generationResult.confidence),
        explanation: generationResult.explanation,
        tables: processingResult.context.tables,
        metadata: {
          optimization: generationResult.optimization,
          security: generationResult.security,
          ...sqlQuery.metadata
        },
        validation,
        processing: processingResult,
        generation: generationResult,
        ragContext: enhancedContext.ragContext,
        governanceApproval
      };
    } catch (error) {
      throw new NL2SQLError(`Failed to convert to SQL: ${error.message}`, {
        naturalLanguage,
        context,
        error: error.message,
      });
    }
  }

  /**
   * Initialize approved query patterns
   */
  private initializeApprovedPatterns(): void {
    // Common safe patterns
    this.approvedPatterns.set('select_all_users', 'SELECT * FROM users');
    this.approvedPatterns.set('select_user_by_id', 'SELECT * FROM users WHERE id = ?');
    this.approvedPatterns.set('count_users', 'SELECT COUNT(*) FROM users');
    this.approvedPatterns.set('select_workflows', 'SELECT * FROM workflows');
    this.approvedPatterns.set('select_active_proposals', 'SELECT * FROM proposals WHERE status = \'active\'');
  }

  /**
   * Initialize security policies
   */
  private initializeSecurityPolicies(): void {
    this.securityPolicies.add('no_delete_without_where');
    this.securityPolicies.add('no_update_without_where');
    this.securityPolicies.add('limit_result_sets');
    this.securityPolicies.add('sanitize_inputs');
    this.securityPolicies.add('validate_table_access');
  }

  /**
   * Enhance context with RAG system
   */
  private async enhanceContextWithRAG(
    naturalLanguage: string,
    context?: Record<string, any>
  ): Promise<{ originalContext: Record<string, any>; ragContext: Document[] }> {
    if (!this.config.enableRAG || !this.ragSystem) {
      return { originalContext: context || {}, ragContext: [] };
    }

    try {
      const ragQuery: RAGQuery = {
        query: naturalLanguage,
        topK: this.config.ragTopK || 5,
        threshold: 0.3
      };

      const results = await this.ragSystem.search(ragQuery);
      const ragContext = results.map(result => result.document);

      return {
        originalContext: context || {},
        ragContext
      };
    } catch (error) {
      console.warn('RAG enhancement failed:', error.message);
      return { originalContext: context || {}, ragContext: [] };
    }
  }

  /**
   * Check governance approval for query
   */
  private async checkGovernanceApproval(
    sql: string,
    processingResult: ProcessingResult,
    ragContext: Document[]
  ): Promise<QueryApprovalResult> {
    if (!this.config.enableGovernance || this.config.governanceMode === 'disabled') {
      return { approved: true, securityLevel: 'LOW' };
    }

    try {
      // Check if query matches approved patterns
      const normalizedSql = sql.toLowerCase().trim();
      for (const [pattern, approvedSql] of this.approvedPatterns) {
        if (normalizedSql.includes(approvedSql.toLowerCase())) {
          return {
            approved: true,
            reason: `Matches approved pattern: ${pattern}`,
            securityLevel: 'LOW'
          };
        }
      }

      // Analyze security level
      const securityLevel = this.analyzeSecurityLevel(sql, processingResult);

      // In strict mode, require governance approval for high-risk queries
      if (this.config.governanceMode === 'strict' && securityLevel === 'HIGH') {
        return {
          approved: false,
          reason: 'High-risk query requires governance approval',
          securityLevel,
          suggestedAlternatives: this.suggestSaferAlternatives(sql, processingResult)
        };
      }

      // Advisory mode: warn but allow
      return {
        approved: true,
        reason: securityLevel === 'HIGH' ? 'Advisory: High-risk query detected' : 'Query approved',
        securityLevel
      };
    } catch (error) {
      console.warn('Governance check failed:', error.message);
      return {
        approved: true,
        reason: 'Governance check failed, defaulting to approval',
        securityLevel: 'MEDIUM'
      };
    }
  }

  /**
   * Enhanced SQL validation with security analysis
   */
  private async validateSQLEnhanced(
    sql: string,
    tables: string[],
    securityInfo: any
  ): Promise<SQLValidationResult> {
    const basicValidation = await this.validateSQL(sql, tables);

    // Add enhanced security checks
    const securityErrors: string[] = [];
    const securityWarnings: string[] = [];

    // Check against security policies
    if (this.securityPolicies.has('no_delete_without_where') &&
        sql.toLowerCase().includes('delete') &&
        !sql.toLowerCase().includes('where')) {
      securityErrors.push('DELETE without WHERE clause is prohibited');
    }

    if (this.securityPolicies.has('no_update_without_where') &&
        sql.toLowerCase().includes('update') &&
        !sql.toLowerCase().includes('where')) {
      securityErrors.push('UPDATE without WHERE clause is prohibited');
    }

    if (this.securityPolicies.has('limit_result_sets') &&
        !sql.toLowerCase().includes('limit') &&
        sql.toLowerCase().includes('select')) {
      securityWarnings.push('Consider adding LIMIT clause to prevent large result sets');
    }

    return {
      ...basicValidation,
      errors: [...basicValidation.errors, ...securityErrors],
      warnings: [...basicValidation.warnings, ...securityWarnings],
      suggestions: [
        ...basicValidation.suggestions,
        ...(securityInfo.riskLevel === 'HIGH' ? ['Consider reviewing query for security implications'] : [])
      ]
    };
  }

  /**
   * Store successful pattern for learning
   */
  private async storeSuccessfulPattern(
    naturalLanguage: string,
    sql: string,
    processingResult: ProcessingResult
  ): Promise<void> {
    if (!this.ragSystem) return;

    try {
      const pattern = {
        naturalLanguage,
        sql,
        intent: processingResult.intent,
        entities: processingResult.entities,
        confidence: processingResult.confidence,
        timestamp: new Date().toISOString()
      };

      await this.ragSystem.addDocument(
        `Query: ${naturalLanguage}\nSQL: ${sql}\nIntent: ${processingResult.intent.type}`,
        {
          type: 'successful_pattern',
          ...pattern
        },
        `pattern:${Date.now()}`
      );
    } catch (error) {
      console.warn('Failed to store successful pattern:', error.message);
    }
  }

  /**
   * Analyze security level of query
   */
  private analyzeSecurityLevel(sql: string, processingResult: ProcessingResult): 'LOW' | 'MEDIUM' | 'HIGH' {
    const lowerSql = sql.toLowerCase();

    // High risk operations
    if (lowerSql.includes('delete') || lowerSql.includes('drop') || lowerSql.includes('truncate')) {
      return 'HIGH';
    }

    if (lowerSql.includes('update') || lowerSql.includes('insert')) {
      return 'HIGH';
    }

    // Medium risk - bulk operations or system queries
    if (lowerSql.includes('select *') && !lowerSql.includes('limit')) {
      return 'MEDIUM';
    }

    if (processingResult.context.tables.length > 3) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Suggest safer alternatives for high-risk queries
   */
  private suggestSaferAlternatives(sql: string, processingResult: ProcessingResult): string[] {
    const suggestions: string[] = [];
    const lowerSql = sql.toLowerCase();

    if (lowerSql.includes('delete') && !lowerSql.includes('where')) {
      suggestions.push('Add WHERE clause to limit affected rows');
      suggestions.push('Consider soft delete with UPDATE status = \'deleted\'');
    }

    if (lowerSql.includes('select *') && !lowerSql.includes('limit')) {
      suggestions.push('Add LIMIT clause to prevent large result sets');
      suggestions.push('Select specific columns instead of *');
    }

    if (lowerSql.includes('update') && !lowerSql.includes('where')) {
      suggestions.push('Add WHERE clause to limit affected rows');
    }

    return suggestions;
  }

  /**
   * Legacy method compatibility - now enhanced
   */
  private async generateSQL(
    naturalLanguage: string,
    context?: Record<string, any>
  ): Promise<{
    sql: string;
    confidence: number;
    explanation: string;
    tables: string[];
    metadata: Record<string, any>;
  }> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(naturalLanguage, context);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseResponse(content);
    } catch (error) {
      throw new NL2SQLError(`OpenAI API error: ${error.message}`, { error });
    }
  }

  /**
   * Build system prompt with schema information
   */
  private buildSystemPrompt(): string {
    const schemaInfo = this.buildSchemaInfo();

    return `You are an expert SQL query generator. Convert natural language questions to SQL queries.

Database Schema:
${schemaInfo}

Instructions:
1. Generate accurate SQL queries based on the natural language input
2. Use proper table and column names from the schema
3. Include appropriate JOINs when multiple tables are involved
4. Use proper SQL syntax and best practices
5. Provide a confidence score (0-1) for your query
6. Explain your reasoning
7. List all tables used in the query

Response Format (JSON):
{
  "sql": "SELECT * FROM table WHERE condition",
  "confidence": 0.95,
  "explanation": "This query retrieves...",
  "tables": ["table1", "table2"],
  "metadata": {
    "joins": 1,
    "filters": 2,
    "aggregations": 0
  }
}

Always respond with valid JSON only.`;
  }

  /**
   * Build user prompt with context
   */
  private buildUserPrompt(naturalLanguage: string, context?: Record<string, any>): string {
    let prompt = `Convert this natural language question to SQL:\n"${naturalLanguage}"`;

    if (context) {
      prompt += `\n\nAdditional Context:\n${JSON.stringify(context, null, 2)}`;
    }

    return prompt;
  }

  /**
   * Build schema information string
   */
  private buildSchemaInfo(): string {
    if (this.schemas.size === 0) {
      return 'No schemas available. Please add table schemas first.';
    }

    return Array.from(this.schemas.values())
      .map(schema => this.formatSchemaInfo(schema))
      .join('\n\n');
  }

  /**
   * Format schema information for a table
   */
  private formatSchemaInfo(schema: TableSchema): string {
    let info = `Table: ${schema.name}`;
    if (schema.description) {
      info += ` - ${schema.description}`;
    }

    info += '\nColumns:\n';
    schema.columns.forEach(column => {
      info += `  - ${column.name} (${column.type})`;
      if (column.primaryKey) info += ' [PK]';
      if (column.foreignKey) info += ` [FK -> ${column.foreignKey}]`;
      if (!column.nullable) info += ' [NOT NULL]';
      if (column.description) info += ` - ${column.description}`;
      info += '\n';
    });

    if (schema.relationships && schema.relationships.length > 0) {
      info += 'Relationships:\n';
      schema.relationships.forEach(rel => {
        info += `  - ${rel.table}.${rel.column} -> ${rel.referencedTable}.${rel.referencedColumn} (${rel.type})\n`;
      });
    }

    return info;
  }

  /**
   * Parse OpenAI response
   */
  private parseResponse(content: string): {
    sql: string;
    confidence: number;
    explanation: string;
    tables: string[];
    metadata: Record<string, any>;
  } {
    try {
      const parsed = JSON.parse(content);

      return {
        sql: parsed.sql || '',
        confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
        explanation: parsed.explanation || '',
        tables: parsed.tables || [],
        metadata: parsed.metadata || {},
      };
    } catch (error) {
      // Fallback parsing if JSON parsing fails
      const sqlMatch = content.match(/SELECT[\s\S]*?;?$/i);
      return {
        sql: sqlMatch ? sqlMatch[0].trim() : '',
        confidence: 0.5,
        explanation: 'Could not parse detailed response',
        tables: [],
        metadata: { parseError: true },
      };
    }
  }

  /**
   * Validate generated SQL
   */
  private async validateSQL(sql: string, tables: string[]): Promise<SQLValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Basic syntax validation
    if (!sql.trim()) {
      errors.push('Empty SQL query');
    }

    if (!sql.toLowerCase().includes('select')) {
      errors.push('SQL query must contain SELECT statement');
    }

    // Table validation
    for (const table of tables) {
      if (!this.schemas.has(table)) {
        errors.push(`Table '${table}' not found in schema`);
      }
    }

    // Column validation (basic)
    const columnMatches = sql.match(/\b(\w+)\.\w+\b/g) || [];
    for (const match of columnMatches) {
      const [table, column] = match.split('.');
      const schema = this.schemas.get(table);
      if (schema && !schema.columns.find(col => col.name === column)) {
        errors.push(`Column '${column}' not found in table '${table}'`);
      }
    }

    // Performance warnings
    if (sql.toLowerCase().includes('select *')) {
      warnings.push('Consider selecting specific columns instead of *');
    }

    if (!sql.toLowerCase().includes('limit') && !sql.toLowerCase().includes('where')) {
      warnings.push('Consider adding LIMIT clause for large tables');
    }

    // Suggestions
    if (tables.length > 1 && !sql.toLowerCase().includes('join')) {
      suggestions.push('Consider using explicit JOINs for better performance');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  /**
   * Add table schema
   */
  async addTableSchema(schema: TableSchema): Promise<void> {
    try {
      // Validate schema
      this.validateSchema(schema);
      this.schemas.set(schema.name, schema);
    } catch (error) {
      throw new NL2SQLError(`Failed to add schema: ${error.message}`, { schema: schema.name });
    }
  }

  /**
   * Validate table schema
   */
  private validateSchema(schema: TableSchema): void {
    if (!schema.name) {
      throw new Error('Schema name is required');
    }

    if (!schema.columns || schema.columns.length === 0) {
      throw new Error('Schema must have at least one column');
    }

    // Check for duplicate column names
    const columnNames = schema.columns.map(col => col.name);
    const duplicates = columnNames.filter((name, index) => columnNames.indexOf(name) !== index);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate column names: ${duplicates.join(', ')}`);
    }

    // Validate columns
    for (const column of schema.columns) {
      if (!column.name || !column.type) {
        throw new Error('Column name and type are required');
      }
    }
  }

  /**
   * Remove table schema
   */
  removeTableSchema(tableName: string): boolean {
    return this.schemas.delete(tableName);
  }

  /**
   * Get table schema
   */
  getTableSchema(tableName: string): TableSchema | undefined {
    return this.schemas.get(tableName);
  }

  /**
   * Get all schemas
   */
  async getSchemas(): Promise<TableSchema[]> {
    return Array.from(this.schemas.values());
  }

  /**
   * Get query history
   */
  getQueryHistory(limit = 50): SQLQuery[] {
    return this.queryHistory
      .slice(-limit)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get query by ID
   */
  getQuery(queryId: string): SQLQuery | undefined {
    return this.queryHistory.find(query => query.id === queryId);
  }

  /**
   * Get system statistics
   */
  async getStats(): Promise<{
    totalSchemas: number;
    totalQueries: number;
    averageConfidence: number;
    successRate: number;
    topTables: Array<{ name: string; usage: number }>;
  }> {
    const totalSchemas = this.schemas.size;
    const totalQueries = this.queryHistory.length;

    // Calculate average confidence
    const averageConfidence = totalQueries > 0
      ? this.queryHistory.reduce((sum, query) => sum + query.confidence, 0) / totalQueries
      : 0;

    // Calculate success rate (queries with confidence > 0.7)
    const successfulQueries = this.queryHistory.filter(query => query.confidence > 0.7).length;
    const successRate = totalQueries > 0 ? successfulQueries / totalQueries : 0;

    // Get top tables by usage
    const tableUsage = new Map<string, number>();
    this.queryHistory.forEach(query => {
      query.tables.forEach(table => {
        tableUsage.set(table, (tableUsage.get(table) || 0) + 1);
      });
    });

    const topTables = Array.from(tableUsage.entries())
      .map(([name, usage]) => ({ name, usage }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 10);

    return {
      totalSchemas,
      totalQueries,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      successRate: Math.round(successRate * 100) / 100,
      topTables,
    };
  }

  /**
   * Clear query history
   */
  clearHistory(): void {
    this.queryHistory = [];
  }

  /**
   * Generate unique query ID
   */
  private generateQueryId(): string {
    return `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default NL2SQLEngine;