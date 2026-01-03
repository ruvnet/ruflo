# MCP Tool Filtering Implementation Plan

## Problem Statement

When integrating claude-flow as an MCP server in services like Cursor, the large number of tools (50+) causes Cursor to disable the MCP server due to platform-imposed limits on total tools across all MCP servers.

**Goal**: Create a tool filtering mechanism that allows users to easily configure a whitelist of enabled tools via a configuration file, preventing disabled tools from appearing in MCP tool listings.

---

## Current Architecture Analysis

### Key Files Involved in Tool Registration

| File | Purpose | Role in Tool Filtering |
|------|---------|------------------------|
| `src/mcp/server.ts` | Main MCP server | Entry point for tool registration via `registerBuiltInTools()` |
| `src/mcp/tools.ts` | ToolRegistry class | Centralized registry with `register()`, `listTools()`, `getTool()` |
| `src/mcp/tool-registry.ts` | ClaudeFlowToolRegistry | In-process tool management with SDK integration |
| `src/mcp/router.ts` | RequestRouter | Routes `tools.list` and `tools.invoke` requests |
| `src/mcp/claude-flow-tools.ts` | Tool definitions | Creates 27+ Claude-Flow specific MCP tools |
| `src/mcp/swarm-tools.ts` | Swarm tools | Creates swarm coordination tools |
| `src/mcp/ruv-swarm-tools.ts` | RUV swarm tools | Creates additional swarm tools |
| `src/core/config.ts` | ConfigManager | Handles configuration loading (JSON, YAML, TOML) |
| `src/utils/types.ts` | Type definitions | Defines MCPConfig, MCPTool interfaces |

### Tool Registration Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server Startup                           │
│                  (src/mcp/server.ts)                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │   registerBuiltInTools()      │
           │   - system/info, system/health│
           │   - tools/list, tools/schema  │
           └───────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
createClaudeFlowTools()  createSwarmTools()  createRuvSwarmTools()
   (27+ tools)            (N tools)          (N tools)
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │   ToolRegistry.register()     │
           │   - Stores in tools Map       │
           │   - Creates capability info   │
           │   - Initializes metrics       │
           └───────────────────────────────┘
                           │
                           ▼
           ┌───────────────────────────────┐
           │   ToolRegistry.listTools()    │
           │   - Returns all tools         │  ← FILTERING POINT
           │   - Exposed via tools.list    │
           └───────────────────────────────┘
```

### Current Configuration System

The existing `ConfigManager` in `src/core/config.ts` provides:
- Multi-format support (JSON, YAML, TOML)
- Environment variable overrides
- Profile management
- Validation rules
- Change tracking

**Existing MCPConfig interface** (`src/utils/types.ts:305-318`):
```typescript
export interface MCPConfig {
  transport: 'stdio' | 'http' | 'websocket';
  host?: string;
  port?: number;
  tlsEnabled?: boolean;
  authToken?: string;
  auth?: MCPAuthConfig;
  loadBalancer?: MCPLoadBalancerConfig;
  sessionTimeout?: number;
  maxSessions?: number;
  enableMetrics?: boolean;
  corsEnabled?: boolean;
  corsOrigins?: string[];
  // ⚠️ NO TOOL FILTERING CONFIG CURRENTLY
}
```

---

## Implementation Plan

### Phase 1: Configuration Schema Design

#### 1.1 Define Tool Filtering Configuration Interface

**File: `src/utils/types.ts`**

Add new interface for tool filtering:

```typescript
/**
 * Configuration for MCP tool filtering
 * Allows selective enabling/disabling of tools to meet platform limits
 */
export interface MCPToolFilterConfig {
  /**
   * Enable tool filtering (default: false for backward compatibility)
   */
  enabled: boolean;

  /**
   * Filter mode:
   * - 'allowlist': Only tools in the list are enabled
   * - 'denylist': All tools except those in the list are enabled
   */
  mode: 'allowlist' | 'denylist';

  /**
   * List of tool names/patterns
   * Supports exact names ('system/info') or glob patterns ('system/*')
   */
  tools: string[];

  /**
   * Filter by category (namespace prefix)
   * e.g., ['system', 'agents'] enables all tools in those namespaces
   */
  categories?: string[];

  /**
   * Maximum number of tools to expose (optional safety limit)
   * Useful for platforms with strict tool limits
   */
  maxTools?: number;

  /**
   * Priority ordering when maxTools limit is reached
   * Higher priority tools are kept when trimming
   */
  priorities?: {
    [toolName: string]: number;
  };
}
```

#### 1.2 Extend MCPConfig Interface

**File: `src/utils/types.ts`**

Update MCPConfig to include tool filtering:

```typescript
export interface MCPConfig {
  transport: 'stdio' | 'http' | 'websocket';
  host?: string;
  port?: number;
  tlsEnabled?: boolean;
  authToken?: string;
  auth?: MCPAuthConfig;
  loadBalancer?: MCPLoadBalancerConfig;
  sessionTimeout?: number;
  maxSessions?: number;
  enableMetrics?: boolean;
  corsEnabled?: boolean;
  corsOrigins?: string[];

