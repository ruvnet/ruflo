# Implementation Guide: Deferred Tool Loading

## Overview

Implement Anthropic's Tool Search pattern to reduce token consumption by 85%.

## Current State Analysis

The `tool-registry-progressive.ts` already has partial lazy loading. We need to:
1. Add formal `defer_loading` API support
2. Implement regex-based tool search
3. Configure tool priorities

---

## Step 1: Define Deferred Loading Configuration

### New File: `src/mcp/schemas/deferred-loading.ts`

```typescript
/**
 * Deferred Loading Configuration
 * Based on Anthropic's tool_search_tool pattern
 */

export interface DeferredToolConfig {
  name: string;
  defer_loading: boolean;
  priority: 'critical' | 'high' | 'medium' | 'low';
  loadConditions?: {
    category?: string[];
    contextKeywords?: string[];
    previousToolCalls?: string[];
  };
}

// Tools that should ALWAYS be loaded (defer_loading: false)
export const CORE_TOOLS: DeferredToolConfig[] = [
  { name: 'tools/search', defer_loading: false, priority: 'critical' },
  { name: 'system/status', defer_loading: false, priority: 'critical' },
  { name: 'system/health', defer_loading: false, priority: 'high' },
  { name: 'agents/spawn', defer_loading: false, priority: 'high' },
  { name: 'agents/list', defer_loading: false, priority: 'high' },
];

// Tools that should be deferred (defer_loading: true)
export const DEFERRED_TOOLS: DeferredToolConfig[] = [
  // Task management - load when task operations mentioned
  {
    name: 'tasks/create',
    defer_loading: true,
    priority: 'medium',
    loadConditions: {
      contextKeywords: ['task', 'create task', 'new task', 'assign']
    }
  },
  { name: 'tasks/list', defer_loading: true, priority: 'medium' },
  { name: 'tasks/status', defer_loading: true, priority: 'low' },
  { name: 'tasks/cancel', defer_loading: true, priority: 'low' },
  { name: 'tasks/assign', defer_loading: true, priority: 'low' },

  // Memory operations - load when memory mentioned
  {
    name: 'memory/query',
    defer_loading: true,
    priority: 'medium',
    loadConditions: {
      contextKeywords: ['memory', 'remember', 'recall', 'store']
    }
  },
  { name: 'memory/store', defer_loading: true, priority: 'medium' },
  { name: 'memory/delete', defer_loading: true, priority: 'low' },
  { name: 'memory/export', defer_loading: true, priority: 'low' },
  { name: 'memory/import', defer_loading: true, priority: 'low' },

  // Workflow - load when workflow mentioned
  {
    name: 'workflow/execute',
    defer_loading: true,
    priority: 'medium',
    loadConditions: {
      contextKeywords: ['workflow', 'pipeline', 'orchestrate']
    }
  },
  { name: 'workflow/create', defer_loading: true, priority: 'low' },
  { name: 'workflow/list', defer_loading: true, priority: 'low' },

  // Terminal - load when shell/command mentioned
  {
    name: 'terminal/execute',
    defer_loading: true,
    priority: 'medium',
    loadConditions: {
      contextKeywords: ['terminal', 'shell', 'command', 'execute']
    }
  },
  { name: 'terminal/list', defer_loading: true, priority: 'low' },
  { name: 'terminal/create', defer_loading: true, priority: 'low' },

  // Configuration - rarely needed
  { name: 'config/get', defer_loading: true, priority: 'low' },
  { name: 'config/update', defer_loading: true, priority: 'low' },
  { name: 'config/validate', defer_loading: true, priority: 'low' },

  // Query control - Phase 4 tools
  { name: 'query/control', defer_loading: true, priority: 'low' },
  { name: 'query/list', defer_loading: true, priority: 'low' },

  // Swarm tools - load when swarm mentioned
  {
    name: 'swarm/create-objective',
    defer_loading: true,
    priority: 'medium',
    loadConditions: {
      contextKeywords: ['swarm', 'objective', 'multi-agent']
    }
  },
  { name: 'swarm/execute-objective', defer_loading: true, priority: 'medium' },
  { name: 'swarm/get-status', defer_loading: true, priority: 'medium' },
  { name: 'swarm/get-comprehensive-status', defer_loading: true, priority: 'low' },
  { name: 'swarm/emergency-stop', defer_loading: true, priority: 'low' },

  // Agent management (deferred subset)
  { name: 'agents/terminate', defer_loading: true, priority: 'low' },
  { name: 'agents/info', defer_loading: true, priority: 'low' },
  { name: 'agents/spawn_parallel', defer_loading: true, priority: 'medium' },

  // Resource management
  { name: 'resource/register', defer_loading: true, priority: 'low' },
  { name: 'resource/get-statistics', defer_loading: true, priority: 'low' },

  // Messaging
  { name: 'message/send', defer_loading: true, priority: 'low' },
  { name: 'message/get-metrics', defer_loading: true, priority: 'low' },

  // Monitoring
  { name: 'monitor/get-metrics', defer_loading: true, priority: 'low' },
  { name: 'monitor/get-alerts', defer_loading: true, priority: 'low' },
];

export function getToolLoadingConfig(toolName: string): DeferredToolConfig | undefined {
  return [...CORE_TOOLS, ...DEFERRED_TOOLS].find(t => t.name === toolName);
}

export function shouldLoadImmediately(toolName: string): boolean {
  const config = getToolLoadingConfig(toolName);
  return config ? !config.defer_loading : false;
}
```

