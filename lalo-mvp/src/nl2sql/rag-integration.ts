import { RAGSystem, SearchResult } from '../rag/index.js';
import { Document, RAGQuery } from '../types/index.js';
import { ProcessingResult } from './language-processor.js';
import { TableSchema } from '../types/index.js';

export interface RAGEnhancedContext {
  originalContext: Record<string, any>;
  ragContext: Document[];
  schemaDocumentation: Document[];
  exampleQueries: Document[];
  enhancedPrompt: string;
}

export class RAGIntegration {
  private ragSystem: RAGSystem;
  private schemaDocsCollection = 'schema_documentation';
  private queryExamplesCollection = 'query_examples';

  constructor(ragSystem: RAGSystem) {
    this.ragSystem = ragSystem;
  }

  /**
   * Enhance query context using RAG system
   */
  async enhanceContext(
    naturalLanguage: string,
    originalContext?: Record<string, any>,
    schemas?: Map<string, TableSchema>
  ): Promise<RAGEnhancedContext> {
    try {
      // Search for relevant schema documentation
      const schemaQuery: RAGQuery = {
        query: `${naturalLanguage} database schema table structure`,
        topK: 3,
        filters: { type: 'schema_documentation' }
      };

      const schemaResults = await this.ragSystem.search(schemaQuery);

      // Search for similar query examples
      const exampleQuery: RAGQuery = {
        query: naturalLanguage,
        topK: 5,
        filters: { type: 'query_example' }
      };

      const exampleResults = await this.ragSystem.search(exampleQuery);

      // Search for general context
      const contextQuery: RAGQuery = {
        query: naturalLanguage,
        topK: 3
      };

      const contextResults = await this.ragSystem.search(contextQuery);

      // Build enhanced prompt
      const enhancedPrompt = this.buildEnhancedPrompt(
        naturalLanguage,
        schemaResults,
        exampleResults,
        contextResults,
        schemas
      );

      return {
        originalContext: originalContext || {},
        ragContext: [...contextResults.map(r => r.document)],
        schemaDocumentation: [...schemaResults.map(r => r.document)],
        exampleQueries: [...exampleResults.map(r => r.document)],
        enhancedPrompt
      };
    } catch (error) {
      // Fallback to original context if RAG fails
      return {
        originalContext: originalContext || {},
        ragContext: [],
        schemaDocumentation: [],
        exampleQueries: [],
        enhancedPrompt: naturalLanguage
      };
    }
  }

  /**
   * Add schema documentation to RAG system
   */
  async addSchemaDocumentation(
    schema: TableSchema,
    additionalInfo?: string
  ): Promise<void> {
    const content = this.generateSchemaDocumentation(schema, additionalInfo);

    await this.ragSystem.addDocument(
      content,
      {
        type: 'schema_documentation',
        tableName: schema.name,
        schema: schema,
        createdAt: new Date().toISOString()
      },
      `schema:${schema.name}`
    );
  }

  /**
   * Add query example to RAG system
   */
  async addQueryExample(
    naturalLanguage: string,
    sql: string,
    explanation: string,
    context?: Record<string, any>
  ): Promise<void> {
    const content = `
Natural Language: ${naturalLanguage}

SQL Query:
${sql}

Explanation: ${explanation}

Context: ${context ? JSON.stringify(context, null, 2) : 'None'}
    `.trim();

    await this.ragSystem.addDocument(
      content,
      {
        type: 'query_example',
        naturalLanguage,
        sql,
        explanation,
        context,
        createdAt: new Date().toISOString()
      },
      `query_example:${Date.now()}`
    );
  }

  /**
   * Generate comprehensive schema documentation
   */
  private generateSchemaDocumentation(
    schema: TableSchema,
    additionalInfo?: string
  ): string {
    let doc = `# Table: ${schema.name}\n\n`;

    if (schema.description) {
      doc += `Description: ${schema.description}\n\n`;
    }

    doc += `## Columns\n\n`;
    for (const column of schema.columns) {
      doc += `- **${column.name}** (${column.type})`;

      if (column.primaryKey) doc += ' [PRIMARY KEY]';
      if (column.foreignKey) doc += ` [FOREIGN KEY -> ${column.foreignKey}]`;
      if (!column.nullable) doc += ' [NOT NULL]';

      if (column.description) {
        doc += `\n  ${column.description}`;
      }

      doc += '\n';
    }

    if (schema.relationships && schema.relationships.length > 0) {
      doc += `\n## Relationships\n\n`;
      for (const rel of schema.relationships) {
        doc += `- ${rel.table}.${rel.column} → ${rel.referencedTable}.${rel.referencedColumn} (${rel.type})\n`;
      }
    }

    if (additionalInfo) {
      doc += `\n## Additional Information\n\n${additionalInfo}\n`;
    }

    // Add common query patterns
    doc += `\n## Common Query Patterns\n\n`;
    doc += this.generateCommonPatterns(schema);

    return doc;
  }

