# Claude-Flow MCP Tool Usage Improvement Plan

Based on Anthropic's Advanced Tool Use Engineering Guide (https://www.anthropic.com/engineering/advanced-tool-use)

## Executive Summary

This plan outlines improvements to Claude-Flow's MCP tool implementation based on three key Anthropic features:
1. **Tool Search Tool** - 85% token reduction via deferred loading
2. **Programmatic Tool Calling** - 37% token reduction via code execution
3. **Tool Use Examples** - Improved parameter clarity

Current State Analysis:
- Claude-Flow has 50+ tools across `claude-flow-tools.ts` and `swarm-tools.ts`
- Progressive registry exists in `tool-registry-progressive.ts` (partial implementation)
- No programmatic tool calling support
- Limited tool use examples in schemas

---

## Phase 1: Enhanced Tool Search with Deferred Loading

### Current Gap
The existing `ProgressiveToolRegistry` implements lazy loading but lacks full `defer_loading` support as specified in Anthropic's API.

### Implementation Tasks

#### 1.1 Implement `defer_loading` Flag Support
**File:** `src/mcp/tool-registry-progressive.ts`

```typescript
interface DeferrableToolDefinition {
  name: string;
  description: string;
  defer_loading: boolean;  // New flag
  category: string;
  tags: string[];
  inputSchema?: object;    // Only loaded when defer_loading=false
}
```

**Changes:**
- Add `defer_loading` property to tool metadata
- Default high-frequency tools to `defer_loading: false`
- Default specialized tools to `defer_loading: true`

#### 1.2 Create Tool Categories with Loading Priorities

| Category | defer_loading | Tools |
|----------|---------------|-------|
| Core System | `false` | `system/status`, `system/health`, `tools/search` |
| Agent Management | `false` | `agents/spawn`, `agents/list` |
| Task Operations | `true` | `tasks/create`, `tasks/list`, `tasks/status` |
| Memory Operations | `true` | `memory/query`, `memory/store` |
| Workflow | `true` | `workflow/execute`, `workflow/create` |
| Swarm Coordination | `true` | `swarm/*` tools |
| Terminal | `true` | `terminal/*` tools |

#### 1.3 Enhance tools/search Tool
**File:** `src/mcp/tools/system/search.ts`

