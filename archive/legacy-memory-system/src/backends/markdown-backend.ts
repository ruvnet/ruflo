/**
 * SPARC Memory Bank - Markdown Backend
 * File-based storage using structured markdown files
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { MemoryItem, MemoryQuery, MemoryBackend, BackendStats } from '../types';

export interface MarkdownBackendConfig {
  rootPath: string;
  gitIntegration?: boolean;
  compression?: boolean;
  prettyPrint?: boolean;
}

export class MarkdownBackend implements MemoryBackend {
  private config: MarkdownBackendConfig;
  private indexPath: string;
  private index: Map<string, MemoryIndexEntry> = new Map();

  constructor(config: MarkdownBackendConfig) {
    this.config = config;
    this.indexPath = path.join(config.rootPath, '.memory-index.json');
  }

  async initialize(): Promise<void> {
    // Create root directory if it doesn't exist
    await fs.mkdir(this.config.rootPath, { recursive: true });

    // Create directory structure
    const dirs = [
      'agent-sessions',
      'shared-knowledge',
      'shared-knowledge/calibration-values',
      'shared-knowledge/test-patterns',
      'shared-knowledge/failure-analysis',
      'shared-knowledge/architectural-decisions',
      'shared-knowledge/code-patterns',
      'coordination',
      'project-memory',
      'github-integration'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(this.config.rootPath, dir), { recursive: true });
    }

    // Load index
    await this.loadIndex();
  }

  async store(item: MemoryItem): Promise<void> {
    const filePath = this.getFilePath(item);
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    // Prepare content
    const content = this.itemToMarkdown(item);

    // Write file
    await fs.writeFile(filePath, content, 'utf-8');

    // Update index
    this.updateIndex(item, filePath);
    await this.saveIndex();

    // Git integration
    if (this.config.gitIntegration) {
      await this.gitAdd(filePath);
    }
  }

  async get(category: string, key: string): Promise<MemoryItem | null> {
    const indexKey = `${category}:${key}`;
    const entry = this.index.get(indexKey);

    if (!entry) return null;

    try {
      const content = await fs.readFile(entry.path, 'utf-8');
      return this.markdownToItem(content, category, key);
    } catch (error) {
      // File might have been deleted
      this.index.delete(indexKey);
      return null;
    }
  }

  async query(query: MemoryQuery): Promise<MemoryItem[]> {
    const results: MemoryItem[] = [];

    for (const [key, entry] of this.index.entries()) {
      // Check if entry matches query criteria
      if (!this.matchesQuery(entry, query)) continue;

      try {
        const content = await fs.readFile(entry.path, 'utf-8');
        const item = this.markdownToItem(content, entry.category, entry.key);
        
        // Apply custom filter
        if (!query.filter || query.filter(item)) {
          results.push(item);
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    // Sort results
    if (query.orderBy) {
      results.sort((a, b) => {
        const aVal = this.getOrderValue(a, query.orderBy!);
        const bVal = this.getOrderValue(b, query.orderBy!);
        const direction = query.orderDirection === 'desc' ? -1 : 1;
        
        if (aVal < bVal) return -1 * direction;
        if (aVal > bVal) return 1 * direction;
        return 0;
      });
    }

    // Apply limit and offset
    const start = query.offset || 0;
    const end = query.limit ? start + query.limit : results.length;

    return results.slice(start, end);
  }

  async delete(category: string, key: string): Promise<boolean> {
    const indexKey = `${category}:${key}`;
    const entry = this.index.get(indexKey);

    if (!entry) return false;

    try {
      await fs.unlink(entry.path);
      this.index.delete(indexKey);
      await this.saveIndex();
      
      if (this.config.gitIntegration) {
        await this.gitRemove(entry.path);
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  async update(category: string, key: string, updates: Partial<MemoryItem>): Promise<boolean> {
    const existing = await this.get(category, key);
    if (!existing) return false;

    const merged = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        ...updates.metadata,
        updated_at: Date.now()
      }
    };

    await this.store(merged);
    return true;
  }

  async getStats(): Promise<BackendStats> {
    let totalItems = 0;
    let sizeBytes = 0;
    let oldestItem: number | undefined;
    let newestItem: number | undefined;
    const categories = new Set<string>();

    for (const entry of this.index.values()) {
      totalItems++;
      categories.add(entry.category);
      
      try {
        const stat = await fs.stat(entry.path);
        sizeBytes += stat.size;
        
        const timestamp = entry.metadata?.timestamp || stat.mtimeMs;
        if (!oldestItem || timestamp < oldestItem) oldestItem = timestamp;
        if (!newestItem || timestamp > newestItem) newestItem = timestamp;
      } catch (error) {
        // Skip files that can't be accessed
      }
    }

    return {
      totalItems,
      categories: categories.size,
      sizeBytes,
      oldestItem,
      newestItem
    };
  }

  async close(): Promise<void> {
    await this.saveIndex();
  }

  /**
   * Search through markdown files
   */
  async search(searchTerm: string, options?: {
    categories?: string[];
    limit?: number;
  }): Promise<MemoryItem[]> {
    const results: MemoryItem[] = [];
    const searchLower = searchTerm.toLowerCase();
    let count = 0;

    for (const [key, entry] of this.index.entries()) {
      // Check category filter
      if (options?.categories && !options.categories.includes(entry.category)) {
        continue;
      }

      try {
        const content = await fs.readFile(entry.path, 'utf-8');
        
        // Simple text search
        if (content.toLowerCase().includes(searchLower)) {
          const item = this.markdownToItem(content, entry.category, entry.key);
          results.push(item);
          count++;

          if (options?.limit && count >= options.limit) {
            break;
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return results;
  }

  /**
   * Convert MemoryItem to Markdown format
   */
  private itemToMarkdown(item: MemoryItem): string {
    let content = `# ${item.key}\n\n`;
    
    // Add frontmatter
    const frontmatter = {
      id: item.id,
      category: item.category,
      created: new Date(item.metadata?.timestamp || Date.now()).toISOString(),
      version: item.metadata?.version || '1.0',
      namespace: item.metadata?.namespace || 'default',
      tags: item.metadata?.tags || [],
      ...item.metadata
    };

    content += '---\n';
    content += yaml.dump(frontmatter, { 
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
    content += '---\n\n';

    // Add content based on value type
    if (typeof item.value === 'string') {
      content += item.value;
    } else if (this.config.prettyPrint) {
      content += '```json\n';
      content += JSON.stringify(item.value, null, 2);
      content += '\n```';
    } else {
      content += JSON.stringify(item.value);
    }

    // Add vector embedding if present
    if (item.vectorEmbedding) {
      content += '\n\n<!-- Vector Embedding -->\n';
      content += `<!-- ${JSON.stringify(item.vectorEmbedding)} -->`;
    }

    return content;
  }

  /**
   * Convert Markdown content to MemoryItem
   */
  private markdownToItem(content: string, category: string, key: string): MemoryItem {
    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let metadata: any = {};
    let bodyContent = content;

    if (frontmatterMatch) {
      try {
        metadata = yaml.load(frontmatterMatch[1]) as any;
        bodyContent = content.substring(frontmatterMatch[0].length).trim();
      } catch (error) {
        // Invalid YAML, skip frontmatter
      }
    }

    // Extract vector embedding if present
    let vectorEmbedding: number[] | undefined;
    const vectorMatch = bodyContent.match(/<!-- Vector Embedding -->\n<!-- (.+?) -->/);
    if (vectorMatch) {
      try {
        vectorEmbedding = JSON.parse(vectorMatch[1]);
        bodyContent = bodyContent.replace(vectorMatch[0], '').trim();
      } catch (error) {
        // Invalid vector data
      }
    }

    // Parse value
    let value: any = bodyContent;
    
    // Try to parse JSON content
    const jsonMatch = bodyContent.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        value = JSON.parse(jsonMatch[1]);
      } catch (error) {
        // Not valid JSON, keep as string
      }
    } else if (bodyContent.startsWith('{') || bodyContent.startsWith('[')) {
      try {
        value = JSON.parse(bodyContent);
      } catch (error) {
        // Not valid JSON, keep as string
      }
    }

    return {
      id: metadata.id || key,
      category,
      key,
      value,
      metadata: {
        ...metadata,
        timestamp: metadata.created ? new Date(metadata.created).getTime() : Date.now()
      },
      vectorEmbedding,
      ttl: metadata.ttl
    };
  }

  /**
   * Get file path for a memory item
   */
  private getFilePath(item: MemoryItem): string {
    const namespace = item.metadata?.namespace || 'default';
    const safeName = this.sanitizeFilename(item.key);
    
    // Map categories to directory structure
    const categoryPath = this.getCategoryPath(item.category);
    
    return path.join(
      this.config.rootPath,
      categoryPath,
      namespace,
      `${safeName}.md`
    );
  }

  /**
   * Map category to directory path
   */
  private getCategoryPath(category: string): string {
    const mapping: Record<string, string> = {
      'agent-session': 'agent-sessions',
      'calibration': 'shared-knowledge/calibration-values',
      'test-pattern': 'shared-knowledge/test-patterns',
      'failure': 'shared-knowledge/failure-analysis',
      'architecture': 'shared-knowledge/architectural-decisions',
      'code-pattern': 'shared-knowledge/code-patterns',
      'coordination': 'coordination',
      'project': 'project-memory',
      'github': 'github-integration'
    };

    return mapping[category] || `shared-knowledge/${category}`;
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .substring(0, 255);
  }

  /**
   * Load index from disk
   */
  private async loadIndex(): Promise<void> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      const data = JSON.parse(content);
      this.index = new Map(Object.entries(data));
    } catch (error) {
      // Index doesn't exist, scan directory
      await this.rebuildIndex();
    }
  }

  /**
   * Save index to disk
   */
  private async saveIndex(): Promise<void> {
    const data = Object.fromEntries(this.index);
    await fs.writeFile(
      this.indexPath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }

  /**
   * Rebuild index by scanning directory
   */
  private async rebuildIndex(): Promise<void> {
    this.index.clear();
    await this.scanDirectory(this.config.rootPath);
    await this.saveIndex();
  }

  /**
   * Scan directory recursively
   */
  private async scanDirectory(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const relativePath = path.relative(this.config.rootPath, fullPath);
          const category = this.getCategoryFromPath(relativePath);
          const key = path.basename(entry.name, '.md');
          
          const item = this.markdownToItem(content, category, key);
          this.updateIndex(item, fullPath);
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }
  }

  /**
   * Get category from file path
   */
  private getCategoryFromPath(relativePath: string): string {
    const parts = relativePath.split(path.sep);
    
    // Map directory structure back to categories
    if (parts[0] === 'agent-sessions') return 'agent-session';
    if (parts[0] === 'coordination') return 'coordination';
    if (parts[0] === 'project-memory') return 'project';
    if (parts[0] === 'github-integration') return 'github';
    
    if (parts[0] === 'shared-knowledge') {
      if (parts[1] === 'calibration-values') return 'calibration';
      if (parts[1] === 'test-patterns') return 'test-pattern';
      if (parts[1] === 'failure-analysis') return 'failure';
      if (parts[1] === 'architectural-decisions') return 'architecture';
      if (parts[1] === 'code-patterns') return 'code-pattern';
      return parts[1] || 'general';
    }
    
    return 'general';
  }

  /**
   * Update index entry
   */
  private updateIndex(item: MemoryItem, filePath: string): void {
    const indexKey = `${item.category}:${item.key}`;
    
    this.index.set(indexKey, {
      category: item.category,
      key: item.key,
      path: filePath,
      metadata: item.metadata
    });
  }

  /**
   * Check if entry matches query
   */
  private matchesQuery(entry: MemoryIndexEntry, query: MemoryQuery): boolean {
    if (query.categories && !query.categories.includes(entry.category)) {
      return false;
    }

    if (query.keys && !query.keys.includes(entry.key)) {
      return false;
    }

    if (query.namespace && entry.metadata?.namespace !== query.namespace) {
      return false;
    }

    if (query.tags && entry.metadata?.tags) {
      const entryTags = entry.metadata.tags as string[];
      if (!query.tags.some(tag => entryTags.includes(tag))) {
        return false;
      }
    }

    const timestamp = entry.metadata?.timestamp;
    if (timestamp) {
      if (query.startTime && timestamp < query.startTime) return false;
      if (query.endTime && timestamp > query.endTime) return false;
      if (query.asOf && timestamp > query.asOf) return false;
    }

    return true;
  }

  /**
   * Get value for ordering
   */
  private getOrderValue(item: MemoryItem, orderBy: string): any {
    switch (orderBy) {
      case 'timestamp':
        return item.metadata?.timestamp || 0;
      case 'key':
        return item.key;
      case 'category':
        return item.category;
      default:
        return 0;
    }
  }

  /**
   * Git integration helpers
   */
  private async gitAdd(filePath: string): Promise<void> {
    // Implement git add functionality
    // This would use child_process to run git commands
  }

  private async gitRemove(filePath: string): Promise<void> {
    // Implement git rm functionality
  }
}

interface MemoryIndexEntry {
  category: string;
  key: string;
  path: string;
  metadata?: any;
}