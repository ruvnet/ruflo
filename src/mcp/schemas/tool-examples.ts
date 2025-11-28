/**
 * Tool Example Schema
 *
 * Provides concrete usage patterns for tools to improve accuracy.
 * Based on Anthropic's Tool Use Examples best practice.
 *
 * @see https://www.anthropic.com/engineering/advanced-tool-use
 */

/**
 * A concrete usage example for a tool
 */
export interface ToolExample {
  /** Brief description of what this example demonstrates */
  description: string;

  /** Example input parameters */
  input: Record<string, unknown>;

  /** Optional expected output shape (for documentation) */
  expectedOutput?: unknown;

  /** When to use this pattern */
  context?: string;

  /** Complexity level */
  complexity?: 'minimal' | 'typical' | 'advanced';
}

/**
 * Tool definition with examples
 */
export interface ToolWithExamples {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  examples: ToolExample[];
  returnSchema?: Record<string, unknown>;
}

/**
 * Add examples to an existing tool definition
 */
export function withExamples<T extends { name: string }>(
  tool: T,
  examples: ToolExample[]
): T & { examples: ToolExample[] } {
  return { ...tool, examples };
}

/**
 * Validate examples against a tool's schema
 */
export function validateExamples(
  tool: ToolWithExamples
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };

  for (let i = 0; i < tool.examples.length; i++) {
    const example = tool.examples[i];

    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in example.input)) {
          errors.push(`Example ${i} (${example.description}): missing required field '${req}'`);
        }
      }
    }

    // Check enum values
    if (schema.properties) {
      for (const [key, value] of Object.entries(example.input)) {
        const prop = schema.properties[key];
        if (prop?.enum && !prop.enum.includes(value as string)) {
          errors.push(
            `Example ${i} (${example.description}): '${key}' value '${value}' not in enum [${prop.enum.join(', ')}]`
          );
        }
      }
    }

    // Check complexity annotation
    if (!example.complexity) {
      errors.push(`Example ${i} (${example.description}): missing complexity level`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Pre-defined examples for core tools
 */
export const TOOL_EXAMPLES: Record<string, ToolExample[]> = {
  'agents/spawn': [
    {
      description: 'Spawn a basic researcher agent',
      complexity: 'minimal',
      input: {
        type: 'researcher',
        name: 'WebResearcher-1'
      }
    },
    {
      description: 'Spawn a coder with specific capabilities',
      complexity: 'typical',
      input: {
        type: 'coder',
        name: 'TypeScriptDev',
        capabilities: ['typescript', 'react', 'node', 'testing'],
        priority: 7
      }
    },
    {
      description: 'Spawn a high-priority coordinator with custom system prompt',
      complexity: 'advanced',
      input: {
        type: 'coordinator',
        name: 'MainOrchestrator',
        systemPrompt: 'You coordinate the development team. Delegate tasks to specialists and synthesize their work.',
        maxConcurrentTasks: 5,
        priority: 10
      },
      context: 'Use when you need an agent to manage other agents'
    }
  ],

  'agents/list': [
    {
      description: 'List all active agents',
      complexity: 'minimal',
      input: {}
    },
    {
      description: 'Filter agents by type',
      complexity: 'typical',
      input: {
        filterByType: 'researcher'
      }
    },
    {
      description: 'Include terminated agents in listing',
      complexity: 'advanced',
      input: {
        includeTerminated: true,
        filterByType: 'coder'
      }
    }
  ],

  'tasks/create': [
    {
      description: 'Create a simple research task',
      complexity: 'minimal',
      input: {
        type: 'research',
        description: 'Research best practices for React state management'
      }
    },
    {
      description: 'Create a high-priority implementation task assigned to agent type',
      complexity: 'typical',
      input: {
        type: 'implement',
        description: 'Implement user authentication using JWT tokens',
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
      context: 'Use dependencies when this task requires other tasks to complete first'
    }
  ],

  'tasks/list': [
    {
      description: 'List all pending tasks',
      complexity: 'minimal',
      input: {
        status: 'pending'
      }
    },
    {
      description: 'List running tasks for specific agent',
      complexity: 'typical',
      input: {
        status: 'running',
        agentId: 'agent_1705312800_abc123',
        limit: 10
      }
    }
  ],

  'memory/query': [
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
      description: 'Query with multiple filters and time range',
      complexity: 'advanced',
      input: {
        agentId: 'agent_1705312800_abc123',
        type: 'decision',
        tags: ['architecture', 'approved'],
        startTime: '2024-01-15T00:00:00Z',
        endTime: '2024-01-20T23:59:59Z',
        limit: 20
      },
      context: 'Use multiple filters to narrow down to relevant entries'
    }
  ],

  'memory/store': [
    {
      description: 'Store a simple observation',
      complexity: 'minimal',
      input: {
        agentId: 'agent_1705312800_abc123',
        sessionId: 'session_001',
        type: 'observation',
        content: 'User prefers TypeScript over JavaScript'
      }
    },
    {
      description: 'Store an insight with tags',
      complexity: 'typical',
      input: {
        agentId: 'agent_1705312800_abc123',
        sessionId: 'session_001',
        type: 'insight',
        content: 'Caching improves API response time by 40%',
        tags: ['performance', 'optimization', 'backend']
      }
    },
    {
      description: 'Store a decision with context and parent reference',
      complexity: 'advanced',
      input: {
        agentId: 'agent_1705312800_abc123',
        sessionId: 'session_001',
        type: 'decision',
        content: 'Chose Redis for caching layer due to performance requirements',
        context: {
          alternatives: ['Memcached', 'Local cache'],
          reasoning: 'Redis provides persistence and pub/sub features needed for our use case'
        },
        tags: ['architecture', 'caching'],
        parentId: 'memory_prev_123'
      }
    }
  ],

  'workflow/execute': [
    {
      description: 'Execute a workflow from file',
      complexity: 'minimal',
      input: {
        filePath: './workflows/deploy.yaml'
      }
    },
    {
      description: 'Execute workflow with parameters',
      complexity: 'typical',
      input: {
        filePath: './workflows/build-and-test.yaml',
        parameters: {
          environment: 'staging',
          branch: 'develop'
        }
      }
    },
    {
      description: 'Execute inline workflow definition',
      complexity: 'advanced',
      input: {
        workflow: {
          name: 'quick-deploy',
          tasks: [
            { id: 'build', type: 'build', description: 'Build the project' },
            { id: 'test', type: 'test', description: 'Run tests', dependencies: ['build'] },
            { id: 'deploy', type: 'deploy', description: 'Deploy to staging', dependencies: ['test'] }
          ]
        },
        parameters: {
          target: 'staging'
        }
      }
    }
  ],

  'swarm/create-objective': [
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
      description: 'Adaptive optimization with requirements',
      complexity: 'advanced',
      input: {
        title: 'Performance Optimization Sprint',
        description: 'Identify and fix performance bottlenecks',
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

  'system/status': [
    {
      description: 'Get basic system status',
      complexity: 'minimal',
      input: {}
    }
  ],

  'system/health': [
    {
      description: 'Quick health check',
      complexity: 'minimal',
      input: {}
    },
    {
      description: 'Deep health check with component tests',
      complexity: 'typical',
      input: {
        deep: true
      }
    }
  ]
};

/**
 * Get examples for a specific tool
 */
export function getToolExamples(toolName: string): ToolExample[] {
  return TOOL_EXAMPLES[toolName] || [];
}

/**
 * Check if a tool has examples defined
 */
export function hasExamples(toolName: string): boolean {
  return toolName in TOOL_EXAMPLES && TOOL_EXAMPLES[toolName].length > 0;
}

/**
 * Get example by complexity level
 */
export function getExampleByComplexity(
  toolName: string,
  complexity: ToolExample['complexity']
): ToolExample | undefined {
  const examples = getToolExamples(toolName);
  return examples.find(e => e.complexity === complexity);
}
