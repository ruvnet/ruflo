/**
 * Tool Filter Tests
 *
 * Comprehensive test suite for MCP tool filtering system.
 * Supports allowlist, denylist, category filtering, and priority-based limiting.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { MCPTool, MCPContext } from '../utils/types.js';

// ===== Type Definitions for Tool Filter =====

/**
 * Tool category definitions for semantic grouping
 */
export type ToolCategory =
  | 'system'
  | 'swarm'
  | 'memory'
  | 'neural'
  | 'github'
  | 'workflow'
  | 'analysis'
  | 'coordination'
  | 'other';

/**
 * Configuration for MCP tool filtering
 */
export interface MCPToolFilterConfig {
  /** Whether filtering is enabled */
  enabled: boolean;

  /** Filter mode: allowlist includes only listed, denylist excludes listed */
  mode: 'allowlist' | 'denylist';

  /** Tool name patterns to match (supports glob-like patterns) */
  patterns: string[];

  /** Categories to include/exclude based on mode */
  categories?: ToolCategory[];

  /** Maximum number of tools to expose */
  maxTools?: number;

  /** Priority ordering for tools when limiting (higher = more important) */
  toolPriorities?: Record<string, number>;

  /** Enable statistics tracking */
  trackStats?: boolean;
}

/**
 * Statistics about filter operations
 */
export interface FilterStats {
  totalTools: number;
  filteredTools: number;
  matchedPatterns: string[];
  filterTime: number;
  lastFiltered: Date;
}

/**
 * Result of a filter operation
 */
export interface FilterResult {
  tools: MCPTool[];
  stats: FilterStats;
}

// ===== Tool Filter Implementation (Mock for Testing) =====

/**
 * Tool Filter class for filtering MCP tools based on configuration
 */
export class ToolFilter {
  private config: MCPToolFilterConfig;
  private lastStats?: FilterStats;
  private categoryMap: Map<string, ToolCategory> = new Map();

  constructor(config: MCPToolFilterConfig) {
    this.config = config;
    this.initializeCategoryMap();
  }

  /**
   * Initialize category mapping based on tool name prefixes
   */
  private initializeCategoryMap(): void {
    // Category detection patterns
    const categoryPatterns: Record<string, ToolCategory> = {
      'swarm_': 'swarm',
      'agent_': 'swarm',
      'memory_': 'memory',
      'neural_': 'neural',
      'github_': 'github',
      'workflow_': 'workflow',
      'task_': 'coordination',
      'daa_': 'coordination',
      'benchmark_': 'analysis',
      'features_': 'system',
      'system_': 'system',
    };

    this.categoryMap = new Map(Object.entries(categoryPatterns));
  }

  /**
   * Get the category for a tool based on its name
   */
  getToolCategory(toolName: string): ToolCategory {
    for (const [prefix, category] of this.categoryMap.entries()) {
      if (toolName.startsWith(prefix)) {
        return category;
      }
    }
    return 'other';
  }

  /**
   * Check if a tool name matches a pattern
   * Supports glob-like patterns: * (any), ? (single char)
   */
  matchPattern(toolName: string, pattern: string): boolean {
    // Exact match
    if (pattern === toolName) {
      return true;
    }

    // Wildcard match
    if (pattern === '*') {
      return true;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*')  // * matches any characters
      .replace(/\?/g, '.');  // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(toolName);
  }

  /**
   * Filter tools based on configuration
   */
  filter(tools: MCPTool[]): FilterResult {
    const startTime = performance.now();

    // If filtering is disabled, return all tools
    if (!this.config.enabled) {
      const stats: FilterStats = {
        totalTools: tools.length,
        filteredTools: tools.length,
        matchedPatterns: [],
        filterTime: performance.now() - startTime,
        lastFiltered: new Date(),
      };
      this.lastStats = stats;
      return { tools, stats };
    }

    const matchedPatterns: string[] = [];
    let filteredTools: MCPTool[];

    if (this.config.mode === 'allowlist') {
      // Allowlist mode: only include tools matching patterns
      filteredTools = tools.filter(tool => {
        const matches = this.config.patterns.some(pattern => {
          const isMatch = this.matchPattern(tool.name, pattern);
          if (isMatch && !matchedPatterns.includes(pattern)) {
            matchedPatterns.push(pattern);
          }
          return isMatch;
        });

        // Also check category filter if specified
        if (matches && this.config.categories && this.config.categories.length > 0) {
          const category = this.getToolCategory(tool.name);
          return this.config.categories.includes(category);
        }

        return matches;
      });
    } else {
      // Denylist mode: exclude tools matching patterns
      filteredTools = tools.filter(tool => {
        const shouldExclude = this.config.patterns.some(pattern => {
          const isMatch = this.matchPattern(tool.name, pattern);
          if (isMatch && !matchedPatterns.includes(pattern)) {
            matchedPatterns.push(pattern);
          }
          return isMatch;
        });

        // Also check category filter if specified (exclude matching categories)
        if (!shouldExclude && this.config.categories && this.config.categories.length > 0) {
          const category = this.getToolCategory(tool.name);
          return !this.config.categories.includes(category);
        }

        return !shouldExclude;
      });
    }

    // Apply maxTools limit with priority ordering
    if (this.config.maxTools && filteredTools.length > this.config.maxTools) {
      const priorities = this.config.toolPriorities || {};

      // Sort by priority (higher first), then by name for stable ordering
      filteredTools.sort((a, b) => {
        const priorityA = priorities[a.name] ?? 0;
        const priorityB = priorities[b.name] ?? 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }
        return a.name.localeCompare(b.name);
      });

      filteredTools = filteredTools.slice(0, this.config.maxTools);
    }

    const stats: FilterStats = {
      totalTools: tools.length,
      filteredTools: filteredTools.length,
      matchedPatterns,
      filterTime: performance.now() - startTime,
      lastFiltered: new Date(),
    };

    this.lastStats = stats;
    return { tools: filteredTools, stats };
  }