  // NEW: Tool filtering configuration
  toolFilter?: MCPToolFilterConfig;
}
```

### Phase 2: Configuration File Format

#### 2.1 Create Dedicated Tool Filter Config File

**File location**: `.claude-flow/mcp-tools.json` (or `.yaml`, `.toml`)

**JSON Format Example**:
```json
{
  "$schema": "https://claude-flow.dev/schemas/mcp-tools.schema.json",
  "version": "1.0",
  "toolFilter": {
    "enabled": true,
    "mode": "allowlist",
    "tools": [
      "system/info",
      "system/health",
      "agents/spawn",
      "agents/list",
      "memory/store",
      "memory/retrieve",
      "tasks/create",
      "tasks/status"
    ],
    "categories": [],
    "maxTools": 30,
    "priorities": {
      "system/info": 100,
      "system/health": 99,
      "agents/spawn": 90
    }
  }
}
```

**YAML Format Example**:
```yaml
version: "1.0"
toolFilter:
  enabled: true
  mode: allowlist

  # Explicit tool allowlist
  tools:
    - system/info
    - system/health
    - agents/spawn
    - agents/list
    - agents/metrics
    - memory/*         # Wildcard: all memory tools
    - tasks/create
    - tasks/status

  # Category-based filtering (alternative to explicit tools)
  categories:
    - system
    - agents

  # Safety limit for platforms like Cursor
  maxTools: 30

  # Priority when trimming to maxTools limit
  priorities:
    system/info: 100
    system/health: 99
    agents/spawn: 90
```

#### 2.2 Environment Variable Support

Allow configuration via environment variables for deployment flexibility:

```bash
# Enable/disable filtering
CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED=true

# Filter mode
CLAUDE_FLOW_MCP_TOOL_FILTER_MODE=allowlist

# Comma-separated tool list
CLAUDE_FLOW_MCP_TOOLS_ALLOWED=system/info,system/health,agents/spawn,agents/list

# Maximum tools limit
CLAUDE_FLOW_MCP_MAX_TOOLS=30
```

### Phase 3: Tool Filter Implementation

#### 3.1 Create ToolFilter Class

**File: `src/mcp/tool-filter.ts`** (NEW FILE)

```typescript
/**
 * Tool Filter for MCP Server
 *
 * Provides filtering capabilities to limit exposed tools based on configuration.
 * Designed to work with platforms that have tool count limits (e.g., Cursor).
 */

import type { MCPToolFilterConfig, MCPTool } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';
import { minimatch } from 'minimatch'; // For glob pattern matching

export interface IToolFilter {
  shouldIncludeTool(toolName: string): boolean;
  filterTools(tools: MCPTool[]): MCPTool[];
  getFilterStats(): ToolFilterStats;
}

export interface ToolFilterStats {
  totalTools: number;
  filteredTools: number;
  excludedTools: number;
  filterMode: 'allowlist' | 'denylist';
  enabled: boolean;
}

export class ToolFilter implements IToolFilter {
  private config: MCPToolFilterConfig;
  private logger: ILogger;
  private allowedTools: Set<string>;
  private deniedTools: Set<string>;
  private patterns: string[];
  private stats: ToolFilterStats;

  constructor(config: MCPToolFilterConfig | undefined, logger: ILogger) {
    this.logger = logger;

    // Default config if not provided (no filtering)
    this.config = config || {
      enabled: false,
      mode: 'allowlist',
      tools: [],
    };

    this.allowedTools = new Set();
    this.deniedTools = new Set();
    this.patterns = [];
    this.stats = {
      totalTools: 0,
      filteredTools: 0,
      excludedTools: 0,
      filterMode: this.config.mode,
      enabled: this.config.enabled,
    };

    this.parseConfiguration();
  }

  /**
   * Parse configuration and prepare filter sets
   */
  private parseConfiguration(): void {
    if (!this.config.enabled) {
      this.logger.debug('Tool filtering disabled');
      return;
    }

    // Separate exact names from glob patterns
    for (const tool of this.config.tools) {
      if (this.isPattern(tool)) {
        this.patterns.push(tool);
      } else if (this.config.mode === 'allowlist') {
        this.allowedTools.add(tool);
      } else {
        this.deniedTools.add(tool);
      }
    }

    // Add category-based tools
    if (this.config.categories) {
      for (const category of this.config.categories) {
        this.patterns.push(`${category}/*`);
      }
    }

    this.logger.info('Tool filter initialized', {
      mode: this.config.mode,
      explicitTools: this.allowedTools.size || this.deniedTools.size,
      patterns: this.patterns.length,
      maxTools: this.config.maxTools,
    });
  }

  /**
   * Check if a string is a glob pattern
   */
  private isPattern(str: string): boolean {
    return str.includes('*') || str.includes('?') || str.includes('[');
  }

  /**
   * Check if a tool name matches any pattern
   */
  private matchesPattern(toolName: string): boolean {
    return this.patterns.some(pattern => minimatch(toolName, pattern));
  }

  /**
   * Determine if a tool should be included based on filter config
   */
  shouldIncludeTool(toolName: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    if (this.config.mode === 'allowlist') {
      // In allowlist mode, tool must be explicitly allowed or match a pattern
      return this.allowedTools.has(toolName) || this.matchesPattern(toolName);
    } else {
      // In denylist mode, tool is included unless explicitly denied
      return !this.deniedTools.has(toolName) && !this.matchesPattern(toolName);
    }
  }

  /**
   * Filter an array of tools based on configuration
   */
  filterTools(tools: MCPTool[]): MCPTool[] {
    this.stats.totalTools = tools.length;

    if (!this.config.enabled) {
      this.stats.filteredTools = tools.length;
      this.stats.excludedTools = 0;
      return tools;
    }

    // Apply allow/deny filtering
    let filteredTools = tools.filter(tool => this.shouldIncludeTool(tool.name));

    // Apply maxTools limit if specified
    if (this.config.maxTools && filteredTools.length > this.config.maxTools) {
      filteredTools = this.applyMaxToolsLimit(filteredTools);
    }

    this.stats.filteredTools = filteredTools.length;
    this.stats.excludedTools = tools.length - filteredTools.length;

    this.logger.info('Tools filtered', {
      total: tools.length,
      included: filteredTools.length,
      excluded: this.stats.excludedTools,
    });

    return filteredTools;
  }

