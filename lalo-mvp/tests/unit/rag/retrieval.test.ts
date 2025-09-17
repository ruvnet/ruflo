/**
 * RAG (Retrieval-Augmented Generation) Unit Tests
 * Tests for document retrieval, embedding, and relevance scoring
 */

import { RAGEngine, VectorStore, DocumentEmbedder, RetrievalPipeline } from '../../../src/rag';

describe('RAG Retrieval Engine', () => {
  let ragEngine: RAGEngine;
  let mockVectorStore: jest.Mocked<VectorStore>;
  let mockEmbedder: jest.Mocked<DocumentEmbedder>;
  let pipeline: RetrievalPipeline;

  beforeEach(() => {
    mockVectorStore = {
      store: jest.fn(),
      search: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      getStats: jest.fn(),
      optimize: jest.fn()
    } as any;

    mockEmbedder = {
      embed: jest.fn(),
      embedBatch: jest.fn(),
      getEmbeddingDimension: jest.fn().mockReturnValue(768)
    } as any;

    ragEngine = new RAGEngine({
      vectorStore: mockVectorStore,
      embedder: mockEmbedder,
      maxResults: 10,
      minSimilarityScore: 0.7
    });

    pipeline = new RetrievalPipeline({
      preprocessors: ['tokenize', 'clean'],
      retrievers: ['vector', 'keyword'],
      rankers: ['similarity', 'relevance'],
      postprocessors: ['deduplicate', 'format']
    });
  });

  describe('Document Embedding', () => {
    test('should embed documents correctly', async () => {
      const document = global.testUtils.generateTestData('document');
      const mockEmbedding = Array(768).fill(0).map(() => Math.random());

      mockEmbedder.embed.mockResolvedValue(mockEmbedding);

      const embedding = await ragEngine.embedDocument(document);

      expect(mockEmbedder.embed).toHaveBeenCalledWith(document.content);
      expect(embedding).toEqual(mockEmbedding);
      expect(embedding).toHaveLength(768);
    });

    test('should handle batch embedding efficiently', async () => {
      const documents = global.testUtils.generateTestData('document', 5);
      const mockEmbeddings = documents.map(() =>
        Array(768).fill(0).map(() => Math.random())
      );

      mockEmbedder.embedBatch.mockResolvedValue(mockEmbeddings);

      const embeddings = await ragEngine.embedDocuments(documents);

      expect(mockEmbedder.embedBatch).toHaveBeenCalledWith(
        documents.map(d => d.content)
      );
      expect(embeddings).toHaveLength(5);
      expect(embeddings[0]).toHaveLength(768);
    });

    test('should handle embedding errors gracefully', async () => {
      const document = global.testUtils.generateTestData('document');

      mockEmbedder.embed.mockRejectedValue(new Error('Embedding service unavailable'));

      await expect(ragEngine.embedDocument(document))
        .rejects.toThrow('Embedding service unavailable');
    });

    test('should normalize embeddings', async () => {
      const document = global.testUtils.generateTestData('document');
      const unnormalizedEmbedding = [3, 4, 0]; // magnitude = 5

      mockEmbedder.embed.mockResolvedValue(unnormalizedEmbedding);

      const embedding = await ragEngine.embedDocument(document, { normalize: true });

      // Check if normalized (magnitude should be 1)
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      expect(magnitude).toBeCloseTo(1, 5);
    });
  });

  describe('Vector Storage', () => {
    test('should store documents in vector store', async () => {
      const document = global.testUtils.generateTestData('document');
      const embedding = Array(768).fill(0).map(() => Math.random());

      mockEmbedder.embed.mockResolvedValue(embedding);
      mockVectorStore.store.mockResolvedValue({ success: true, id: document.id });

      const result = await ragEngine.storeDocument(document);

      expect(mockVectorStore.store).toHaveBeenCalledWith({
        id: document.id,
        embedding,
        metadata: document.metadata,
        content: document.content
      });
      expect(result.success).toBe(true);
    });

    test('should update existing documents', async () => {
      const document = global.testUtils.generateTestData('document');
      const newEmbedding = Array(768).fill(0).map(() => Math.random());

      mockEmbedder.embed.mockResolvedValue(newEmbedding);
      mockVectorStore.update.mockResolvedValue({ success: true });

      const result = await ragEngine.updateDocument(document.id, document);

      expect(mockVectorStore.update).toHaveBeenCalledWith(document.id, {
        embedding: newEmbedding,
        metadata: document.metadata,
        content: document.content
      });
      expect(result.success).toBe(true);
    });

    test('should delete documents from store', async () => {
      const documentId = 'doc-123';

      mockVectorStore.delete.mockResolvedValue({ success: true });

      const result = await ragEngine.deleteDocument(documentId);

      expect(mockVectorStore.delete).toHaveBeenCalledWith(documentId);
      expect(result.success).toBe(true);
    });
  });

  describe('Document Retrieval', () => {
    test('should retrieve relevant documents', async () => {
      const query = 'machine learning algorithms';
      const queryEmbedding = Array(768).fill(0).map(() => Math.random());

      const mockResults = [
        {
          id: 'doc-1',
          content: 'Machine learning algorithms overview',
          score: 0.95,
          metadata: { type: 'article', author: 'AI Expert' }
        },
        {
          id: 'doc-2',
          content: 'Deep learning neural networks',
          score: 0.87,
          metadata: { type: 'research', year: 2023 }
        }
      ];

      mockEmbedder.embed.mockResolvedValue(queryEmbedding);
      mockVectorStore.search.mockResolvedValue(mockResults);

      const results = await ragEngine.retrieve(query);

      expect(mockEmbedder.embed).toHaveBeenCalledWith(query);
      expect(mockVectorStore.search).toHaveBeenCalledWith(
        queryEmbedding,
        expect.objectContaining({
          limit: 10,
          minScore: 0.7
        })
      );
      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.95);
    });

    test('should filter results by metadata', async () => {
      const query = 'data analysis';
      const filters = { type: 'article', year: { gte: 2020 } };

      const mockResults = [
        {
          id: 'doc-1',
          content: 'Data analysis techniques',
          score: 0.90,
          metadata: { type: 'article', year: 2022 }
        }
      ];

      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockResolvedValue(mockResults);

      const results = await ragEngine.retrieve(query, { filters });

      expect(mockVectorStore.search).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ filters })
      );
      expect(results[0].metadata.year).toBeGreaterThanOrEqual(2020);
    });

    test('should handle empty retrieval results', async () => {
      const query = 'nonexistent topic';

      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockResolvedValue([]);

      const results = await ragEngine.retrieve(query);

      expect(results).toHaveLength(0);
    });

    test('should apply similarity threshold filtering', async () => {
      const query = 'test query';
      const mockResults = [
        { id: 'doc-1', content: 'Relevant content', score: 0.85 },
        { id: 'doc-2', content: 'Less relevant', score: 0.65 }, // Below threshold
        { id: 'doc-3', content: 'Very relevant', score: 0.92 }
      ];

      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockResolvedValue(mockResults);

      const results = await ragEngine.retrieve(query);

      // Should filter out doc-2 (score < 0.7)
      expect(results).toHaveLength(2);
      expect(results.every(r => r.score >= 0.7)).toBe(true);
    });
  });

  describe('Retrieval Pipeline', () => {
    test('should process queries through pipeline stages', async () => {
      const query = 'What are the benefits of neural networks?';

      const preprocessSpy = jest.spyOn(pipeline, 'preprocess');
      const retrieveSpy = jest.spyOn(pipeline, 'retrieve');
      const rankSpy = jest.spyOn(pipeline, 'rank');
      const postprocessSpy = jest.spyOn(pipeline, 'postprocess');

      preprocessSpy.mockResolvedValue({ tokens: ['benefits', 'neural', 'networks'] });
      retrieveSpy.mockResolvedValue([
        { id: 'doc-1', content: 'Neural networks benefits', score: 0.9 },
        { id: 'doc-2', content: 'Machine learning overview', score: 0.8 }
      ]);
      rankSpy.mockResolvedValue([
        { id: 'doc-1', content: 'Neural networks benefits', score: 0.95 },
        { id: 'doc-2', content: 'Machine learning overview', score: 0.82 }
      ]);
      postprocessSpy.mockResolvedValue([
        { id: 'doc-1', content: 'Neural networks benefits', score: 0.95, formatted: true }
      ]);

      const results = await pipeline.process(query);

      expect(preprocessSpy).toHaveBeenCalledWith(query);
      expect(retrieveSpy).toHaveBeenCalled();
      expect(rankSpy).toHaveBeenCalled();
      expect(postprocessSpy).toHaveBeenCalled();
      expect(results[0].formatted).toBe(true);
    });

    test('should handle multi-stage retrieval', async () => {
      const query = 'database optimization techniques';

      // Mock vector retrieval
      const vectorResults = [
        { id: 'doc-1', content: 'Database indexing', score: 0.9, source: 'vector' }
      ];

      // Mock keyword retrieval
      const keywordResults = [
        { id: 'doc-2', content: 'Query optimization', score: 0.8, source: 'keyword' }
      ];

      jest.spyOn(pipeline, 'vectorRetrieve').mockResolvedValue(vectorResults);
      jest.spyOn(pipeline, 'keywordRetrieve').mockResolvedValue(keywordResults);

      const results = await pipeline.multiStageRetrieve(query);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.source === 'vector')).toBeDefined();
      expect(results.find(r => r.source === 'keyword')).toBeDefined();
    });

    test('should deduplicate results', async () => {
      const duplicateResults = [
        { id: 'doc-1', content: 'Same content', score: 0.9 },
        { id: 'doc-1', content: 'Same content', score: 0.85 }, // Duplicate
        { id: 'doc-2', content: 'Different content', score: 0.8 }
      ];

      const deduplicated = pipeline.deduplicate(duplicateResults);

      expect(deduplicated).toHaveLength(2);
      expect(deduplicated[0].score).toBe(0.9); // Higher score kept
    });
  });

  describe('Relevance Scoring', () => {
    test('should calculate semantic similarity scores', () => {
      const queryEmbedding = [1, 0, 0];
      const docEmbedding = [0.8, 0.6, 0]; // 45-degree angle

      const similarity = ragEngine.calculateSimilarity(queryEmbedding, docEmbedding);

      // Cosine similarity for 45-degree angle ≈ 0.707
      expect(similarity).toBeCloseTo(0.707, 2);
    });

    test('should apply relevance boosting based on metadata', () => {
      const baseScore = 0.8;
      const metadata = {
        type: 'research',
        recency: 0.9, // Recent document
        authority: 0.95 // High authority source
      };

      const boostedScore = ragEngine.applyRelevanceBoost(baseScore, metadata);

      expect(boostedScore).toBeGreaterThan(baseScore);
      expect(boostedScore).toBeLessThanOrEqual(1.0);
    });

    test('should handle contextual relevance scoring', async () => {
      const query = 'machine learning in healthcare';
      const context = {
        domain: 'healthcare',
        userRole: 'researcher',
        previousQueries: ['medical AI', 'patient diagnosis']
      };

      const documents = [
        { id: 'doc-1', content: 'ML in medical diagnosis', metadata: { domain: 'healthcare' } },
        { id: 'doc-2', content: 'ML in finance', metadata: { domain: 'finance' } }
      ];

      const scores = await ragEngine.scoreWithContext(query, documents, context);

      // Healthcare document should score higher due to domain match
      expect(scores[0]).toBeGreaterThan(scores[1]);
    });
  });

  describe('Performance Optimization', () => {
    test('should implement caching for frequent queries', async () => {
      const query = 'popular query';
      const cachedResults = [
        { id: 'doc-1', content: 'Cached result', score: 0.9 }
      ];

      // First call - cache miss
      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockResolvedValue(cachedResults);

      const results1 = await ragEngine.retrieve(query);

      // Second call - should use cache
      const results2 = await ragEngine.retrieve(query);

      expect(mockEmbedder.embed).toHaveBeenCalledTimes(1); // Only called once
      expect(results1).toEqual(results2);
    });

    test('should handle batch retrieval efficiently', async () => {
      const queries = ['query 1', 'query 2', 'query 3'];
      const mockEmbeddings = queries.map(() => Array(768).fill(0).map(() => Math.random()));

      mockEmbedder.embedBatch.mockResolvedValue(mockEmbeddings);
      mockVectorStore.search.mockImplementation(() =>
        Promise.resolve([{ id: 'doc-1', content: 'result', score: 0.8 }])
      );

      const results = await ragEngine.retrieveBatch(queries);

      expect(mockEmbedder.embedBatch).toHaveBeenCalledWith(queries);
      expect(results).toHaveLength(3);
    });

    test('should optimize vector store periodically', async () => {
      const optimizeSpy = jest.spyOn(mockVectorStore, 'optimize');

      await ragEngine.performMaintenance();

      expect(optimizeSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Resilience', () => {
    test('should handle vector store failures gracefully', async () => {
      const query = 'test query';

      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockRejectedValue(new Error('Vector store unavailable'));

      // Should fall back to alternative retrieval method
      const fallbackSpy = jest.spyOn(ragEngine, 'fallbackRetrieve');
      fallbackSpy.mockResolvedValue([
        { id: 'fallback-doc', content: 'Fallback result', score: 0.7 }
      ]);

      const results = await ragEngine.retrieve(query);

      expect(fallbackSpy).toHaveBeenCalled();
      expect(results[0].id).toBe('fallback-doc');
    });

    test('should validate document format before processing', async () => {
      const invalidDocument = {
        id: 'invalid',
        // Missing required fields
      };

      await expect(ragEngine.storeDocument(invalidDocument as any))
        .rejects.toThrow('Invalid document format');
    });

    test('should handle embedding dimension mismatches', async () => {
      const wrongDimensionEmbedding = Array(512).fill(0.1); // Wrong dimension

      mockEmbedder.embed.mockResolvedValue(wrongDimensionEmbedding);

      await expect(ragEngine.storeDocument(global.testUtils.generateTestData('document')))
        .rejects.toThrow('Embedding dimension mismatch');
    });
  });

  describe('Hive Mind Integration', () => {
    test('should share retrieval patterns with hive', async () => {
      const query = 'machine learning optimization';
      const results = [
        { id: 'doc-1', content: 'ML optimization techniques', score: 0.95 }
      ];

      mockEmbedder.embed.mockResolvedValue(Array(768).fill(0.1));
      mockVectorStore.search.mockResolvedValue(results);

      const shareSpy = jest.spyOn(ragEngine, 'shareRetrievalPattern');

      await ragEngine.retrieve(query);

      expect(shareSpy).toHaveBeenCalledWith({
        query,
        results: results.length,
        avgScore: 0.95,
        timestamp: expect.any(Date)
      });
    });

    test('should learn from collective retrieval feedback', async () => {
      const feedback = {
        query: 'database optimization',
        selectedDocuments: ['doc-1', 'doc-3'],
        rejectedDocuments: ['doc-2'],
        userSatisfaction: 0.8
      };

      await ragEngine.incorporateFeedback(feedback);

      const learningData = ragEngine.getLearningData();
      expect(learningData.queryPatterns).toContainEqual(
        expect.objectContaining({ query: 'database optimization' })
      );
    });

    test('should coordinate distributed retrieval across nodes', async () => {
      const distributedQuery = {
        query: 'comprehensive analysis topic',
        partitions: ['partition-1', 'partition-2', 'partition-3'],
        aggregationStrategy: 'merge_and_rank'
      };

      const coordinateSpy = jest.spyOn(ragEngine, 'coordinateDistributedRetrieval');
      coordinateSpy.mockResolvedValue({
        results: [
          { id: 'doc-1', content: 'Result from partition 1', score: 0.9 },
          { id: 'doc-2', content: 'Result from partition 2', score: 0.85 }
        ],
        nodeContributions: {
          'node-1': 5,
          'node-2': 3,
          'node-3': 4
        }
      });

      const results = await ragEngine.distributedRetrieve(distributedQuery);

      expect(coordinateSpy).toHaveBeenCalledWith(distributedQuery);
      expect(results.results).toHaveLength(2);
      expect(results.nodeContributions).toBeDefined();
    });
  });
});