/**
 * Automatic Agent Creator
 * Dynamically creates new agent types when they're not found in the registry
 */

import type { AgentTemplate, AgentManagerConfig } from './agent-manager.js';
import type { AgentType, AgentCapabilities, AgentConfig, AgentEnvironment } from '../swarm/types.js';
import { getErrorMessage } from '../utils/error-handler.js';

export interface AgentCreationConfig {
  baseCapabilities?: Partial<AgentCapabilities>;
  baseConfig?: Partial<AgentConfig>;
  baseEnvironment?: Partial<AgentEnvironment>;
  inferFromName?: boolean;
  autoRegister?: boolean;
}

export class AutoAgentCreator {
  private defaultConfig: AgentCreationConfig;
  private knownDomains: Map<string, Partial<AgentCapabilities>>;
  private createdAgents: Map<string, AgentTemplate>;

  constructor(config: AgentCreationConfig = {}) {
    this.defaultConfig = {
      inferFromName: true,
      autoRegister: true,
      ...config
    };

    this.createdAgents = new Map();
    this.initializeKnownDomains();
  }

  /**
   * Initialize known domain patterns for capability inference
   */
  private initializeKnownDomains(): void {
    this.knownDomains = new Map([
      ['research', {
        research: true,
        webSearch: true,
        documentation: true,
        analysis: true,
        domains: ['research', 'information-gathering', 'data-collection']
      }],
      ['design', {
        documentation: true,
        analysis: true,
        domains: ['design', 'architecture', 'ui-ux']
      }],
      ['develop', {
        codeGeneration: true,
        codeReview: true,
        testing: true,
        fileSystem: true,
        terminalAccess: true,
        domains: ['development', 'programming', 'software-engineering']
      }],
      ['test', {
        testing: true,
        codeReview: true,
        analysis: true,
        domains: ['testing', 'quality-assurance', 'validation']
      }],
      ['analyze', {
        analysis: true,
        documentation: true,
        domains: ['analysis', 'data-science', 'insights']
      }],
      ['optimize', {
        analysis: true,
        codeReview: true,
        domains: ['optimization', 'performance', 'efficiency']
      }],
      ['integrate', {
        apiIntegration: true,
        codeGeneration: true,
        domains: ['integration', 'api', 'connectivity']
      }],
      ['write', {
        documentation: true,
        domains: ['writing', 'content-creation', 'documentation']
      }],
      ['coordinate', {
        domains: ['coordination', 'management', 'orchestration']
      }],
      ['ui', {
        codeGeneration: true,
        documentation: true,
        domains: ['frontend', 'user-interface', 'ui-development']
      }],
      ['backend', {
        codeGeneration: true,
        apiIntegration: true,
        terminalAccess: true,
        domains: ['backend', 'api', 'server']
      }],
      ['database', {
        analysis: true,
        domains: ['database', 'data-management', 'sql']
      }],
      ['security', {
        codeReview: true,
        analysis: true,
        domains: ['security', 'vulnerability-assessment', 'compliance']
      }],
      ['performance', {
        analysis: true,
        codeReview: true,
        domains: ['performance', 'optimization', 'profiling']
      }]
    ]);
  }

  /**
   * Create a new agent template based on the requested type
   */
  async createAgentTemplate(
    requestedType: string,
    customCapabilities?: Partial<AgentCapabilities>,
    customConfig?: Partial<AgentConfig>
  ): Promise<AgentTemplate> {
    console.log(`[AutoAgentCreator] Creating new agent type: ${requestedType}`);

    // Check if we've already created this agent type
    const existing = this.createdAgents.get(requestedType);
    if (existing) {
      console.log(`[AutoAgentCreator] Using cached template for: ${requestedType}`);
      return existing;
    }

    // Infer capabilities from the agent type name
    const inferredCapabilities = this.inferCapabilities(requestedType);
    
    // Create the agent template
    const template: AgentTemplate = {
      name: this.formatAgentName(requestedType),
      type: requestedType as AgentType, // We'll treat any string as a valid type
      capabilities: {
        codeGeneration: false,
        codeReview: false,
        testing: false,
        documentation: false,
        research: false,
        analysis: false,
        webSearch: false,
        apiIntegration: false,
        fileSystem: true,
        terminalAccess: false,
        languages: [],
        frameworks: [],
        domains: [],
        tools: [],
        maxConcurrentTasks: 3,
        maxMemoryUsage: 256 * 1024 * 1024, // 256MB default
        maxExecutionTime: 300000, // 5 minutes default
        reliability: 0.8,
        speed: 0.7,
        quality: 0.8,
        ...this.defaultConfig.baseCapabilities,
        ...inferredCapabilities,
        ...customCapabilities
      },
      config: {
        autonomyLevel: 0.7,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 20,
        maxConcurrentTasks: 3,
        timeoutThreshold: 300000,
        reportingInterval: 30000,
        heartbeatInterval: 10000,
        permissions: ['file-read'],
        trustedAgents: [],
        expertise: {},
        preferences: {},
        ...this.defaultConfig.baseConfig,
        ...customConfig
      },
      environment: {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: `./agents/${requestedType}`,
        tempDirectory: `./tmp/${requestedType}`,
        logDirectory: `./logs/${requestedType}`,
        apiEndpoints: {},
        credentials: {},
        availableTools: [],
        toolConfigs: {},
        ...this.defaultConfig.baseEnvironment
      },
      startupScript: `./scripts/start-${requestedType}.ts`,
      dependencies: []
    };

    // Add specific expertise based on the agent type
    template.config.expertise = this.inferExpertise(requestedType, template.capabilities);

    // Add specific tools based on capabilities
    template.environment.availableTools = this.inferTools(template.capabilities);

    // Add specific permissions based on capabilities
    template.config.permissions = this.inferPermissions(template.capabilities);

    // Cache the created template
    this.createdAgents.set(requestedType, template);

    console.log(`[AutoAgentCreator] Created template for ${requestedType} with capabilities:`, {
      domains: template.capabilities.domains,
      tools: template.environment.availableTools,
      permissions: template.config.permissions
    });

    return template;
  }

