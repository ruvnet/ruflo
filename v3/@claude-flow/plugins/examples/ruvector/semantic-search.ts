/**
 * RuVector PostgreSQL Bridge - Semantic Code Search Example
 *
 * This example demonstrates:
 * - Embedding code snippets for semantic search
 * - Natural language code queries
 * - Ranking and relevance scoring
 * - Hybrid search (semantic + keyword)
 *
 * Run with: npx ts-node examples/ruvector/semantic-search.ts
 *
 * @module @claude-flow/plugins/examples/ruvector/semantic-search
 */

import {
  createRuVectorBridge,
  type RuVectorBridge,
  type VectorRecord,
  type VectorSearchOptions,
} from '../../src/integrations/ruvector/index.js';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'vectors',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
  dimensions: 768, // Code embedding dimension (e.g., CodeBERT, StarCoder)
};

// ============================================================================
// Simulated Embedding Model
// ============================================================================

/**
 * Simulated code embedding function.
 * In production, use a proper code embedding model like:
 * - CodeBERT
 * - StarCoder
 * - Code-LLaMA embeddings
 * - OpenAI text-embedding-3-small
 */
class CodeEmbedder {
  private dimension: number;
  private vocabulary: Map<string, number[]> = new Map();

  constructor(dimension: number) {
    this.dimension = dimension;
    this.initializeVocabulary();
  }

  /**
   * Initialize semantic vocabulary for code concepts.
   * This is a simplified simulation - real models use pattern networks.
   */
  private initializeVocabulary(): void {
    const concepts = [
      'function', 'class', 'variable', 'loop', 'condition',
      'array', 'object', 'string', 'number', 'boolean',
      'async', 'await', 'promise', 'callback', 'error',
      'import', 'export', 'module', 'interface', 'type',
      'auth', 'user', 'password', 'token', 'login',
      'database', 'query', 'sql', 'insert', 'select',
      'api', 'http', 'request', 'response', 'endpoint',
      'test', 'expect', 'mock', 'assert', 'describe',
    ];

    concepts.forEach((concept, idx) => {
      const embedding = this.createConceptEmbedding(idx, concepts.length);
      this.vocabulary.set(concept, embedding);
    });
  }

  /**
   * Create a deterministic embedding for a concept.
   */
  private createConceptEmbedding(idx: number, total: number): number[] {
    const embedding = new Array(this.dimension).fill(0);
    const base = (idx / total) * Math.PI * 2;

    for (let i = 0; i < this.dimension; i++) {
      embedding[i] = Math.sin(base + (i / this.dimension) * Math.PI) * 0.5;
      if (i % 2 === 0) {
        embedding[i] += Math.cos(base * 2 + i * 0.01) * 0.3;
      }
    }

    return this.normalize(embedding);
  }

  /**
   * Embed code snippet.
   */
  embed(code: string): number[] {
    const tokens = this.tokenize(code);
    const embedding = new Array(this.dimension).fill(0);

    // Accumulate embeddings from vocabulary matches
    let matchCount = 0;
    for (const token of tokens) {
      const tokenLower = token.toLowerCase();
      if (this.vocabulary.has(tokenLower)) {
        const tokenEmbedding = this.vocabulary.get(tokenLower)!;
        for (let i = 0; i < this.dimension; i++) {
          embedding[i] += tokenEmbedding[i];
        }
        matchCount++;
      }
    }

    // Add noise for tokens not in vocabulary
    const unknownRatio = (tokens.length - matchCount) / tokens.length;
    for (let i = 0; i < this.dimension; i++) {
      embedding[i] += (Math.random() * 2 - 1) * unknownRatio * 0.1;
    }

    return this.normalize(embedding);
  }

  /**
   * Embed a natural language query.
   */
  embedQuery(query: string): number[] {
    return this.embed(query);
  }

  /**
   * Tokenize code into meaningful tokens.
   */
  private tokenize(code: string): string[] {
    return code
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * Normalize vector to unit length.
   */
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }
}

// ============================================================================
// Sample Code Repository
// ============================================================================