  /**
   * Generate common query patterns for a table
   */
  private generateCommonPatterns(schema: TableSchema): string {
    const tableName = schema.name;
    const primaryKey = schema.columns.find(c => c.primaryKey)?.name || 'id';

    let patterns = '';

    // Basic SELECT patterns
    patterns += `### Basic Queries\n`;
    patterns += `- List all ${tableName}: "show all ${tableName}" or "get all ${tableName}"\n`;
    patterns += `- Find specific ${tableName.slice(0, -1)}: "find ${tableName.slice(0, -1)} with ${primaryKey} = X"\n`;

    // Filter patterns based on columns
    const filterableColumns = schema.columns.filter(c =>
      !c.primaryKey && c.type.includes('varchar') || c.type.includes('text')
    );

    if (filterableColumns.length > 0) {
      patterns += `- Filter by ${filterableColumns[0].name}: "show ${tableName} where ${filterableColumns[0].name} contains 'value'"\n`;
    }

    // Date-based patterns
    const dateColumns = schema.columns.filter(c =>
      c.name.includes('created') || c.name.includes('updated') || c.type.includes('timestamp')
    );

    if (dateColumns.length > 0) {
      patterns += `- Recent records: "show latest ${tableName}" or "get ${tableName} from last week"\n`;
    }

    // Count patterns
    patterns += `- Count records: "how many ${tableName}" or "count ${tableName}"\n`;

    return patterns;
  }

  /**
   * Build enhanced prompt with RAG context
   */
  private buildEnhancedPrompt(
    naturalLanguage: string,
    schemaResults: SearchResult[],
    exampleResults: SearchResult[],
    contextResults: SearchResult[],
    schemas?: Map<string, TableSchema>
  ): string {
    let prompt = `Natural Language Query: "${naturalLanguage}"\n\n`;

    // Add schema context
    if (schemaResults.length > 0) {
      prompt += `## Relevant Schema Information:\n\n`;
      schemaResults.forEach((result, index) => {
        prompt += `### Schema ${index + 1} (Relevance: ${result.relevance.toFixed(2)}):\n`;
        prompt += `${result.document.content}\n\n`;
      });
    }

    // Add example queries
    if (exampleResults.length > 0) {
      prompt += `## Similar Query Examples:\n\n`;
      exampleResults.forEach((result, index) => {
        prompt += `### Example ${index + 1} (Relevance: ${result.relevance.toFixed(2)}):\n`;
        prompt += `${result.document.content}\n\n`;
      });
    }

    // Add additional context
    if (contextResults.length > 0) {
      prompt += `## Additional Context:\n\n`;
      contextResults.forEach((result, index) => {
        prompt += `### Context ${index + 1}:\n`;
        prompt += `${result.document.content}\n\n`;
      });
    }

    // Add current schema information if available
    if (schemas && schemas.size > 0) {
      prompt += `## Current Database Schema:\n\n`;
      for (const [name, schema] of schemas) {
        prompt += `### Table: ${name}\n`;
        prompt += `Columns: ${schema.columns.map(c => `${c.name} (${c.type})`).join(', ')}\n`;
        if (schema.description) {
          prompt += `Description: ${schema.description}\n`;
        }
        prompt += '\n';
      }
    }

    return prompt;
  }

  /**
   * Store successful query patterns for future use
   */
  async storeSuccessfulPattern(
    naturalLanguage: string,
    sql: string,
    processingResult: ProcessingResult,
    confidence: number
  ): Promise<void> {
    if (confidence < 0.8) return; // Only store high-confidence patterns

    const explanation = `Intent: ${processingResult.intent.type}, Tables: ${processingResult.context.tables.join(', ')}, Confidence: ${confidence}`;

    await this.addQueryExample(
      naturalLanguage,
      sql,
      explanation,
      {
        intent: processingResult.intent,
        entities: processingResult.entities,
        confidence,
        timestamp: new Date().toISOString()
      }
    );
  }

  /**
   * Search for query patterns that match current intent
   */
  async findSimilarPatterns(
    processingResult: ProcessingResult,
    topK = 3
  ): Promise<SearchResult[]> {
    const searchQuery = `${processingResult.intent.type} ${processingResult.context.tables.join(' ')}`;

    const query: RAGQuery = {
      query: searchQuery,
      topK,
      filters: {
        type: 'query_example',
        'metadata.intent.type': processingResult.intent.type
      },
      threshold: 0.5
    };

    return this.ragSystem.search(query);
  }

  /**
   * Get schema documentation for specific tables
   */
  async getSchemaDocumentation(tableNames: string[]): Promise<Document[]> {
    const results: Document[] = [];

    for (const tableName of tableNames) {
      const query: RAGQuery = {
        query: `table ${tableName} schema structure`,
        topK: 1,
        filters: {
          type: 'schema_documentation',
          tableName
        }
      };

      const searchResults = await this.ragSystem.search(query);
      results.push(...searchResults.map(r => r.document));
    }

    return results;
  }
}

export default RAGIntegration;