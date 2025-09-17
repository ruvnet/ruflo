import { TableSchema, ColumnInfo, Relationship } from '../types/index.js';
import { QueryContext, Intent, Entity } from './language-processor.js';

export interface SQLGenerationOptions {
  optimizeJoins?: boolean;
  useAliases?: boolean;
  addComments?: boolean;
  formatOutput?: boolean;
  preventCartesian?: boolean;
  maxJoins?: number;
}

export interface GeneratedSQL {
  query: string;
  explanation: string;
  confidence: number;
  optimization: {
    joinStrategy: string;
    indexSuggestions: string[];
    performanceNotes: string[];
  };
  security: {
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    concerns: string[];
    sanitized: boolean;
  };
}

export interface JoinPath {
  from: string;
  to: string;
  via: string[];
  cost: number;
  type: 'direct' | 'indirect';
}

export class SQLGenerator {
  private schemas = new Map<string, TableSchema>();
  private relationshipGraph = new Map<string, Set<string>>();
  private options: SQLGenerationOptions;

  constructor(options: SQLGenerationOptions = {}) {
    this.options = {
      optimizeJoins: true,
      useAliases: true,
      addComments: false,
      formatOutput: true,
      preventCartesian: true,
      maxJoins: 5,
      ...options
    };
  }

