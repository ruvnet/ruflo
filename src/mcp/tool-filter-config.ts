/**
 * Tool Filter Configuration Loader
 *
 * Loads tool filter configuration from multiple sources:
 * 1. Dedicated config file (.claude-flow/mcp-tools.json)
 * 2. Alternative config files (.claude-flow/mcp-tools.yaml, mcp-tools.json)
 * 3. Environment variables
 *
 * Priority order (highest to lowest):
 * 1. Environment variables (override file config)
 * 2. Config files (first found wins)
 *
 * @module tool-filter-config
 */

/*
 * ============================================================================
 * CONFIGURATION FILE FORMAT SUPPORT
 * ============================================================================
 *
 * JSON files (.json):
 *   - Full support for all configuration options
 *   - Recommended for complex configurations
 *   - Supports all nested structures, arrays, and data types
 *
 * YAML files (.yaml, .yml):
 *   - Full YAML 1.2 support via the 'yaml' library
 *   - Supports all standard YAML features including:
 *     - Multi-line strings (block scalars: | and >)
 *     - Anchors and aliases (&anchor, *alias)
 *     - Flow style collections ({key: value}, [item1, item2])
 *     - Tags (!!str, !!int, etc.)
 *     - Multiple documents (--- separator)
 *     - Complex keys
 *
 * Both formats work equally well. Choose based on your preference:
 *   - JSON: Stricter syntax, better IDE support, easier to validate
 *   - YAML: More human-readable, supports comments, less verbose
 *
 * Example YAML configuration:
 *   toolFilter:
 *     enabled: true
 *     mode: allowlist
 *     tools:
 *       - swarm_init
 *       - agent_spawn
 *     maxTools: 50
 *
 * Example JSON configuration:
 *   {
 *     "toolFilter": {
 *       "enabled": true,
 *       "mode": "allowlist",
 *       "tools": ["swarm_init", "agent_spawn"],
 *       "maxTools": 50
 *     }
 *   }
 * ============================================================================
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { MCPToolFilterConfig } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';
import { validateGlobPattern, MAX_PATTERN_LENGTH } from './tool-filter.js';

/**
 * Default paths to search for tool filter configuration files
 * Searched in order, first found wins
 */
const DEFAULT_CONFIG_PATHS = [
  '.claude-flow/mcp-tools.json',
  '.claude-flow/mcp-tools.yaml',
  'mcp-tools.json',
];

/**
 * Result of loading tool filter configuration
 */
export interface LoadedToolFilterConfig {
  /** The loaded configuration */
  config: MCPToolFilterConfig;
  /** Source of the configuration (file path or 'environment') */
  source: string;
}

/**
 * Result of configuration validation
 */
export interface ConfigValidationResult {
  /** Whether the configuration is valid (no errors) */
  valid: boolean;
  /** List of validation errors (invalid configuration) */
  errors: string[];
  /** List of warnings (valid but potentially problematic) */
  warnings: string[];
}

/** Known properties in MCPToolFilterConfig */
const KNOWN_CONFIG_PROPERTIES = new Set([
  'enabled',
  'mode',
  'tools',
  'categories',
  'maxTools',
  'priorities',
]);

/** Maximum recommended number of patterns before performance warning */
const MAX_RECOMMENDED_PATTERNS = 100;

/**
 * Validate tool filter configuration schema
 *
 * Performs comprehensive validation of the configuration structure and values.
 * Returns errors for invalid configurations and warnings for edge cases.
 *
 * @param config - The configuration to validate (unknown type for runtime validation)
 * @returns Validation result with errors and warnings
 */
