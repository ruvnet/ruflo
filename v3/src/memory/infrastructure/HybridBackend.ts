/**
 * HybridBackend
 *
 * Combines SQLite for structured queries with AgentDB for vector search.
 * Per ADR-009: Hybrid Memory Backend Default.
 */

import type {
  Memory,
  MemoryBackend,
  MemoryQuery,
  MemorySearchResult
} from '../../shared/types';
import { SQLiteBackend } from './SQLiteBackend';
import { AgentDBBackend } from './AgentDBBackend';

export class HybridBackend implements MemoryBackend {
  private sqliteBackend: SQLiteBackend;
  private agentDbBackend: AgentDBBackend;
  private initialized: boolean = false;

  constructor(sqliteBackend: SQLiteBackend, agentDbBackend: AgentDBBackend) {
    this.sqliteBackend = sqliteBackend;
    this.agentDbBackend = agentDbBackend;
  }

  /**
   * Initialize both backends
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await Promise.all([
      this.sqliteBackend.initialize(),
      this.agentDbBackend.initialize()
    ]);

    this.initialized = true;
  }

  /**
   * Close both backends
   */
  async close(): Promise<void> {
    await Promise.all([
      this.sqliteBackend.close(),
      this.agentDbBackend.close()
    ]);
    this.initialized = false;
  }

  /**
   * Store memory in both backends
   */
  async store(memory: Memory): Promise<Memory> {
    // Store in SQLite for structured queries
    await this.sqliteBackend.store(memory);

    // Store in AgentDB if has embedding
    if (memory.embedding && memory.embedding.length > 0) {
      await this.agentDbBackend.store(memory);
    }

    return memory;
  }

  /**
   * Retrieve memory by ID (from SQLite primary)
   */
  async retrieve(id: string): Promise<Memory | undefined> {
    return this.sqliteBackend.retrieve(id);
  }

  /**
   * Update memory in both backends
   */
  async update(memory: Memory): Promise<void> {
    await this.sqliteBackend.update(memory);

    if (memory.embedding && memory.embedding.length > 0) {
      await this.agentDbBackend.update(memory);
    }
  }

  /**
   * Delete memory from both backends
   */
  async delete(id: string): Promise<void> {
    await Promise.all([
      this.sqliteBackend.delete(id),
      this.agentDbBackend.delete(id)
    ]);
  }

  /**
   * Query memories using SQLite
   */
  async query(query: MemoryQuery): Promise<Memory[]> {
    return this.sqliteBackend.query(query);
  }

  /**
   * Vector search using AgentDB (150x-12,500x faster with HNSW)
   */
  async vectorSearch(embedding: number[], k: number = 10): Promise<MemorySearchResult[]> {
    return this.agentDbBackend.vectorSearch(embedding, k);
  }

  /**
   * Clear all memories for an agent
   */
  async clearAgent(agentId: string): Promise<void> {
    await Promise.all([
      this.sqliteBackend.clearAgent(agentId),
      this.agentDbBackend.clearAgent(agentId)
    ]);
  }

  /**
   * Hybrid search: combine SQL filtering with vector similarity
   */
  async hybridSearch(
    query: MemoryQuery,
    embedding?: number[],
    k: number = 10
  ): Promise<MemorySearchResult[]> {
    if (!embedding) {
      // No embedding, fall back to SQL query
      const results = await this.query(query);
      return results.map(m => ({ ...m, similarity: 1.0 }));
    }

    // Get vector search results
    const vectorResults = await this.vectorSearch(embedding, k * 2);

    // Filter by query criteria
    let filtered = vectorResults;

    if (query.agentId) {
      filtered = filtered.filter(m => m.agentId === query.agentId);
    }
    if (query.type) {
      filtered = filtered.filter(m => m.type === query.type);
    }
    if (query.timeRange) {
      filtered = filtered.filter(
        m => m.timestamp >= query.timeRange!.start && m.timestamp <= query.timeRange!.end
      );
    }
    if (query.metadata) {
      filtered = filtered.filter(m => {
        if (!m.metadata) return false;
        return Object.entries(query.metadata!).every(
          ([key, value]) => m.metadata![key] === value
        );
      });
    }

    return filtered.slice(0, k);
  }

  /**
   * Get backend statistics
   */
  getStats(): { sqlite: number; agentdb: number } {
    return {
      sqlite: this.sqliteBackend.getCount(),
      agentdb: 0 // AgentDB doesn't expose count directly
    };
  }
}

export { HybridBackend as default };