  /**
   * Add table schema for SQL generation
   */
  addSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
    this.updateRelationshipGraph(schema);
  }

  /**
   * Generate SQL from processed language context
   */
  async generateSQL(
    intent: Intent,
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    try {
      switch (intent.type) {
        case 'SELECT':
        case 'AGGREGATE':
          return this.generateSelectQuery(context, entities, naturalLanguage);
        case 'INSERT':
          return this.generateInsertQuery(context, entities, naturalLanguage);
        case 'UPDATE':
          return this.generateUpdateQuery(context, entities, naturalLanguage);
        case 'DELETE':
          return this.generateDeleteQuery(context, entities, naturalLanguage);
        case 'JOIN':
          return this.generateJoinQuery(context, entities, naturalLanguage);
        default:
          return this.generateComplexQuery(context, entities, naturalLanguage);
      }
    } catch (error) {
      throw new Error(`SQL generation failed: ${error.message}`);
    }
  }

  /**
   * Generate SELECT query with optimization
   */
  private async generateSelectQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    const query = this.buildSelectQuery(context, entities);
    const explanation = this.generateSelectExplanation(context, entities, naturalLanguage);
    const optimization = this.analyzeQueryOptimization(query, context);
    const security = this.analyzeQuerySecurity(query, context);

    return {
      query: this.formatQuery(query),
      explanation,
      confidence: this.calculateGenerationConfidence(context, entities),
      optimization,
      security
    };
  }

  private buildSelectQuery(context: QueryContext, entities: Entity[]): string {
    const columns = this.extractSelectColumns(context, entities);
    const fromClause = this.buildFromClause(context);
    const joinClauses = this.buildJoinClauses(context);
    const whereClause = this.buildWhereClause(context);
    const groupByClause = this.buildGroupByClause(context);
    const havingClause = this.buildHavingClause(context);
    const orderByClause = this.buildOrderByClause(context);
    const limitClause = this.buildLimitClause(context);

    let query = `SELECT ${columns}\nFROM ${fromClause}`;

    if (joinClauses) {
      query += `\n${joinClauses}`;
    }

    if (whereClause) {
      query += `\nWHERE ${whereClause}`;
    }

    if (groupByClause) {
      query += `\nGROUP BY ${groupByClause}`;
    }

    if (havingClause) {
      query += `\nHAVING ${havingClause}`;
    }

    if (orderByClause) {
      query += `\nORDER BY ${orderByClause}`;
    }

    if (limitClause) {
      query += `\n${limitClause}`;
    }

    return query;
  }

  private extractSelectColumns(context: QueryContext, entities: Entity[]): string {
    // Extract column entities
    const columnEntities = entities.filter(e => e.type === 'COLUMN');

    // If aggregations are present, build aggregation columns
    if (context.aggregations.length > 0) {
      const aggColumns = context.aggregations.map(agg => {
        const column = agg.column === '*' ? '*' : this.qualifyColumnName(agg.column, context.tables);
        return `${agg.function}(${column})`;
      });

      // Add non-aggregated columns for GROUP BY
      const nonAggColumns = columnEntities
        .filter(e => !context.aggregations.some(agg => agg.column === e.value))
        .map(e => this.qualifyColumnName(e.value, context.tables));

      return [...aggColumns, ...nonAggColumns].join(', ');
    }

    // If specific columns are mentioned, use them
    if (columnEntities.length > 0) {
      return columnEntities
        .map(e => this.qualifyColumnName(e.value, context.tables))
        .join(', ');
    }

    // Default to all columns with table prefix
    if (context.tables.length === 1) {
      return this.options.useAliases ? 'a.*' : `${context.tables[0]}.*`;
    }

    return '*';
  }

  private buildFromClause(context: QueryContext): string {
    if (context.tables.length === 0) {
      throw new Error('No tables specified in query context');
    }

    const primaryTable = context.tables[0];
    return this.options.useAliases ? `${primaryTable} a` : primaryTable;
  }

  private buildJoinClauses(context: QueryContext): string {
    if (context.tables.length <= 1) {
      return '';
    }

    const joins: string[] = [];
    const processedTables = new Set([context.tables[0]]);

    // Process explicit relationships first
    for (const rel of context.relationships) {
      if (processedTables.has(rel.from) && !processedTables.has(rel.to)) {
        const joinClause = this.buildJoinClause(rel.from, rel.to, rel.type);
        if (joinClause) {
          joins.push(joinClause);
          processedTables.add(rel.to);
        }
      }
    }

    // Auto-discover remaining joins
    for (const table of context.tables.slice(1)) {
      if (!processedTables.has(table)) {
        const joinPath = this.findOptimalJoinPath(context.tables[0], table);
        if (joinPath) {
          const joinClause = this.buildJoinFromPath(joinPath);
          if (joinClause) {
            joins.push(joinClause);
            processedTables.add(table);
          }
        }
      }
    }

    return joins.join('\n');
  }

  private buildJoinClause(fromTable: string, toTable: string, joinType: string): string | null {
    const fromSchema = this.schemas.get(fromTable);
    const toSchema = this.schemas.get(toTable);

    if (!fromSchema || !toSchema) {
      return null;
    }

    // Find foreign key relationship
    let joinCondition = '';

    // Check foreign keys in fromTable pointing to toTable
    for (const column of fromSchema.columns) {
      if (column.foreignKey && column.foreignKey.includes(toTable)) {
        const referencedColumn = this.extractReferencedColumn(column.foreignKey);
        joinCondition = `${this.getTableAlias(fromTable)}.${column.name} = ${this.getTableAlias(toTable)}.${referencedColumn}`;
        break;
      }
    }

    // Check foreign keys in toTable pointing to fromTable
    if (!joinCondition) {
      for (const column of toSchema.columns) {
        if (column.foreignKey && column.foreignKey.includes(fromTable)) {
          const referencedColumn = this.extractReferencedColumn(column.foreignKey);
          joinCondition = `${this.getTableAlias(toTable)}.${column.name} = ${this.getTableAlias(fromTable)}.${referencedColumn}`;
          break;
        }
      }
    }

    // Default join condition based on common naming conventions
    if (!joinCondition) {
      const commonKeys = [
        { from: `${toTable.slice(0, -1)}_id`, to: 'id' },
        { from: `${fromTable.slice(0, -1)}_id`, to: 'id' },
        { from: 'id', to: `${fromTable.slice(0, -1)}_id` }
      ];

      for (const { from, to } of commonKeys) {
        if (fromSchema.columns.some(c => c.name === from) &&
            toSchema.columns.some(c => c.name === to)) {
          joinCondition = `${this.getTableAlias(fromTable)}.${from} = ${this.getTableAlias(toTable)}.${to}`;
          break;
        }
      }
    }

    if (!joinCondition) {
      return null;
    }

    const joinTypeSQL = joinType.toUpperCase() === 'INNER' ? 'INNER JOIN' : `${joinType.toUpperCase()} JOIN`;
    const tableWithAlias = this.options.useAliases ?
      `${toTable} ${this.getTableAlias(toTable)}` : toTable;

    return `${joinTypeSQL} ${tableWithAlias} ON ${joinCondition}`;
  }

  private buildWhereClause(context: QueryContext): string {
    if (context.filters.length === 0) {
      return '';
    }

    const conditions = context.filters.map(filter => {
      const column = this.qualifyColumnName(filter.column, context.tables);
      const value = this.sanitizeValue(filter.value, filter.operator);

      switch (filter.operator.toLowerCase()) {
        case 'like':
          return `${column} LIKE '${value}'`;
        case 'in':
          return `${column} IN (${value})`;
        case 'between':
          const [start, end] = value.split(' AND ');
          return `${column} BETWEEN '${start}' AND '${end}'`;
        default:
          return `${column} ${filter.operator} '${value}'`;
      }
    });

    return conditions.join(' AND ');
  }

  private buildGroupByClause(context: QueryContext): string {
    if (context.aggregations.length === 0) {
      return '';
    }

    // Find non-aggregated columns that should be in GROUP BY
    const groupColumns: string[] = [];

    // Add ORDER BY column if it's not aggregated
    if (context.orderBy && !context.aggregations.some(agg => agg.column === context.orderBy!.column)) {
      groupColumns.push(this.qualifyColumnName(context.orderBy.column, context.tables));
    }

    return groupColumns.length > 0 ? groupColumns.join(', ') : '';
  }

  private buildHavingClause(context: QueryContext): string {
    // HAVING clause for aggregated filters
    const havingFilters = context.filters.filter(f =>
      context.aggregations.some(agg => agg.column === f.column)
    );

    if (havingFilters.length === 0) {
      return '';
    }

    const conditions = havingFilters.map(filter => {
      const aggFunction = context.aggregations.find(agg => agg.column === filter.column);
      if (aggFunction) {
        const column = filter.column === '*' ? '*' : this.qualifyColumnName(filter.column, context.tables);
        return `${aggFunction.function}(${column}) ${filter.operator} '${this.sanitizeValue(filter.value, filter.operator)}'`;
      }
      return '';
    }).filter(Boolean);

    return conditions.join(' AND ');
  }

  private buildOrderByClause(context: QueryContext): string {
    if (!context.orderBy) {
      return '';
    }

    const column = this.qualifyColumnName(context.orderBy.column, context.tables);
    return `${column} ${context.orderBy.direction}`;
  }

  private buildLimitClause(context: QueryContext): string {
    return context.limit ? `LIMIT ${context.limit}` : '';
  }

  private generateSelectExplanation(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): string {
    let explanation = `This query retrieves `;

    // Describe what's being selected
    if (context.aggregations.length > 0) {
      const aggDescriptions = context.aggregations.map(agg =>
        `${agg.function.toLowerCase()} of ${agg.column}`
      );
      explanation += aggDescriptions.join(', ');
    } else {
      explanation += entities.filter(e => e.type === 'COLUMN').length > 0
        ? 'specific columns'
        : 'all columns';
    }

    // Describe tables
    explanation += ` from ${context.tables.join(', ')}`;

    // Describe joins
    if (context.tables.length > 1) {
      explanation += `, joining ${context.tables.length} tables`;
    }

    // Describe filters
    if (context.filters.length > 0) {
      explanation += ` with ${context.filters.length} filter condition(s)`;
    }

    // Describe ordering
    if (context.orderBy) {
      explanation += `, ordered by ${context.orderBy.column} ${context.orderBy.direction.toLowerCase()}`;
    }

    // Describe limit
    if (context.limit) {
      explanation += `, limited to ${context.limit} rows`;
    }

    explanation += '.';

    return explanation;
  }

  /**
   * Generate other query types (INSERT, UPDATE, DELETE)
   */
  private async generateInsertQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    if (context.tables.length === 0) {
      throw new Error('No table specified for INSERT operation');
    }

    const table = context.tables[0];
    const valueEntities = entities.filter(e => e.type === 'VALUE');

    // Basic INSERT structure - would need more sophisticated value extraction
    const query = `INSERT INTO ${table} (column1, column2) VALUES (value1, value2)`;

    return {
      query: this.formatQuery(query),
      explanation: `This query inserts new data into the ${table} table.`,
      confidence: 0.6, // Lower confidence for INSERT without full value mapping
      optimization: {
        joinStrategy: 'N/A',
        indexSuggestions: [`Consider adding index on ${table} primary key`],
        performanceNotes: ['Batch inserts for better performance']
      },
      security: {
        riskLevel: 'MEDIUM',
        concerns: ['Verify data validation before insert'],
        sanitized: false
      }
    };
  }

  private async generateUpdateQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    if (context.tables.length === 0) {
      throw new Error('No table specified for UPDATE operation');
    }

    const table = context.tables[0];
    const whereClause = this.buildWhereClause(context);

    const query = `UPDATE ${table} SET column1 = value1${whereClause ? ` WHERE ${whereClause}` : ''}`;

    return {
      query: this.formatQuery(query),
      explanation: `This query updates records in the ${table} table.`,
      confidence: 0.6,
      optimization: {
        joinStrategy: 'N/A',
        indexSuggestions: [`Add index on WHERE clause columns`],
        performanceNotes: ['Use WHERE clause to limit affected rows']
      },
      security: {
        riskLevel: 'HIGH',
        concerns: ['UPDATE without WHERE affects all rows', 'Verify authorization'],
        sanitized: false
      }
    };
  }

  private async generateDeleteQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    if (context.tables.length === 0) {
      throw new Error('No table specified for DELETE operation');
    }

    const table = context.tables[0];
    const whereClause = this.buildWhereClause(context);

    if (!whereClause) {
      throw new Error('DELETE operation requires WHERE clause for safety');
    }

    const query = `DELETE FROM ${table} WHERE ${whereClause}`;

    return {
      query: this.formatQuery(query),
      explanation: `This query deletes records from the ${table} table matching the specified conditions.`,
      confidence: 0.7,
      optimization: {
        joinStrategy: 'N/A',
        indexSuggestions: [`Add index on WHERE clause columns`],
        performanceNotes: ['Consider soft delete for audit trails']
      },
      security: {
        riskLevel: 'HIGH',
        concerns: ['Irreversible operation', 'Verify authorization', 'Consider backup'],
        sanitized: true
      }
    };
  }

  private async generateJoinQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    // JOIN intent is handled as part of SELECT query generation
    return this.generateSelectQuery(context, entities, naturalLanguage);
  }

  private async generateComplexQuery(
    context: QueryContext,
    entities: Entity[],
    naturalLanguage: string
  ): Promise<GeneratedSQL> {
    // For complex queries, fall back to SELECT with additional analysis
    const result = await this.generateSelectQuery(context, entities, naturalLanguage);
    result.explanation = `Complex query: ${result.explanation}`;
    result.confidence *= 0.8; // Reduce confidence for complex queries

    return result;
  }

  /**
   * Helper methods
   */
  private qualifyColumnName(column: string, tables: string[]): string {
    if (column === '*') return '*';

    // If column already qualified, return as-is
    if (column.includes('.')) return column;

    // Find which table contains this column
    for (const tableName of tables) {
      const schema = this.schemas.get(tableName);
      if (schema?.columns.some(col => col.name === column)) {
        return this.options.useAliases
          ? `${this.getTableAlias(tableName)}.${column}`
          : `${tableName}.${column}`;
      }
    }

    // If not found in schemas, use first table
    const firstTable = tables[0];
    return this.options.useAliases
      ? `${this.getTableAlias(firstTable)}.${column}`
      : `${firstTable}.${column}`;
  }

  private getTableAlias(tableName: string): string {
    if (!this.options.useAliases) return tableName;

    // Simple alias generation: first letter + index
    const aliases = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const index = Array.from(this.schemas.keys()).indexOf(tableName);
    return aliases[index] || `t${index}`;
  }

  private sanitizeValue(value: string, operator: string): string {
    // Basic SQL injection prevention
    return value.replace(/'/g, "''").replace(/;/g, '');
  }

  private extractReferencedColumn(foreignKey: string): string {
    // Extract referenced column from foreign key constraint
    // Format: "table.column" or "table(column)"
    const match = foreignKey.match(/\.(\w+)|\((\w+)\)/);
    return match?.[1] || match?.[2] || 'id';
  }

  private findOptimalJoinPath(fromTable: string, toTable: string): JoinPath | null {
    // Simplified join path finding - could be enhanced with graph algorithms
    const relationships = this.schemas.get(fromTable)?.relationships || [];

    for (const rel of relationships) {
      if (rel.referencedTable === toTable) {
        return {
          from: fromTable,
          to: toTable,
          via: [],
          cost: 1,
          type: 'direct'
        };
      }
    }

    return null;
  }

  private buildJoinFromPath(joinPath: JoinPath): string {
    // Build JOIN clause from join path
    return this.buildJoinClause(joinPath.from, joinPath.to, 'inner');
  }

  private updateRelationshipGraph(schema: TableSchema): void {
    if (!this.relationshipGraph.has(schema.name)) {
      this.relationshipGraph.set(schema.name, new Set());
    }

    const connections = this.relationshipGraph.get(schema.name)!;

    for (const rel of schema.relationships) {
      connections.add(rel.referencedTable);
    }
  }

  private calculateGenerationConfidence(context: QueryContext, entities: Entity[]): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence based on available information
    if (context.tables.length > 0) confidence += 0.2;
    if (context.filters.length > 0) confidence += 0.1;
    if (entities.some(e => e.type === 'COLUMN')) confidence += 0.1;
    if (context.aggregations.length > 0) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  private analyzeQueryOptimization(query: string, context: QueryContext) {
    const indexSuggestions: string[] = [];
    const performanceNotes: string[] = [];

    // Analyze WHERE clause columns for index suggestions
    for (const filter of context.filters) {
      indexSuggestions.push(`Consider index on ${filter.column} for WHERE clause optimization`);
    }

    // Analyze JOIN performance
    if (context.tables.length > 1) {
      performanceNotes.push('Multiple table joins detected - ensure proper indexing');
    }

    return {
      joinStrategy: context.tables.length > 1 ? 'nested_loop' : 'single_table',
      indexSuggestions,
      performanceNotes
    };
  }

  private analyzeQuerySecurity(query: string, context: QueryContext) {
    const concerns: string[] = [];
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    // Check for potentially risky operations
    if (query.toLowerCase().includes('delete')) {
      riskLevel = 'HIGH';
      concerns.push('DELETE operation detected');
    }

    if (query.toLowerCase().includes('update')) {
      riskLevel = 'HIGH';
      concerns.push('UPDATE operation detected');
    }

    if (context.filters.length === 0 && query.toLowerCase().includes('select')) {
      riskLevel = 'MEDIUM';
      concerns.push('SELECT without WHERE clause may return large dataset');
    }

    return {
      riskLevel,
      concerns,
      sanitized: true // Basic sanitization applied
    };
  }

  private formatQuery(query: string): string {
    if (!this.options.formatOutput) {
      return query;
    }

    // Basic query formatting
    return query
      .replace(/\s+/g, ' ')
      .replace(/\n\s*/g, '\n')
      .trim();
  }
}

export default SQLGenerator;