  /**
   * Infer capabilities based on the agent type name
   */
  private inferCapabilities(agentType: string): Partial<AgentCapabilities> {
    const lowerType = agentType.toLowerCase();
    const capabilities: Partial<AgentCapabilities> = {
      domains: [agentType.toLowerCase().replace(/_/g, '-')]
    };

    // Check against known domain patterns
    for (const [pattern, domainCapabilities] of this.knownDomains) {
      if (lowerType.includes(pattern)) {
        Object.assign(capabilities, domainCapabilities);
        // Merge domains instead of replacing
        if (domainCapabilities.domains) {
          capabilities.domains = [
            ...(capabilities.domains || []),
            ...domainCapabilities.domains
          ];
        }
      }
    }

    // Special cases for compound types
    if (lowerType.includes('full') && lowerType.includes('stack')) {
      Object.assign(capabilities, {
        codeGeneration: true,
        codeReview: true,
        testing: true,
        apiIntegration: true,
        fileSystem: true,
        terminalAccess: true,
        domains: [...(capabilities.domains || []), 'fullstack', 'web-development']
      });
    }

    if (lowerType.includes('devops')) {
      Object.assign(capabilities, {
        terminalAccess: true,
        apiIntegration: true,
        analysis: true,
        domains: [...(capabilities.domains || []), 'devops', 'infrastructure', 'deployment']
      });
    }

    if (lowerType.includes('data') && lowerType.includes('scientist')) {
      Object.assign(capabilities, {
        analysis: true,
        codeGeneration: true,
        documentation: true,
        domains: [...(capabilities.domains || []), 'data-science', 'machine-learning', 'statistics']
      });
    }

    // Language-specific capabilities
    const languagePatterns = {
      'python': ['python'],
      'javascript': ['javascript', 'typescript'],
      'java': ['java'],
      'rust': ['rust'],
      'go': ['go', 'golang'],
      'ruby': ['ruby'],
      'php': ['php'],
      'csharp': ['csharp', 'c#'],
      'cpp': ['cpp', 'c++'],
      'swift': ['swift'],
      'kotlin': ['kotlin']
    };

    for (const [pattern, languages] of Object.entries(languagePatterns)) {
      if (lowerType.includes(pattern)) {
        capabilities.languages = [...(capabilities.languages || []), ...languages];
        capabilities.codeGeneration = true;
      }
    }

    // Framework-specific capabilities
    const frameworkPatterns = {
      'react': ['react', 'next.js'],
      'vue': ['vue', 'nuxt'],
      'angular': ['angular'],
      'svelte': ['svelte', 'sveltekit'],
      'django': ['django'],
      'flask': ['flask'],
      'fastapi': ['fastapi'],
      'express': ['express', 'node'],
      'rails': ['rails', 'ruby-on-rails'],
      'spring': ['spring', 'spring-boot'],
      'laravel': ['laravel']
    };

    for (const [pattern, frameworks] of Object.entries(frameworkPatterns)) {
      if (lowerType.includes(pattern)) {
        capabilities.frameworks = [...(capabilities.frameworks || []), ...frameworks];
        capabilities.codeGeneration = true;
      }
    }

    // Remove duplicates from arrays
    if (capabilities.domains) {
      capabilities.domains = [...new Set(capabilities.domains)];
    }
    if (capabilities.languages) {
      capabilities.languages = [...new Set(capabilities.languages)];
    }
    if (capabilities.frameworks) {
      capabilities.frameworks = [...new Set(capabilities.frameworks)];
    }

    return capabilities;
  }