  /**
   * Apply maxTools limit using priority ordering
   */
  private applyMaxToolsLimit(tools: MCPTool[]): MCPTool[] {
    const priorities = this.config.priorities || {};

    // Sort by priority (higher first), then by name
    const sorted = tools.sort((a, b) => {
      const priorityA = priorities[a.name] ?? 0;
      const priorityB = priorities[b.name] ?? 0;
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      return a.name.localeCompare(b.name);
    });

    const result = sorted.slice(0, this.config.maxTools);

    this.logger.warn('Tool count exceeded maxTools limit', {
      maxTools: this.config.maxTools,
      totalTools: tools.length,
      trimmedTools: tools.length - result.length,
    });

    return result;
  }

  /**
   * Get filtering statistics
   */
  getFilterStats(): ToolFilterStats {
    return { ...this.stats };
  }

  /**
   * Update filter configuration at runtime
   */
  updateConfig(config: MCPToolFilterConfig): void {
    this.config = config;
    this.allowedTools.clear();
    this.deniedTools.clear();
    this.patterns = [];
    this.parseConfiguration();
  }
}

/**
 * Create a tool filter from configuration
 */
export function createToolFilter(
  config: MCPToolFilterConfig | undefined,
  logger: ILogger
): IToolFilter {
  return new ToolFilter(config, logger);
}
```

#### 3.2 Integrate Filter into ToolRegistry

**File: `src/mcp/tools.ts`**

Modify `ToolRegistry` class to use filtering:

```typescript
import { IToolFilter, createToolFilter } from './tool-filter.js';

export class ToolRegistry extends EventEmitter {
  private tools = new Map<string, MCPTool>();
  private toolFilter?: IToolFilter;
  // ... existing properties

  constructor(private logger: ILogger, toolFilterConfig?: MCPToolFilterConfig) {
    super();
    if (toolFilterConfig) {
      this.toolFilter = createToolFilter(toolFilterConfig, logger);
    }
  }

  /**
   * Sets or updates the tool filter
   */
  setToolFilter(config: MCPToolFilterConfig): void {
    this.toolFilter = createToolFilter(config, this.logger);
    this.emit('filterUpdated', { config });
  }

  /**
   * Lists all registered tools (with filtering applied)
   */
  listTools(): Array<{ name: string; description: string }> {
    let tools = Array.from(this.tools.values());

    // Apply filtering if enabled
    if (this.toolFilter) {
      tools = this.toolFilter.filterTools(tools);
    }

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  /**
   * Gets tool count (after filtering)
   */
  getToolCount(): number {
    if (this.toolFilter) {
      return this.toolFilter.filterTools(Array.from(this.tools.values())).length;
    }
    return this.tools.size;
  }

  /**
   * Gets all registered tool count (before filtering)
   */
  getTotalToolCount(): number {
    return this.tools.size;
  }

  /**
   * Gets filter statistics
   */
  getFilterStats(): ToolFilterStats | null {
    return this.toolFilter?.getFilterStats() || null;
  }
}
```

#### 3.3 Integrate Filter into MCPServer

**File: `src/mcp/server.ts`**

Modify `MCPServer` to load and apply filter configuration:

```typescript
import { createToolFilter, IToolFilter } from './tool-filter.js';

export class MCPServer implements IMCPServer {
  private toolFilter?: IToolFilter;
  // ... existing properties

  constructor(
    private config: MCPConfig,
    // ... other params
  ) {
    // ... existing initialization

    // Initialize tool filter if configured
    if (config.toolFilter?.enabled) {
      this.toolFilter = createToolFilter(config.toolFilter, this.logger);
    }

    // Pass filter config to tool registry
    this.toolRegistry = new ToolRegistry(logger, config.toolFilter);
  }

  // ... existing methods