Current implementation is basic. Enhance with:
- Regex pattern matching (as per Anthropic's `tool_search_tool_regex`)
- Relevance scoring based on description and tags
- Category filtering
- Return minimal metadata first, full schema on demand

```typescript
interface ToolSearchResult {
  name: string;
  description: string;
  category: string;
  relevanceScore: number;
  // Full inputSchema loaded only when tool is actually invoked
}
```

#### 1.4 Token Savings Calculation

**Estimated Impact:**
- Current: ~150K tokens for 50+ tool definitions upfront
- With deferred loading: ~5K tokens (core tools only)
- **Savings: 96.7% token reduction**

---

## Phase 2: Programmatic Tool Calling

### Current Gap
Claude-Flow has no support for programmatic tool orchestration where Claude generates Python/JS code to call tools without intermediate results entering context.

### Implementation Tasks

#### 2.1 Create Programmatic Execution Sandbox
**New File:** `src/mcp/programmatic/sandbox-executor.ts`

```typescript
interface ProgrammaticExecutionConfig {
  allowedCallers: ['code_execution'];
  maxExecutionTime: number;
  memoryLimit: number;
  allowedTools: string[];
}

class ProgrammaticSandbox {
  async executeCode(code: string, tools: Map<string, MCPTool>): Promise<any> {
    // Execute generated code in isolated environment
    // Tools are callable as async functions
    // Only final result returns to model context
  }
}
```

#### 2.2 Mark Tools as Programmatically Callable
Add `allowed_callers` property to tool definitions:

```typescript
{
  name: 'memory/batch-query',
  description: 'Query multiple memory entries efficiently',
  allowed_callers: ['code_execution'],  // Only callable from code
  inputSchema: {...}
}
```

#### 2.3 Create Batch Operation Tools
**New File:** `src/mcp/tools/batch-operations.ts`

Tools optimized for programmatic calling:

| Tool | Purpose | Benefit |
|------|---------|---------|
| `batch/query-memories` | Query multiple memory keys | Aggregate results |
| `batch/spawn-agents` | Spawn multiple agents | Parallel creation |
| `batch/execute-tasks` | Execute task array | Parallel execution |
| `batch/file-operations` | Batch file reads/writes | Reduce API calls |

#### 2.4 Integrate with Claude Code SDK
**File:** `src/mcp/sdk-integration.ts`

```typescript
// Enable programmatic tool calling mode
const sdkConfig = {
  tools: [
    ...standardTools,
    ...programmaticTools.map(t => ({
      ...t,
      allowed_callers: ['code_execution_20250825']
    }))
  ],
  code_execution: {
    enabled: true,
    sandbox: 'isolated',
    timeout: 30000
  }
};
```

#### 2.5 Token Savings for Complex Workflows

**Example: Multi-agent research task**

Without Programmatic Calling:
- 15 sequential API calls
- Each intermediate result in context
- ~45K tokens consumed

With Programmatic Calling:
- 1 code generation call
- Results aggregated outside context
- ~15K tokens consumed
- **Savings: 67% reduction**

---

## Phase 3: Tool Use Examples

### Current Gap
Tool schemas lack concrete usage examples, relying only on JSON Schema descriptions.

### Implementation Tasks

#### 3.1 Add Examples to Tool Definitions
**File:** `src/mcp/claude-flow-tools.ts`

Current:
```typescript
{
  name: 'agents/spawn',
  description: 'Spawn a new Claude agent',
  inputSchema: {
    properties: {
      type: { type: 'string', description: 'Agent type' },
      name: { type: 'string', description: 'Agent name' }
    }
  }
}
```

Enhanced:
```typescript
{
  name: 'agents/spawn',
  description: 'Spawn a new Claude agent with specified configuration',
  inputSchema: {
    properties: {
      type: {
        type: 'string',
        description: 'Agent type (e.g., researcher, coder, reviewer)'
      },
      name: {
        type: 'string',
        description: 'Display name for the agent (e.g., "ResearchBot-1")'
      }
    }
  },
  examples: [
    {
      description: 'Spawn a researcher agent',
      input: { type: 'researcher', name: 'DataResearcher-1' }
    },
    {
      description: 'Spawn a coder with custom capabilities',
      input: {
        type: 'coder',
        name: 'TypeScriptExpert',
        capabilities: ['typescript', 'react', 'testing'],
        priority: 8
      }
    },
    {
      description: 'Minimal spawn with defaults',
      input: { type: 'coordinator', name: 'MainCoord' }
    }
  ]
}
```

#### 3.2 Create Examples Schema Standard
**New File:** `src/mcp/schemas/tool-examples.ts`

```typescript
interface ToolExample {
  description: string;           // What this example demonstrates
  input: Record<string, any>;    // Example input parameters
  expectedOutput?: any;          // Optional expected output
  context?: string;              // When to use this pattern
}

interface ToolDefinitionWithExamples extends MCPTool {
  examples: ToolExample[];
}
```

#### 3.3 Tools Requiring Enhanced Examples

| Tool | Why Examples Help |
|------|-------------------|
| `agents/spawn` | Multiple agent types, optional params |
| `tasks/create` | Complex dependencies, assignment options |
| `memory/query` | Multiple filter combinations |
| `workflow/create` | Nested task structures |
| `swarm/create-objective` | Strategy combinations |

#### 3.4 Document Format Conventions

Add explicit format documentation:

```typescript
{
  name: 'tasks/create',
  inputSchema: {
    properties: {
      priority: {
        type: 'number',
        description: 'Task priority (1-10, where 10 is highest)',
        minimum: 1,
        maximum: 10,
        default: 5
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (e.g., 30000 for 30 seconds)',
        format: 'milliseconds'
      }
    }
  }
}
```

---

## Phase 4: Return Format Documentation

### Current Gap
Tools don't document their return structures, making it harder for Claude to reason about results.

### Implementation Tasks

#### 4.1 Add Return Schema to Tools
**Enhancement across all tool files**

```typescript
{
  name: 'agents/list',
  description: 'List all active agents',
  inputSchema: {...},
  returnSchema: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique agent identifier (format: agent_TIMESTAMP_RANDOM)' },
            name: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string', enum: ['active', 'idle', 'terminated'] }
          }
        }
      },
      count: { type: 'number', description: 'Total number of agents returned' },
      timestamp: { type: 'string', format: 'date-time' }
    }
  }
}
```

#### 4.2 Create Return Type Registry
**New File:** `src/mcp/schemas/return-types.ts`

Common return structures:
- `SuccessResponse`: `{ success: boolean, message: string, timestamp: string }`
- `ListResponse<T>`: `{ items: T[], count: number, timestamp: string }`
- `EntityResponse<T>`: `{ entity: T, timestamp: string }`
- `ErrorResponse`: `{ error: string, code: string, details?: object }`

---

## Phase 5: Performance Optimization

### 5.1 Implement Prompt Caching Compatibility

Ensure deferred tools don't break prompt caching:

```typescript
// System prompt and core tools remain cacheable
const cacheablePrompt = {
  systemPrompt: '...',  // Cached
  coreTools: [...],      // Cached
  // Deferred tools added AFTER cache point
};
```

### 5.2 Batch Tool Results

For programmatic calling, aggregate results:

```typescript
interface BatchResult {
  results: Map<string, any>;
  errors: Map<string, Error>;
  metrics: {
    totalCalls: number;
    successCount: number;
    totalDuration: number;
  };
}
```

### 5.3 Implement Result Compression

For large intermediate results:

```typescript
class ResultCompressor {
  // Summarize large arrays
  summarizeArray(arr: any[], maxItems: number = 10): any[] {
    if (arr.length <= maxItems) return arr;
    return [...arr.slice(0, maxItems), { _truncated: arr.length - maxItems }];
  }

  // Extract key fields only
  extractKeyFields(obj: any, fields: string[]): any {
    return fields.reduce((acc, f) => ({ ...acc, [f]: obj[f] }), {});
  }
}
```

---

## Implementation Priority Matrix

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| Phase 1: Deferred Loading | Medium | High (85% token reduction) | P0 |
| Phase 3: Tool Examples | Low | Medium (accuracy improvement) | P1 |
| Phase 4: Return Schemas | Low | Medium (reasoning clarity) | P1 |
| Phase 2: Programmatic Calling | High | High (37% token reduction) | P2 |
| Phase 5: Optimization | Medium | Medium (latency reduction) | P2 |

---

## Metrics & Success Criteria

### Token Efficiency
- Target: 80% reduction in tool definition tokens
- Measure: Compare context usage before/after

### Accuracy
- Target: 15% improvement in tool selection accuracy
- Measure: Track tool call success rate

### Latency
- Target: 30% reduction in multi-step workflow latency
- Measure: End-to-end workflow timing

### Developer Experience
- Target: Reduce "invalid parameter" errors by 50%
- Measure: Error logs analysis

---

## Files to Modify

### Existing Files
1. `src/mcp/tool-registry-progressive.ts` - Add defer_loading support
2. `src/mcp/claude-flow-tools.ts` - Add examples and return schemas
3. `src/mcp/swarm-tools.ts` - Add examples and return schemas
4. `src/mcp/tools/system/search.ts` - Enhance search capability
5. `src/mcp/sdk-integration.ts` - Add programmatic calling config

### New Files
1. `src/mcp/programmatic/sandbox-executor.ts` - Code execution sandbox
2. `src/mcp/programmatic/batch-tools.ts` - Batch operation tools
3. `src/mcp/schemas/tool-examples.ts` - Example schema definitions
4. `src/mcp/schemas/return-types.ts` - Return type registry
5. `src/mcp/schemas/deferred-loading.ts` - Defer loading configuration

---

## Quick Wins (Immediate Implementation)

### 1. Add Examples to Top 10 Most-Used Tools
- `agents/spawn`
- `agents/list`
- `tasks/create`
- `tasks/list`
- `memory/query`
- `memory/store`
- `system/status`
- `workflow/execute`
- `swarm/create-objective`
- `swarm/get-status`

### 2. Enable Deferred Loading for Low-Frequency Tools
- Terminal tools
- Config tools
- Import/Export tools

### 3. Add Return Format Documentation
- Document all return types in tool descriptions
- Use consistent response structures

---

## References

- Anthropic Engineering Blog: https://www.anthropic.com/engineering/advanced-tool-use
- MCP Protocol Specification: https://modelcontextprotocol.io/
- Claude Code SDK Documentation: Internal

---

## Next Steps

1. Review this plan with the team
2. Create implementation tickets for each phase
3. Start with Phase 1 (highest impact, medium effort)
4. Iterate based on metrics feedback