export function validateToolFilterConfig(config: unknown): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Must be an object
  if (config === null || typeof config !== 'object') {
    return {
      valid: false,
      errors: ['Configuration must be an object'],
      warnings: [],
    };
  }

  const configObj = config as Record<string, unknown>;

  // Check for unknown properties
  for (const key of Object.keys(configObj)) {
    if (!KNOWN_CONFIG_PROPERTIES.has(key)) {
      warnings.push(`Unknown property '${key}' will be ignored`);
    }
  }

  // Validate 'enabled' - must be boolean if present
  if ('enabled' in configObj && typeof configObj.enabled !== 'boolean') {
    errors.push(`'enabled' must be a boolean, got ${typeof configObj.enabled}`);
  }

  // Validate 'mode' - must be 'allowlist' or 'denylist' if present
  if ('mode' in configObj) {
    if (configObj.mode !== 'allowlist' && configObj.mode !== 'denylist') {
      errors.push(`'mode' must be 'allowlist' or 'denylist', got '${String(configObj.mode)}'`);
    }
  }

  // Validate 'tools' - must be array of strings if present
  if ('tools' in configObj) {
    if (!Array.isArray(configObj.tools)) {
      errors.push(`'tools' must be an array, got ${typeof configObj.tools}`);
    } else {
      // Check each element is a string
      const nonStrings = configObj.tools
        .map((t, i) => ({ value: t, index: i }))
        .filter(({ value }) => typeof value !== 'string');

      if (nonStrings.length > 0) {
        const indices = nonStrings.map(({ index }) => index).join(', ');
        errors.push(`'tools' array must contain only strings, non-string values at indices: ${indices}`);
      }

      // Validate each pattern for ReDoS protection
      for (let i = 0; i < configObj.tools.length; i++) {
        const pattern = configObj.tools[i];
        if (typeof pattern === 'string') {
          const validationResult = validateGlobPattern(pattern);
          if (!validationResult.valid) {
            warnings.push(`Tool pattern at index ${i} ('${pattern.substring(0, 50)}${pattern.length > 50 ? '...' : ''}'): ${validationResult.reason}`);
          }
        }
      }

      // Warn about empty tools array in allowlist mode
      const mode = configObj.mode ?? 'allowlist';
      if (configObj.tools.length === 0 && mode === 'allowlist') {
        warnings.push("Empty 'tools' array in allowlist mode will match nothing");
      }

      // Performance warning for large number of patterns
      if (configObj.tools.length > MAX_RECOMMENDED_PATTERNS) {
        warnings.push(
          `Large number of tool patterns (${configObj.tools.length}) may impact performance. Consider using categories or wildcards.`
        );
      }
    }
  }

  // Validate 'categories' - must be array of strings if present
  if ('categories' in configObj) {
    if (!Array.isArray(configObj.categories)) {
      errors.push(`'categories' must be an array, got ${typeof configObj.categories}`);
    } else {
      // Check each element is a string
      const nonStrings = configObj.categories
        .map((c, i) => ({ value: c, index: i }))
        .filter(({ value }) => typeof value !== 'string');

      if (nonStrings.length > 0) {
        const indices = nonStrings.map(({ index }) => index).join(', ');
        errors.push(`'categories' array must contain only strings, non-string values at indices: ${indices}`);
      }

      // Validate each category for ReDoS protection
      for (let i = 0; i < configObj.categories.length; i++) {
        const category = configObj.categories[i];
        if (typeof category === 'string') {
          const validationResult = validateGlobPattern(category);
          if (!validationResult.valid) {
            warnings.push(`Category pattern at index ${i} ('${category.substring(0, 50)}${category.length > 50 ? '...' : ''}'): ${validationResult.reason}`);
          }
        }
      }

      // Performance warning for large number of categories
      if (configObj.categories.length > MAX_RECOMMENDED_PATTERNS) {
        warnings.push(
          `Large number of category patterns (${configObj.categories.length}) may impact performance.`
        );
      }
    }
  }

  // Validate 'maxTools' - must be positive integer if present
  if ('maxTools' in configObj) {
    const maxTools = configObj.maxTools;
    if (typeof maxTools !== 'number') {
      errors.push(`'maxTools' must be a number, got ${typeof maxTools}`);
    } else if (!Number.isInteger(maxTools)) {
      errors.push(`'maxTools' must be an integer, got ${maxTools}`);
    } else if (maxTools <= 0) {
      warnings.push(`'maxTools' is ${maxTools}, which will be ignored (must be positive)`);
    }
  }

  // Validate 'priorities' - must be object with string keys and number values if present
  if ('priorities' in configObj) {
    const priorities = configObj.priorities;
    if (priorities === null || typeof priorities !== 'object' || Array.isArray(priorities)) {
      errors.push(`'priorities' must be an object, got ${Array.isArray(priorities) ? 'array' : typeof priorities}`);
    } else {
      const prioritiesObj = priorities as Record<string, unknown>;
      for (const [key, value] of Object.entries(prioritiesObj)) {
        if (typeof value !== 'number') {
          errors.push(`'priorities.${key}' must be a number, got ${typeof value}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Default configuration when no config is found
 */
const DEFAULT_CONFIG: MCPToolFilterConfig = {
  enabled: false,
  mode: 'allowlist',
  tools: [],
};

/**
 * Load tool filter configuration from multiple sources
 *
 * @param logger - Logger instance for debugging
 * @param workingDirectory - Base directory to search for config files (defaults to cwd)
 * @returns Loaded configuration or null if none found/disabled
 */
export async function loadToolFilterConfig(
  logger: ILogger,
  workingDirectory?: string
): Promise<LoadedToolFilterConfig | null> {
  const cwd = workingDirectory || process.cwd();

  // First, try to load from config files
  const fileConfig = await loadFromConfigFiles(cwd, logger);

  // If we found a file config, optionally merge with env overrides
  if (fileConfig) {
    const envOverrides = loadEnvironmentOverrides();

    // If env has explicit enabled setting, it overrides file
    if (envOverrides.hasExplicitEnabled) {
      fileConfig.config.enabled = envOverrides.config.enabled;
    }

    // Merge other env overrides if they exist
    if (envOverrides.config.tools.length > 0) {
      fileConfig.config.tools = envOverrides.config.tools;
    }
    if (envOverrides.config.maxTools !== undefined) {
      fileConfig.config.maxTools = envOverrides.config.maxTools;
    }
    if (envOverrides.hasExplicitMode) {
      fileConfig.config.mode = envOverrides.config.mode;
    }

    logger.debug('Tool filter config loaded', {
      source: fileConfig.source,
      enabled: fileConfig.config.enabled,
      mode: fileConfig.config.mode,
      toolCount: fileConfig.config.tools.length,
    });

    return fileConfig;
  }

  // No file config found, try environment-only configuration
  const envConfig = loadFromEnvironment();
  if (envConfig.enabled) {
    logger.info('Tool filter config loaded from environment variables');
    return {
      config: envConfig,
      source: 'environment',
    };
  }

  // No configuration found
  logger.debug('No tool filter configuration found, filtering disabled');
  return null;
}

/**
 * Attempt to load configuration from config files
 */
async function loadFromConfigFiles(
  cwd: string,
  logger: ILogger
): Promise<LoadedToolFilterConfig | null> {
  for (const configPath of DEFAULT_CONFIG_PATHS) {
    const fullPath = join(cwd, configPath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const parsed = parseConfigFile(content, configPath);

      // Look for toolFilter in the parsed config
      if (parsed.toolFilter) {
        // Validate the configuration
        const validation = validateToolFilterConfig(parsed.toolFilter);
        logValidationResults(logger, validation, configPath);

        if (!validation.valid) {
          logger.error(`Invalid tool filter configuration in ${configPath}, using defaults`);
          continue;
        }

        const config = validateAndNormalize(parsed.toolFilter, validation);
        logger.info('Loaded tool filter config from file', { source: configPath });
        return {
          config,
          source: configPath,
        };
      }

      // Also support root-level config (entire file is the tool filter config)
      if (parsed.enabled !== undefined && parsed.mode !== undefined) {
        // Validate the configuration
        const validation = validateToolFilterConfig(parsed);
        logValidationResults(logger, validation, configPath);

        if (!validation.valid) {
          logger.error(`Invalid tool filter configuration in ${configPath}, using defaults`);
          continue;
        }

        const config = validateAndNormalize(parsed, validation);
        logger.info('Loaded tool filter config from file (root level)', { source: configPath });
        return {
          config,
          source: configPath,
        };
      }
    } catch (error) {
      // File doesn't exist or can't be read, continue to next
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Failed to parse config file: ${configPath}`, { error });
      }
      continue;
    }
  }

  return null;
}

