import { ChromaApi, OpenAIEmbeddingFunction } from 'chromadb';
import { OpenAI } from 'openai';
import { Document, SearchResult, RAGQuery, RAGConfig, RAGError } from '../types/index.js';
import { getConfig } from '../config/index.js';
import { DocumentIngestionPipeline } from './ingestion/pipeline.js';
import { SemanticChunker } from './chunking/semantic-chunker.js';
import { MultiModalEmbedding } from './embeddings/multi-modal.js';
import { RAGCache } from './cache/rag-cache.js';
import { IntegrationHooks } from './hooks/integration-hooks.js';
import { promises as fs } from 'fs';
import { URL } from 'url';

export interface EmbeddingFunction {
  generate(texts: string[]): Promise<number[][]>;
}

export interface DocumentSource {
  type: 'file' | 'url' | 'api' | 'text';
  path?: string;
  url?: string;
  content?: string;
  metadata?: Record<string, any>;
}

export interface ChunkingStrategy {
  name: 'sentence' | 'semantic' | 'recursive' | 'code';
  options?: Record<string, any>;
}

export interface RAGStats {
  totalDocuments: number;
  totalChunks: number;
  averageChunkSize: number;
  collections: string[];
  cacheStats: {
    hits: number;
    misses: number;
    size: number;
  };
  embeddingStats: {
    totalEmbeddings: number;
    averageLatency: number;
  };
}

export class RAGSystem {
  private config: RAGConfig;
  private chroma: ChromaApi;
  private openai: OpenAI;
  private embeddingFunction: EmbeddingFunction;
  private collectionName = 'lalo_documents';
  private documents = new Map<string, Document>();
  private ingestionPipeline: DocumentIngestionPipeline;
  private semanticChunker: SemanticChunker;
  private multiModalEmbedding: MultiModalEmbedding;
  private cache: RAGCache;
  private hooks: IntegrationHooks;
  private stats = {
    embeddingLatencies: [] as number[],
    totalEmbeddings: 0
  };

  constructor(config?: Partial<RAGConfig>) {
    this.config = { ...getConfig().rag, ...config };
    this.initializeClients();
    this.initializeComponents();
  }

  private initializeClients(): void {
    // Initialize OpenAI
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Chroma
    this.chroma = new ChromaApi({
      path: process.env.CHROMA_URL || 'http://localhost:8000',
    });

    // Initialize embedding function
    this.embeddingFunction = new OpenAIEmbeddingFunction({
      openai_api_key: process.env.OPENAI_API_KEY!,
      openai_model: this.config.embeddingModel,
    });

    this.setupCollection();
  }

  private initializeComponents(): void {
    // Initialize new components
    this.ingestionPipeline = new DocumentIngestionPipeline();
    this.semanticChunker = new SemanticChunker(this.openai, this.config.embeddingModel);
    this.multiModalEmbedding = new MultiModalEmbedding(this.openai);
    this.cache = new RAGCache({
      defaultTTL: 60 * 60 * 1000, // 1 hour
      maxCacheSize: 1000
    });
    this.hooks = new IntegrationHooks();

    // Setup default integrations
    this.setupDefaultIntegrations();
  }

  private setupDefaultIntegrations(): void {
    this.hooks.setupWorkflowIntegration();
    this.hooks.setupGovernanceIntegration();
    this.hooks.setupNL2SQLIntegration();
    this.hooks.setupMCPIntegration();
  }

