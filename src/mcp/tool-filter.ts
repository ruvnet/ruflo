/**
 * MCP Tool Filtering Implementation
 *
 * Provides configurable tool filtering for MCP servers to meet platform
 * tool limits (e.g., Cursor's limit on total tools across MCP servers).
 *
 * Supports:
 * - Allowlist mode: Only include tools that match patterns
 * - Denylist mode: Exclude tools that match patterns
 * - Glob pattern matching using minimatch (e.g., 'system/*', 'agents/spawn')
 * - Category-based filtering
 * - Maximum tool limiting with priority-based ordering
 */

import { minimatch } from 'minimatch';
import type { MCPTool, MCPToolFilterConfig } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';

/**
 * Statistics about tool filtering operations
 */
export interface ToolFilterStats {
  /** Total number of tools before filtering */
  totalTools: number;
  /** Number of tools after filtering */
  filteredTools: number;
  /** Number of tools excluded by allowlist/denylist filter */
  excludedTools: number;
  /** Number of tools excluded by maxTools limit */
  truncatedTools: number;
  /** Names of tools excluded by allowlist/denylist filter */
  excludedToolNames: string[];
  /** Names of tools excluded by maxTools limit */
  truncatedToolNames: string[];
  /** Filter mode used */
  filterMode: 'allowlist' | 'denylist' | 'disabled';
  /** Whether filtering is enabled */
  enabled: boolean;
  /** Timestamp of last filter operation */
  lastFilterTimestamp: Date | null;
}

/**
 * Interface for tool filtering implementations
 */
export interface IToolFilter {
  /**
   * Check if a tool should be included based on filter configuration
   * Does not consider maxTools limit - only pattern matching
   * @param toolName - Name of the tool to check
   * @returns true if the tool should be included, false otherwise
   */
  shouldIncludeTool(toolName: string): boolean;

  /**
   * Filter a list of tools based on configuration
   * Applies both pattern filtering and maxTools limiting
   * @param tools - Array of MCP tools to filter
   * @returns Filtered array of tools
   */
  filterTools(tools: MCPTool[]): MCPTool[];

  /**
   * Get statistics about the most recent filtering operation
   * @returns Filter statistics
   */
  getFilterStats(): ToolFilterStats;

  /**
   * Update the filter configuration at runtime
   * @param config - New filter configuration
   */
  updateConfig(config: MCPToolFilterConfig): void;
}

/**
 * Default tool priorities for common tool categories
 * Higher values indicate higher priority (kept when maxTools limit is reached)
 */
const DEFAULT_PRIORITIES: Record<string, number> = {
  // System tools - highest priority
  'system/info': 100,
  'system/health': 100,

  // Core agent operations
  'agents/spawn': 90,
  'agents/list': 90,
  'agents/status': 85,

  // Core task operations
  'tasks/create': 90,
  'tasks/status': 85,
  'tasks/list': 80,

  // Core memory operations
  'memory/store': 85,
  'memory/retrieve': 85,
  'memory/search': 80,

  // Swarm coordination
  'swarm/init': 80,
  'swarm/status': 75,
};

/**
 * Default priority for tools not in the priority map
 */
const DEFAULT_TOOL_PRIORITY = 50;

/**
 * Tool Filter Implementation
 *
 * Filters MCP tools based on configuration settings including
 * allowlist/denylist modes, glob patterns, and priority-based limiting.
 *
 * @example
 * ```typescript
 * const filter = new ToolFilter(
 *   {
 *     enabled: true,
 *     mode: 'allowlist',
 *     tools: ['system/*', 'agents/spawn'],
 *     categories: ['memory'],
 *     maxTools: 20,
 *     priorities: { 'custom/tool': 95 }
 *   },
 *   logger
 * );
 *
 * const filteredTools = filter.filterTools(allTools);
 * const stats = filter.getFilterStats();
 * ```
 */
export class ToolFilter implements IToolFilter {
  private config: MCPToolFilterConfig;
  private logger: ILogger;
  private stats: ToolFilterStats;

