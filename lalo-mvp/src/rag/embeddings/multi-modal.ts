import { OpenAI } from 'openai';

export interface EmbeddingRequest {
  content: string;
  type: 'text' | 'code' | 'structured' | 'query';
  metadata?: Record<string, any>;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  type: string;
  cached: boolean;
  latency: number;
}

export class MultiModalEmbedding {
  private openai: OpenAI;
  private embeddingCache = new Map<string, EmbeddingResult>();
  private models = {
    text: 'text-embedding-3-small',
    code: 'text-embedding-3-small', // Could use code-specific model
    structured: 'text-embedding-3-small',
    query: 'text-embedding-3-small'
  };

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(request);

    // Check cache first
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true, latency: 0 };
    }

    try {
      // Preprocess content based on type
      const processedContent = await this.preprocessContent(request);

      // Select appropriate model
      const model = this.models[request.type] || this.models.text;

      // Generate embedding
      const response = await this.openai.embeddings.create({
        model,
        input: processedContent,
      });

      const embedding = response.data[0].embedding;
      const latency = Date.now() - startTime;

      const result: EmbeddingResult = {
        embedding,
        model,
        dimensions: embedding.length,
        type: request.type,
        cached: false,
        latency
      };

      // Cache the result
      this.embeddingCache.set(cacheKey, result);

      return result;
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  async generateBatchEmbeddings(requests: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    // Group by type for optimal batch processing
    const groupedByType = new Map<string, EmbeddingRequest[]>();

    for (const request of requests) {
      const type = request.type;
      if (!groupedByType.has(type)) {
        groupedByType.set(type, []);
      }
      groupedByType.get(type)!.push(request);
    }

    const allResults: EmbeddingResult[] = [];

    // Process each type group
    for (const [type, typeRequests] of groupedByType) {
      const batchResults = await this.processBatchByType(typeRequests, type as any);
      allResults.push(...batchResults);
    }

    // Restore original order
    const resultMap = new Map<string, EmbeddingResult>();
    allResults.forEach(result => {
      const key = this.getCacheKey({ content: '', type: result.type as any });
      resultMap.set(key, result);
    });

    return requests.map(req => {
      const key = this.getCacheKey(req);
      return resultMap.get(key) || allResults[0]; // Fallback
    });
  }

  private async processBatchByType(
    requests: EmbeddingRequest[],
    type: 'text' | 'code' | 'structured' | 'query'
  ): Promise<EmbeddingResult[]> {
    const startTime = Date.now();

    // Check cache for all requests
    const uncachedRequests: EmbeddingRequest[] = [];
    const results: EmbeddingResult[] = [];

    for (const request of requests) {
      const cacheKey = this.getCacheKey(request);
      const cached = this.embeddingCache.get(cacheKey);

      if (cached) {
        results.push({ ...cached, cached: true, latency: 0 });
      } else {
        uncachedRequests.push(request);
      }
    }

    if (uncachedRequests.length === 0) {
      return results;
    }

    // Process uncached requests
    const processedContents = await Promise.all(
      uncachedRequests.map(req => this.preprocessContent(req))
    );

    const model = this.models[type];
    const response = await this.openai.embeddings.create({
      model,
      input: processedContents,
    });

    const latency = Date.now() - startTime;

    // Create results for uncached requests
    for (let i = 0; i < uncachedRequests.length; i++) {
      const request = uncachedRequests[i];
      const embedding = response.data[i].embedding;

      const result: EmbeddingResult = {
        embedding,
        model,
        dimensions: embedding.length,
        type: request.type,
        cached: false,
        latency: latency / uncachedRequests.length // Distribute latency
      };

      // Cache the result
      const cacheKey = this.getCacheKey(request);
      this.embeddingCache.set(cacheKey, result);

      results.push(result);
    }

    return results;
  }

  private async preprocessContent(request: EmbeddingRequest): Promise<string> {
    switch (request.type) {
      case 'code':
        return this.preprocessCode(request.content);
      case 'structured':
        return this.preprocessStructured(request.content);
      case 'query':
        return this.preprocessQuery(request.content);
      default:
        return this.preprocessText(request.content);
    }
  }

  private preprocessText(content: string): Promise<string> {
    // Clean and normalize text
    let processed = content
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\x20-\x7E\n]/g, '') // Remove non-printable characters
      .trim();

    // Truncate if too long (embedding models have token limits)
    if (processed.length > 8000) {
      processed = processed.substring(0, 8000) + '...';
    }

    return Promise.resolve(processed);
  }

  private preprocessCode(content: string): Promise<string> {
    // Preserve code structure but clean up
    let processed = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\/\/.*$/gm, '') // Remove line comments
      .replace(/^\s*$/gm, '') // Remove empty lines
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();

    // Add code context markers
    processed = `[CODE] ${processed}`;

    return Promise.resolve(processed);
  }

  private preprocessStructured(content: string): Promise<string> {
    try {
      // Try to parse and reformat JSON for consistency
      const parsed = JSON.parse(content);
      let processed = JSON.stringify(parsed, null, 1); // Compact formatting

      // Add structured data markers
      processed = `[STRUCTURED] ${processed}`;

      return Promise.resolve(processed);
    } catch (error) {
      // Fallback to text preprocessing if not valid JSON
      return this.preprocessText(content);
    }
  }

  private preprocessQuery(content: string): Promise<string> {
    // Expand query with context markers and normalize
    let processed = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ')
      .trim();

    // Add query context
    processed = `[QUERY] ${processed}`;

    return Promise.resolve(processed);
  }

  private getCacheKey(request: EmbeddingRequest): string {
    // Create a consistent cache key
    const contentHash = this.simpleHash(request.content);
    return `${request.type}:${contentHash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  // Similarity computation utilities
  async computeSimilarity(
    embedding1: number[],
    embedding2: number[],
    method: 'cosine' | 'euclidean' | 'dot' = 'cosine'
  ): Promise<number> {
    switch (method) {
      case 'cosine':
        return this.cosineSimilarity(embedding1, embedding2);
      case 'euclidean':
        return this.euclideanSimilarity(embedding1, embedding2);
      case 'dot':
        return this.dotProductSimilarity(embedding1, embedding2);
      default:
        return this.cosineSimilarity(embedding1, embedding2);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    return dotProduct / (magnitudeA * magnitudeB);
  }

  private euclideanSimilarity(a: number[], b: number[]): number {
    const distance = Math.sqrt(
      a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0)
    );
    return 1 / (1 + distance); // Convert distance to similarity
  }

  private dotProductSimilarity(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  // Cache management
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.embeddingCache.size,
      keys: Array.from(this.embeddingCache.keys())
    };
  }

  clearCache(): void {
    this.embeddingCache.clear();
  }

  getModel(type: 'text' | 'code' | 'structured' | 'query'): string {
    return this.models[type];
  }

  setModel(type: 'text' | 'code' | 'structured' | 'query', model: string): void {
    this.models[type] = model;
  }

  // Advanced embedding utilities
  async findMostSimilar(
    queryEmbedding: number[],
    candidateEmbeddings: Array<{ embedding: number[]; metadata: any }>,
    topK: number = 5
  ): Promise<Array<{ similarity: number; metadata: any }>> {
    const similarities = await Promise.all(
      candidateEmbeddings.map(async candidate => ({
        similarity: await this.computeSimilarity(queryEmbedding, candidate.embedding),
        metadata: candidate.metadata
      }))
    );

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async clusterEmbeddings(
    embeddings: Array<{ embedding: number[]; metadata: any }>,
    clusters: number = 5
  ): Promise<Array<{ cluster: number; items: any[] }>> {
    // Simple k-means clustering implementation
    if (embeddings.length === 0 || clusters <= 0) return [];

    const dimensions = embeddings[0].embedding.length;

    // Initialize centroids randomly
    const centroids: number[][] = [];
    for (let i = 0; i < clusters; i++) {
      const centroid = new Array(dimensions).fill(0).map(() => Math.random());
      centroids.push(centroid);
    }

    // Perform clustering iterations
    const maxIterations = 10;
    for (let iter = 0; iter < maxIterations; iter++) {
      // Assign points to nearest centroid
      const assignments = await Promise.all(
        embeddings.map(async (item) => {
          let bestCluster = 0;
          let bestDistance = Infinity;

          for (let c = 0; c < clusters; c++) {
            const distance = 1 - await this.computeSimilarity(item.embedding, centroids[c]);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestCluster = c;
            }
          }

          return bestCluster;
        })
      );

      // Update centroids
      for (let c = 0; c < clusters; c++) {
        const clusterPoints = embeddings.filter((_, i) => assignments[i] === c);

        if (clusterPoints.length > 0) {
          for (let d = 0; d < dimensions; d++) {
            centroids[c][d] = clusterPoints.reduce(
              (sum, point) => sum + point.embedding[d], 0
            ) / clusterPoints.length;
          }
        }
      }
    }

    // Group results by cluster
    const results: Array<{ cluster: number; items: any[] }> = [];
    for (let c = 0; c < clusters; c++) {
      const items = embeddings
        .map((item, i) => ({ ...item.metadata, originalIndex: i }))
        .filter((_, i) => {
          // Re-assign to get final clustering
          let bestCluster = 0;
          let bestDistance = Infinity;

          for (let cluster = 0; cluster < clusters; cluster++) {
            const distance = 1 - this.cosineSimilarity(embeddings[i].embedding, centroids[cluster]);
            if (distance < bestDistance) {
              bestDistance = distance;
              bestCluster = cluster;
            }
          }

          return bestCluster === c;
        });

      results.push({ cluster: c, items });
    }

    return results;
  }
}