  private async setupCollection(): Promise<void> {
    try {
      await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });
    } catch (error) {
      // Collection doesn't exist, create it
      await this.chroma.createCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
        metadata: {
          description: 'LALO document collection',
          created: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Add a document to the RAG system
   */
  async addDocument(
    content: string,
    metadata?: Record<string, any>,
    source?: string
  ): Promise<string> {
    try {
      const context = {
        operation: 'ingest' as const,
        timestamp: new Date(),
        metadata: { source, ...metadata }
      };

      // Execute pre-ingest hooks
      const processedData = await this.hooks.executePreIngestHooks(
        { content, metadata: metadata || {} },
        context
      );

      const documentId = this.generateDocumentId();

      // Use semantic chunker for better chunking
      const documentType = this.detectDocumentType(processedData.content, source);
      const chunkResults = await this.semanticChunker.chunkDocument(
        processedData.content,
        {
          maxChunkSize: this.config.chunkSize,
          overlap: this.config.chunkOverlap,
          preserveStructure: true,
          semanticBoundaries: true
        },
        documentType
      );

      const document: Document = {
        id: documentId,
        content: processedData.content,
        metadata: processedData.metadata,
        source,
        createdAt: new Date(),
      };

      // Store document metadata
      this.documents.set(documentId, document);

      // Get collection
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });

      // Generate embeddings using multi-modal embedding
      const embeddingRequests = chunkResults.map(chunk => ({
        content: chunk.content,
        type: this.mapDocumentTypeToEmbeddingType(documentType),
        metadata: { documentId, chunkIndex: chunk.startIndex }
      }));

      const embeddingResults = await this.multiModalEmbedding.generateBatchEmbeddings(embeddingRequests);

      // Add chunks to vector store
      const chunkIds = chunkResults.map((_, index) => `${documentId}_chunk_${index}`);
      const chunkMetadata = chunkResults.map((chunk, index) => ({
        documentId,
        chunkIndex: index,
        source,
        chunkContent: chunk.content,
        chunkType: chunk.metadata.type,
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        embeddingType: embeddingResults[index].type,
        ...processedData.metadata,
        ...chunk.metadata
      }));

      await collection.add({
        ids: chunkIds,
        documents: chunkResults.map(chunk => chunk.content),
        metadatas: chunkMetadata,
      });

      // Execute post-ingest hooks
      const finalDocument = await this.hooks.executePostIngestHooks(document, context);

      // Update stored document with any hook modifications
      this.documents.set(documentId, finalDocument);

      // Cache the document
      await this.cache.setDocument(documentId, finalDocument);

      return documentId;
    } catch (error) {
      throw new RAGError(`Failed to add document: ${error.message}`, { error });
    }
  }

  /**
   * Search for documents using semantic similarity
   */
  async search(query: RAGQuery, contextData?: Record<string, any>): Promise<SearchResult[]> {
    try {
      const context = {
        operation: 'search' as const,
        timestamp: new Date(),
        metadata: contextData
      };

      // Check cache first
      const cachedResults = await this.cache.getSearchResults(query);
      if (cachedResults) {
        return cachedResults;
      }

      // Execute pre-search hooks
      const enhancedQuery = await this.hooks.executePreSearchHooks(query, context);

      // Inject additional context
      const injectedContext = await this.hooks.injectContext(enhancedQuery);

      // Generate embedding for the query
      const queryEmbedding = await this.multiModalEmbedding.generateEmbedding({
        content: enhancedQuery.query,
        type: 'query',
        metadata: injectedContext
      });

      const collection = await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });

      const results = await collection.query({
        queryTexts: [enhancedQuery.query],
        nResults: (enhancedQuery.topK || this.config.topK) * 2, // Get more results for reranking
        where: enhancedQuery.filters,
      });

      if (!results.ids || !results.ids[0] || !results.documents || !results.distances) {
        return [];
      }

      const searchResults: SearchResult[] = [];

      for (let i = 0; i < results.ids[0].length; i++) {
        const chunkId = results.ids[0][i];
        const content = results.documents[0]?.[i];
        const distance = results.distances[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i];

        if (!content || distance === undefined) continue;

        // Calculate enhanced similarity score
        const baseScore = 1 / (1 + distance);
        const enhancedScore = await this.calculateEnhancedRelevanceScore(
          queryEmbedding.embedding,
          content,
          metadata,
          injectedContext
        );

        const finalScore = (baseScore + enhancedScore) / 2;

        // Apply threshold if specified
        if (enhancedQuery.threshold && finalScore < enhancedQuery.threshold) continue;

        // Get document from cache or memory
        const documentId = metadata?.documentId || chunkId.split('_chunk_')[0];
        let document = await this.cache.getDocument(documentId);

        if (!document) {
          document = this.documents.get(documentId);
          if (document) {
            await this.cache.setDocument(documentId, document);
          }
        }

        if (document) {
          searchResults.push({
            document: {
              ...document,
              content, // Use chunk content for the result
            },
            score: finalScore,
            relevance: finalScore,
          });
        }
      }

      // Sort by score and apply topK limit
      const sortedResults = searchResults
        .sort((a, b) => b.score - a.score)
        .slice(0, enhancedQuery.topK || this.config.topK);

      // Execute post-search hooks
      const finalResults = await this.hooks.executePostSearchHooks(sortedResults, context);

      // Cache the results
      await this.cache.setSearchResults(query, finalResults);

      // Update statistics
      this.updateSearchStats(queryEmbedding.latency);

      return finalResults;
    } catch (error) {
      throw new RAGError(`Search failed: ${error.message}`, { query, error });
    }
  }

  /**
   * Update document content
   */
  async updateDocument(
    documentId: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const document = this.documents.get(documentId);
      if (!document) {
        throw new RAGError(`Document not found: ${documentId}`);
      }

      // Remove old chunks
      await this.removeDocument(documentId);

      // Add updated document
      const updatedMetadata = { ...document.metadata, ...metadata };
      await this.addDocument(content, updatedMetadata, document.source);

      // Update document record
      this.documents.set(documentId, {
        ...document,
        content,
        metadata: updatedMetadata,
      });
    } catch (error) {
      throw new RAGError(`Failed to update document: ${error.message}`, { documentId, error });
    }
  }

  /**
   * Remove a document from the RAG system
   */
  async removeDocument(documentId: string): Promise<void> {
    try {
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });

      // Find all chunks for this document
      const results = await collection.get({
        where: { documentId },
      });

      if (results.ids && results.ids.length > 0) {
        await collection.delete({
          ids: results.ids,
        });
      }

      this.documents.delete(documentId);
    } catch (error) {
      throw new RAGError(`Failed to remove document: ${error.message}`, { documentId, error });
    }
  }

  /**
   * Get document by ID
   */
  getDocument(documentId: string): Document | undefined {
    return this.documents.get(documentId);
  }

  /**
   * List all documents
   */
  listDocuments(filter?: {
    source?: string;
    metadata?: Record<string, any>;
  }): Document[] {
    let documents = Array.from(this.documents.values());

    if (filter) {
      if (filter.source) {
        documents = documents.filter(doc => doc.source === filter.source);
      }
      if (filter.metadata) {
        documents = documents.filter(doc => {
          return Object.entries(filter.metadata!).every(
            ([key, value]) => doc.metadata[key] === value
          );
        });
      }
    }

    return documents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Chunk document into smaller pieces (legacy method, now uses SemanticChunker)
   */
  private async chunkDocument(content: string, documentType: string = 'text'): Promise<string[]> {
    const chunkResults = await this.semanticChunker.chunkDocument(
      content,
      {
        maxChunkSize: this.config.chunkSize,
        overlap: this.config.chunkOverlap,
        preserveStructure: true,
        semanticBoundaries: true
      },
      documentType
    );

    return chunkResults.map(chunk => chunk.content);
  }

  /**
   * Get overlap text from the end of a chunk
   */
  private getOverlapText(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return text;

    const overlap = text.slice(-overlapSize);
    // Try to break at word boundary
    const lastSpace = overlap.lastIndexOf(' ');
    return lastSpace > 0 ? overlap.slice(lastSpace + 1) : overlap;
  }

  /**
   * Generate embeddings for text (enhanced with multi-modal support)
   */
  async generateEmbeddings(
    texts: string[],
    type: 'text' | 'code' | 'structured' | 'query' = 'text'
  ): Promise<number[][]> {
    try {
      const requests = texts.map(text => ({
        content: text,
        type,
        metadata: {}
      }));

      const results = await this.multiModalEmbedding.generateBatchEmbeddings(requests);

      // Update statistics
      this.stats.totalEmbeddings += results.length;
      const totalLatency = results.reduce((sum, result) => sum + result.latency, 0);
      this.stats.embeddingLatencies.push(totalLatency / results.length);

      return results.map(result => result.embedding);
    } catch (error) {
      throw new RAGError(`Failed to generate embeddings: ${error.message}`, { error });
    }
  }

  /**
   * Get system statistics
   */
  async getStats(): Promise<RAGStats> {
    try {
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });

      const count = await collection.count();
      const totalDocuments = this.documents.size;

      // Calculate average chunk size
      const allContent = Array.from(this.documents.values()).map(doc => doc.content);
      const totalContentLength = allContent.reduce((sum, content) => sum + content.length, 0);
      const averageChunkSize = totalDocuments > 0 ? totalContentLength / totalDocuments : 0;

      // Get cache statistics
      const cacheStats = this.cache.getStats();

      // Calculate embedding statistics
      const averageLatency = this.stats.embeddingLatencies.length > 0
        ? this.stats.embeddingLatencies.reduce((a, b) => a + b, 0) / this.stats.embeddingLatencies.length
        : 0;

      return {
        totalDocuments,
        totalChunks: count,
        averageChunkSize: Math.round(averageChunkSize),
        collections: [this.collectionName],
        cacheStats: {
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          size: cacheStats.size
        },
        embeddingStats: {
          totalEmbeddings: this.stats.totalEmbeddings,
          averageLatency: Math.round(averageLatency)
        }
      };
    } catch (error) {
      throw new RAGError(`Failed to get stats: ${error.message}`, { error });
    }
  }

  /**
   * Clear all documents
   */
  async clearDocuments(): Promise<void> {
    try {
      await this.chroma.deleteCollection({ name: this.collectionName });
      await this.setupCollection();
      this.documents.clear();
    } catch (error) {
      throw new RAGError(`Failed to clear documents: ${error.message}`, { error });
    }
  }

  /**
   * Generate unique document ID
   */
  private generateDocumentId(): string {
    return `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  // Advanced RAG methods

  /**
   * Ingest documents from various sources
   */
  async ingestFromSource(source: DocumentSource): Promise<string> {
    try {
      const { content, metadata } = await this.ingestionPipeline.ingestDocument(source);
      return this.addDocument(content, metadata, source.type);
    } catch (error) {
      throw new RAGError(`Failed to ingest from source: ${error.message}`, { source, error });
    }
  }

  /**
   * Batch ingest multiple sources
   */
  async ingestBatch(sources: DocumentSource[]): Promise<{ documentId: string; success: boolean; error?: string }[]> {
    const results = await Promise.allSettled(
      sources.map(source => this.ingestFromSource(source))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return {
          documentId: result.value,
          success: true
        };
      } else {
        return {
          documentId: `failed-${index}`,
          success: false,
          error: result.reason.message
        };
      }
    });
  }

  /**
   * Advanced search with multiple strategies
   */
  async advancedSearch(options: {
    query: string;
    strategy?: 'semantic' | 'hybrid' | 'keyword';
    filters?: Record<string, any>;
    topK?: number;
    rerankResults?: boolean;
    includeContext?: boolean;
  }): Promise<SearchResult[]> {
    const { query, strategy = 'semantic', filters, topK, rerankResults = true, includeContext = true } = options;

    const ragQuery: RAGQuery = {
      query,
      filters,
      topK: rerankResults ? (topK || this.config.topK) * 2 : topK
    };

    let results = await this.search(ragQuery);

    if (strategy === 'hybrid') {
      // Combine semantic and keyword search
      const keywordResults = await this.keywordSearch(query, filters, topK);
      results = this.mergeSearchResults(results, keywordResults);
    }

    if (rerankResults) {
      results = await this.rerankResults(query, results);
      results = results.slice(0, topK || this.config.topK);
    }

    if (includeContext) {
      results = await this.enrichResultsWithContext(results);
    }

    return results;
  }

  /**
   * Similarity search using pre-computed embeddings
   */
  async similaritySearch(
    embedding: number[],
    topK: number = this.config.topK,
    filters?: Record<string, any>
  ): Promise<SearchResult[]> {
    try {
      const collection = await this.chroma.getCollection({
        name: this.collectionName,
        embeddingFunction: this.embeddingFunction,
      });

      const results = await collection.query({
        queryEmbeddings: [embedding],
        nResults: topK,
        where: filters,
      });

      if (!results.ids || !results.ids[0] || !results.documents || !results.distances) {
        return [];
      }

      const searchResults: SearchResult[] = [];

      for (let i = 0; i < results.ids[0].length; i++) {
        const chunkId = results.ids[0][i];
        const content = results.documents[0]?.[i];
        const distance = results.distances[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i];

        if (!content || distance === undefined) continue;

        const score = 1 / (1 + distance);
        const documentId = metadata?.documentId || chunkId.split('_chunk_')[0];
        const document = this.documents.get(documentId);

        if (document) {
          searchResults.push({
            document: {
              ...document,
              content,
            },
            score,
            relevance: score,
          });
        }
      }

      return searchResults.sort((a, b) => b.score - a.score);
    } catch (error) {
      throw new RAGError(`Similarity search failed: ${error.message}`, { error });
    }
  }

  /**
   * Get related documents based on document similarity
   */
  async getRelatedDocuments(
    documentId: string,
    topK: number = 5
  ): Promise<SearchResult[]> {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new RAGError(`Document not found: ${documentId}`);
    }

    // Generate embedding for the document
    const embedding = await this.multiModalEmbedding.generateEmbedding({
      content: document.content,
      type: 'text',
      metadata: document.metadata
    });

    // Find similar documents
    const results = await this.similaritySearch(
      embedding.embedding,
      topK + 1, // +1 to exclude the original document
      { documentId: { '$ne': documentId } } // Exclude the original document
    );

    return results.slice(0, topK);
  }

  // Integration-specific methods

  /**
   * Search with workflow context
   */
  async searchWithWorkflowContext(
    query: string,
    workflowContext: { workflowId: string; currentStep: string; variables: Record<string, any> }
  ): Promise<SearchResult[]> {
    return this.search(
      { query, filters: { category: 'workflow' } },
      { workflowContext }
    );
  }

  /**
   * Search governance knowledge base
   */
  async searchGovernance(
    query: string,
    governanceContext?: { proposalId?: string; permissions: string[] }
  ): Promise<SearchResult[]> {
    return this.search(
      { query, filters: { category: 'governance' } },
      { governanceContext }
    );
  }

  /**
   * Search SQL schema documentation
   */
  async searchSQLSchemas(query: string): Promise<SearchResult[]> {
    return this.search(
      { query, filters: { category: 'sql_schema' } },
      { isNL2SQL: true }
    );
  }

  // Helper methods

  private detectDocumentType(content: string, source?: string): string {
    if (source?.includes('sql') || content.includes('CREATE TABLE') || content.includes('SELECT')) {
      return 'sql';
    }
    if (source?.includes('json') || (content.trim().startsWith('{') || content.trim().startsWith('['))) {
      return 'json';
    }
    if (source?.includes('md') || content.includes('# ') || content.includes('## ')) {
      return 'markdown';
    }
    if (source?.includes('code') || content.includes('function ') || content.includes('class ')) {
      return 'code';
    }
    return 'text';
  }

  private mapDocumentTypeToEmbeddingType(documentType: string): 'text' | 'code' | 'structured' | 'query' {
    switch (documentType) {
      case 'code':
      case 'sql':
        return 'code';
      case 'json':
        return 'structured';
      default:
        return 'text';
    }
  }

  private async calculateEnhancedRelevanceScore(
    queryEmbedding: number[],
    content: string,
    metadata: any,
    context: Record<string, any>
  ): Promise<number> {
    let score = 0.5; // Base score

    // Boost score based on content type matching
    if (context.isNL2SQL && metadata.category === 'sql_schema') {
      score += 0.2;
    }

    if (context.workflowContext && metadata.workflowId === context.workflowContext.workflowId) {
      score += 0.15;
    }

    if (context.governanceContext && metadata.category === 'governance') {
      score += 0.1;
    }

    // Boost based on recency
    if (metadata.createdAt) {
      const daysSinceCreation = (Date.now() - new Date(metadata.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation < 7) {
        score += 0.05; // Boost recent documents
      }
    }

    return Math.min(score, 1);
  }

  private async keywordSearch(
    query: string,
    filters?: Record<string, any>,
    topK: number = this.config.topK
  ): Promise<SearchResult[]> {
    // Simple keyword search implementation
    const keywords = query.toLowerCase().split(/\s+/);
    const results: SearchResult[] = [];

    for (const [documentId, document] of this.documents) {
      const content = document.content.toLowerCase();
      let matches = 0;

      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          matches++;
        }
      }

      if (matches > 0) {
        const score = matches / keywords.length;
        results.push({
          document,
          score,
          relevance: score
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private mergeSearchResults(
    semanticResults: SearchResult[],
    keywordResults: SearchResult[]
  ): SearchResult[] {
    const merged = new Map<string, SearchResult>();

    // Add semantic results with higher weight
    semanticResults.forEach(result => {
      merged.set(result.document.id, {
        ...result,
        score: result.score * 0.7 // 70% weight for semantic
      });
    });

    // Add or merge keyword results
    keywordResults.forEach(result => {
      const existing = merged.get(result.document.id);
      if (existing) {
        // Combine scores
        existing.score = existing.score + (result.score * 0.3); // 30% weight for keyword
        existing.relevance = existing.score;
      } else {
        merged.set(result.document.id, {
          ...result,
          score: result.score * 0.3
        });
      }
    });

    return Array.from(merged.values()).sort((a, b) => b.score - a.score);
  }

  private async rerankResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    // Simple reranking based on query term frequency
    const queryTerms = query.toLowerCase().split(/\s+/);

    return results.map(result => {
      const content = result.document.content.toLowerCase();
      let termFrequency = 0;

      queryTerms.forEach(term => {
        const matches = (content.match(new RegExp(term, 'g')) || []).length;
        termFrequency += matches;
      });

      const rerankScore = result.score + (termFrequency * 0.01);

      return {
        ...result,
        score: Math.min(rerankScore, 1),
        relevance: Math.min(rerankScore, 1)
      };
    }).sort((a, b) => b.score - a.score);
  }

  private async enrichResultsWithContext(results: SearchResult[]): Promise<SearchResult[]> {
    return results.map(result => ({
      ...result,
      document: {
        ...result.document,
        metadata: {
          ...result.document.metadata,
          retrievalTimestamp: new Date().toISOString(),
          enriched: true
        }
      }
    }));
  }

  private updateSearchStats(latency: number): void {
    this.stats.embeddingLatencies.push(latency);

    // Keep only last 100 latencies to prevent memory bloat
    if (this.stats.embeddingLatencies.length > 100) {
      this.stats.embeddingLatencies = this.stats.embeddingLatencies.slice(-100);
    }
  }

  /**
   * Preload frequently accessed content
   */
  async preloadCache(queries: string[]): Promise<void> {
    const ragQueries = queries.map(query => ({ query }));
    await this.cache.preloadFrequentQueries(ragQueries);
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    this.cache.invalidateAll();
    this.multiModalEmbedding.clearCache();
  }

  /**
   * Get comprehensive system statistics
   */
  async getDetailedStats(): Promise<RAGStats & { hookStats: any; cacheDetails: any }> {
    const basicStats = await this.getStats();

    return {
      ...basicStats,
      hookStats: this.hooks.getHookCounts(),
      cacheDetails: {
        ...this.cache.getStats(),
        embeddingCache: this.multiModalEmbedding.getCacheStats()
      }
    };
  }
}

export default RAGSystem;