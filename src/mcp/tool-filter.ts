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
 * - Caching of filter results for performance optimization
 */

import { minimatch } from 'minimatch';
import type { MCPTool, MCPToolFilterConfig } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';

/**
 * Maximum allowed length for a glob pattern
 * Longer patterns increase regex compilation time and memory usage
 */
export const MAX_PATTERN_LENGTH = 200;

/**
 * Result of pattern validation
 */
export interface PatternValidationResult {
  /** Whether the pattern is valid */
  valid: boolean;
  /** Reason for invalidity (if invalid) */
  reason?: string;
}

/**
 * Patterns that indicate potentially dangerous glob patterns
 * These can cause catastrophic backtracking in regex engines
 */
const DANGEROUS_PATTERN_CHECKS: Array<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    // Nested double stars: **/**, **/**/*, etc.
    pattern: /\*\*[^/]*\*\*/,
    reason: 'Nested double stars (**/**) can cause catastrophic backtracking',
  },
  {
    // Multiple consecutive double stars: **/**
    pattern: /\*\*\/\*\*\//,
    reason: 'Consecutive double star segments (**/**/) can cause performance issues',
  },
  {
    // Triple or more wildcards: ***, ****, etc.
    pattern: /\*{3,}/,
    reason: 'Triple or more consecutive wildcards (***) are not valid glob patterns',
  },
  {
    // Nested quantifiers in character classes that could be exploited
    pattern: /\[[^\]]*\*[^\]]*\*[^\]]*\]/,
    reason: 'Multiple wildcards in character class can cause performance issues',
  },
  {
    // Extremely repetitive patterns like /*/*/*/*/*/*
    pattern: /(?:\/\*){5,}/,
    reason: 'Excessive repeated wildcard segments can cause performance issues',
  },
  {
    // Alternation with wildcards that could explode: {*,**,***}
    pattern: /\{[^}]*\*[^}]*,[^}]*\*[^}]*\}/,
    reason: 'Alternation with multiple wildcard options can cause performance issues',
  },
];

/**
 * Validate a single glob pattern for safety and correctness
 *
 * Checks for:
 * - Non-empty string
 * - Maximum length limit
 * - Potentially dangerous patterns that could cause ReDoS
 *
 * @param pattern - The glob pattern to validate
 * @returns Validation result with reason if invalid
 */
