import { OpenAI } from 'openai';

export interface Intent {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'AGGREGATE' | 'JOIN' | 'COMPLEX';
  confidence: number;
  subtype?: string;
  operation?: string;
}

export interface Entity {
  type: 'TABLE' | 'COLUMN' | 'VALUE' | 'CONDITION' | 'FUNCTION' | 'OPERATOR';
  value: string;
  confidence: number;
  table?: string;
  dataType?: string;
  position: [number, number]; // start, end positions in text
}

export interface QueryContext {
  tables: string[];
  relationships: Array<{
    from: string;
    to: string;
    type: 'inner' | 'left' | 'right' | 'full';
    confidence: number;
  }>;
  filters: Array<{
    column: string;
    operator: string;
    value: string;
    confidence: number;
  }>;
  aggregations: Array<{
    function: string;
    column: string;
    confidence: number;
  }>;
  orderBy?: {
    column: string;
    direction: 'ASC' | 'DESC';
  };
  limit?: number;
}

export interface ProcessingResult {
  intent: Intent;
  entities: Entity[];
  context: QueryContext;
  confidence: number;
  reasoning: string;
}

export class LanguageProcessor {
  private openai: OpenAI;
  private intentPatterns: Map<string, RegExp[]>;
  private entityPatterns: Map<string, RegExp[]>;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Intent recognition patterns
    this.intentPatterns = new Map([
      ['SELECT', [
        /\b(show|get|find|list|display|retrieve|select)\b/i,
        /\b(what|which|how many|count)\b/i,
        /\b(all|users|records|data)\b/i
      ]],
      ['INSERT', [
        /\b(add|insert|create|new)\b/i,
        /\b(into|to)\b/i
      ]],
      ['UPDATE', [
        /\b(update|change|modify|set|edit)\b/i
      ]],
      ['DELETE', [
        /\b(delete|remove|drop)\b/i
      ]],
      ['AGGREGATE', [
        /\b(count|sum|average|max|min|total)\b/i,
        /\b(group by|grouped|grouping)\b/i
      ]],
      ['JOIN', [
        /\b(join|combine|merge|with|together)\b/i,
        /\b(and|along with|including)\b/i
      ]]
    ]);