  /**
   * Infer expertise levels based on capabilities
   */
  private inferExpertise(
    agentType: string, 
    capabilities: AgentCapabilities
  ): Record<string, number> {
    const expertise: Record<string, number> = {};
    const lowerType = agentType.toLowerCase();

    // Base expertise from capabilities
    if (capabilities.codeGeneration) expertise.coding = 0.8;
    if (capabilities.codeReview) expertise.review = 0.7;
    if (capabilities.testing) expertise.testing = 0.7;
    if (capabilities.documentation) expertise.documentation = 0.7;
    if (capabilities.research) expertise.research = 0.8;
    if (capabilities.analysis) expertise.analysis = 0.8;

    // Boost expertise for specialized types
    if (lowerType.includes('senior') || lowerType.includes('expert')) {
      Object.keys(expertise).forEach(key => {
        expertise[key] = Math.min(0.95, expertise[key] + 0.15);
      });
    }

    if (lowerType.includes('junior') || lowerType.includes('trainee')) {
      Object.keys(expertise).forEach(key => {
        expertise[key] = Math.max(0.5, expertise[key] - 0.2);
      });
    }

    // Domain-specific expertise
    capabilities.domains.forEach(domain => {
      expertise[domain.replace(/-/g, '_')] = 0.8;
    });

    return expertise;
  }

  /**
   * Infer tools based on capabilities
   */
  private inferTools(capabilities: AgentCapabilities): string[] {
    const tools: string[] = [];

    if (capabilities.codeGeneration) {
      tools.push('editor', 'code-generator');
    }
    if (capabilities.codeReview) {
      tools.push('code-analyzer', 'linter');
    }
    if (capabilities.testing) {
      tools.push('test-runner', 'coverage-analyzer');
    }
    if (capabilities.documentation) {
      tools.push('doc-generator', 'markdown-editor');
    }
    if (capabilities.research) {
      tools.push('web-search', 'data-extractor');
    }
    if (capabilities.analysis) {
      tools.push('data-processor', 'analyzer');
    }
    if (capabilities.webSearch) {
      tools.push('web-browser', 'scraper');
    }
    if (capabilities.apiIntegration) {
      tools.push('api-client', 'webhook-handler');
    }
    if (capabilities.terminalAccess) {
      tools.push('terminal', 'shell');
    }

    // Language-specific tools
    if (capabilities.languages?.includes('python')) {
      tools.push('pip', 'python-debugger');
    }
    if (capabilities.languages?.includes('javascript') || capabilities.languages?.includes('typescript')) {
      tools.push('npm', 'node-debugger');
    }
    if (capabilities.languages?.includes('rust')) {
      tools.push('cargo');
    }
    if (capabilities.languages?.includes('go')) {
      tools.push('go-tools');
    }

    // Framework-specific tools
    if (capabilities.frameworks?.includes('react')) {
      tools.push('react-devtools');
    }
    if (capabilities.frameworks?.includes('vue')) {
      tools.push('vue-devtools');
    }

    return [...new Set(tools)]; // Remove duplicates
  }

  /**
   * Infer permissions based on capabilities
   */
  private inferPermissions(capabilities: AgentCapabilities): string[] {
    const permissions: string[] = ['file-read']; // Base permission

    if (capabilities.codeGeneration || capabilities.documentation) {
      permissions.push('file-write');
    }
    if (capabilities.terminalAccess) {
      permissions.push('terminal-access', 'process-spawn');
    }
    if (capabilities.webSearch) {
      permissions.push('web-access');
    }
    if (capabilities.apiIntegration) {
      permissions.push('network-access', 'api-access');
    }
    if (capabilities.codeReview || capabilities.codeGeneration) {
      permissions.push('git-access');
    }

    return [...new Set(permissions)]; // Remove duplicates
  }

  /**
   * Format agent name from type
   */
  private formatAgentName(agentType: string): string {
    return agentType
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ') + ' Agent';
  }

  /**
   * Get or create an agent template
   */
  async getOrCreateTemplate(
    agentType: string,
    existingTemplates: Map<string, AgentTemplate>
  ): Promise<AgentTemplate> {
    // First check existing templates
    const existing = existingTemplates.get(agentType);
    if (existing) {
      return existing;
    }

    // Check our cache
    const cached = this.createdAgents.get(agentType);
    if (cached) {
      return cached;
    }

    // Create new template
    return this.createAgentTemplate(agentType);
  }

  /**
   * Register a newly created template with the agent manager
   */
  registerTemplate(
    templates: Map<string, AgentTemplate>,
    agentType: string,
    template: AgentTemplate
  ): void {
    templates.set(agentType, template);
    console.log(`[AutoAgentCreator] Registered new agent type: ${agentType}`);
  }

  /**
   * Get all created agent templates
   */
  getCreatedTemplates(): Map<string, AgentTemplate> {
    return new Map(this.createdAgents);
  }

  /**
   * Clear the cache of created templates
   */
  clearCache(): void {
    this.createdAgents.clear();
  }
}