---

## Step 2: Enhance Tool Search

### Update: `src/mcp/tools/system/search.ts`

```typescript
import { DynamicToolLoader } from '../loader.js';
import type { MCPTool } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';

interface SearchOptions {
  pattern?: string;      // Regex pattern for tool names
  category?: string;     // Filter by category
  tags?: string[];       // Filter by tags
  description?: string;  // Search in descriptions
  limit?: number;        // Max results
  includeSchema?: boolean; // Include full input schema
}

interface SearchResult {
  name: string;
  description: string;
  category: string;
  tags: string[];
  relevanceScore: number;
  inputSchema?: object;  // Only if includeSchema=true
}

export function createSearchToolsTool(loader: DynamicToolLoader, logger: ILogger): MCPTool {
  return {
    name: 'tools/search',
    description: `Search for available tools using patterns, categories, or descriptions.
Use this to discover tools without loading all definitions upfront.
Returns tool metadata by default; set includeSchema=true for full schemas.`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to match tool names (e.g., "memory/.*" or "agent")'
        },
        category: {
          type: 'string',
          enum: ['agents', 'tasks', 'memory', 'system', 'workflow', 'terminal', 'config', 'swarm', 'resource', 'message', 'monitor', 'query'],
          description: 'Filter tools by category'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tool tags'
        },
        description: {
          type: 'string',
          description: 'Search within tool descriptions'
        },
        limit: {
          type: 'number',
          default: 10,
          description: 'Maximum number of results to return'
        },
        includeSchema: {
          type: 'boolean',
          default: false,
          description: 'Include full inputSchema in results (increases response size)'
        }
      }
    },
    examples: [
      {
        description: 'Find all memory-related tools',
        input: { pattern: 'memory/.*' }
      },
      {
        description: 'Search for tools that create things',
        input: { description: 'create', limit: 5 }
      },
      {
        description: 'Get agent tools with full schemas',
        input: { category: 'agents', includeSchema: true }
      }
    ],
    handler: async (input: SearchOptions) => {
      logger.debug('Searching tools', { input });

      const allTools = loader.getAllToolNames();
      let results: SearchResult[] = [];

      for (const toolName of allTools) {
        const metadata = loader.getToolMetadata(toolName);
        if (!metadata) continue;

        let score = 0;
        let matches = true;

        // Pattern matching (regex)
        if (input.pattern) {
          try {
            const regex = new RegExp(input.pattern, 'i');
            if (!regex.test(toolName)) {
              matches = false;
            } else {
              score += 10; // High score for name match
            }
          } catch (e) {
            // Invalid regex, fall back to substring
            if (!toolName.toLowerCase().includes(input.pattern.toLowerCase())) {
              matches = false;
            }
          }
        }

        // Category filter
        if (input.category && matches) {
          const toolCategory = toolName.split('/')[0];
          if (toolCategory !== input.category) {
            matches = false;
          } else {
            score += 5;
          }
        }

        // Description search
        if (input.description && matches) {
          const descLower = (metadata.description || '').toLowerCase();
          const searchLower = input.description.toLowerCase();
          if (descLower.includes(searchLower)) {
            score += 3;
          } else {
            // Partial match using word boundaries
            const words = searchLower.split(/\s+/);
            const matchedWords = words.filter(w => descLower.includes(w));
            if (matchedWords.length === 0) {
              matches = false;
            } else {
              score += matchedWords.length;
            }
          }
        }

        // Tags filter
        if (input.tags && input.tags.length > 0 && matches) {
          const toolTags = metadata.tags || [];
          const matchingTags = input.tags.filter(t =>
            toolTags.some(tt => tt.toLowerCase() === t.toLowerCase())
          );
          if (matchingTags.length === 0) {
            matches = false;
          } else {
            score += matchingTags.length * 2;
          }
        }

        if (matches) {
          const result: SearchResult = {
            name: toolName,
            description: metadata.description || '',
            category: toolName.split('/')[0],
            tags: metadata.tags || [],
            relevanceScore: score
          };

          // Include full schema only if requested
          if (input.includeSchema) {
            const fullTool = await loader.loadTool(toolName, logger);
            if (fullTool) {
              result.inputSchema = fullTool.inputSchema;
            }
          }

          results.push(result);
        }
      }

      // Sort by relevance score
      results.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Apply limit
      const limit = input.limit || 10;
      results = results.slice(0, limit);

      logger.info('Tool search completed', {
        query: input,
        resultCount: results.length
      });

      return {
        tools: results,
        count: results.length,
        totalAvailable: allTools.length,
        timestamp: new Date().toISOString()
      };
    }
  };
}
```