/**
 * Log validation errors and warnings
 */
function logValidationResults(
  logger: ILogger,
  validation: ConfigValidationResult,
  source: string
): void {
  for (const error of validation.errors) {
    logger.error(`Config validation error in ${source}: ${error}`);
  }
  for (const warning of validation.warnings) {
    logger.warn(`Config validation warning in ${source}: ${warning}`);
  }
}

/**
 * Parse configuration file based on extension
 *
 * Supports JSON and YAML formats. YAML parsing uses the full-featured 'yaml'
 * library which supports all YAML 1.2 features including:
 * - Multi-line strings (block scalars)
 * - Anchors and aliases
 * - Flow style collections
 * - Tags and custom types
 * - Multiple documents
 */
function parseConfigFile(content: string, path: string): Record<string, unknown> {
  if (path.endsWith('.json')) {
    return JSON.parse(content);
  }

  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    const parsed = parseYaml(content);
    // Ensure we return an object (YAML can parse to primitives)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  }

  // Try JSON by default
  return JSON.parse(content);
}

/**
 * Load configuration entirely from environment variables
 */
function loadFromEnvironment(): MCPToolFilterConfig {
  const enabled = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED === 'true';
  const modeEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE;
  const mode: 'allowlist' | 'denylist' =
    modeEnv === 'allowlist' || modeEnv === 'denylist' ? modeEnv : 'allowlist';
  const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
  const tools = toolsEnv
    ? toolsEnv
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];
  const maxToolsEnv = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS;
  const maxTools = maxToolsEnv ? parseInt(maxToolsEnv, 10) : undefined;

  return {
    enabled,
    mode,
    tools,
    maxTools: maxTools && !isNaN(maxTools) ? maxTools : undefined,
  };
}