    // Entity recognition patterns
    this.entityPatterns = new Map([
      ['TABLE', [
        /\b(users?|workflows?|proposals?|votes?|documents?)\b/i,
        /\b(table|from|in)\s+(\w+)/i
      ]],
      ['COLUMN', [
        /\b(id|name|email|title|description|status|created_at|updated_at)\b/i,
        /\b(user_id|workflow_id|proposal_id)\b/i
      ]],
      ['CONDITION', [
        /\b(where|when|if|having)\b/i,
        /\b(equals?|is|are|contains?|like|in|between)\b/i
      ]],
      ['OPERATOR', [
        /\b(and|or|not|>|<|>=|<=|=|!=|<>)\b/i
      ]],
      ['FUNCTION', [
        /\b(count|sum|avg|max|min|distinct)\b/i
      ]]
    ]);
  }

  /**
   * Process natural language input to extract intent, entities, and context
   */
  async processLanguage(input: string, schemas?: Map<string, any>): Promise<ProcessingResult> {
    try {
      // Parallel processing for better performance
      const [aiResult, patternResult] = await Promise.all([
        this.processWithAI(input, schemas),
        this.processWithPatterns(input)
      ]);

      // Combine results with confidence weighting
      const combinedResult = this.combineResults(aiResult, patternResult);

      return combinedResult;
    } catch (error) {
      throw new Error(`Language processing failed: ${error.message}`);
    }
  }

  /**
   * Use AI for advanced intent and entity recognition
   */
  private async processWithAI(input: string, schemas?: Map<string, any>): Promise<ProcessingResult> {
    const systemPrompt = this.buildAIProcessingPrompt(schemas);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this query: "${input}"` }
      ]
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI processing');
    }

    return this.parseAIResponse(content);
  }

  /**
   * Use pattern matching for fast recognition
   */
  private processWithPatterns(input: string): ProcessingResult {
    const intent = this.recognizeIntent(input);
    const entities = this.extractEntities(input);
    const context = this.buildContext(entities, input);

    return {
      intent,
      entities,
      context,
      confidence: this.calculatePatternConfidence(intent, entities),
      reasoning: 'Pattern-based recognition'
    };
  }

  private recognizeIntent(input: string): Intent {
    const lowerInput = input.toLowerCase();
    let bestMatch: Intent = { type: 'SELECT', confidence: 0 };

    for (const [intentType, patterns] of this.intentPatterns) {
      let matches = 0;
      for (const pattern of patterns) {
        if (pattern.test(lowerInput)) {
          matches++;
        }
      }

      const confidence = matches / patterns.length;
      if (confidence > bestMatch.confidence) {
        bestMatch = {
          type: intentType as Intent['type'],
          confidence,
          operation: this.extractOperation(lowerInput, intentType)
        };
      }
    }

    return bestMatch;
  }

  private extractEntities(input: string): Entity[] {
    const entities: Entity[] = [];
    const lowerInput = input.toLowerCase();

    for (const [entityType, patterns] of this.entityPatterns) {
      for (const pattern of patterns) {
        const matches = Array.from(lowerInput.matchAll(new RegExp(pattern.source, 'gi')));

        for (const match of matches) {
          if (match.index !== undefined) {
            entities.push({
              type: entityType as Entity['type'],
              value: match[1] || match[0],
              confidence: 0.8,
              position: [match.index, match.index + match[0].length]
            });
          }
        }
      }
    }

    return this.deduplicateEntities(entities);
  }

  private buildContext(entities: Entity[], input: string): QueryContext {
    const tables = entities
      .filter(e => e.type === 'TABLE')
      .map(e => e.value);

    const columns = entities
      .filter(e => e.type === 'COLUMN')
      .map(e => e.value);

    return {
      tables: [...new Set(tables)],
      relationships: this.inferRelationships(tables),
      filters: this.extractFilters(input, entities),
      aggregations: this.extractAggregations(input, entities),
      orderBy: this.extractOrderBy(input),
      limit: this.extractLimit(input)
    };
  }

  private inferRelationships(tables: string[]): QueryContext['relationships'] {
    const relationships: QueryContext['relationships'] = [];

    // Common relationship patterns
    const commonJoins = [
      { from: 'users', to: 'workflows', key: 'user_id' },
      { from: 'workflows', to: 'proposals', key: 'workflow_id' },
      { from: 'users', to: 'votes', key: 'user_id' },
      { from: 'proposals', to: 'votes', key: 'proposal_id' }
    ];

    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const table1 = tables[i];
        const table2 = tables[j];

        const join = commonJoins.find(j =>
          (j.from === table1 && j.to === table2) ||
          (j.from === table2 && j.to === table1)
        );

        if (join) {
          relationships.push({
            from: table1,
            to: table2,
            type: 'inner',
            confidence: 0.8
          });
        }
      }
    }

    return relationships;
  }

  private extractFilters(input: string, entities: Entity[]): QueryContext['filters'] {
    const filters: QueryContext['filters'] = [];
    const conditions = entities.filter(e => e.type === 'CONDITION');

    // Pattern matching for common filter patterns
    const filterPatterns = [
      /(\w+)\s*(=|is|equals?)\s*['"]?([^'"]+)['"]?/gi,
      /(\w+)\s*(>|<|>=|<=)\s*(['"]?)([^'"]+)\3/gi,
      /(\w+)\s+like\s+['"]([^'"]+)['"]/gi,
      /(\w+)\s+in\s*\(([^)]+)\)/gi
    ];

    for (const pattern of filterPatterns) {
      const matches = Array.from(input.matchAll(pattern));
      for (const match of matches) {
        if (match[1] && match[2] && match[3]) {
          filters.push({
            column: match[1],
            operator: match[2],
            value: match[3],
            confidence: 0.7
          });
        }
      }
    }

    return filters;
  }

  private extractAggregations(input: string, entities: Entity[]): QueryContext['aggregations'] {
    const aggregations: QueryContext['aggregations'] = [];
    const functions = entities.filter(e => e.type === 'FUNCTION');

    const aggPatterns = [
      /(count|sum|avg|max|min)\s*\(\s*(\w+|\*)\s*\)/gi,
      /(count|sum|avg|max|min)\s+(\w+)/gi
    ];

    for (const pattern of aggPatterns) {
      const matches = Array.from(input.matchAll(pattern));
      for (const match of matches) {
        if (match[1] && match[2]) {
          aggregations.push({
            function: match[1].toUpperCase(),
            column: match[2] === '*' ? '*' : match[2],
            confidence: 0.8
          });
        }
      }
    }

    return aggregations;
  }

  private extractOrderBy(input: string): QueryContext['orderBy'] | undefined {
    const orderPattern = /order\s+by\s+(\w+)(?:\s+(asc|desc))?/i;
    const match = input.match(orderPattern);

    if (match) {
      return {
        column: match[1],
        direction: (match[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC'
      };
    }

    return undefined;
  }

  private extractLimit(input: string): number | undefined {
    const limitPattern = /limit\s+(\d+)/i;
    const match = input.match(limitPattern);

    if (match) {
      return parseInt(match[1], 10);
    }

    // Check for natural language limit expressions
    const naturalLimits = [
      { pattern: /first\s+(\d+)/i, multiplier: 1 },
      { pattern: /top\s+(\d+)/i, multiplier: 1 },
      { pattern: /latest\s+(\d+)/i, multiplier: 1 }
    ];

    for (const { pattern, multiplier } of naturalLimits) {
      const match = input.match(pattern);
      if (match) {
        return parseInt(match[1], 10) * multiplier;
      }
    }

    return undefined;
  }

  private extractOperation(input: string, intentType: string): string | undefined {
    const operationPatterns = new Map([
      ['SELECT', ['show', 'get', 'find', 'list', 'display', 'retrieve']],
      ['INSERT', ['add', 'insert', 'create']],
      ['UPDATE', ['update', 'change', 'modify', 'set']],
      ['DELETE', ['delete', 'remove', 'drop']]
    ]);

    const patterns = operationPatterns.get(intentType);
    if (patterns) {
      for (const pattern of patterns) {
        if (input.toLowerCase().includes(pattern)) {
          return pattern;
        }
      }
    }

    return undefined;
  }

  private deduplicateEntities(entities: Entity[]): Entity[] {
    const seen = new Map<string, Entity>();

    for (const entity of entities) {
      const key = `${entity.type}-${entity.value.toLowerCase()}`;
      const existing = seen.get(key);

      if (!existing || entity.confidence > existing.confidence) {
        seen.set(key, entity);
      }
    }

    return Array.from(seen.values());
  }

  private calculatePatternConfidence(intent: Intent, entities: Entity[]): number {
    const intentWeight = 0.4;
    const entityWeight = 0.6;

    const avgEntityConfidence = entities.length > 0
      ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
      : 0;

    return (intent.confidence * intentWeight) + (avgEntityConfidence * entityWeight);
  }

  private buildAIProcessingPrompt(schemas?: Map<string, any>): string {
    let schemaInfo = '';
    if (schemas && schemas.size > 0) {
      schemaInfo = '\nAvailable schemas:\n';
      for (const [name, schema] of schemas) {
        schemaInfo += `- ${name}: ${JSON.stringify(schema, null, 2)}\n`;
      }
    }

    return `You are an expert natural language processor for SQL query generation. Analyze the input and extract:

1. Intent: The primary operation type (SELECT, INSERT, UPDATE, DELETE, AGGREGATE, JOIN, COMPLEX)
2. Entities: Table names, column names, values, conditions, functions, operators
3. Context: Tables involved, relationships, filters, aggregations, ordering, limits

${schemaInfo}

Respond in JSON format:
{
  "intent": {
    "type": "SELECT|INSERT|UPDATE|DELETE|AGGREGATE|JOIN|COMPLEX",
    "confidence": 0.95,
    "subtype": "optional subtype",
    "operation": "specific operation word"
  },
  "entities": [
    {
      "type": "TABLE|COLUMN|VALUE|CONDITION|FUNCTION|OPERATOR",
      "value": "entity value",
      "confidence": 0.9,
      "table": "optional table name",
      "dataType": "optional data type",
      "position": [0, 10]
    }
  ],
  "context": {
    "tables": ["table1", "table2"],
    "relationships": [
      {
        "from": "table1",
        "to": "table2",
        "type": "inner|left|right|full",
        "confidence": 0.8
      }
    ],
    "filters": [
      {
        "column": "column_name",
        "operator": "=|>|<|LIKE|IN",
        "value": "filter_value",
        "confidence": 0.7
      }
    ],
    "aggregations": [
      {
        "function": "COUNT|SUM|AVG|MAX|MIN",
        "column": "column_name",
        "confidence": 0.8
      }
    ],
    "orderBy": {
      "column": "column_name",
      "direction": "ASC|DESC"
    },
    "limit": 10
  },
  "confidence": 0.85,
  "reasoning": "Explanation of the analysis"
}

Focus on accuracy and provide high confidence scores only when certain.`;
  }

  private parseAIResponse(content: string): ProcessingResult {
    try {
      const parsed = JSON.parse(content);

      return {
        intent: parsed.intent || { type: 'SELECT', confidence: 0 },
        entities: parsed.entities || [],
        context: parsed.context || {
          tables: [],
          relationships: [],
          filters: [],
          aggregations: []
        },
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || 'AI-based analysis'
      };
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
  }

  private combineResults(aiResult: ProcessingResult, patternResult: ProcessingResult): ProcessingResult {
    // Weight AI results higher but use patterns as fallback
    const aiWeight = 0.7;
    const patternWeight = 0.3;

    const combinedConfidence = (aiResult.confidence * aiWeight) + (patternResult.confidence * patternWeight);

    // Use AI result as base, supplement with pattern results where AI confidence is low
    const result: ProcessingResult = {
      intent: aiResult.confidence > 0.5 ? aiResult.intent : patternResult.intent,
      entities: this.mergeEntities(aiResult.entities, patternResult.entities),
      context: this.mergeContext(aiResult.context, patternResult.context),
      confidence: combinedConfidence,
      reasoning: `Combined analysis: AI (${aiResult.confidence.toFixed(2)}) + Patterns (${patternResult.confidence.toFixed(2)})`
    };

    return result;
  }

  private mergeEntities(aiEntities: Entity[], patternEntities: Entity[]): Entity[] {
    const merged = new Map<string, Entity>();

    // Add AI entities first (higher priority)
    for (const entity of aiEntities) {
      const key = `${entity.type}-${entity.value.toLowerCase()}`;
      merged.set(key, entity);
    }

    // Add pattern entities that don't conflict
    for (const entity of patternEntities) {
      const key = `${entity.type}-${entity.value.toLowerCase()}`;
      if (!merged.has(key)) {
        merged.set(key, { ...entity, confidence: entity.confidence * 0.8 });
      }
    }

    return Array.from(merged.values());
  }

  private mergeContext(aiContext: QueryContext, patternContext: QueryContext): QueryContext {
    return {
      tables: [...new Set([...aiContext.tables, ...patternContext.tables])],
      relationships: [...aiContext.relationships, ...patternContext.relationships],
      filters: [...aiContext.filters, ...patternContext.filters],
      aggregations: [...aiContext.aggregations, ...patternContext.aggregations],
      orderBy: aiContext.orderBy || patternContext.orderBy,
      limit: aiContext.limit || patternContext.limit
    };
  }
}

export default LanguageProcessor;