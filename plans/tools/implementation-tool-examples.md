# Implementation Guide: Tool Use Examples

## Overview

Add concrete usage examples to tool definitions to improve parameter clarity and reduce errors.

---

## Why Examples Matter

From Anthropic's research:
- Complex nested structures with ambiguous usage benefit significantly
- APIs with domain-specific conventions need examples
- Tools with many optional parameters need clear patterns
- Similar tools need distinguishing examples

---

## Step 1: Define Example Schema

### New File: `src/mcp/schemas/tool-examples.ts`

```typescript
/**
 * Tool Example Schema
 *
 * Provides concrete usage patterns for tools.
 */

export interface ToolExample {
  /** Brief description of what this example demonstrates */
  description: string;

  /** Example input parameters */
  input: Record<string, any>;

  /** Optional expected output (for documentation) */
  expectedOutput?: any;

  /** When to use this pattern */
  context?: string;

  /** Difficulty/complexity level */
  complexity?: 'minimal' | 'typical' | 'advanced';
}

export interface ToolWithExamples {
  name: string;
  description: string;
  inputSchema: object;
  examples: ToolExample[];
}

/**
 * Create examples for a tool
 */
export function withExamples<T extends { name: string; inputSchema: any }>(
  tool: T,
  examples: ToolExample[]
): T & { examples: ToolExample[] } {
  return { ...tool, examples };
}

/**
 * Validate examples against schema
 */
export function validateExamples(
  tool: ToolWithExamples
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (let i = 0; i < tool.examples.length; i++) {
    const example = tool.examples[i];
    const schema = tool.inputSchema as any;

    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in example.input)) {
          errors.push(`Example ${i}: missing required field '${req}'`);
        }
      }
    }

    // Check enum values
    if (schema.properties) {
      for (const [key, value] of Object.entries(example.input)) {
        const prop = schema.properties[key];
        if (prop?.enum && !prop.enum.includes(value)) {
          errors.push(`Example ${i}: '${key}' value '${value}' not in enum`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

## Step 2: Add Examples to Core Tools

### Update: `src/mcp/claude-flow-tools.ts`

```typescript
// agents/spawn with examples
function createSpawnAgentTool(logger: ILogger): MCPTool {
  return {
    name: 'agents/spawn',
    description: `Spawn a new Claude agent with specified configuration.
The agent will be initialized with the given type and capabilities.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of specialized agent (e.g., researcher, coder, reviewer, coordinator)'
        },
        name: {
          type: 'string',
          description: 'Display name for the agent (e.g., "DataAnalyst-1", "CodeReviewer")'
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of capabilities (e.g., ["typescript", "react", "testing"])'
        },
        systemPrompt: {
          type: 'string',
          description: 'Custom system prompt for specialized behavior'
        },
        maxConcurrentTasks: {
          type: 'number',
          default: 3,
          description: 'Maximum simultaneous tasks (1-10)'
        },
        priority: {
          type: 'number',
          default: 5,
          description: 'Agent priority level (1=lowest, 10=highest)'
        }
      },
      required: ['type', 'name']
    },
    examples: [
      {
        description: 'Spawn a basic researcher agent',
        complexity: 'minimal',
        input: {
          type: 'researcher',
          name: 'WebResearcher-1'
        }
      },
      {
        description: 'Spawn a specialized coder with capabilities',
        complexity: 'typical',
        input: {
          type: 'coder',
          name: 'TypeScriptDev',
          capabilities: ['typescript', 'react', 'node', 'testing'],
          priority: 7
        }
      },
      {
        description: 'Spawn a high-priority coordinator with custom prompt',
        complexity: 'advanced',
        input: {
          type: 'coordinator',
          name: 'MainOrchestrator',
          systemPrompt: 'You coordinate the research team. Delegate tasks to specialists and synthesize their findings.',
          maxConcurrentTasks: 5,
          priority: 10
        }
      }
    ],
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      // ... existing handler code
    }
  };
}

// tasks/create with examples
function createCreateTaskTool(logger: ILogger): MCPTool {
  return {
    name: 'tasks/create',
    description: `Create a new task for execution.
Tasks can be assigned to specific agents or agent types.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Task type (e.g., "research", "implement", "review", "test")'
        },
        description: {
          type: 'string',
          description: 'Detailed task description'
        },
        priority: {
          type: 'number',
          default: 5,
          description: 'Priority 1-10 (10=critical, 5=normal, 1=low)'
        },
        dependencies: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task IDs that must complete first'
        },
        assignToAgent: {
          type: 'string',
          description: 'Specific agent ID to assign to'
        },
        assignToAgentType: {
          type: 'string',
          description: 'Agent type to assign to (e.g., "coder", "researcher")'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (e.g., 60000 for 1 minute)'
        }
      },
      required: ['type', 'description']
    },
    examples: [
      {
        description: 'Create a simple research task',
        complexity: 'minimal',
        input: {
          type: 'research',
          description: 'Research best practices for React state management'
        }
      },
      {
        description: 'Create a high-priority implementation task',
        complexity: 'typical',
        input: {
          type: 'implement',
          description: 'Implement user authentication using JWT',
          priority: 8,
          assignToAgentType: 'coder',
          timeout: 300000
        }
      },
      {
        description: 'Create a task with dependencies',
        complexity: 'advanced',
        input: {
          type: 'review',
          description: 'Code review for authentication implementation',
          priority: 6,
          dependencies: ['task_123_abc', 'task_456_def'],
          assignToAgentType: 'reviewer'
        },
        context: 'Use dependencies when task requires other tasks to complete first'
      }
    ],
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      // ... existing handler code
    }
  };
}