/**
 * Load environment variable overrides (for merging with file config)
 */
function loadEnvironmentOverrides(): {
  config: MCPToolFilterConfig;
  hasExplicitEnabled: boolean;
  hasExplicitMode: boolean;
} {
  const enabledEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED;
  const hasExplicitEnabled = enabledEnv === 'true' || enabledEnv === 'false';
  const enabled = enabledEnv === 'true';

  const modeEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE;
  const hasExplicitMode = modeEnv === 'allowlist' || modeEnv === 'denylist';
  const mode: 'allowlist' | 'denylist' = hasExplicitMode
    ? (modeEnv as 'allowlist' | 'denylist')
    : 'allowlist';

  const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
  const tools = toolsEnv
    ? toolsEnv
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : [];

  const maxToolsEnv = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS;
  const maxTools = maxToolsEnv ? parseInt(maxToolsEnv, 10) : undefined;

  return {
    config: {
      enabled,
      mode,
      tools,
      maxTools: maxTools && !isNaN(maxTools) ? maxTools : undefined,
    },
    hasExplicitEnabled,
    hasExplicitMode,
  };
}

/**
 * Validate and normalize configuration to ensure all required fields are present
 *
 * Uses validation result to filter out invalid values and use defaults instead.
 *
 * @param config - Partial configuration to normalize
 * @param validation - Optional validation result to use for filtering invalid values
 * @returns Fully normalized configuration with all required fields
 */
function validateAndNormalize(
  config: Partial<MCPToolFilterConfig>,
  validation?: ConfigValidationResult
): MCPToolFilterConfig {
  const hasError = (field: string): boolean => {
    if (!validation) return false;
    return validation.errors.some((e) => e.includes(`'${field}'`));
  };

  // Filter tools array - remove non-strings if validation passed but array has issues
  let tools = DEFAULT_CONFIG.tools;
  if (Array.isArray(config.tools) && !hasError('tools')) {
    tools = config.tools.filter((t): t is string => typeof t === 'string');
  }

  // Filter categories array - remove non-strings
  let categories: string[] | undefined = undefined;
  if (Array.isArray(config.categories) && !hasError('categories')) {
    const filtered = config.categories.filter((c): c is string => typeof c === 'string');
    categories = filtered.length > 0 ? filtered : undefined;
  }

  // Filter priorities - remove non-number values
  let priorities: Record<string, number> | undefined = undefined;
  if (
    typeof config.priorities === 'object' &&
    config.priorities !== null &&
    !Array.isArray(config.priorities) &&
    !hasError('priorities')
  ) {
    const filtered: Record<string, number> = {};
    for (const [key, value] of Object.entries(config.priorities)) {
      if (typeof value === 'number') {
        filtered[key] = value;
      }
    }
    priorities = Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  return {
    enabled: hasError('enabled') ? DEFAULT_CONFIG.enabled : (config.enabled ?? DEFAULT_CONFIG.enabled),
    mode: hasError('mode') ? DEFAULT_CONFIG.mode : (config.mode ?? DEFAULT_CONFIG.mode),
    tools,
    categories,
    maxTools:
      typeof config.maxTools === 'number' && config.maxTools > 0 && !hasError('maxTools')
        ? config.maxTools
        : undefined,
    priorities,
  };
}