  /**
   * Create a new ToolFilter instance
   * @param config - Filter configuration (or undefined for no filtering)
   * @param logger - Logger instance for debugging and info output
   */
  constructor(config: MCPToolFilterConfig | undefined, logger: ILogger) {
    this.config = config ?? {
      enabled: false,
      mode: 'allowlist',
      tools: [],
    };
    this.logger = logger;
    this.stats = this.createEmptyStats();

    if (this.config.enabled) {
      this.logger.info('Tool filter initialized', {
        mode: this.config.mode,
        toolPatterns: this.config.tools.length,
        categories: this.config.categories?.length ?? 0,
        maxTools: this.config.maxTools,
      });
    } else {
      this.logger.debug('Tool filtering disabled');
    }
  }

  /**
   * Create empty statistics object with current configuration state
   */
  private createEmptyStats(): ToolFilterStats {
    return {
      totalTools: 0,
      filteredTools: 0,
      excludedTools: 0,
      truncatedTools: 0,
      excludedToolNames: [],
      truncatedToolNames: [],
      filterMode: this.config.enabled ? this.config.mode : 'disabled',
      enabled: this.config.enabled,
      lastFilterTimestamp: null,
    };
  }

  /**
   * Check if a tool name matches any pattern in a list using minimatch
   * @param toolName - Tool name to check
   * @param patterns - Array of patterns (exact names or globs)
   * @returns true if any pattern matches
   */
  private matchesPatterns(toolName: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      // Check for exact match first (faster)
      if (pattern === toolName) {
        return true;
      }

      // Check glob pattern match using minimatch
      if (minimatch(toolName, pattern, { nocase: false })) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a tool matches any category pattern
   * Categories match tool name prefixes with common separators
   * @param toolName - Tool name to check
   * @param categories - Array of category prefixes
   * @returns true if tool belongs to any category
   */
  private matchesCategories(toolName: string, categories: string[]): boolean {
    for (const category of categories) {
      // Category matches if tool name starts with "category/" or "category_" or "category-"
      if (
        toolName.startsWith(`${category}/`) ||
        toolName.startsWith(`${category}_`) ||
        toolName.startsWith(`${category}-`)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get priority for a tool, used for ordering when maxTools limit applies
   * @param toolName - Tool name
   * @returns Priority value (higher = more important, kept first when truncating)
   */
  private getToolPriority(toolName: string): number {
    // Check configured priorities first
    if (this.config.priorities?.[toolName] !== undefined) {
      return this.config.priorities[toolName];
    }

    // Fall back to default priorities
    if (DEFAULT_PRIORITIES[toolName] !== undefined) {
      return DEFAULT_PRIORITIES[toolName];
    }

    // Extract category for category-based default priority
    const category = toolName.split(/[/_-]/)[0];
    const categoryPriorities = Object.entries(DEFAULT_PRIORITIES)
      .filter(([key]) => key.startsWith(`${category}/`))
      .map(([, value]) => value);

    if (categoryPriorities.length > 0) {
      // Return slightly lower than explicit category tools
      return Math.min(...categoryPriorities) - 5;
    }

    return DEFAULT_TOOL_PRIORITY;
  }

  /**
   * Check if a single tool should be included based on filter rules
   * Does not consider maxTools limit - only pattern/category matching
   */
  shouldIncludeTool(toolName: string): boolean {
    // If filtering is disabled, include all tools
    if (!this.config.enabled) {
      return true;
    }

    const { mode, tools, categories } = this.config;

    // Check tool patterns
    const matchesToolPattern = tools.length > 0 && this.matchesPatterns(toolName, tools);

    // Check category patterns
    const matchesCategory =
      categories && categories.length > 0 && this.matchesCategories(toolName, categories);

    // Combine matches - tool is matched if it matches patterns OR categories
    const matches = matchesToolPattern || matchesCategory;

    if (mode === 'allowlist') {
      // In allowlist mode: include only if matches
      return matches;
    } else {
      // In denylist mode: include only if NOT matches
      return !matches;
    }
  }

  /**
   * Filter an array of tools based on configuration
   * Applies pattern filtering first, then maxTools limit if configured
   */
  filterTools(tools: MCPTool[]): MCPTool[] {
    // Reset stats for this operation
    this.stats = this.createEmptyStats();
    this.stats.totalTools = tools.length;
    this.stats.lastFilterTimestamp = new Date();

    // If filtering is disabled, return all tools
    if (!this.config.enabled) {
      this.stats.filteredTools = tools.length;
      this.logger.debug('Tool filtering disabled, returning all tools', {
        count: tools.length,
      });
      return tools;
    }

    this.logger.debug('Filtering tools', {
      mode: this.config.mode,
      toolPatterns: this.config.tools,
      categories: this.config.categories,
      maxTools: this.config.maxTools,
    });

    // Step 1: Apply allowlist/denylist filtering
    const filteredByPattern: MCPTool[] = [];
    const excludedByPattern: string[] = [];

    for (const tool of tools) {
      if (this.shouldIncludeTool(tool.name)) {
        filteredByPattern.push(tool);
      } else {
        excludedByPattern.push(tool.name);
      }
    }

    this.stats.excludedToolNames = excludedByPattern;
    this.stats.excludedTools = excludedByPattern.length;

    this.logger.debug('Pattern filtering complete', {
      included: filteredByPattern.length,
      excluded: excludedByPattern.length,
    });

    // Step 2: Apply maxTools limit with priority ordering
    let result = filteredByPattern;

    if (this.config.maxTools !== undefined && filteredByPattern.length > this.config.maxTools) {
      // Sort by priority (descending), then by name for stable ordering
      const toolsWithPriority = filteredByPattern.map((tool) => ({
        tool,
        priority: this.getToolPriority(tool.name),
      }));

      toolsWithPriority.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return a.tool.name.localeCompare(b.tool.name);
      });

      // Take top N tools based on maxTools limit
      const keptTools = toolsWithPriority.slice(0, this.config.maxTools);
      const truncatedTools = toolsWithPriority.slice(this.config.maxTools);

      this.stats.truncatedToolNames = truncatedTools.map((t) => t.tool.name);
      this.stats.truncatedTools = truncatedTools.length;

      result = keptTools.map((t) => t.tool);

      this.logger.warn('Applied maxTools limit', {
        maxTools: this.config.maxTools,
        originalCount: filteredByPattern.length,
        resultCount: result.length,
        truncatedCount: this.stats.truncatedTools,
      });
    }

    this.stats.filteredTools = result.length;

    this.logger.info('Tool filtering complete', {
      total: this.stats.totalTools,
      filtered: this.stats.filteredTools,
      excluded: this.stats.excludedTools,
      truncated: this.stats.truncatedTools,
    });

    return result;
  }

  /**
   * Get statistics from the most recent filter operation
   * Returns a copy to prevent external modification
   */
  getFilterStats(): ToolFilterStats {
    return {
      ...this.stats,
      excludedToolNames: [...this.stats.excludedToolNames],
      truncatedToolNames: [...this.stats.truncatedToolNames],
    };
  }

  /**
   * Update the filter configuration at runtime
   * Resets statistics and re-initializes with new config
   */
  updateConfig(config: MCPToolFilterConfig): void {
    this.config = config;
    this.stats = this.createEmptyStats();

    this.logger.info('Tool filter configuration updated', {
      enabled: config.enabled,
      mode: config.mode,
      toolPatterns: config.tools.length,
      categories: config.categories?.length ?? 0,
      maxTools: config.maxTools,
    });
  }
}

/**
 * Factory function to create a ToolFilter instance
 *
 * @param config - Filter configuration (optional, defaults to disabled filtering)
 * @param logger - Logger instance for output
 * @returns Configured IToolFilter instance
 *
 * @example
 * ```typescript
 * // Create with allowlist configuration
 * const filter = createToolFilter(
 *   {
 *     enabled: true,
 *     mode: 'allowlist',
 *     tools: ['system/*', 'agents/spawn', 'memory/*'],
 *     maxTools: 20
 *   },
 *   logger
 * );
 *
 * // Filter tools
 * const filteredTools = filter.filterTools(allTools);
 *
 * // Check statistics
 * const stats = filter.getFilterStats();
 * console.log(`Filtered ${stats.excludedTools} tools`);
 * ```
 *
 * @example
 * ```typescript
 * // Create with denylist configuration
 * const filter = createToolFilter(
 *   {
 *     enabled: true,
 *     mode: 'denylist',
 *     tools: ['debug/*', 'experimental/*'],
 *     categories: ['internal']
 *   },
 *   logger
 * );
 * ```
 */
export function createToolFilter(
  config: MCPToolFilterConfig | undefined,
  logger: ILogger
): IToolFilter {
  return new ToolFilter(config, logger);
}