export function validateGlobPattern(pattern: unknown): PatternValidationResult {
  // Check if pattern is a string
  if (typeof pattern !== 'string') {
    return {
      valid: false,
      reason: `Pattern must be a string, got ${typeof pattern}`,
    };
  }

  // Check for empty string
  if (pattern.length === 0) {
    return {
      valid: false,
      reason: 'Pattern cannot be empty',
    };
  }

  // Check for whitespace-only string
  if (pattern.trim().length === 0) {
    return {
      valid: false,
      reason: 'Pattern cannot be whitespace only',
    };
  }

  // Check maximum length
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      valid: false,
      reason: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters (got ${pattern.length})`,
    };
  }

  // Check for dangerous patterns that could cause ReDoS
  for (const check of DANGEROUS_PATTERN_CHECKS) {
    if (check.pattern.test(pattern)) {
      return {
        valid: false,
        reason: check.reason,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate an array of glob patterns and return only valid ones
 * Logs warnings for invalid patterns
 *
 * @param patterns - Array of patterns to validate
 * @param logger - Logger for warning messages
 * @param context - Context string for log messages (e.g., 'tools', 'categories')
 * @returns Array of valid patterns
 */
export function validateAndFilterPatterns(
  patterns: unknown[],
  logger: ILogger,
  context: string
): string[] {
  const validPatterns: string[] = [];

  for (const pattern of patterns) {
    const result = validateGlobPattern(pattern);

    if (result.valid) {
      validPatterns.push(pattern as string);
    } else {
      logger.warn(`Invalid ${context} pattern skipped: "${String(pattern)}"`, {
        reason: result.reason,
      });
    }
  }

  return validPatterns;
}

/**
 * Core system tools that should typically not be excluded by maxTools limit
 * These are essential for basic swarm/agent functionality
 */
const CORE_SYSTEM_TOOLS = [
  'system/info',
  'system/health',
  'swarm_init',
  'swarm_status',
  'agent_spawn',
  'agent_list',
];

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
  /** Names of core system tools excluded by maxTools limit */
  excludedCoreTools: string[];
  /** Filter mode used */
  filterMode: 'allowlist' | 'denylist' | 'disabled';
  /** Whether filtering is enabled */
  enabled: boolean;
  /** Timestamp of last filter operation */
  lastFilterTimestamp: Date | null;
  /** Number of cache hits (when caching is enabled) */
  cacheHits: number;
  /** Number of cache misses (when caching is enabled) */
  cacheMisses: number;
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

  /**
   * Clear the filter results cache
   * Only relevant when caching is enabled
   */
  clearCache(): void;
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
 * Default cache TTL in milliseconds (60 seconds)
 */
const DEFAULT_CACHE_TTL = 60000;

/**
 * Cache entry for storing filtered results
 */
interface CacheEntry {
  /** Hash of the input tools (based on tool names) */
  key: string;
  /** Filtered result */
  result: MCPTool[];
  /** Timestamp when the entry was created */
  timestamp: number;
  /** Stats snapshot at cache time */
  stats: ToolFilterStats;
}

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
  private cache: CacheEntry | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Create a new ToolFilter instance
   * @param config - Filter configuration (or undefined for no filtering)
   * @param logger - Logger instance for debugging and info output
   */
  constructor(config: MCPToolFilterConfig | undefined, logger: ILogger) {
    this.logger = logger;
    this.config = config ?? {
      enabled: false,
      mode: 'allowlist',
      tools: [],
    };

    // Validate and filter patterns during construction
    if (this.config.enabled) {
      this.config = this.validateConfigPatterns(this.config);
    }

    this.stats = this.createEmptyStats();

    if (this.config.enabled) {
      this.logger.info('Tool filter initialized', {
        mode: this.config.mode,
        toolPatterns: this.config.tools.length,
        categories: this.config.categories?.length ?? 0,
        maxTools: this.config.maxTools,
        cacheEnabled: this.config.enableCache ?? false,
        cacheTtl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL,
      });
    } else {
      this.logger.debug('Tool filtering disabled');
    }
  }

  /**
   * Validate and filter patterns in the configuration
   * Returns a new config with only valid patterns
   */
  private validateConfigPatterns(config: MCPToolFilterConfig): MCPToolFilterConfig {
    const validatedConfig = { ...config };

    // Validate tool patterns
    if (config.tools && config.tools.length > 0) {
      validatedConfig.tools = validateAndFilterPatterns(config.tools, this.logger, 'tool');
    }

    // Validate category patterns
    if (config.categories && config.categories.length > 0) {
      validatedConfig.categories = validateAndFilterPatterns(
        config.categories,
        this.logger,
        'category'
      );
    }

    return validatedConfig;
  }

  /**
   * Generate a cache key from an array of tools based on their names
   * @param tools - Array of MCP tools
   * @returns A string hash representing the tool set
   */
  private generateCacheKey(tools: MCPTool[]): string {
    // Sort tool names for consistent hashing regardless of input order
    const sortedNames = tools.map((t) => t.name).sort();
    return sortedNames.join('|');
  }

  /**
   * Check if a cached result is still valid
   * @param key - Cache key to check
   * @returns true if cache is valid, false if stale or missing
   */
  private isCacheValid(key: string): boolean {
    if (!this.cache) {
      return false;
    }

    if (this.cache.key !== key) {
      return false;
    }

    const ttl = this.config.cacheTtl ?? DEFAULT_CACHE_TTL;
    const elapsed = Date.now() - this.cache.timestamp;
    return elapsed < ttl;
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
      excludedCoreTools: [],
      filterMode: this.config.enabled ? this.config.mode : 'disabled',
      enabled: this.config.enabled,
      lastFilterTimestamp: null,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
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
    // Check cache first if caching is enabled
    if (this.config.enableCache) {
      const cacheKey = this.generateCacheKey(tools);
      if (this.isCacheValid(cacheKey)) {
        this.cacheHits++;
        this.stats = {
          ...this.cache!.stats,
          cacheHits: this.cacheHits,
          cacheMisses: this.cacheMisses,
        };
        this.stats.lastFilterTimestamp = new Date();
        this.logger.debug('Cache hit for tool filter', {
          cacheKey: cacheKey.substring(0, 50) + '...',
          resultCount: this.cache!.result.length,
        });
        return this.cache!.result;
      }
      this.cacheMisses++;
    }

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

    // Log excluded tools at INFO level for user visibility
    if (excludedByPattern.length > 0) {
      const maxToolsToShow = 10;
      const toolsToShow = excludedByPattern.slice(0, maxToolsToShow);
      const remaining = excludedByPattern.length - maxToolsToShow;

      let excludedMessage = toolsToShow.join(', ');
      if (remaining > 0) {
        excludedMessage += `, ... and ${remaining} more`;
      }

      this.logger.info(`Excluded tools by pattern filter: ${excludedMessage}`);
    }

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

      // Check for excluded core system tools
      this.stats.excludedCoreTools = this.stats.truncatedToolNames.filter((toolName) =>
        CORE_SYSTEM_TOOLS.includes(toolName)
      );

      result = keptTools.map((t) => t.tool);

      this.logger.warn('Applied maxTools limit', {
        maxTools: this.config.maxTools,
        originalCount: filteredByPattern.length,
        resultCount: result.length,
        truncatedCount: this.stats.truncatedTools,
      });

      // Warn if core system tools were excluded
      if (this.stats.excludedCoreTools.length > 0) {
        this.logger.warn(
          `Warning: maxTools limit excluded core system tools: [${this.stats.excludedCoreTools.join(', ')}]. Consider increasing maxTools or adding these to priorities.`
        );
      }
    }

    this.stats.filteredTools = result.length;

    // Log summary at INFO level with clear format for user visibility
    const modeLabel = this.config.mode === 'allowlist' ? 'allowlist' : 'denylist';
    const patternsCount = this.config.tools.length + (this.config.categories?.length ?? 0);

    this.logger.info(
      `Tool filter applied (${modeLabel} mode): ${result.length} tools included, ${this.stats.excludedTools} excluded by pattern` +
      (this.stats.truncatedTools > 0 ? `, ${this.stats.truncatedTools} truncated by maxTools limit` : '')
    );

    this.logger.debug('Tool filtering complete', {
      total: this.stats.totalTools,
      filtered: this.stats.filteredTools,
      excluded: this.stats.excludedTools,
      truncated: this.stats.truncatedTools,
      patternsMatched: patternsCount,
    });

    // Store in cache if caching is enabled
    if (this.config.enableCache) {
      const cacheKey = this.generateCacheKey(tools);
      this.cache = {
        key: cacheKey,
        result,
        timestamp: Date.now(),
        stats: { ...this.stats },
      };
      this.logger.debug('Cached filter result', {
        cacheKey: cacheKey.substring(0, 50) + '...',
        resultCount: result.length,
        ttl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL,
      });
    }

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
      excludedCoreTools: [...this.stats.excludedCoreTools],
    };
  }

  /**
   * Update the filter configuration at runtime
   * Resets statistics and re-initializes with new config
   * Invalidates the cache when configuration changes
   */
  updateConfig(config: MCPToolFilterConfig): void {
    // Validate and filter patterns
    this.config = config.enabled ? this.validateConfigPatterns(config) : config;
    this.stats = this.createEmptyStats();
    // Invalidate cache when config changes
    this.clearCache();

    this.logger.info('Tool filter configuration updated', {
      enabled: this.config.enabled,
      mode: this.config.mode,
      toolPatterns: this.config.tools.length,
      categories: this.config.categories?.length ?? 0,
      maxTools: this.config.maxTools,
      cacheEnabled: this.config.enableCache ?? false,
      cacheTtl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL,
    });
  }

  /**
   * Clear the filter results cache
   * Resets cache entry and cache statistics
   */
  clearCache(): void {
    if (this.cache) {
      this.logger.debug('Clearing filter cache', {
        previousHits: this.cacheHits,
        previousMisses: this.cacheMisses,
      });
    }
    this.cache = null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
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
