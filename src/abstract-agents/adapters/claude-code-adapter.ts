/**
 * Claude Code Agent Adapter
 * Adapter for integrating Claude Code capabilities into the abstract agent system
 */

import BaseCodingAgentAdapter from './base-adapter.js';
import type { 
  AgentCapabilities, 
  AgentConfiguration, 
  AgentHealth, 
  CodingTask, 
  CodingResult,
  AgentProvider
} from '../interfaces/abstract-coding-agent.js';
import type { AgentId, AgentMessage } from '../../swarm/types.js';

// ===== CLAUDE CODE ADAPTER =====

export class ClaudeCodeAgentAdapter extends BaseCodingAgentAdapter {
  private claudeCodeClient: any; // Claude Code client instance
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(
    id: string,
    config: AgentConfiguration
  ) {
    super(id, 'claude-code', 'anthropic-claude-code', config);
    
    // Extract Claude Code specific configuration
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = config.model || 'claude-3-sonnet-20240229';
    this.maxTokens = config.limits?.maxTokensPerRequest || 4000;
    
    if (!this.apiKey) {
      throw new Error('Anthropic API key is required for Claude Code adapter');
    }
  }

  // ===== IMPLEMENTED ABSTRACT METHODS =====

  /**
   * Execute task using Claude Code's capabilities
   */
  protected async executeTaskInternal(task: CodingTask): Promise<any> {
    try {
      // Initialize Claude Code client if not already done
      if (!this.claudeCodeClient) {
        await this.initializeClaudeCodeClient();
      }

      // Prepare the prompt based on task type
      const prompt = this.buildPrompt(task);
      
      // Execute the task using Claude Code
      const response = await this.executeClaudeCodeRequest(prompt, task);
      
      // Process the response
      return this.processClaudeCodeResponse(response, task);
    } catch (error) {
      console.error(`Claude Code execution failed for task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Get Claude Code specific capabilities
   */
  protected async getAgentCapabilities(): Promise<AgentCapabilities> {
    return {
      codeGeneration: true,
      codeReview: true,
      debugging: true,
      refactoring: true,
      testing: true,
      documentation: true,
      languages: [
        { name: 'typescript', proficiency: 0.95, features: ['types', 'interfaces', 'generics'] },
        { name: 'javascript', proficiency: 0.95, features: ['es6+', 'async/await', 'modules'] },
        { name: 'python', proficiency: 0.9, features: ['async', 'typing', 'decorators'] },
        { name: 'rust', proficiency: 0.85, features: ['ownership', 'borrowing', 'traits'] },
        { name: 'go', proficiency: 0.8, features: ['goroutines', 'channels', 'interfaces'] },
        { name: 'java', proficiency: 0.8, features: ['generics', 'streams', 'lambdas'] },
        { name: 'csharp', proficiency: 0.8, features: ['linq', 'async', 'generics'] }
      ],
      frameworks: [
        { name: 'react', proficiency: 0.9, capabilities: ['components', 'hooks', 'context'] },
        { name: 'vue', proficiency: 0.85, capabilities: ['composition-api', 'directives', 'components'] },
        { name: 'angular', proficiency: 0.8, capabilities: ['dependency-injection', 'rxjs', 'forms'] },
        { name: 'express', proficiency: 0.9, capabilities: ['middleware', 'routing', 'middleware'] },
        { name: 'fastapi', proficiency: 0.85, capabilities: ['async', 'pydantic', 'openapi'] },
        { name: 'spring', proficiency: 0.8, capabilities: ['dependency-injection', 'aop', 'security'] }
      ],
      domains: [
        { name: 'web-development', expertise: 0.95, subdomains: ['frontend', 'backend', 'fullstack'] },
        { name: 'api-development', expertise: 0.9, subdomains: ['rest', 'graphql', 'grpc'] },
        { name: 'database-design', expertise: 0.85, subdomains: ['sql', 'nosql', 'orm'] },
        { name: 'testing', expertise: 0.9, subdomains: ['unit', 'integration', 'e2e'] },
        { name: 'devops', expertise: 0.8, subdomains: ['ci-cd', 'containers', 'monitoring'] }
      ],
      tools: [
        { name: 'git', type: 'cli', capabilities: ['version-control', 'branching', 'merging'] },
        { name: 'npm', type: 'cli', capabilities: ['package-management', 'scripting'] },
        { name: 'jest', type: 'library', capabilities: ['testing', 'mocking', 'coverage'] },
        { name: 'eslint', type: 'library', capabilities: ['linting', 'code-quality'] },
        { name: 'prettier', type: 'library', capabilities: ['formatting', 'code-style'] }
      ],
      maxConcurrentTasks: 3,
      maxTokensPerRequest: this.maxTokens,
      maxExecutionTime: 300000, // 5 minutes
      reliability: 0.95,
      speed: 0.9,
      quality: 0.95
    };
  }

  /**
   * Perform Claude Code specific health check
   */
  protected async performHealthCheck(): Promise<AgentHealth> {
    try {
      // Test Claude Code connectivity
      const testResponse = await this.testClaudeCodeConnectivity();
      
      if (testResponse.success) {
        return {
          status: 'healthy',
          score: 0.95,
          components: {
            connectivity: 1.0,
            performance: 0.9,
            reliability: 0.95,
            resources: 0.95
          },
          lastCheck: new Date(),
          issues: []
        };
      } else {
        return {
          status: 'degraded',
          score: 0.7,
          components: {
            connectivity: 0.8,
            performance: 0.7,
            reliability: 0.7,
            resources: 0.7
          },
          lastCheck: new Date(),
          issues: [{
            type: 'connectivity',
            severity: 'medium',
            message: 'Claude Code connectivity issues detected',
            timestamp: new Date(),
            resolved: false
          }]
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        score: 0.0,
        components: {
          connectivity: 0.0,
          performance: 0.0,
          reliability: 0.0,
          resources: 0.0
        },
        lastCheck: new Date(),
        issues: [{
          type: 'connectivity',
          severity: 'critical',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date(),
          resolved: false
        }]
      };
    }
  }

  /**
   * Initialize Claude Code specific resources
   */
  protected async initializeInternal(): Promise<void> {
    try {
      await this.initializeClaudeCodeClient();
      console.log(`Claude Code adapter ${this.id} initialized successfully`);
    } catch (error) {
      console.error(`Failed to initialize Claude Code adapter ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Shutdown Claude Code specific resources
   */
  protected async shutdownInternal(): Promise<void> {
    try {
      // Clean up any ongoing requests
      this.claudeCodeClient = null;
      console.log(`Claude Code adapter ${this.id} shutdown successfully`);
    } catch (error) {
      console.error(`Failed to shutdown Claude Code adapter ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Send message using Claude Code communication
   */
  protected async sendMessageInternal(to: AgentId, message: AgentMessage): Promise<void> {
    // Claude Code doesn't have direct agent-to-agent communication
    // This would typically be handled by a coordination system
    console.log(`Claude Code adapter ${this.id} sending message to ${to.id}:`, message.type);
  }

  // ===== CLAUDE CODE SPECIFIC METHODS =====

  /**
   * Initialize Claude Code client
   */
  private async initializeClaudeCodeClient(): Promise<void> {
    try {
      // This would initialize the actual Claude Code client
      // For now, we'll simulate it
      this.claudeCodeClient = {
        apiKey: this.apiKey,
        model: this.model,
        maxTokens: this.maxTokens,
        initialized: true
      };
    } catch (error) {
      throw new Error(`Failed to initialize Claude Code client: ${error}`);
    }
  }

  /**
   * Build prompt for Claude Code based on task
   */
  private buildPrompt(task: CodingTask): string {
    let prompt = `You are Claude Code, an AI coding assistant. Please help with the following task:\n\n`;
    
    prompt += `Task: ${task.name}\n`;
    prompt += `Description: ${task.description}\n`;
    prompt += `Type: ${task.type}\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `Current Code:\n\`\`\`${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    if (task.instructions) {
      prompt += `Instructions: ${task.instructions}\n\n`;
    }
    
    if (task.context.code?.relatedFiles) {
      prompt += `Related Files:\n`;
      task.context.code.relatedFiles.forEach(file => {
        prompt += `- ${file.path}: ${file.relationship}\n`;
      });
      prompt += `\n`;
    }
    
    if (task.examples && task.examples.length > 0) {
      prompt += `Examples:\n`;
      task.examples.forEach(example => {
        prompt += `- ${example.name}: ${example.description}\n`;
        if (example.input) {
          prompt += `  Input: ${example.input}\n`;
        }
        if (example.output) {
          prompt += `  Output: ${example.output}\n`;
        }
      });
      prompt += `\n`;
    }
    
    prompt += `Please provide a complete solution with:\n`;
    prompt += `1. The requested code\n`;
    prompt += `2. Any necessary tests\n`;
    prompt += `3. Documentation if needed\n`;
    prompt += `4. Explanations of key decisions\n`;
    
    return prompt;
  }

  /**
   * Execute Claude Code request
   */
  private async executeClaudeCodeRequest(prompt: string, task: CodingTask): Promise<any> {
    try {
      // This would make the actual API call to Claude Code
      // For now, we'll simulate a response
      const response = {
        content: this.generateSimulatedResponse(task),
        usage: {
          input_tokens: Math.floor(prompt.length / 4),
          output_tokens: Math.floor(task.description.length / 4),
          total_tokens: Math.floor((prompt.length + task.description.length) / 4)
        },
        model: this.model,
        finish_reason: 'stop'
      };
      
      return response;
    } catch (error) {
      throw new Error(`Claude Code API request failed: ${error}`);
    }
  }

  /**
   * Process Claude Code response
   */
  private processClaudeCodeResponse(response: any, task: CodingTask): any {
    return {
      content: response.content,
      usage: response.usage,
      model: response.model,
      finishReason: response.finish_reason,
      taskType: task.type,
      timestamp: new Date()
    };
  }

  /**
   * Test Claude Code connectivity
   */
  private async testClaudeCodeConnectivity(): Promise<{ success: boolean; latency?: number }> {
    try {
      const startTime = Date.now();
      
      // Simulate a simple test request
      const testPrompt = "Hello, please respond with 'OK' to confirm connectivity.";
      const response = await this.executeClaudeCodeRequest(testPrompt, {
        id: 'test',
        type: 'custom',
        name: 'Connectivity Test',
        description: 'Test Claude Code connectivity',
        priority: 'low',
        status: 'running',
        createdAt: new Date(),
        updatedAt: new Date(),
        context: { project: { id: 'test', name: 'test', type: 'test', structure: { root: '', directories: [], files: [], configFiles: [], dependencies: [] } }, code: {}, environment: { runtime: { name: 'node', version: '18', architecture: 'x64', features: [] }, os: { name: 'linux', version: '5.15', architecture: 'x64' }, tools: [], services: [] }, business: { requirements: [], userStories: [], acceptanceCriteria: [], businessRules: [] }, technical: { architecture: { style: 'monolithic', patterns: [], components: [], interactions: [] }, patterns: [], standards: [], performance: {}, security: { authentication: { methods: [], strength: 'basic', sessionManagement: false }, authorization: { model: 'rbac', granularity: 'coarse', inheritance: false }, dataProtection: { encryption: 'none', keyManagement: '', dataClassification: [] }, compliance: [] } } },
        requirements: { capabilities: [], agentType: undefined, minReliability: undefined, maxConcurrency: undefined, estimatedDuration: undefined, maxDuration: undefined, memoryRequired: undefined, cpuRequired: undefined, storageRequired: undefined, networkRequired: undefined, minQuality: undefined, testCoverage: undefined, documentationRequired: undefined, reviewRequired: undefined, tools: [], permissions: [], environment: undefined, dependencies: [] },
        constraints: {},
        dependencies: [],
        input: {},
        instructions: testPrompt,
        tags: []
      });
      
      const latency = Date.now() - startTime;
      
      return {
        success: response.content && response.content.includes('OK'),
        latency
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Generate simulated response for testing
   */
  private generateSimulatedResponse(task: CodingTask): string {
    switch (task.type) {
      case 'code-generation':
        return `// Generated code for: ${task.name}\n\nexport function ${task.name.toLowerCase().replace(/\s+/g, '_')}() {\n  // Implementation here\n  return "Hello World";\n}\n\n// Tests\ndescribe('${task.name}', () => {\n  it('should work correctly', () => {\n    expect(${task.name.toLowerCase().replace(/\s+/g, '_')}()).toBe("Hello World");\n  });\n});`;
      
      case 'code-review':
        return `## Code Review for: ${task.name}\n\n### Issues Found:\n- No issues found\n\n### Suggestions:\n- Consider adding error handling\n- Add JSDoc comments for better documentation\n\n### Overall Assessment:\nThe code looks good and follows best practices.`;
      
      case 'debugging':
        return `## Debugging Analysis for: ${task.name}\n\n### Potential Issues:\n- Check for null/undefined values\n- Verify input validation\n- Review error handling\n\n### Recommended Fixes:\n1. Add null checks\n2. Implement proper error handling\n3. Add input validation`;
      
      case 'testing':
        return `// Test suite for: ${task.name}\n\ndescribe('${task.name}', () => {\n  beforeEach(() => {\n    // Setup\n  });\n\n  it('should handle normal case', () => {\n    // Test implementation\n  });\n\n  it('should handle edge cases', () => {\n    // Test implementation\n  });\n\n  it('should handle error cases', () => {\n    // Test implementation\n  });\n});`;
      
      case 'documentation':
        return `# ${task.name}\n\n## Overview\nThis module provides functionality for ${task.description}.\n\n## Usage\n\`\`\`typescript\nimport { ${task.name} } from './${task.name.toLowerCase()}';\n\nconst result = ${task.name}();\n\`\`\`\n\n## API Reference\n\n### ${task.name}()\nReturns: \`string\`\n\nDescription: ${task.description}`;
      
      default:
        return `Response for ${task.type}: ${task.description}`;
    }
  }

  // ===== OVERRIDDEN HELPER METHODS =====

  /**
   * Extract tokens used from Claude Code response
   */
  protected extractTokensUsed(rawResult: any): number {
    return rawResult.usage?.total_tokens || 0;
  }

  /**
   * Extract cost from Claude Code response
   */
  protected extractCost(rawResult: any): number {
    const tokens = this.extractTokensUsed(rawResult);
    // Claude Code pricing (approximate)
    const costPerToken = 0.000015; // $0.015 per 1K tokens
    return tokens * costPerToken;
  }

  /**
   * Assess quality of Claude Code result
   */
  protected assessQuality(rawResult: any): number {
    // Claude Code typically produces high-quality results
    let quality = 0.9;
    
    // Adjust based on finish reason
    if (rawResult.finishReason === 'stop') {
      quality = 0.95;
    } else if (rawResult.finishReason === 'length') {
      quality = 0.8; // May be truncated
    }
    
    return quality;
  }

  /**
   * Extract warnings from Claude Code response
   */
  protected extractWarnings(rawResult: any): any[] {
    const warnings = [];
    
    if (rawResult.finishReason === 'length') {
      warnings.push({
        type: 'truncation',
        message: 'Response may be truncated due to token limit',
        severity: 'medium'
      });
    }
    
    return warnings;
  }

  /**
   * Check if error is retryable for Claude Code
   */
  protected isRetryableError(error: any): boolean {
    const retryableErrors = [
      'rate_limit_exceeded',
      'server_error',
      'timeout',
      'network_error'
    ];
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return retryableErrors.some(retryableError => 
      errorMessage.toLowerCase().includes(retryableError)
    );
  }
}

// ===== EXPORTS =====

export default ClaudeCodeAgentAdapter;