const codeSnippets = [
  {
    id: 'auth-login',
    language: 'typescript',
    filename: 'auth/login.ts',
    code: `
async function login(username: string, password: string): Promise<AuthToken> {
  const user = await findUserByUsername(username);
  if (!user) {
    throw new AuthenticationError('User not found');
  }

  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new AuthenticationError('Invalid password');
  }

  const token = generateJWT({ userId: user.id, role: user.role });
  await saveSession(user.id, token);

  return { token, expiresIn: 3600 };
}`,
    tags: ['authentication', 'login', 'jwt', 'security'],
  },
  {
    id: 'auth-middleware',
    language: 'typescript',
    filename: 'middleware/auth.ts',
    code: `
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = verifyJWT(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
}`,
    tags: ['middleware', 'authentication', 'jwt', 'express'],
  },
  {
    id: 'db-query',
    language: 'typescript',
    filename: 'database/query.ts',
    code: `
async function executeQuery<T>(sql: string, params: unknown[]): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } catch (error) {
    logger.error('Database query failed', { sql, error });
    throw new DatabaseError('Query execution failed');
  } finally {
    client.release();
  }
}`,
    tags: ['database', 'postgresql', 'query', 'async'],
  },
  {
    id: 'api-users',
    language: 'typescript',
    filename: 'api/users.ts',
    code: `
router.get('/users/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const user = await userService.findById(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  });
});`,
    tags: ['api', 'rest', 'users', 'express'],
  },
  {
    id: 'test-auth',
    language: 'typescript',
    filename: 'tests/auth.test.ts',
    code: `
describe('Authentication', () => {
  it('should login with valid credentials', async () => {
    const result = await login('testuser', 'password123');

    expect(result.token).toBeDefined();
    expect(result.expiresIn).toBe(3600);
  });

  it('should reject invalid password', async () => {
    await expect(login('testuser', 'wrong'))
      .rejects
      .toThrow('Invalid password');
  });
});`,
    tags: ['test', 'jest', 'authentication', 'unit-test'],
  },
  {
    id: 'array-utils',
    language: 'typescript',
    filename: 'utils/array.ts',
    code: `
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const groupKey = String(item[key]);
    acc[groupKey] = acc[groupKey] || [];
    acc[groupKey].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}`,
    tags: ['utility', 'array', 'functional'],
  },
  {
    id: 'error-handler',
    language: 'typescript',
    filename: 'middleware/error.ts',
    code: `
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  logger.error('Unhandled error', { error, path: req.path });

  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message });
  }

  if (error instanceof AuthenticationError) {
    return res.status(401).json({ error: error.message });
  }

  res.status(500).json({ error: 'Internal server error' });
}`,
    tags: ['error-handling', 'middleware', 'express'],
  },
  {
    id: 'cache-service',
    language: 'typescript',
    filename: 'services/cache.ts',
    code: `
class CacheService {
  private cache: Map<string, { value: unknown; expiry: number }> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }
}`,
    tags: ['cache', 'memory', 'service'],
  },
];

// ============================================================================
// Main Example
// ============================================================================

