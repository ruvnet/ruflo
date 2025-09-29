/**
 * Tool repository for managing and discovering MCP tools
 * This is in a neutral location to avoid circular dependencies between server and proxy layers
 */

import type { MCPTool } from '../utils/types.js';

/**
 * In-memory tool repository for storing and retrieving tools
 */
export class InMemoryToolRepository {
  private tools: Map<string, MCPTool> = new Map();
  private toolsByCategory: Map<string, Set<string>> = new Map();
  private toolCategoryByName: Map<string, string> = new Map();

  /**
   * Add a tool to the repository
   */
  addTool(tool: MCPTool): void {
    // Check for existing category
    const existingCategory = this.toolCategoryByName.get(tool.name) ?? this.extractCategory(tool.name);
    const newCategory = this.extractCategory(tool.name);
    
    // If tool exists and category changed, remove from old category
    if (existingCategory && existingCategory !== newCategory) {
      const categorySet = this.toolsByCategory.get(existingCategory);
      if (categorySet) {
        categorySet.delete(tool.name);
        // Clean up empty category sets
        if (categorySet.size === 0) {
          this.toolsByCategory.delete(existingCategory);
        }
      }
    }

    // Add/update tool
    this.tools.set(tool.name, tool);
    
    // Update category indexing
    if (newCategory) {
      if (!this.toolsByCategory.has(newCategory)) {
        this.toolsByCategory.set(newCategory, new Set());
      }
      this.toolsByCategory.get(newCategory)!.add(tool.name);
      this.toolCategoryByName.set(tool.name, newCategory);
    } else {
      this.toolCategoryByName.delete(tool.name);
    }
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): MCPTool[] {
    const toolNames = this.toolsByCategory.get(category);
    if (!toolNames) return [];
    
    return Array.from(toolNames)
      .map(name => this.tools.get(name))
      .filter((tool): tool is MCPTool => tool !== undefined);
  }

  /**
   * Search for tools matching a query
   */
  searchTools(query: string): MCPTool[] {
    const lowerQuery = query.toLowerCase();
    const results: Array<{ tool: MCPTool; score: number }> = [];

    for (const tool of this.tools.values()) {
      let score = 0;

      // Exact name match
      if (tool.name.toLowerCase() === lowerQuery) {
        score += 100;
      } else if (tool.name.toLowerCase().includes(lowerQuery)) {
        // Partial name match
        score += 50;
      }

      // Description match
      if (tool.description.toLowerCase().includes(lowerQuery)) {
        score += 25;
      }

      // Category match
      const category = this.extractCategory(tool.name);
      if (category && category.toLowerCase().includes(lowerQuery)) {
        score += 10;
      }

      if (score > 0) {
        results.push({ tool, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.tool);
  }

  /**
   * Get total number of tools
   */
  getTotalTools(): number {
    return this.tools.size;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.toolsByCategory.clear();
    this.toolCategoryByName.clear();
  }

  /**
   * Remove a tool from the repository
   * @returns true if the tool was found and removed, false otherwise
   */
  removeTool(name: string): boolean {
    // Check if tool exists
    if (!this.tools.has(name)) {
      return false;
    }

    // Remove from category index
    const category = this.toolCategoryByName.get(name);
    if (category) {
      const categorySet = this.toolsByCategory.get(category);
      if (categorySet) {
        categorySet.delete(name);
        // Clean up empty category sets
        if (categorySet.size === 0) {
          this.toolsByCategory.delete(category);
        }
      }
      this.toolCategoryByName.delete(name);
    }

    // Remove the tool
    this.tools.delete(name);
    return true;
  }

  /**
   * Extract category from tool name (e.g., "file/read" -> "file")
   */
  private extractCategory(toolName: string): string | null {
    const parts = toolName.split('/');
    return parts.length > 1 ? parts[0] : null;
  }
}