---

## Step 3: Modify Tool Registration for Deferred Loading

### Update: `src/mcp/tool-registry-progressive.ts`

Add to the class:

```typescript
import { CORE_TOOLS, DEFERRED_TOOLS, shouldLoadImmediately } from './schemas/deferred-loading.js';

// In initialize() method, replace:
async initialize(): Promise<void> {
  logger.info('Initializing progressive tool registry with deferred loading...');

  // Scan for tool metadata (lightweight operation)
  await this.toolLoader.scanTools();

  const stats = this.toolLoader.getStats();

  // Calculate token savings
  const coreToolCount = CORE_TOOLS.length;
  const deferredToolCount = stats.totalTools - coreToolCount;

  logger.info('Tool loading analysis', {
    totalTools: stats.totalTools,
    coreTools: coreToolCount,
    deferredTools: deferredToolCount,
    estimatedTokenSavings: `${((deferredToolCount / stats.totalTools) * 100).toFixed(1)}%`
  });

  // Register only core tools that should load immediately
  await this.registerCoreTools();

  // Log deferred tools
  logger.debug('Deferred tools (will load on-demand)', {
    tools: DEFERRED_TOOLS.map(t => t.name)
  });

  if (this.config.enableInProcess) {
    await this.createInProcessServer();
  }
}

// Enhanced core tools registration
private async registerCoreTools(): Promise<void> {
  logger.info('Registering core system tools (defer_loading: false)...');

  // Always register tools/search
  const searchTool = createSearchToolsTool(this.toolLoader, logger);
  this.toolCache.set(searchTool.name, searchTool);

  // Load other core tools
  for (const coreToolConfig of CORE_TOOLS) {
    if (coreToolConfig.name === 'tools/search') continue; // Already added

    const tool = await this.toolLoader.loadTool(coreToolConfig.name, logger);
    if (tool) {
      this.toolCache.set(coreToolConfig.name, tool);
      logger.debug('Core tool loaded', { name: coreToolConfig.name });
    }
  }

  logger.info('Core tools registered', {
    coreTools: Array.from(this.toolCache.keys()),
    count: this.toolCache.size
  });
}
```

---

## Step 4: Update SDK Server Config

### Update: `src/mcp/sdk-integration.ts`

When creating SDK server config, mark deferred tools:

```typescript
function createSdkToolDefinitions(registry: ProgressiveToolRegistry) {
  const allToolNames = registry.getToolNames();

  return allToolNames.map(toolName => {
    const shouldDefer = !shouldLoadImmediately(toolName);
    const metadata = registry.toolLoader.getToolMetadata(toolName);

    return {
      name: toolName,
      description: metadata?.description || '',
      defer_loading: shouldDefer,
      // Full inputSchema only for non-deferred tools
      inputSchema: shouldDefer ? undefined : metadata?.inputSchema
    };
  });
}
```

---

## Step 5: Token Savings Report

### New Utility: `src/mcp/utils/token-calculator.ts`

```typescript
/**
 * Estimate token usage for tool definitions
 */
export function estimateToolTokens(tool: { name: string; description: string; inputSchema?: object }): number {
  // Rough estimation: ~4 chars per token
  const nameTokens = Math.ceil(tool.name.length / 4);
  const descTokens = Math.ceil((tool.description || '').length / 4);
  const schemaTokens = tool.inputSchema
    ? Math.ceil(JSON.stringify(tool.inputSchema).length / 4)
    : 0;

  return nameTokens + descTokens + schemaTokens + 20; // +20 for JSON structure
}

export function calculateTokenSavings(
  totalTools: number,
  coreTools: number,
  avgTokensPerTool: number = 3000
): {
  withoutDeferred: number;
  withDeferred: number;
  savings: number;
  savingsPercent: string;
} {
  const metadataTokensPerTool = 40; // Just name + short description

  const withoutDeferred = totalTools * avgTokensPerTool;
  const withDeferred = (coreTools * avgTokensPerTool) + ((totalTools - coreTools) * metadataTokensPerTool);
  const savings = withoutDeferred - withDeferred;

  return {
    withoutDeferred,
    withDeferred,
    savings,
    savingsPercent: `${((savings / withoutDeferred) * 100).toFixed(1)}%`
  };
}
```

---

## Testing the Implementation

### Test Cases

1. **Token reduction verification**
   - Count tokens with all tools loaded
   - Count tokens with deferred loading
   - Verify 80%+ reduction

2. **Tool search functionality**
   - Search by regex pattern
   - Search by category
   - Search by description keywords
   - Verify relevance scoring

3. **Lazy loading verification**
   - Verify deferred tools not in initial context
   - Verify tools load when invoked
   - Verify caching after first load

4. **Edge cases**
   - Invalid regex patterns
   - Empty search results
   - Tools not found

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial token usage | ~150K | ~15K | 90% reduction |
| Tool definitions in context | 50+ | 5-7 | 85% reduction |
| First response latency | High | Low | ~2x faster |
| Tool selection accuracy | 70% | 85% | +15% |