  /**
   * Get the last filter statistics
   */
  getStats(): FilterStats | undefined {
    return this.lastStats;
  }

  /**
   * Update filter configuration
   */
  updateConfig(config: Partial<MCPToolFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration (deep copy to prevent mutation)
   */
  getConfig(): MCPToolFilterConfig {
    return {
      ...this.config,
      patterns: [...this.config.patterns],
      categories: this.config.categories ? [...this.config.categories] : undefined,
      toolPriorities: this.config.toolPriorities
        ? { ...this.config.toolPriorities }
        : undefined,
    };
  }
}

/**
 * Factory function to create a ToolFilter instance
 */
export function createToolFilter(config: MCPToolFilterConfig): ToolFilter {
  return new ToolFilter(config);
}

// ===== Test Helpers =====

/**
 * Create a mock MCP tool with the given name
 */
function createMockTool(name: string, description?: string): MCPTool {
  return {
    name,
    description: description ?? `Description for ${name}`,
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({}),
  };
}

/**
 * Create a set of mock tools for testing
 */
function createMockToolSet(): MCPTool[] {
  return [
    createMockTool('swarm_init'),
    createMockTool('swarm_status'),
    createMockTool('swarm_monitor'),
    createMockTool('agent_spawn'),
    createMockTool('agent_list'),
    createMockTool('agent_metrics'),
    createMockTool('memory_usage'),
    createMockTool('memory_search'),
    createMockTool('memory_persist'),
    createMockTool('neural_status'),
    createMockTool('neural_train'),
    createMockTool('neural_patterns'),
    createMockTool('github_repo_analyze'),
    createMockTool('github_pr_manage'),
    createMockTool('workflow_create'),
    createMockTool('workflow_execute'),
    createMockTool('task_orchestrate'),
    createMockTool('task_status'),
    createMockTool('daa_agent_create'),
    createMockTool('benchmark_run'),
    createMockTool('features_detect'),
    createMockTool('system_health'),
  ];
}

// ===== Tests =====

describe('ToolFilter', () => {
  let mockTools: MCPTool[];

  beforeEach(() => {
    mockTools = createMockToolSet();
  });

  afterEach(() => {
    // Clear any mock state if needed
  });

  describe('No Filtering (Disabled)', () => {
    it('should return all tools when filtering is disabled', () => {
      const filter = createToolFilter({
        enabled: false,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(mockTools.length);
      expect(result.tools).toEqual(mockTools);
      expect(result.stats.totalTools).toBe(mockTools.length);
      expect(result.stats.filteredTools).toBe(mockTools.length);
    });

    it('should track timing even when disabled', () => {
      const filter = createToolFilter({
        enabled: false,
        mode: 'allowlist',
        patterns: [],
      });

      const result = filter.filter(mockTools);

      expect(result.stats.filterTime).toBeGreaterThanOrEqual(0);
      expect(result.stats.lastFiltered).toBeInstanceOf(Date);
    });
  });

  describe('Allowlist Mode - Exact Matching', () => {
    it('should include only exactly matched tools', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_init', 'swarm_status'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(2);
      expect(result.tools.map(t => t.name)).toEqual(['swarm_init', 'swarm_status']);
    });

    it('should return empty array when no tools match', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['nonexistent_tool'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(0);
      expect(result.stats.filteredTools).toBe(0);
    });
  });

  describe('Allowlist Mode - Glob Pattern Matching', () => {
    it('should match tools using wildcard pattern', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t => t.name.startsWith('swarm_'))).toBe(true);
      expect(result.tools.map(t => t.name)).toEqual([
        'swarm_init',
        'swarm_status',
        'swarm_monitor',
      ]);
    });

    it('should match tools using multiple wildcard patterns', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*', 'agent_*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(6);
      expect(result.tools.every(t =>
        t.name.startsWith('swarm_') || t.name.startsWith('agent_')
      )).toBe(true);
    });

    it('should match all tools with global wildcard', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(mockTools.length);
    });