// memory/query with examples
function createQueryMemoryTool(logger: ILogger): MCPTool {
  return {
    name: 'memory/query',
    description: `Query agent memory with filters and search.
Returns memory entries matching the specified criteria.`,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Filter by agent ID (format: agent_TIMESTAMP_RANDOM)'
        },
        sessionId: {
          type: 'string',
          description: 'Filter by session ID'
        },
        type: {
          type: 'string',
          enum: ['observation', 'insight', 'decision', 'artifact', 'error'],
          description: 'Entry type to filter'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (e.g., ["important", "code"])'
        },
        search: {
          type: 'string',
          description: 'Full-text search in content'
        },
        startTime: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 datetime (e.g., "2024-01-15T10:00:00Z")'
        },
        endTime: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 datetime'
        },
        limit: {
          type: 'number',
          default: 50,
          description: 'Max entries to return (1-1000)'
        }
      }
    },
    examples: [
      {
        description: 'Get all memories for an agent',
        complexity: 'minimal',
        input: {
          agentId: 'agent_1705312800_abc123'
        }
      },
      {
        description: 'Search for specific insights',
        complexity: 'typical',
        input: {
          type: 'insight',
          search: 'performance optimization',
          limit: 10
        }
      },
      {
        description: 'Query with multiple filters',
        complexity: 'advanced',
        input: {
          agentId: 'agent_1705312800_abc123',
          type: 'decision',
          tags: ['architecture', 'approved'],
          startTime: '2024-01-15T00:00:00Z',
          limit: 20
        },
        context: 'Use multiple filters to narrow down relevant entries'
      }
    ],
    handler: async (input: any, context?: ClaudeFlowToolContext) => {
      // ... existing handler code
    }
  };
}
```

---

## Step 3: Examples for Swarm Tools

### Update: `src/mcp/swarm-tools.ts`

```typescript
// swarm/create-objective with examples
{
  name: 'swarm/create-objective',
  description: `Create a new swarm objective with tasks and coordination.
The objective defines what the swarm should accomplish and how tasks are executed.`,
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Objective title (e.g., "Build REST API")'
      },
      description: {
        type: 'string',
        description: 'Detailed objective description'
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            description: { type: 'string' },
            requirements: { type: 'object' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] }
          },
          required: ['type', 'description']
        },
        description: 'Tasks to accomplish the objective'
      },
      strategy: {
        type: 'string',
        enum: ['parallel', 'sequential', 'adaptive'],
        description: 'parallel: all at once, sequential: one by one, adaptive: auto-optimize'
      },
      timeout: {
        type: 'number',
        description: 'Overall timeout in ms (e.g., 3600000 for 1 hour)'
      }
    },
    required: ['title', 'description', 'tasks']
  },
  examples: [
    {
      description: 'Simple parallel research objective',
      complexity: 'minimal',
      input: {
        title: 'Market Research',
        description: 'Analyze competitor products and market trends',
        tasks: [
          { type: 'research', description: 'Identify top 5 competitors' },
          { type: 'research', description: 'Analyze pricing strategies' }
        ]
      }
    },
    {
      description: 'Sequential development objective',
      complexity: 'typical',
      input: {
        title: 'User Authentication System',
        description: 'Build complete auth system with JWT',
        tasks: [
          { type: 'design', description: 'Design auth flow and database schema', priority: 'high' },
          { type: 'implement', description: 'Implement JWT token generation', priority: 'high' },
          { type: 'implement', description: 'Build login/register endpoints', priority: 'normal' },
          { type: 'test', description: 'Write integration tests', priority: 'normal' }
        ],
        strategy: 'sequential',
        timeout: 1800000
      }
    },
    {
      description: 'Adaptive optimization objective',
      complexity: 'advanced',
      input: {
        title: 'Performance Optimization Sprint',
        description: 'Identify and fix performance bottlenecks across the codebase',
        tasks: [
          {
            type: 'analyze',
            description: 'Profile application and identify slow endpoints',
            priority: 'critical',
            requirements: { tools: ['profiler', 'metrics'] }
          },
          {
            type: 'implement',
            description: 'Optimize database queries',
            priority: 'high',
            requirements: { skills: ['sql', 'orm'] }
          },
          {
            type: 'implement',
            description: 'Add caching layer',
            priority: 'high'
          },
          {
            type: 'test',
            description: 'Benchmark improvements',
            priority: 'normal'
          }
        ],
        strategy: 'adaptive',
        timeout: 3600000
      },
      context: 'Use adaptive strategy when tasks have varying dependencies and can be optimized at runtime'
    }
  ],
  handler: async (input: any, context?: SwarmToolContext) => {
    // ... existing handler code
  }
}
```

---

## Step 4: Return Format Documentation

Add explicit return documentation in tool descriptions:

```typescript
// Enhanced description with return format
{
  name: 'agents/list',
  description: `List all active agents in the system.

Returns:
- agents: Array of agent objects with {id, name, type, status, currentTask}
- count: Total number of agents returned
- timestamp: ISO 8601 timestamp of the query

Agent status values: "active", "idle", "busy", "terminated"`,
  // ... rest of definition
}