  /**
   * Registers a tool with filter check
   */
  registerTool(tool: MCPTool): void {
    // Always register to internal registry
    this.toolRegistry.register(tool);

    // Log if tool is filtered
    if (this.toolFilter && !this.toolFilter.shouldIncludeTool(tool.name)) {
      this.logger.debug('Tool registered but filtered from listings', { name: tool.name });
    } else {
      this.logger.info('Tool registered', { name: tool.name });
    }
  }
}
```

### Phase 4: Configuration Loading

#### 4.1 Create Tool Filter Config Loader

**File: `src/mcp/tool-filter-config.ts`** (NEW FILE)

```typescript
/**
 * Tool Filter Configuration Loader
 *
 * Loads tool filter configuration from multiple sources:
 * 1. Dedicated config file (.claude-flow/mcp-tools.json)
 * 2. Main config file (mcp.toolFilter section)
 * 3. Environment variables
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { MCPToolFilterConfig } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';

const DEFAULT_CONFIG_PATHS = [
  '.claude-flow/mcp-tools.json',
  '.claude-flow/mcp-tools.yaml',
  '.claude-flow/mcp-tools.yml',
  'mcp-tools.json',
  'claude-flow.json',
];

export interface LoadedToolFilterConfig {
  config: MCPToolFilterConfig;
  source: string;
}

export async function loadToolFilterConfig(
  logger: ILogger,
  workingDirectory?: string
): Promise<LoadedToolFilterConfig | null> {
  const cwd = workingDirectory || process.cwd();

  // Try to load from dedicated config files
  for (const configPath of DEFAULT_CONFIG_PATHS) {
    const fullPath = join(cwd, configPath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const config = parseConfigFile(content, configPath);

      if (config.toolFilter) {
        logger.info('Loaded tool filter config', { source: configPath });
        return {
          config: config.toolFilter,
          source: configPath,
        };
      }
    } catch (error) {
      // File doesn't exist or can't be read, try next
      continue;
    }
  }

  // Try environment variables
  const envConfig = loadFromEnvironment();
  if (envConfig.enabled) {
    logger.info('Loaded tool filter config from environment');
    return {
      config: envConfig,
      source: 'environment',
    };
  }

  return null;
}

function parseConfigFile(content: string, path: string): any {
  if (path.endsWith('.json')) {
    return JSON.parse(content);
  }

  if (path.endsWith('.yaml') || path.endsWith('.yml')) {
    // Simple YAML parsing (or use js-yaml library)
    return parseSimpleYaml(content);
  }

  // Try JSON by default
  return JSON.parse(content);
}

function loadFromEnvironment(): MCPToolFilterConfig {
  const enabled = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED === 'true';
  const mode = (process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE || 'allowlist') as 'allowlist' | 'denylist';
  const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
  const tools = toolsEnv ? toolsEnv.split(',').map(t => t.trim()) : [];
  const maxTools = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS
    ? parseInt(process.env.CLAUDE_FLOW_MCP_MAX_TOOLS, 10)
    : undefined;

  return {
    enabled,
    mode,
    tools,
    maxTools,
  };
}

function parseSimpleYaml(content: string): any {
  // Simplified YAML parser (for production, use js-yaml)
  const result: any = {};
  const lines = content.split('\n');
  let currentPath: string[] = [];
  let currentIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const colonIndex = trimmed.indexOf(':');

    if (colonIndex === -1) continue;

    const key = trimmed.substring(0, colonIndex).trim();
    let value: any = trimmed.substring(colonIndex + 1).trim();

    // Adjust path based on indentation
    while (currentPath.length > 0 && indent <= currentIndent) {
      currentPath.pop();
      currentIndent -= 2;
    }

    // Parse value
    if (value === '' || value === null) {
      // Object or array follows
      currentPath.push(key);
      currentIndent = indent;
    } else {
      // Parse scalar value
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

      setNestedValue(result, [...currentPath, key], value);
    }
  }

  return result;
}

function setNestedValue(obj: any, path: string[], value: any): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i] in current)) {
      current[path[i]] = {};
    }
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}
```

### Phase 5: CLI Integration

#### 5.1 Add Tool Filter Commands

**File: `src/cli/commands/mcp.ts`**

Add subcommands for managing tool filters:

```typescript
// Add to existing MCP commands

const toolFilterCommand = new Command('tools')
  .description('Manage MCP tool filtering');

toolFilterCommand
  .command('list')
  .description('List all registered tools with filter status')
  .option('--all', 'Show all tools including filtered ones')
  .action(async (options) => {
    // Implementation
  });

toolFilterCommand
  .command('filter')
  .description('Configure tool filtering')
  .option('--enable', 'Enable tool filtering')
  .option('--disable', 'Disable tool filtering')
  .option('--mode <mode>', 'Set filter mode (allowlist|denylist)')
  .option('--add <tools>', 'Add tools to filter list')
  .option('--remove <tools>', 'Remove tools from filter list')
  .action(async (options) => {
    // Implementation
  });

toolFilterCommand
  .command('export')
  .description('Export current tool list to config file')
  .option('--format <format>', 'Output format (json|yaml)')
  .option('--output <file>', 'Output file path')
  .action(async (options) => {
    // Implementation
  });

toolFilterCommand
  .command('stats')
  .description('Show tool filtering statistics')
  .action(async () => {
    // Implementation
  });
```

### Phase 6: Integration Points Summary

#### 6.1 Files to Create

| File | Purpose |
|------|---------|
| `src/mcp/tool-filter.ts` | Core filtering logic |
| `src/mcp/tool-filter-config.ts` | Configuration loading |

#### 6.2 Files to Modify

| File | Changes |
|------|---------|
| `src/utils/types.ts` | Add `MCPToolFilterConfig` interface |
| `src/mcp/tools.ts` | Integrate filter into `ToolRegistry.listTools()` |
| `src/mcp/server.ts` | Load filter config, pass to registry |
| `src/mcp/tool-registry.ts` | Apply filtering in `ClaudeFlowToolRegistry` |
| `src/core/config.ts` | Add validation rules for tool filter config |
| `src/cli/commands/mcp.ts` | Add CLI commands for filter management |

#### 6.3 Filtering Integration Points

```
                    ┌──────────────────────────────────────┐
                    │  Configuration Sources               │
                    │  - .claude-flow/mcp-tools.json      │
                    │  - Environment variables            │
                    │  - CLI arguments                    │
                    └─────────────────┬────────────────────┘
                                      │
                                      ▼
                    ┌──────────────────────────────────────┐
                    │  ToolFilterConfig Loader             │
                    │  (src/mcp/tool-filter-config.ts)    │
                    └─────────────────┬────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                         MCPServer                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                      ToolRegistry                          │  │
│  │  ┌────────────────┐    ┌──────────────────┐               │  │
│  │  │ tools Map      │───▶│ ToolFilter       │               │  │
│  │  │ (all tools)    │    │ - shouldInclude()│               │  │
│  │  └────────────────┘    │ - filterTools()  │               │  │
│  │                        └────────┬─────────┘               │  │
│  │                                 │                          │  │
│  │  ┌────────────────────────────────────────────────────┐   │  │
│  │  │              listTools() ◀─────────────────────────┼───┼──┤
│  │  │              (filtered result)                     │   │  │
│  │  └────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌──────────────────────────────────────┐
                    │  MCP Client (e.g., Cursor)          │
                    │  - Receives filtered tools.list     │
                    │  - Only sees enabled tools          │
                    └──────────────────────────────────────┘
```

---

## Compatibility Notes

### Existing Branch Changes

The current `btsomogyi/tool-filtering` branch has the following relevant changes:

1. **Deleted `src/mcp/tool-registry-progressive.ts`** - This file implemented a progressive disclosure pattern. The tool filtering implementation should be added as a separate concern that works with any tool loading strategy.

2. **`src/mcp/tool-registry.ts`** - The `ClaudeFlowToolRegistry` class exists and manages in-process tool execution. Tool filtering should be integrated here as well.

3. **`src/mcp/server.ts`** - Main server with `registerBuiltInTools()` method. This is where filtering should be applied during registration.

### Backward Compatibility

- **Default behavior**: When no filter config is provided, all tools are enabled (current behavior)
- **Graceful degradation**: Missing config file = no filtering
- **Environment override**: Environment variables can override file config
- **Runtime updates**: Filter can be updated without server restart

---

## Testing Strategy

### Unit Tests

```typescript
// tests/mcp/tool-filter.test.ts

describe('ToolFilter', () => {
  describe('allowlist mode', () => {
    it('should include explicitly allowed tools');
    it('should exclude non-allowed tools');
    it('should support glob patterns');
    it('should support category filtering');
  });

  describe('denylist mode', () => {
    it('should exclude explicitly denied tools');
    it('should include non-denied tools');
  });

  describe('maxTools limit', () => {
    it('should trim tools to maxTools limit');
    it('should respect priority ordering');
  });

  describe('configuration loading', () => {
    it('should load from JSON file');
    it('should load from YAML file');
    it('should load from environment variables');
    it('should merge multiple config sources');
  });
});
```

### Integration Tests

```typescript
// tests/mcp/filtered-server.test.ts

describe('MCPServer with filtering', () => {
  it('should expose only filtered tools via tools.list');
  it('should allow execution of filtered tools');
  it('should reject execution of non-filtered tools');
  it('should update filter at runtime');
});
```

---

## Rollout Plan

### Stage 1: Core Implementation
1. Add `MCPToolFilterConfig` interface
2. Implement `ToolFilter` class
3. Integrate into `ToolRegistry`
4. Add unit tests

### Stage 2: Configuration Loading
1. Implement config file loader
2. Add environment variable support
3. Integrate into `MCPServer` startup

### Stage 3: CLI Integration
1. Add `claude-flow mcp tools` commands
2. Implement tool list export
3. Add filter statistics

### Stage 4: Documentation
1. Update README with filtering instructions
2. Add configuration examples
3. Create migration guide

---

## Example Configurations

### Minimal Config (Cursor-friendly - 20 tools)

```json
{
  "toolFilter": {
    "enabled": true,
    "mode": "allowlist",
    "tools": [
      "system/info",
      "system/health",
      "agents/spawn",
      "agents/list",
      "agents/status",
      "memory/store",
      "memory/retrieve",
      "memory/query",
      "tasks/create",
      "tasks/list",
      "tasks/status",
      "swarm/init",
      "swarm/status",
      "terminal/execute",
      "config/get",
      "config/set",
      "workflow/create",
      "workflow/execute",
      "metrics/get",
      "neural/status"
    ],
    "maxTools": 20
  }
}
```

### Category-Based Config

```yaml
toolFilter:
  enabled: true
  mode: allowlist
  categories:
    - system      # All system/* tools
    - agents      # All agents/* tools
    - memory      # All memory/* tools
  maxTools: 30
```

### Denylist Config (Exclude specific tools)

```json
{
  "toolFilter": {
    "enabled": true,
    "mode": "denylist",
    "tools": [
      "neural/*",
      "enterprise/*",
      "debug/*"
    ]
  }
}
```

---

## Success Criteria

1. **Functional**: Tool filtering correctly limits exposed tools
2. **Performance**: No measurable impact on tool listing or execution
3. **Compatibility**: Works with existing configuration system
4. **Usability**: Simple config file format, clear documentation
5. **Reliability**: Graceful handling of missing/invalid config

---

## Appendix A: Tool Dependency Graph

This section documents the dependencies between claude-flow MCP tools, enabling users to create minimal configurations that include all required dependencies.

### Tool Categories and Sources

| Source File | Tool Count | Category |
|-------------|-----------|----------|
| `claude-flow-tools.ts` | 27 | Core orchestration tools |
| `swarm-tools.ts` | 16 + 4 legacy | Swarm coordination tools |
| `ruv-swarm-tools.ts` | 15 | External ruv-swarm CLI wrapper |

### Master Dependency Graph

```
                           ┌─────────────────────────────────────────────────────┐
                           │              INITIALIZATION LAYER                   │
                           │                                                     │
                           │  swarm_init ─────────────────────────────────────┐  │
                           │       │                                          │  │
                           │       │ Creates swarm context, sets topology     │  │
                           │       │                                          │  │
                           └───────┼──────────────────────────────────────────┼──┘
                                   │                                          │
        ┌──────────────────────────┼──────────────────────────────────────────┼──────────────────────────┐
        │                          │           SWARM MANAGEMENT               │                          │
        │                          ▼                                          ▼                          │
        │  ┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐    │
        │  │         SWARM STATUS TOOLS              │   │         SWARM CONTROL TOOLS             │    │
        │  │                                         │   │                                         │    │
        │  │  swarm_status ◀───────────────────────┐ │   │  swarm_scale ───────▶ swarm_init       │    │
        │  │  swarm_monitor ◀──────────────────────┤ │   │  swarm_destroy                         │    │
        │  │  swarm/get-status ◀───────────────────┤ │   │  swarm/emergency-stop                  │    │
        │  │  swarm/get-comprehensive-status ◀─────┤ │   │  topology_optimize                     │    │
        │  │                                       │ │   │  load_balance ───────▶ agent_list      │    │
        │  └───────────────────────────────────────┼─┘   │  coordination_sync                     │    │
        │                                          │     └─────────────────────────────────────────┘    │
        └──────────────────────────────────────────┼────────────────────────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼────────────────────────────────────────────────────┐
        │                          │               │          AGENT LAYER                               │
        │                          ▼               │                                                    │
        │  ┌─────────────────────────────────────────┐                                                  │
        │  │           AGENT SPAWNING                 │                                                  │
        │  │                                          │                                                  │
        │  │  agent_spawn ────────────────────────────┼────────────────────────────────────┐            │
        │  │  agents/spawn ───────────────────────────┼────────────────────────────────────┤            │
        │  │  agents/spawn_parallel ──────────────────┼────────────────────────────────────┤            │
        │  │  agent/create ───────────────────────────┼────────────────────────────────────┤            │
        │  └──────────────────────────────────────────┘                                    │            │
        │                          │                                                       │            │
        │                          ▼ (produces agentId)                                    │            │
        │  ┌──────────────────────────────────────────────────────────────────────────────┐│            │
        │  │              AGENT MANAGEMENT (require agentId)                              ││            │
        │  │                                                                              ││            │
        │  │  agent_list ◀────────────────────────────────────────────────────────────────┘│            │
        │  │  agents/list ◀────────────────────────────────────────────────────────────────┤            │
        │  │  agents/info ◀─────── requires agentId from spawn/list                        │            │
        │  │  agents/terminate ◀── requires agentId from spawn/list                        │            │
        │  │  agent_metrics ◀───── requires agentId (optional)                             │            │
        │  └───────────────────────────────────────────────────────────────────────────────┘            │
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼────────────────────────────────────────────────────┐
        │                          │               │          TASK LAYER                                │
        │                          ▼               │                                                    │
        │  ┌──────────────────────────────────────────────────────────────────────────────────────────┐ │
        │  │                           TASK ORCHESTRATION                                             │ │
        │  │                                                                                          │ │
        │  │  task_orchestrate ──────┬──────────────────────────────────────────┐                     │ │
        │  │  tasks/create ──────────┤                                          │                     │ │
        │  │  swarm/create-objective─┤                                          │                     │ │
        │  │                         │                                          ▼                     │ │
        │  │                         │ (produces taskId)          ┌─────────────────────────────┐     │ │
        │  │                         │                            │  swarm/execute-objective    │     │ │
        │  │                         ▼                            │  (requires objectiveId)     │     │ │
        │  │  ┌───────────────────────────────────────┐           └─────────────────────────────┘     │ │
        │  │  │  TASK STATUS (require taskId)         │                                               │ │
        │  │  │                                       │                                               │ │
        │  │  │  task_status ◀─── requires taskId     │                                               │ │
        │  │  │  tasks/status ◀── requires taskId     │                                               │ │
        │  │  │  task_results ◀── requires taskId     │                                               │ │
        │  │  │  tasks/list ◀──── optional filter     │                                               │ │
        │  │  │  tasks/cancel ◀── requires taskId     │                                               │ │
        │  │  │  tasks/assign ◀── requires taskId     │                                               │ │
        │  │  │                    + agentId          │                                               │ │
        │  │  └───────────────────────────────────────┘                                               │ │
        │  └──────────────────────────────────────────────────────────────────────────────────────────┘ │
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼────────────────────────────────────────────────────┐
        │                          │               │          MEMORY LAYER                              │
        │                          ▼               │                                                    │
        │  ┌───────────────────────────────────────────────────────────────────┐                        │
        │  │                    MEMORY OPERATIONS                               │                        │
        │  │                                                                    │                        │
        │  │  ┌────────────────────┐    ┌────────────────────────────────────┐ │                        │
        │  │  │  CORE MEMORY       │    │  ADVANCED MEMORY                    │ │                        │
        │  │  │                    │    │                                     │ │                        │
        │  │  │  memory_usage ─────┼───▶│  memory_search ◀── uses store data  │ │                        │
        │  │  │  (store/retrieve/  │    │  memory_persist ◀─ depends on store │ │                        │
        │  │  │   list/delete)     │    │  memory_namespace                   │ │                        │
        │  │  │                    │    │  memory_backup ◀── backup store     │ │                        │
        │  │  │  memory/store      │    │  memory_restore ◀─ restore to store │ │                        │
        │  │  │  memory/query      │    │  memory_compress                    │ │                        │
        │  │  │  memory/delete     │    │  memory_sync                        │ │                        │
        │  │  │  memory/export     │    │  cache_manage                       │ │                        │
        │  │  │  memory/import     │    │  state_snapshot                     │ │                        │
        │  │  │                    │    │  context_restore ◀─ uses snapshot   │ │                        │
        │  │  └────────────────────┘    │  memory_analytics                   │ │                        │
        │  │                            └────────────────────────────────────┘ │                        │
        │  └───────────────────────────────────────────────────────────────────┘                        │
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼────────────────────────────────────────────────────┐
        │                          │               │          NEURAL LAYER                              │
        │                          ▼               │                                                    │
        │  ┌───────────────────────────────────────────────────────────────────┐                        │
        │  │                    NEURAL OPERATIONS                               │                        │
        │  │                                                                    │                        │
        │  │  ┌────────────────────┐    ┌────────────────────────────────────┐ │                        │
        │  │  │  STATUS & PATTERNS │    │  TRAINING & INFERENCE               │ │                        │
        │  │  │                    │    │                                     │ │                        │
        │  │  │  neural_status     │    │  neural_train ──────────┐           │ │                        │
        │  │  │  neural_patterns ──┼────┼▶ pattern_recognize      │           │ │                        │
        │  │  │                    │    │  learning_adapt          │           │ │                        │
        │  │  │                    │    │                          ▼           │ │                        │
        │  │  └────────────────────┘    │  ┌───────────────────────────────┐  │ │                        │
        │  │                            │  │  MODEL OPERATIONS             │  │ │                        │
        │  │                            │  │                               │  │ │                        │
        │  │                            │  │  model_load ◀── load model    │  │ │                        │
        │  │                            │  │  model_save ◀── save trained  │  │ │                        │
        │  │                            │  │  neural_predict ◀─ inference  │  │ │                        │
        │  │                            │  │  inference_run ◀── batch      │  │ │                        │
        │  │                            │  │  neural_compress              │  │ │                        │
        │  │                            │  │  ensemble_create              │  │ │                        │
        │  │                            │  │  transfer_learn               │  │ │                        │
        │  │                            │  │  neural_explain               │  │ │                        │
        │  │                            │  │  cognitive_analyze            │  │ │                        │
        │  │                            │  │  wasm_optimize                │  │ │                        │
        │  │                            │  └───────────────────────────────┘  │ │                        │
        │  │                            └────────────────────────────────────┘ │                        │
        │  └───────────────────────────────────────────────────────────────────┘                        │
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
                                                   │
        ┌──────────────────────────────────────────┼────────────────────────────────────────────────────┐
        │                          │               │          STANDALONE TOOLS (No Dependencies)        │
        │                          ▼               │                                                    │
        │  ┌───────────────────────────────────────────────────────────────────┐                        │
        │  │  SYSTEM TOOLS             │  CONFIG TOOLS         │  UTILITY      │                        │
        │  │                           │                       │               │                        │
        │  │  system/status            │  config/get           │  features_detect                       │
        │  │  system/metrics           │  config/update        │  benchmark_run                         │
        │  │  system/health            │  config/validate      │  health_check                          │
        │  │  system/info              │                       │  performance_report                    │
        │  │                           │                       │  bottleneck_analyze                    │
        │  ├───────────────────────────┼───────────────────────┤  token_usage                           │
        │  │  WORKFLOW TOOLS           │  TERMINAL TOOLS       │  metrics_collect                       │
        │  │                           │                       │  trend_analysis                        │
        │  │  workflow/list            │  terminal/list        │  cost_analysis                         │
        │  │  workflow/create ─────────┤  terminal/create ─────┤  quality_assess                        │
        │  │        │                  │        │              │  error_analysis                        │
        │  │        ▼                  │        ▼              │  usage_stats                           │
        │  │  workflow/execute         │  terminal/execute     │                                        │
        │  │                           │                       │                                        │
        │  └───────────────────────────┴───────────────────────┴────────────────────────────────────────┘
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Dependency Categories

#### 1. Initialization Dependencies (Must be called first)

| Tool | Creates | Required By |
|------|---------|-------------|
| `swarm_init` | Swarm context, CLAUDE_SWARM_ID | All swarm/agent tools |
| `terminal/create` | Terminal session | `terminal/execute` |
| `workflow/create` | Workflow definition | `workflow/execute` |

#### 2. ID-Producing Tools (Output used by other tools)

| Tool | Produces | Consumed By |
|------|----------|-------------|
| `agent_spawn` / `agents/spawn` | agentId | `agents/info`, `agents/terminate`, `tasks/assign`, `agent_metrics` |
| `task_orchestrate` / `tasks/create` | taskId | `task_status`, `tasks/status`, `task_results`, `tasks/cancel`, `tasks/assign` |
| `swarm/create-objective` | objectiveId | `swarm/execute-objective` |
| `memory_usage` (store) | entryId | `memory_usage` (retrieve/delete), `memory/query`, `memory/export` |
| `state_snapshot` | snapshotId | `context_restore` |

#### 3. Standalone Tools (No dependencies)

These tools can be called independently at any time:

```
system/info          system/health        system/status        system/metrics
config/get           config/validate      features_detect      benchmark_run
performance_report   bottleneck_analyze   health_check         token_usage
metrics_collect      trend_analysis       cost_analysis        quality_assess
error_analysis       usage_stats          memory_analytics
```

---

## Appendix B: Hive-Mind Minimal Configuration

The hive-mind system is the core orchestration engine for claude-flow. Below are configurations ranging from minimal to full-featured.

### Minimal Configuration (10 tools - Basic Hive-Mind)

This is the absolute minimum for hive-mind to function:

```json
{
  "toolFilter": {
    "enabled": true,
    "mode": "allowlist",
    "tools": [
      "swarm_init",
      "swarm_status",
      "swarm_destroy",
      "agent_spawn",
      "agent_list",
      "task_orchestrate",
      "task_status",
      "memory_usage",
      "memory_search",
      "neural_patterns"
    ],
    "maxTools": 10
  }
}
```

**Capabilities with this config:**
- ✅ Initialize and destroy swarms
- ✅ Spawn and list agents
- ✅ Orchestrate tasks and check status
- ✅ Store and search memory
- ✅ Basic pattern analysis
- ❌ No advanced memory (backup, sync, namespaces)
- ❌ No neural training
- ❌ No performance monitoring

### Recommended Configuration (25 tools - Full Hive-Mind)

This provides all hive-mind features without extras:

```json
{
  "toolFilter": {
    "enabled": true,
    "mode": "allowlist",
    "tools": [
      "swarm_init",
      "swarm_status",
      "swarm_destroy",
      "swarm_monitor",
      "agent_spawn",
      "agent_list",
      "agent_metrics",
      "task_orchestrate",
      "task_status",
      "task_results",
      "memory_usage",
      "memory_search",
      "memory_persist",
      "memory_namespace",
      "cache_manage",
      "state_snapshot",
      "neural_status",
      "neural_train",
      "neural_patterns",
      "neural_predict",
      "pattern_recognize",
      "performance_report",
      "bottleneck_analyze",
      "health_check",
      "features_detect"
    ],
    "maxTools": 25,
    "priorities": {
      "swarm_init": 100,
      "swarm_status": 99,
      "agent_spawn": 98,
      "agent_list": 97,
      "task_orchestrate": 96,
      "memory_usage": 95,
      "memory_search": 94
    }
  }
}
```

**Capabilities with this config:**
- ✅ Full swarm lifecycle management
- ✅ Complete agent management with metrics
- ✅ Full task orchestration with results
- ✅ Advanced memory (persistence, namespaces, caching, snapshots)
- ✅ Neural training and prediction
- ✅ Performance monitoring and health checks
- ❌ No workflow tools
- ❌ No terminal tools
- ❌ No advanced neural (compression, ensembles)

### Extended Configuration (40 tools - Hive-Mind + Workflows)

For users who need workflow automation:

```yaml
toolFilter:
  enabled: true
  mode: allowlist
  tools:
    # Core Swarm (4)
    - swarm_init
    - swarm_status
    - swarm_destroy
    - swarm_monitor

    # Agent Management (4)
    - agent_spawn
    - agent_list
    - agent_metrics
    - agents/spawn_parallel

    # Task Orchestration (5)
    - task_orchestrate
    - task_status
    - task_results
    - tasks/create
    - tasks/list

    # Memory (8)
    - memory_usage
    - memory_search
    - memory_persist
    - memory_namespace
    - memory_backup
    - memory_restore
    - cache_manage
    - state_snapshot

    # Neural (7)
    - neural_status
    - neural_train
    - neural_patterns
    - neural_predict
    - pattern_recognize
    - cognitive_analyze
    - learning_adapt

    # Workflow (4)
    - workflow/create
    - workflow/execute
    - workflow/list

    # Terminal (3)
    - terminal/create
    - terminal/execute
    - terminal/list

    # System & Performance (5)
    - system/status
    - system/health
    - performance_report
    - health_check
    - features_detect

  maxTools: 40
```

### Cursor-Optimized Configuration (20 tools)

Specifically designed for Cursor's tool limits:

```json
{
  "toolFilter": {
    "enabled": true,
    "mode": "allowlist",
    "tools": [
      "swarm_init",
      "swarm_status",
      "agent_spawn",
      "agent_list",
      "task_orchestrate",
      "task_status",
      "task_results",
      "memory_usage",
      "memory_search",
      "memory_persist",
      "neural_status",
      "neural_patterns",
      "neural_train",
      "system/status",
      "system/health",
      "config/get",
      "performance_report",
      "health_check",
      "features_detect",
      "swarm_destroy"
    ],
    "maxTools": 20,
    "priorities": {
      "swarm_init": 100,
      "agent_spawn": 99,
      "task_orchestrate": 98,
      "memory_usage": 97,
      "swarm_status": 96,
      "agent_list": 95
    }
  }
}
```

### Tool Dependency Checklist

When creating custom configurations, ensure you include dependencies:

| If you include... | You should also include... |
|-------------------|---------------------------|
| `agents/info` | `agent_spawn` or `agent_list` |
| `agents/terminate` | `agent_spawn` or `agent_list` |
| `task_status` | `task_orchestrate` or `tasks/create` |
| `task_results` | `task_orchestrate` or `tasks/create` |
| `tasks/cancel` | `tasks/create` |
| `tasks/assign` | `tasks/create` + (`agent_spawn` or `agent_list`) |
| `swarm/execute-objective` | `swarm/create-objective` |
| `terminal/execute` | `terminal/create` or `terminal/list` |
| `workflow/execute` | `workflow/create` or `workflow/list` |
| `context_restore` | `state_snapshot` |
| `memory_restore` | `memory_backup` |
| `memory_search` | `memory_usage` |
| Any swarm tool | `swarm_init` |

### Environment Variable Quick Start

For quick testing without config files:

```bash
# Minimal hive-mind (10 tools)
export CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED=true
export CLAUDE_FLOW_MCP_TOOL_FILTER_MODE=allowlist
export CLAUDE_FLOW_MCP_TOOLS_ALLOWED=swarm_init,swarm_status,swarm_destroy,agent_spawn,agent_list,task_orchestrate,task_status,memory_usage,memory_search,neural_patterns
export CLAUDE_FLOW_MCP_MAX_TOOLS=10
```

```bash
# Cursor-optimized (20 tools)
export CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED=true
export CLAUDE_FLOW_MCP_TOOL_FILTER_MODE=allowlist
export CLAUDE_FLOW_MCP_TOOLS_ALLOWED=swarm_init,swarm_status,swarm_destroy,agent_spawn,agent_list,task_orchestrate,task_status,task_results,memory_usage,memory_search,memory_persist,neural_status,neural_patterns,neural_train,system/status,system/health,config/get,performance_report,health_check,features_detect
export CLAUDE_FLOW_MCP_MAX_TOOLS=20
```
