/**
 * Routing hooks - route tasks and explain routing decisions
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import { callMCPTool, MCPClientError } from '../../mcp-client.js';

// Route subcommand
export const routeCommand: Command = {
  name: 'route',
  description: 'Route task to optimal agent using learned patterns',
  options: [
    {
      name: 'task',
      short: 't',
      description: 'Task description',
      type: 'string',
      required: true
    },
    {
      name: 'context',
      short: 'c',
      description: 'Additional context',
      type: 'string'
    },
    {
      name: 'top-k',
      short: 'K',
      description: 'Number of top agent suggestions',
      type: 'number',
      default: 3
    }
  ],
  examples: [
    { command: 'claude-flow hooks route -t "Fix authentication bug"', description: 'Route task to optimal agent' },
    { command: 'claude-flow hooks route -t "Optimize database queries" -K 5', description: 'Get top 5 suggestions' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = ctx.args[0] || ctx.flags.task as string;
    const topK = ctx.flags.topK as number || 3;

    if (!task) {
      output.printError('Task description is required. Use --task or -t flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Routing task: ${output.highlight(task)}`);

    try {
      // Call MCP tool for routing
      const result = await callMCPTool<{
        task: string;
        routing?: {
          method: string;
          backend?: string;
          latencyMs: number;
          throughput: string;
        };
        matchedPattern?: string;
        semanticMatches?: Array<{
          pattern: string;
          score: number;
        }>;
        primaryAgent: {
          type: string;
          confidence: number;
          reason: string;
        };
        alternativeAgents: Array<{
          type: string;
          confidence: number;
          reason: string;
        }>;
        estimatedMetrics: {
          successProbability: number;
          estimatedDuration: string;
          complexity: 'low' | 'medium' | 'high';
        };
      }>('hooks_route', {
        task,
        context: ctx.flags.context,
        topK,
        includeEstimates: true,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      // Show routing method info
      if (result.routing) {
        output.writeln();
        output.writeln(output.bold('Routing Method'));
        const methodDisplay = result.routing.method.startsWith('semantic')
          ? output.success(`${result.routing.method} (${result.routing.backend || 'semantic'})`)
          : 'keyword';
        output.printList([
          `Method: ${methodDisplay}`,
          result.routing.backend ? `Backend: ${result.routing.backend}` : null,
          `Latency: ${result.routing.latencyMs.toFixed(3)}ms`,
          result.matchedPattern ? `Matched Pattern: ${result.matchedPattern}` : null,
        ].filter(Boolean) as string[]);

        // Show semantic matches if available
        if (result.semanticMatches && result.semanticMatches.length > 0) {
          output.writeln();
          output.writeln(output.dim('Semantic Matches:'));
          result.semanticMatches.forEach(m => {
            output.writeln(`  ${m.pattern}: ${(m.score * 100).toFixed(1)}%`);
          });
        }
      }

      output.writeln();
      output.printBox(
        [
          `Agent: ${output.highlight(result.primaryAgent.type)}`,
          `Confidence: ${(result.primaryAgent.confidence * 100).toFixed(1)}%`,
          `Reason: ${result.primaryAgent.reason}`
        ].join('\n'),
        'Primary Recommendation'
      );

      if (result.alternativeAgents.length > 0) {
        output.writeln();
        output.writeln(output.bold('Alternative Agents'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Agent Type', width: 20 },
            { key: 'confidence', header: 'Confidence', width: 12, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(1)}%` },
            { key: 'reason', header: 'Reason', width: 35 }
          ],
          data: result.alternativeAgents
        });
      }

      if (result.estimatedMetrics) {
        output.writeln();
        output.writeln(output.bold('Estimated Metrics'));
        output.printList([
          `Success Probability: ${(result.estimatedMetrics.successProbability * 100).toFixed(1)}%`,
          `Estimated Duration: ${result.estimatedMetrics.estimatedDuration}`,
          `Complexity: ${result.estimatedMetrics.complexity.toUpperCase()}`
        ]);
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Routing failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};

// Explain subcommand
export const explainCommand: Command = {
  name: 'explain',
  description: 'Explain routing decision with transparency',
  options: [
    {
      name: 'task',
      short: 't',
      description: 'Task description',
      type: 'string',
      required: true
    },
    {
      name: 'agent',
      short: 'a',
      description: 'Agent type to explain',
      type: 'string'
    },
    {
      name: 'verbose',
      short: 'v',
      description: 'Verbose explanation',
      type: 'boolean',
      default: false
    }
  ],
  examples: [
    { command: 'claude-flow hooks explain -t "Fix authentication bug"', description: 'Explain routing decision' },
    { command: 'claude-flow hooks explain -t "Optimize queries" -a coder --verbose', description: 'Verbose explanation for specific agent' }
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = ctx.args[0] || ctx.flags.task as string;

    if (!task) {
      output.printError('Task description is required. Use --task or -t flag.');
      return { success: false, exitCode: 1 };
    }

    output.printInfo(`Explaining routing for: ${output.highlight(task)}`);

    try {
      // Call MCP tool for explanation
      const result = await callMCPTool<{
        task: string;
        explanation: string;
        factors: Array<{
          factor: string;
          weight: number;
          value: number;
          impact: string;
        }>;
        patterns: Array<{
          pattern: string;
          matchScore: number;
          examples: string[];
        }>;
        decision: {
          agent: string;
          confidence: number;
          reasoning: string[];
        };
      }>('hooks_explain', {
        task,
        agent: ctx.flags.agent,
        verbose: ctx.flags.verbose || false,
      });

      if (ctx.flags.format === 'json') {
        output.printJson(result);
        return { success: true, data: result };
      }

      output.writeln();
      output.writeln(output.bold('Decision Explanation'));
      output.writeln();
      output.writeln(result.explanation);

      output.writeln();
      output.printBox(
        [
          `Agent: ${output.highlight(result.decision.agent)}`,
          `Confidence: ${(result.decision.confidence * 100).toFixed(1)}%`
        ].join('\n'),
        'Final Decision'
      );

      if (result.decision.reasoning.length > 0) {
        output.writeln();
        output.writeln(output.bold('Reasoning Steps'));
        output.printList(result.decision.reasoning.map((r, i) => `${i + 1}. ${r}`));
      }

      if (result.factors.length > 0) {
        output.writeln();
        output.writeln(output.bold('Decision Factors'));
        output.printTable({
          columns: [
            { key: 'factor', header: 'Factor', width: 20 },
            { key: 'weight', header: 'Weight', width: 10, align: 'right', format: (v) => `${(Number(v) * 100).toFixed(0)}%` },
            { key: 'value', header: 'Value', width: 10, align: 'right', format: (v) => Number(v).toFixed(2) },
            { key: 'impact', header: 'Impact', width: 25 }
          ],
          data: result.factors
        });
      }

      if (result.patterns.length > 0 && ctx.flags.verbose) {
        output.writeln();
        output.writeln(output.bold('Matched Patterns'));
        result.patterns.forEach((p, i) => {
          output.writeln();
          output.writeln(`${i + 1}. ${output.highlight(p.pattern)} (${(p.matchScore * 100).toFixed(1)}% match)`);
          if (p.examples.length > 0) {
            output.printList(p.examples.slice(0, 3).map(e => output.dim(`  ${e}`)));
          }
        });
      }

      return { success: true, data: result };
    } catch (error) {
      if (error instanceof MCPClientError) {
        output.printError(`Explanation failed: ${error.message}`);
      } else {
        output.printError(`Unexpected error: ${String(error)}`);
      }
      return { success: false, exitCode: 1 };
    }
  }
};