// Or use returnSchema (custom extension)
{
  name: 'agents/list',
  description: 'List all active agents in the system',
  inputSchema: { /* ... */ },
  returnSchema: {
    type: 'object',
    properties: {
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Format: agent_TIMESTAMP_RANDOM' },
            name: { type: 'string' },
            type: { type: 'string' },
            status: { type: 'string', enum: ['active', 'idle', 'busy', 'terminated'] },
            currentTask: { type: 'string', nullable: true }
          }
        }
      },
      count: { type: 'number' },
      timestamp: { type: 'string', format: 'date-time' }
    }
  },
  examples: [ /* ... */ ]
}
```

---

## Step 5: Create Example Documentation Generator

### New File: `src/mcp/utils/generate-example-docs.ts`

```typescript
/**
 * Generate documentation from tool examples
 */

import type { MCPTool } from '../utils/types.js';
import type { ToolExample } from '../schemas/tool-examples.js';

interface ToolWithExamples extends MCPTool {
  examples?: ToolExample[];
}

export function generateMarkdownDocs(tools: ToolWithExamples[]): string {
  let md = '# Claude-Flow MCP Tools Reference\n\n';

  // Group by category
  const categories = new Map<string, ToolWithExamples[]>();
  for (const tool of tools) {
    const category = tool.name.split('/')[0];
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(tool);
  }

  for (const [category, categoryTools] of categories) {
    md += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

    for (const tool of categoryTools) {
      md += `### ${tool.name}\n\n`;
      md += `${tool.description}\n\n`;

      // Input parameters
      md += '**Parameters:**\n\n';
      const schema = tool.inputSchema as any;
      if (schema.properties) {
        for (const [prop, def] of Object.entries(schema.properties)) {
          const d = def as any;
          const required = schema.required?.includes(prop) ? '*(required)*' : '';
          md += `- \`${prop}\`: ${d.type} ${required} - ${d.description || ''}\n`;
        }
      }
      md += '\n';

      // Examples
      if (tool.examples && tool.examples.length > 0) {
        md += '**Examples:**\n\n';
        for (const example of tool.examples) {
          md += `*${example.description}*\n`;
          md += '```json\n';
          md += JSON.stringify(example.input, null, 2);
          md += '\n```\n\n';
        }
      }

      md += '---\n\n';
    }
  }

  return md;
}

