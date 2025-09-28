/**
 * OpenAI Codex Agent Adapter
 * Adapter for integrating OpenAI Codex capabilities into the abstract agent system
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

// ===== CODEX ADAPTER =====

export class CodexAgentAdapter extends BaseCodingAgentAdapter {
  private openaiClient: any; // OpenAI client instance
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(
    id: string,
    config: AgentConfiguration
  ) {
    super(id, 'codex', 'openai-codex', config);
    
    // Extract OpenAI specific configuration
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || 'code-davinci-002';
    this.maxTokens = config.limits?.maxTokensPerRequest || 4000;
    this.temperature = config.preferences?.codeStyle?.temperature || 0.1;
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required for Codex adapter');
    }
  }

  // ===== IMPLEMENTED ABSTRACT METHODS =====

  /**
   * Execute task using OpenAI Codex capabilities
   */
  protected async executeTaskInternal(task: CodingTask): Promise<any> {
    try {
      // Initialize OpenAI client if not already done
      if (!this.openaiClient) {
        await this.initializeOpenAIClient();
      }

      // Prepare the prompt based on task type
      const prompt = this.buildCodexPrompt(task);
      
      // Execute the task using Codex
      const response = await this.executeCodexRequest(prompt, task);
      
      // Process the response
      return this.processCodexResponse(response, task);
    } catch (error) {
      console.error(`Codex execution failed for task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Get Codex specific capabilities
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
        { name: 'python', proficiency: 0.95, features: ['async', 'typing', 'decorators', 'generators'] },
        { name: 'javascript', proficiency: 0.9, features: ['es6+', 'async/await', 'modules', 'destructuring'] },
        { name: 'typescript', proficiency: 0.9, features: ['types', 'interfaces', 'generics', 'decorators'] },
        { name: 'java', proficiency: 0.85, features: ['generics', 'streams', 'lambdas', 'annotations'] },
        { name: 'csharp', proficiency: 0.85, features: ['linq', 'async', 'generics', 'attributes'] },
        { name: 'go', proficiency: 0.8, features: ['goroutines', 'channels', 'interfaces', 'generics'] },
        { name: 'rust', proficiency: 0.8, features: ['ownership', 'borrowing', 'traits', 'macros'] },
        { name: 'php', proficiency: 0.8, features: ['composer', 'psr', 'namespaces', 'traits'] }
      ],
      frameworks: [
        { name: 'django', proficiency: 0.9, capabilities: ['orm', 'admin', 'middleware', 'views'] },
        { name: 'flask', proficiency: 0.9, capabilities: ['routing', 'templates', 'extensions'] },
        { name: 'fastapi', proficiency: 0.85, capabilities: ['async', 'pydantic', 'openapi', 'dependency-injection'] },
        { name: 'react', proficiency: 0.85, capabilities: ['components', 'hooks', 'context', 'jsx'] },
        { name: 'vue', proficiency: 0.8, capabilities: ['composition-api', 'directives', 'components'] },
        { name: 'express', proficiency: 0.9, capabilities: ['middleware', 'routing', 'templates'] },
        { name: 'spring', proficiency: 0.8, capabilities: ['dependency-injection', 'aop', 'security', 'data'] }
      ],
      domains: [
        { name: 'web-development', expertise: 0.9, subdomains: ['backend', 'api', 'fullstack'] },
        { name: 'data-science', expertise: 0.95, subdomains: ['ml', 'analytics', 'visualization'] },
        { name: 'automation', expertise: 0.9, subdomains: ['scripts', 'bots', 'workflows'] },
        { name: 'testing', expertise: 0.85, subdomains: ['unit', 'integration', 'automation'] },
        { name: 'algorithms', expertise: 0.95, subdomains: ['sorting', 'searching', 'optimization'] }
      ],
      tools: [
        { name: 'pip', type: 'cli', capabilities: ['package-management', 'virtual-environments'] },
        { name: 'npm', type: 'cli', capabilities: ['package-management', 'scripting'] },
        { name: 'git', type: 'cli', capabilities: ['version-control', 'branching', 'merging'] },
        { name: 'pytest', type: 'library', capabilities: ['testing', 'fixtures', 'parametrization'] },
        { name: 'jest', type: 'library', capabilities: ['testing', 'mocking', 'coverage'] },
        { name: 'black', type: 'library', capabilities: ['formatting', 'code-style'] },
        { name: 'eslint', type: 'library', capabilities: ['linting', 'code-quality'] }
      ],
      maxConcurrentTasks: 2,
      maxTokensPerRequest: this.maxTokens,
      maxExecutionTime: 300000, // 5 minutes
      reliability: 0.9,
      speed: 0.85,
      quality: 0.9
    };
  }

  /**
   * Perform Codex specific health check
   */
  protected async performHealthCheck(): Promise<AgentHealth> {
    try {
      // Test Codex connectivity
      const testResponse = await this.testCodexConnectivity();
      
      if (testResponse.success) {
        return {
          status: 'healthy',
          score: 0.9,
          components: {
            connectivity: 1.0,
            performance: 0.85,
            reliability: 0.9,
            resources: 0.9
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
            message: 'Codex connectivity issues detected',
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
   * Initialize Codex specific resources
   */
  protected async initializeInternal(): Promise<void> {
    try {
      await this.initializeOpenAIClient();
      console.log(`Codex adapter ${this.id} initialized successfully`);
    } catch (error) {
      console.error(`Failed to initialize Codex adapter ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Shutdown Codex specific resources
   */
  protected async shutdownInternal(): Promise<void> {
    try {
      // Clean up any ongoing requests
      this.openaiClient = null;
      console.log(`Codex adapter ${this.id} shutdown successfully`);
    } catch (error) {
      console.error(`Failed to shutdown Codex adapter ${this.id}:`, error);
      throw error;
    }
  }

  /**
   * Send message using Codex communication
   */
  protected async sendMessageInternal(to: AgentId, message: AgentMessage): Promise<void> {
    // Codex doesn't have direct agent-to-agent communication
    // This would typically be handled by a coordination system
    console.log(`Codex adapter ${this.id} sending message to ${to.id}:`, message.type);
  }

  // ===== CODEX SPECIFIC METHODS =====

  /**
   * Initialize OpenAI client
   */
  private async initializeOpenAIClient(): Promise<void> {
    try {
      // This would initialize the actual OpenAI client
      // For now, we'll simulate it
      this.openaiClient = {
        apiKey: this.apiKey,
        model: this.model,
        maxTokens: this.maxTokens,
        temperature: this.temperature,
        initialized: true
      };
    } catch (error) {
      throw new Error(`Failed to initialize OpenAI client: ${error}`);
    }
  }

  /**
   * Build prompt for Codex based on task
   */
  private buildCodexPrompt(task: CodingTask): string {
    let prompt = '';
    
    // Codex works best with code-focused prompts
    switch (task.type) {
      case 'code-generation':
        prompt = this.buildCodeGenerationPrompt(task);
        break;
      case 'code-review':
        prompt = this.buildCodeReviewPrompt(task);
        break;
      case 'debugging':
        prompt = this.buildDebuggingPrompt(task);
        break;
      case 'refactoring':
        prompt = this.buildRefactoringPrompt(task);
        break;
      case 'testing':
        prompt = this.buildTestingPrompt(task);
        break;
      default:
        prompt = this.buildGenericPrompt(task);
    }
    
    return prompt;
  }

  /**
   * Build code generation prompt
   */
  private buildCodeGenerationPrompt(task: CodingTask): string {
    let prompt = `# ${task.name}\n\n`;
    prompt += `${task.description}\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `# Existing code:\n\`\`\`\n${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    if (task.instructions) {
      prompt += `# Requirements:\n${task.instructions}\n\n`;
    }
    
    prompt += `# Implementation:\n\`\`\``;
    
    // Add language hint if available
    const language = this.detectLanguage(task);
    if (language) {
      prompt += language;
    }
    
    prompt += `\n`;
    
    return prompt;
  }

  /**
   * Build code review prompt
   */
  private buildCodeReviewPrompt(task: CodingTask): string {
    let prompt = `# Code Review\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `# Code to review:\n\`\`\`\n${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    prompt += `# Review checklist:\n`;
    prompt += `- Code quality and style\n`;
    prompt += `- Performance considerations\n`;
    prompt += `- Security issues\n`;
    prompt += `- Best practices\n`;
    prompt += `- Potential bugs\n\n`;
    
    prompt += `# Review:\n`;
    
    return prompt;
  }

  /**
   * Build debugging prompt
   */
  private buildDebuggingPrompt(task: CodingTask): string {
    let prompt = `# Debugging\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `# Code with issues:\n\`\`\`\n${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    if (task.description) {
      prompt += `# Problem description:\n${task.description}\n\n`;
    }
    
    prompt += `# Debugging analysis:\n`;
    
    return prompt;
  }

  /**
   * Build refactoring prompt
   */
  private buildRefactoringPrompt(task: CodingTask): string {
    let prompt = `# Refactoring\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `# Original code:\n\`\`\`\n${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    if (task.instructions) {
      prompt += `# Refactoring goals:\n${task.instructions}\n\n`;
    }
    
    prompt += `# Refactored code:\n\`\`\`\n`;
    
    return prompt;
  }

  /**
   * Build testing prompt
   */
  private buildTestingPrompt(task: CodingTask): string {
    let prompt = `# Test Generation\n\n`;
    
    if (task.context.code?.currentCode) {
      prompt += `# Code to test:\n\`\`\`\n${task.context.code.currentCode}\n\`\`\`\n\n`;
    }
    
    prompt += `# Test cases:\n\`\`\`\n`;
    
    return prompt;
  }

  /**
   * Build generic prompt
   */
  private buildGenericPrompt(task: CodingTask): string {
    let prompt = `# ${task.name}\n\n`;
    prompt += `${task.description}\n\n`;
    
    if (task.instructions) {
      prompt += `# Instructions:\n${task.instructions}\n\n`;
    }
    
    prompt += `# Response:\n`;
    
    return prompt;
  }

  /**
   * Detect programming language from context
   */
  private detectLanguage(task: CodingTask): string | null {
    if (task.context.code?.currentCode) {
      const code = task.context.code.currentCode;
      
      // Simple language detection based on syntax
      if (code.includes('def ') || code.includes('import ') || code.includes('from ')) {
        return 'python';
      } else if (code.includes('function ') || code.includes('const ') || code.includes('let ')) {
        return 'javascript';
      } else if (code.includes('public class ') || code.includes('import java.')) {
        return 'java';
      } else if (code.includes('using ') || code.includes('namespace ')) {
        return 'csharp';
      } else if (code.includes('package ') || code.includes('func ')) {
        return 'go';
      }
    }
    
    return null;
  }

  /**
   * Execute Codex request
   */
  private async executeCodexRequest(prompt: string, task: CodingTask): Promise<any> {
    try {
      // This would make the actual API call to OpenAI Codex
      // For now, we'll simulate a response
      const response = {
        choices: [{
          text: this.generateSimulatedCodexResponse(task),
          finish_reason: 'stop',
          index: 0
        }],
        usage: {
          prompt_tokens: Math.floor(prompt.length / 4),
          completion_tokens: Math.floor(task.description.length / 4),
          total_tokens: Math.floor((prompt.length + task.description.length) / 4)
        },
        model: this.model
      };
      
      return response;
    } catch (error) {
      throw new Error(`Codex API request failed: ${error}`);
    }
  }

  /**
   * Process Codex response
   */
  private processCodexResponse(response: any, task: CodingTask): any {
    return {
      content: response.choices[0].text,
      usage: response.usage,
      model: response.model,
      finishReason: response.choices[0].finish_reason,
      taskType: task.type,
      timestamp: new Date()
    };
  }

  /**
   * Test Codex connectivity
   */
  private async testCodexConnectivity(): Promise<{ success: boolean; latency?: number }> {
    try {
      const startTime = Date.now();
      
      // Simulate a simple test request
      const testPrompt = "# Test\nprint('Hello, World!')";
      const response = await this.executeCodexRequest(testPrompt, {
        id: 'test',
        type: 'code-generation',
        name: 'Connectivity Test',
        description: 'Test Codex connectivity',
        priority: 'low',
        status: 'running',
        createdAt: new Date(),
        updatedAt: new Date(),
        context: { project: { id: 'test', name: 'test', type: 'test', structure: { root: '', directories: [], files: [], configFiles: [], dependencies: [] } }, code: {}, environment: { runtime: { name: 'python', version: '3.9', architecture: 'x64', features: [] }, os: { name: 'linux', version: '5.15', architecture: 'x64' }, tools: [], services: [] }, business: { requirements: [], userStories: [], acceptanceCriteria: [], businessRules: [] }, technical: { architecture: { style: 'monolithic', patterns: [], components: [], interactions: [] }, patterns: [], standards: [], performance: {}, security: { authentication: { methods: [], strength: 'basic', sessionManagement: false }, authorization: { model: 'rbac', granularity: 'coarse', inheritance: false }, dataProtection: { encryption: 'none', keyManagement: '', dataClassification: [] }, compliance: [] } } },
        requirements: { capabilities: [], agentType: undefined, minReliability: undefined, maxConcurrency: undefined, estimatedDuration: undefined, maxDuration: undefined, memoryRequired: undefined, cpuRequired: undefined, storageRequired: undefined, networkRequired: undefined, minQuality: undefined, testCoverage: undefined, documentationRequired: undefined, reviewRequired: undefined, tools: [], permissions: [], environment: undefined, dependencies: [] },
        constraints: {},
        dependencies: [],
        input: {},
        instructions: testPrompt,
        tags: []
      });
      
      const latency = Date.now() - startTime;
      
      return {
        success: response.content && response.content.includes('Hello'),
        latency
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Generate simulated Codex response for testing
   */
  private generateSimulatedCodexResponse(task: CodingTask): string {
    switch (task.type) {
      case 'code-generation':
        return `def ${task.name.toLowerCase().replace(/\s+/g, '_')}():\n    """${task.description}"""\n    return "Hello World"\n\n# Test the function\nif __name__ == "__main__":\n    result = ${task.name.toLowerCase().replace(/\s+/g, '_')}()\n    print(result)`;
      
      case 'code-review':
        return `## Code Review\n\n### Issues Found:\n- No major issues detected\n\n### Suggestions:\n- Add type hints for better code clarity\n- Consider adding error handling\n- Add docstrings for functions\n\n### Overall Assessment:\nThe code is well-structured and follows Python conventions.`;
      
      case 'debugging':
        return `## Debugging Analysis\n\n### Potential Issues:\n- Check for None values before operations\n- Verify input validation\n- Review exception handling\n\n### Recommended Fixes:\n1. Add null checks\n2. Implement proper error handling\n3. Add input validation\n4. Use try-except blocks for error handling`;
      
      case 'testing':
        return `import unittest\n\nclass Test${task.name.replace(/\s+/g, '')}(unittest.TestCase):\n    def test_${task.name.toLowerCase().replace(/\s+/g, '_')}(self):\n        # Test implementation\n        result = ${task.name.toLowerCase().replace(/\s+/g, '_')}()\n        self.assertEqual(result, "Hello World")\n\nif __name__ == '__main__':\n    unittest.main()`;
      
      case 'documentation':
        return `\"\"\"\n${task.name}\n========\n\n${task.description}\n\nUsage\n-----\n\n.. code-block:: python\n\n    from ${task.name.toLowerCase().replace(/\s+/g, '_')} import ${task.name.replace(/\s+/g, '')}\n    \n    result = ${task.name.replace(/\s+/g, '')}()\n    print(result)\n\nAPI Reference\n-------------\n\n.. function:: ${task.name.replace(/\s+/g, '')}()\n\n   Returns: str\n   \n   Description: ${task.description}\n\"\"\"`;
      
      default:
        return `# ${task.name}\n\n${task.description}\n\n# Implementation\nresult = "${task.name} implementation"\nprint(result)`;
    }
  }

  // ===== OVERRIDDEN HELPER METHODS =====

  /**
   * Extract tokens used from Codex response
   */
  protected extractTokensUsed(rawResult: any): number {
    return rawResult.usage?.total_tokens || 0;
  }

  /**
   * Extract cost from Codex response
   */
  protected extractCost(rawResult: any): number {
    const tokens = this.extractTokensUsed(rawResult);
    // Codex pricing (approximate)
    const costPerToken = 0.00002; // $0.02 per 1K tokens
    return tokens * costPerToken;
  }

  /**
   * Assess quality of Codex result
   */
  protected assessQuality(rawResult: any): number {
    // Codex typically produces good quality results
    let quality = 0.85;
    
    // Adjust based on finish reason
    if (rawResult.finishReason === 'stop') {
      quality = 0.9;
    } else if (rawResult.finishReason === 'length') {
      quality = 0.75; // May be truncated
    }
    
    return quality;
  }

  /**
   * Extract warnings from Codex response
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
   * Check if error is retryable for Codex
   */
  protected isRetryableError(error: any): boolean {
    const retryableErrors = [
      'rate_limit_exceeded',
      'server_error',
      'timeout',
      'network_error',
      'api_key_invalid'
    ];
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return retryableErrors.some(retryableError => 
      errorMessage.toLowerCase().includes(retryableError)
    );
  }
}

// ===== EXPORTS =====

export default CodexAgentAdapter;