    it('should handle complex patterns with prefix and suffix', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*_status'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t => t.name.endsWith('_status'))).toBe(true);
      expect(result.tools.map(t => t.name)).toEqual([
        'swarm_status',
        'neural_status',
        'task_status',
      ]);
    });

    it('should match middle wildcard patterns', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*_*_*'],  // Tools with at least 2 underscores
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t =>
        t.name.split('_').length >= 3
      )).toBe(true);
    });
  });

  describe('Denylist Mode', () => {
    it('should exclude exactly matched tools', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: ['swarm_init', 'swarm_status'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.some(t => t.name === 'swarm_init')).toBe(false);
      expect(result.tools.some(t => t.name === 'swarm_status')).toBe(false);
      expect(result.tools).toHaveLength(mockTools.length - 2);
    });

    it('should exclude tools matching wildcard patterns', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: ['swarm_*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t => !t.name.startsWith('swarm_'))).toBe(true);
      expect(result.tools).toHaveLength(mockTools.length - 3);
    });

    it('should exclude all tools with global wildcard', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: ['*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(0);
    });

    it('should exclude multiple pattern groups', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: ['swarm_*', 'agent_*', 'neural_*'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t =>
        !t.name.startsWith('swarm_') &&
        !t.name.startsWith('agent_') &&
        !t.name.startsWith('neural_')
      )).toBe(true);
      // Original has 3 swarm, 3 agent, 3 neural = 9 tools to exclude
      expect(result.tools).toHaveLength(mockTools.length - 9);
    });
  });

  describe('Category Filtering', () => {
    it('should filter by category in allowlist mode', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        categories: ['swarm'],
      });

      const result = filter.filter(mockTools);

      // swarm_* and agent_* both map to 'swarm' category
      expect(result.tools.every(t =>
        t.name.startsWith('swarm_') || t.name.startsWith('agent_')
      )).toBe(true);
    });

    it('should filter by multiple categories', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        categories: ['swarm', 'memory'],
      });

      const result = filter.filter(mockTools);

      // Should include swarm, agent (swarm category) and memory tools
      const toolNames = result.tools.map(t => t.name);
      expect(toolNames.some(n => n.startsWith('swarm_'))).toBe(true);
      expect(toolNames.some(n => n.startsWith('agent_'))).toBe(true);
      expect(toolNames.some(n => n.startsWith('memory_'))).toBe(true);
    });

    it('should exclude categories in denylist mode', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: [],  // No pattern exclusions
        categories: ['neural', 'github'],
      });

      const result = filter.filter(mockTools);

      expect(result.tools.every(t =>
        !t.name.startsWith('neural_') && !t.name.startsWith('github_')
      )).toBe(true);
    });

    it('should correctly detect tool categories', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
      });

      expect(filter.getToolCategory('swarm_init')).toBe('swarm');
      expect(filter.getToolCategory('agent_spawn')).toBe('swarm');
      expect(filter.getToolCategory('memory_usage')).toBe('memory');
      expect(filter.getToolCategory('neural_train')).toBe('neural');
      expect(filter.getToolCategory('github_pr_manage')).toBe('github');
      expect(filter.getToolCategory('workflow_create')).toBe('workflow');
      expect(filter.getToolCategory('task_orchestrate')).toBe('coordination');
      expect(filter.getToolCategory('daa_agent_create')).toBe('coordination');
      expect(filter.getToolCategory('benchmark_run')).toBe('analysis');
      expect(filter.getToolCategory('features_detect')).toBe('system');
      expect(filter.getToolCategory('unknown_tool')).toBe('other');
    });
  });

  describe('maxTools Limit', () => {
    it('should limit the number of tools returned', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        maxTools: 5,
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(5);
    });

    it('should not affect result when under limit', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
        maxTools: 10,
      });

      const result = filter.filter(mockTools);

      expect(result.tools).toHaveLength(3); // Only 3 swarm tools
    });

    it('should maintain stable ordering when limiting', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        maxTools: 5,
      });

      const result1 = filter.filter(mockTools);
      const result2 = filter.filter(mockTools);

      expect(result1.tools.map(t => t.name)).toEqual(result2.tools.map(t => t.name));
    });
  });

  describe('Priority Ordering', () => {
    it('should order tools by priority when limiting', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        maxTools: 3,
        toolPriorities: {
          'neural_train': 100,
          'swarm_init': 50,
          'memory_usage': 75,
        },
      });

      const result = filter.filter(mockTools);

      // Should include highest priority tools
      const names = result.tools.map(t => t.name);
      expect(names).toContain('neural_train');
      expect(names).toContain('memory_usage');
      expect(names).toContain('swarm_init');
    });

    it('should use name ordering for tools without explicit priority', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        maxTools: 5,
        toolPriorities: {
          'neural_train': 100, // Only this has priority
        },
      });

      const result = filter.filter(mockTools);

      // neural_train should be first due to high priority
      expect(result.tools[0].name).toBe('neural_train');
    });

    it('should handle equal priorities by name', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*', 'agent_*'],
        maxTools: 4,
        toolPriorities: {
          'swarm_init': 50,
          'swarm_status': 50,
          'agent_spawn': 50,
          'agent_list': 50,
        },
      });

      const result = filter.filter(mockTools);

      // With equal priorities, should be alphabetically sorted
      const names = result.tools.map(t => t.name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });
  });

  describe('Filter Statistics Tracking', () => {
    it('should track total and filtered tool counts', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
        trackStats: true,
      });

      const result = filter.filter(mockTools);

      expect(result.stats.totalTools).toBe(mockTools.length);
      expect(result.stats.filteredTools).toBe(3);
    });

    it('should track matched patterns', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*', 'agent_*', 'nonexistent_*'],
        trackStats: true,
      });

      const result = filter.filter(mockTools);

      expect(result.stats.matchedPatterns).toContain('swarm_*');
      expect(result.stats.matchedPatterns).toContain('agent_*');
      expect(result.stats.matchedPatterns).not.toContain('nonexistent_*');
    });

    it('should record filter execution time', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        trackStats: true,
      });

      const result = filter.filter(mockTools);

      expect(result.stats.filterTime).toBeGreaterThanOrEqual(0);
      expect(result.stats.filterTime).toBeLessThan(100); // Should be fast
    });

    it('should record timestamp of filter operation', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
        trackStats: true,
      });

      const before = new Date();
      const result = filter.filter(mockTools);
      const after = new Date();

      expect(result.stats.lastFiltered.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.stats.lastFiltered.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should provide stats via getStats()', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
        trackStats: true,
      });

      // Before filtering, no stats
      expect(filter.getStats()).toBeUndefined();

      filter.filter(mockTools);

      const stats = filter.getStats();
      expect(stats).toBeDefined();
      expect(stats?.filteredTools).toBe(3);
    });
  });

  describe('Empty Tool List Handling', () => {
    it('should handle empty input gracefully', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['*'],
      });

      const result = filter.filter([]);

      expect(result.tools).toHaveLength(0);
      expect(result.stats.totalTools).toBe(0);
      expect(result.stats.filteredTools).toBe(0);
    });

    it('should handle empty patterns array', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: [],
      });

      const result = filter.filter(mockTools);

      // Empty patterns in allowlist mode = nothing matches
      expect(result.tools).toHaveLength(0);
    });

    it('should handle empty patterns in denylist mode', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'denylist',
        patterns: [],
      });

      const result = filter.filter(mockTools);

      // Empty patterns in denylist mode = nothing excluded
      expect(result.tools).toHaveLength(mockTools.length);
    });
  });

  describe('Configuration Management', () => {
    it('should update configuration dynamically', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const result1 = filter.filter(mockTools);
      expect(result1.tools).toHaveLength(3);

      filter.updateConfig({
        patterns: ['agent_*'],
      });

      const result2 = filter.filter(mockTools);
      expect(result2.tools).toHaveLength(3);
      expect(result2.tools.every(t => t.name.startsWith('agent_'))).toBe(true);
    });

    it('should toggle enabled state', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const result1 = filter.filter(mockTools);
      expect(result1.tools).toHaveLength(3);

      filter.updateConfig({ enabled: false });

      const result2 = filter.filter(mockTools);
      expect(result2.tools).toHaveLength(mockTools.length);
    });

    it('should switch modes', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const result1 = filter.filter(mockTools);
      expect(result1.tools).toHaveLength(3);

      filter.updateConfig({ mode: 'denylist' });

      const result2 = filter.filter(mockTools);
      expect(result2.tools).toHaveLength(mockTools.length - 3);
    });

    it('should return current config via getConfig()', () => {
      const originalConfig: MCPToolFilterConfig = {
        enabled: true,
        mode: 'allowlist',
        patterns: ['test_*'],
        categories: ['swarm'],
        maxTools: 10,
      };

      const filter = createToolFilter(originalConfig);
      const config = filter.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('allowlist');
      expect(config.patterns).toEqual(['test_*']);
      expect(config.categories).toEqual(['swarm']);
      expect(config.maxTools).toBe(10);
    });

    it('should not mutate internal config when returning', () => {
      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['swarm_*'],
      });

      const config = filter.getConfig();
      config.patterns.push('hacked_*');

      // Internal config should be unchanged
      const config2 = filter.getConfig();
      expect(config2.patterns).toEqual(['swarm_*']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in tool names', () => {
      const specialTools = [
        createMockTool('tool-with-dashes'),
        createMockTool('tool.with.dots'),
        createMockTool('tool_with_underscores'),
        createMockTool('Tool123WithNumbers'),
      ];

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['tool*'],
      });

      const result = filter.filter(specialTools);

      expect(result.tools).toHaveLength(3); // Matches tool- tool. tool_
    });

    it('should handle very long tool names', () => {
      const longName = 'a'.repeat(1000);
      const longTools = [createMockTool(longName)];

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['a*'],
      });

      const result = filter.filter(longTools);

      expect(result.tools).toHaveLength(1);
    });

    it('should handle many patterns efficiently', () => {
      const patterns = Array.from({ length: 100 }, (_, i) => `pattern_${i}_*`);

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns,
      });

      const start = performance.now();
      const result = filter.filter(mockTools);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50); // Should complete quickly
      expect(result.tools).toHaveLength(0); // None match
    });

    it('should handle many tools efficiently', () => {
      const manyTools = Array.from({ length: 1000 }, (_, i) =>
        createMockTool(`tool_${i}`)
      );

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['tool_*'],
      });

      const start = performance.now();
      const result = filter.filter(manyTools);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100); // Should complete quickly
      expect(result.tools).toHaveLength(1000);
    });
  });

  describe('Pattern Edge Cases', () => {
    it('should handle single character wildcard', () => {
      const tools = [
        createMockTool('tool_a'),
        createMockTool('tool_b'),
        createMockTool('tool_ab'),
      ];

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['tool_?'],
      });

      const result = filter.filter(tools);

      expect(result.tools.map(t => t.name)).toEqual(['tool_a', 'tool_b']);
    });

    it('should handle mixed wildcards', () => {
      const tools = [
        createMockTool('a1x'),
        createMockTool('a2y'),
        createMockTool('a12x'),
        createMockTool('b1x'),
      ];

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['a?*'],
      });

      const result = filter.filter(tools);

      expect(result.tools.map(t => t.name)).toEqual(['a1x', 'a2y', 'a12x']);
    });

    it('should handle escaped regex special characters', () => {
      const tools = [
        createMockTool('tool.name'),
        createMockTool('tool_name'),
        createMockTool('toolXname'),
      ];

      const filter = createToolFilter({
        enabled: true,
        mode: 'allowlist',
        patterns: ['tool.name'],  // Should match literal dot
      });

      const result = filter.filter(tools);

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('tool.name');
    });
  });
});

describe('createToolFilter Factory', () => {
  it('should create a ToolFilter instance', () => {
    const filter = createToolFilter({
      enabled: true,
      mode: 'allowlist',
      patterns: ['*'],
    });

    expect(filter).toBeInstanceOf(ToolFilter);
  });

  it('should create independent instances', () => {
    const filter1 = createToolFilter({
      enabled: true,
      mode: 'allowlist',
      patterns: ['swarm_*'],
    });

    const filter2 = createToolFilter({
      enabled: true,
      mode: 'denylist',
      patterns: ['agent_*'],
    });

    expect(filter1.getConfig().mode).toBe('allowlist');
    expect(filter2.getConfig().mode).toBe('denylist');
  });
});