async function main(): Promise<void> {
  console.log('RuVector PostgreSQL Bridge - Semantic Code Search Example');
  console.log('=========================================================\n');

  const bridge: RuVectorBridge = createRuVectorBridge({
    connectionString: `postgresql://${config.connection.user}:${config.connection.password}@${config.connection.host}:${config.connection.port}/${config.connection.database}`,
  });

  const embedder = new CodeEmbedder(config.dimensions);

  try {
    await bridge.connect();
    console.log('Connected to PostgreSQL\n');

    // ========================================================================
    // 1. Create Code Collection
    // ========================================================================
    console.log('1. Creating code collection...');
    await bridge.createCollection('code_snippets', {
      dimensions: config.dimensions,
      distanceMetric: 'cosine',
      indexType: 'hnsw',
      indexParams: { m: 16, efConstruction: 100 },
    });
    console.log('   Collection created!\n');

    // ========================================================================
    // 2. Index Code Snippets
    // ========================================================================
    console.log('2. Indexing code snippets...');

    for (const snippet of codeSnippets) {
      const embedding = embedder.embed(snippet.code);
      await bridge.insert('code_snippets', {
        id: snippet.id,
        embedding,
        metadata: {
          language: snippet.language,
          filename: snippet.filename,
          tags: snippet.tags,
          codePreview: snippet.code.slice(0, 100) + '...',
        },
      });
      console.log(`   Indexed: ${snippet.filename}`);
    }
    console.log('   All snippets indexed!\n');

    // ========================================================================
    // 3. Natural Language Code Search
    // ========================================================================
    console.log('3. Natural language search examples:\n');

    const queries = [
      'How do I authenticate a user with username and password?',
      'Show me how to handle errors in Express middleware',
      'I need to query a PostgreSQL database',
      'Unit test example for login functionality',
      'How to implement caching with expiration?',
    ];

    for (const query of queries) {
      console.log(`   Query: "${query}"`);

      const queryEmbedding = embedder.embedQuery(query);
      const results = await bridge.search('code_snippets', queryEmbedding, {
        k: 2,
        includeMetadata: true,
        includeDistance: true,
      });

      console.log('   Results:');
      results.forEach((result, i) => {
        const similarity = 1 - (result.distance ?? 0);
        console.log(`     ${i + 1}. ${result.metadata?.filename} (similarity: ${(similarity * 100).toFixed(1)}%)`);
        console.log(`        Tags: ${(result.metadata?.tags as string[])?.join(', ')}`);
      });
      console.log();
    }

    // ========================================================================
    // 4. Tag-Filtered Search
    // ========================================================================
    console.log('4. Tag-filtered search (authentication + middleware)...\n');

    const authQuery = 'verify user credentials and protect routes';
    const authEmbedding = embedder.embedQuery(authQuery);

    const authResults = await bridge.search('code_snippets', authEmbedding, {
      k: 5,
      includeMetadata: true,
      includeDistance: true,
      filter: {
        tags: { $contains: 'authentication' },
      },
    });

    console.log(`   Query: "${authQuery}"`);
    console.log('   Filtered to: authentication tag');
    console.log('   Results:');
    authResults.forEach((result, i) => {
      const similarity = 1 - (result.distance ?? 0);
      console.log(`     ${i + 1}. ${result.metadata?.filename} (similarity: ${(similarity * 100).toFixed(1)}%)`);
    });
    console.log();

    // ========================================================================
    // 5. Hybrid Search (Semantic + Keyword)
    // ========================================================================
    console.log('5. Hybrid search (semantic + keyword matching)...\n');

    const hybridQuery = 'async function database';
    const hybridEmbedding = embedder.embedQuery(hybridQuery);

    // First, get semantic results
    const semanticResults = await bridge.search('code_snippets', hybridEmbedding, {
      k: 10,
      includeMetadata: true,
      includeDistance: true,
    });

    // Then, boost results that contain the keyword
    const keyword = 'async';
    const hybridResults = semanticResults
      .map(result => {
        const code = codeSnippets.find(s => s.id === result.id)?.code ?? '';
        const keywordMatches = (code.match(new RegExp(keyword, 'gi')) || []).length;
        const semanticScore = 1 - (result.distance ?? 0);
        const keywordBoost = Math.min(keywordMatches * 0.05, 0.2);
        const hybridScore = semanticScore * 0.7 + keywordBoost + 0.1;

        return { ...result, hybridScore };
      })
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, 3);

    console.log(`   Query: "${hybridQuery}"`);
    console.log('   Results (semantic 70% + keyword boost 30%):');
    hybridResults.forEach((result, i) => {
      console.log(`     ${i + 1}. ${result.metadata?.filename} (hybrid score: ${(result.hybridScore * 100).toFixed(1)}%)`);
    });
    console.log();

    // ========================================================================
    // 6. Similar Code Detection
    // ========================================================================
    console.log('6. Finding similar code to a reference snippet...\n');

    const referenceId = 'auth-login';
    const reference = await bridge.get('code_snippets', referenceId);

    if (reference) {
      const similarResults = await bridge.search('code_snippets', reference.embedding, {
        k: 4,
        includeMetadata: true,
        includeDistance: true,
      });

      console.log(`   Reference: ${reference.metadata?.filename}`);
      console.log('   Similar code:');
      similarResults
        .filter(r => r.id !== referenceId) // Exclude self
        .forEach((result, i) => {
          const similarity = 1 - (result.distance ?? 0);
          console.log(`     ${i + 1}. ${result.metadata?.filename} (similarity: ${(similarity * 100).toFixed(1)}%)`);
        });
    }
    console.log();

    // ========================================================================
    // 7. Relevance Feedback (Re-ranking)
    // ========================================================================
    console.log('7. Relevance feedback / re-ranking demo...\n');

    // User marks 'auth-middleware' as relevant for authentication queries
    const relevantId = 'auth-middleware';
    const relevantDoc = await bridge.get('code_snippets', relevantId);

    if (relevantDoc) {
      // Combine original query with relevant document embedding
      const originalQuery = 'protect API endpoints';
      const originalEmbedding = embedder.embedQuery(originalQuery);

      // Rocchio algorithm: query' = alpha * query + beta * relevant
      const alpha = 0.7;
      const beta = 0.3;
      const expandedEmbedding = originalEmbedding.map(
        (v, i) => alpha * v + beta * relevantDoc.embedding[i]
      );

      // Normalize
      const magnitude = Math.sqrt(expandedEmbedding.reduce((s, v) => s + v * v, 0));
      const normalizedEmbedding = expandedEmbedding.map(v => v / magnitude);

      const rerankedResults = await bridge.search('code_snippets', normalizedEmbedding, {
        k: 3,
        includeMetadata: true,
        includeDistance: true,
      });

      console.log(`   Original query: "${originalQuery}"`);
      console.log(`   Relevant feedback: ${relevantDoc.metadata?.filename}`);
      console.log('   Re-ranked results:');
      rerankedResults.forEach((result, i) => {
        const similarity = 1 - (result.distance ?? 0);
        console.log(`     ${i + 1}. ${result.metadata?.filename} (similarity: ${(similarity * 100).toFixed(1)}%)`);
      });
    }

    // ========================================================================
    // Cleanup
    // ========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('Semantic code search example completed!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await bridge.disconnect();
    console.log('\nDisconnected from PostgreSQL.');
  }
}

main().catch(console.error);
