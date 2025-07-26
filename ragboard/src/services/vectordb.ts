import { ApiService } from './api';

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: {
    resourceId: string;
    title: string;
    type: string;
    chunk: string;
    chunkIndex: number;
  };
}

export interface EmbeddingResult {
  resourceId: string;
  chunks: {
    text: string;
    embedding: number[];
    metadata: any;
  }[];
}

export class VectorDBService {
  // Generate embeddings for a resource
  static async generateEmbeddings(resourceId: string, content: string): Promise<EmbeddingResult> {
    const response = await ApiService.apiClient.post('/embeddings/generate', {
      resource_id: resourceId,
      content,
    });
    return response.data;
  }

  // Store embeddings in vector database
  static async storeEmbeddings(embeddings: EmbeddingResult): Promise<void> {
    await ApiService.apiClient.post('/embeddings/store', embeddings);
  }

  // Search for similar content
  static async searchSimilar(
    query: string,
    boardId: string,
    topK: number = 5,
    filters?: {
      resourceTypes?: string[];
      resourceIds?: string[];
    }
  ): Promise<VectorSearchResult[]> {
    const response = await ApiService.apiClient.post('/embeddings/search', {
      query,
      board_id: boardId,
      top_k: topK,
      filters,
    });
    return response.data;
  }

  // Get relevant context for a conversation
  static async getConversationContext(
    chatId: string,
    query: string,
    connectedResourceIds: string[]
  ): Promise<{
    context: string;
    sources: VectorSearchResult[];
  }> {
    const response = await ApiService.apiClient.post('/embeddings/context', {
      chat_id: chatId,
      query,
      resource_ids: connectedResourceIds,
    });
    return response.data;
  }

  // Update embeddings for a resource
  static async updateEmbeddings(resourceId: string, content: string): Promise<void> {
    const embeddings = await this.generateEmbeddings(resourceId, content);
    await this.storeEmbeddings(embeddings);
  }

  // Delete embeddings for a resource
  static async deleteEmbeddings(resourceId: string): Promise<void> {
    await ApiService.apiClient.delete(`/embeddings/resource/${resourceId}`);
  }

  // Batch process multiple resources
  static async batchProcessResources(
    resources: Array<{ id: string; content: string }>
  ): Promise<void> {
    const response = await ApiService.apiClient.post('/embeddings/batch', {
      resources,
    });
    return response.data;
  }

  // Get embedding statistics
  static async getEmbeddingStats(boardId: string): Promise<{
    totalEmbeddings: number;
    totalResources: number;
    indexSize: string;
    lastUpdated: Date;
  }> {
    const response = await ApiService.apiClient.get(`/embeddings/stats/${boardId}`);
    return response.data;
  }
}

// Export singleton instance
export default VectorDBService;