export function generateTypeScriptDocs(tools: ToolWithExamples[]): string {
  let ts = '// Claude-Flow MCP Tool Types (Auto-generated)\n\n';

  for (const tool of tools) {
    const funcName = tool.name.replace(/[\/\-]/g, '_');
    const schema = tool.inputSchema as any;

    ts += `/** ${tool.description.split('\n')[0]} */\n`;
    ts += `interface ${funcName}_Input {\n`;

    if (schema.properties) {
      for (const [prop, def] of Object.entries(schema.properties)) {
        const d = def as any;
        const optional = !schema.required?.includes(prop) ? '?' : '';
        const tsType = jsonSchemaToTs(d);
        ts += `  /** ${d.description || ''} */\n`;
        ts += `  ${prop}${optional}: ${tsType};\n`;
      }
    }

    ts += '}\n\n';
  }

  return ts;
}

function jsonSchemaToTs(schema: any): string {
  if (schema.enum) {
    return schema.enum.map((e: string) => `'${e}'`).join(' | ');
  }
  switch (schema.type) {
    case 'string': return 'string';
    case 'number': case 'integer': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return `Array<${jsonSchemaToTs(schema.items || { type: 'any' })}>`;
    case 'object': return 'Record<string, any>';
    default: return 'any';
  }
}
```

---

## Step 6: Testing Examples

### Test File: `src/mcp/__tests__/tool-examples.test.ts`

```typescript
import { validateExamples } from '../schemas/tool-examples.js';
import { createClaudeFlowTools } from '../claude-flow-tools.js';

describe('Tool Examples', () => {
  let tools: any[];

  beforeAll(async () => {
    tools = await createClaudeFlowTools(mockLogger);
  });

  test('all examples pass schema validation', () => {
    for (const tool of tools) {
      if (!tool.examples) continue;

      const result = validateExamples(tool);
      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error(`Tool ${tool.name} has invalid examples:`, result.errors);
      }
    }
  });

  test('tools with complex schemas have examples', () => {
    const complexTools = tools.filter(t => {
      const schema = t.inputSchema as any;
      // Complex = has nested objects, arrays, or 5+ properties
      return (
        Object.keys(schema.properties || {}).length >= 5 ||
        Object.values(schema.properties || {}).some((p: any) =>
          p.type === 'object' || p.type === 'array'
        )
      );
    });

    for (const tool of complexTools) {
      expect(tool.examples).toBeDefined();
      expect(tool.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('examples cover minimal and advanced usage', () => {
    for (const tool of tools) {
      if (!tool.examples || tool.examples.length < 2) continue;

      const complexities = tool.examples.map((e: any) => e.complexity);
      expect(complexities).toContain('minimal');
      expect(
        complexities.includes('typical') || complexities.includes('advanced')
      ).toBe(true);
    }
  });
});
```

---

## Priority Tools for Examples

Based on complexity and usage frequency:

| Tool | Priority | Reason |
|------|----------|--------|
| `agents/spawn` | P0 | Multiple types, optional params |
| `tasks/create` | P0 | Dependencies, assignment options |
| `memory/query` | P0 | Many filter combinations |
| `swarm/create-objective` | P0 | Nested tasks, strategy options |
| `workflow/execute` | P1 | File path vs inline workflow |
| `agents/spawn_parallel` | P1 | Batch configuration |
| `memory/store` | P1 | Type and context options |
| `terminal/execute` | P1 | Command, args, env options |
| `config/update` | P2 | Section-specific updates |
| `query/control` | P2 | Multiple action types |

---

## Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Parameter errors | High | Low | -50% |
| Tool selection accuracy | 70% | 85% | +15% |
| First-try success rate | 60% | 80% | +20% |
| Documentation lookups | Many | Few | -70% |
