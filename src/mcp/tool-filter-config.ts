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
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { MCPToolFilterConfig } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';

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
        const config = validateAndNormalize(parsed.toolFilter);
        logger.info('Loaded tool filter config from file', { source: configPath });
        return {
          config,
          source: configPath,
        };
      }

      // Also support root-level config (entire file is the tool filter config)
      if (parsed.enabled !== undefined && parsed.mode !== undefined) {
        const config = validateAndNormalize(parsed);
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
 * Parse configuration file based on extension
 */
function parseConfigFile(content: string, path: string): Record<string, unknown> {
  if (path.endsWith('.json')) {
    return JSON.parse(content);
  }

  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    // Basic YAML support - for full YAML, consider adding js-yaml dependency
    return parseBasicYaml(content);
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
 */
function validateAndNormalize(config: Partial<MCPToolFilterConfig>): MCPToolFilterConfig {
  return {
    enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
    mode: config.mode ?? DEFAULT_CONFIG.mode,
    tools: Array.isArray(config.tools) ? config.tools : DEFAULT_CONFIG.tools,
    categories: Array.isArray(config.categories) ? config.categories : undefined,
    maxTools:
      typeof config.maxTools === 'number' && config.maxTools > 0 ? config.maxTools : undefined,
    priorities:
      typeof config.priorities === 'object' && config.priorities !== null
        ? config.priorities
        : undefined,
  };
}

/**
 * Basic YAML parser for simple key-value configurations
 *
 * Supports:
 * - Simple key: value pairs
 * - Nested objects
 * - Arrays with dash notation
 * - Comments (#)
 * - Quoted strings
 * - Booleans and numbers
 *
 * Note: For complex YAML, consider using js-yaml library.
 * This is a basic implementation for simple configuration files.
 */
function parseBasicYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ];
  let currentArray: unknown[] | null = null;
  let currentArrayKey = '';
  let currentArrayIndent = -1;

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Calculate indentation
    const indent = line.search(/\S/);

    // Check if this is an array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.substring(2).trim();

      if (currentArray && indent >= currentArrayIndent) {
        currentArray.push(parseYamlValue(value));
      }
      continue;
    }

    // Reset array context if indentation decreased
    if (indent <= currentArrayIndent) {
      currentArray = null;
      currentArrayKey = '';
      currentArrayIndent = -1;
    }

    // Parse key: value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, colonIndex).trim();
    const rawValue = trimmed.substring(colonIndex + 1).trim();

    // Pop stack until we find the correct parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (rawValue === '' || rawValue === null) {
      // This key introduces a new object or array
      // Check if next line starts with '-' for array
      const lineIdx = lines.indexOf(line);
      const nextLineIdx = lines.findIndex(
        (l, i) => i > lineIdx && l.trim() !== '' && !l.trim().startsWith('#')
      );
      const nextLine = nextLineIdx >= 0 ? lines[nextLineIdx] : '';

      if (nextLine.trim().startsWith('- ')) {
        // This is an array
        const arr: unknown[] = [];
        parent[key] = arr;
        currentArray = arr;
        currentArrayKey = key;
        currentArrayIndent = nextLine.search(/\S/);
      } else {
        // This is a nested object
        const newObj: Record<string, unknown> = {};
        parent[key] = newObj;
        stack.push({ obj: newObj, indent });
      }
    } else {
      // Simple value
      parent[key] = parseYamlValue(rawValue);
    }
  }

  return result;
}

/**
 * Parse a YAML value into its appropriate type
 */
function parseYamlValue(value: string): unknown {
  // Handle quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Handle booleans
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Handle null
  if (value === 'null' || value === '~') return null;

  // Handle numbers
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  // Default to string
  return value;
}
