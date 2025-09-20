/**
 * Enhanced Agent Manager with Automatic Agent Creation
 * Extends the base AgentManager to automatically create new agent types on demand
 */

import { AgentManager, AgentManagerConfig, AgentTemplate } from './agent-manager.js';
import { AutoAgentCreator, AgentCreationConfig } from './auto-agent-creator.js';
import type { ILogger } from '../core/logger.js';
import type { IEventBus } from '../core/event-bus.js';
import type { DistributedMemorySystem } from '../memory/distributed-memory.js';
import type { AgentConfig, AgentEnvironment } from '../swarm/types.js';
import { getErrorMessage } from '../utils/error-handler.js';

export interface EnhancedAgentManagerConfig extends Partial<AgentManagerConfig> {
  autoCreation?: AgentCreationConfig;
  enableAutoCreation?: boolean;
  customTemplateHandlers?: Map<string, (type: string) => Promise<AgentTemplate>>;
}

export class EnhancedAgentManager extends AgentManager {
  private autoCreator: AutoAgentCreator;
  private enableAutoCreation: boolean;
  private customHandlers: Map<string, (type: string) => Promise<AgentTemplate>>;
  private creationAttempts: Map<string, number>;
  private maxCreationAttempts: number = 3;

  constructor(
    config: EnhancedAgentManagerConfig,
    logger: ILogger,
    eventBus: IEventBus,
    memory: DistributedMemorySystem
  ) {
    super(config, logger, eventBus, memory);

    this.enableAutoCreation = config.enableAutoCreation ?? true;
    this.autoCreator = new AutoAgentCreator(config.autoCreation);
    this.customHandlers = config.customTemplateHandlers || new Map();
    this.creationAttempts = new Map();

    // Override the templates property to make it accessible
    Object.defineProperty(this, 'templates', {
      get: () => this.getTemplates(),
      set: (value) => this.setTemplates(value)
    });
  }

  /**
   * Override createAgent to handle automatic template creation
   */
  async createAgent(
    templateNameOrType: string,
    overrides: {
      name?: string;
      config?: Partial<AgentConfig>;
      environment?: Partial<AgentEnvironment>;
    } = {}
  ): Promise<string> {
    try {
      // First try the standard creation
      return await super.createAgent(templateNameOrType, overrides);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      
      // Check if the error is due to missing template
      if (errorMessage.includes('Template') && errorMessage.includes('not found')) {
        if (!this.enableAutoCreation) {
          throw error; // Re-throw if auto-creation is disabled
        }

        // Log the auto-creation attempt
        const logger = this.getLogger();
        logger.info('[EnhancedAgentManager] Agent type not found, attempting auto-creation', {
          requestedType: templateNameOrType
        });

        // Check creation attempts to prevent infinite loops
        const attempts = this.creationAttempts.get(templateNameOrType) || 0;
        if (attempts >= this.maxCreationAttempts) {
          throw new Error(`Failed to create agent type '${templateNameOrType}' after ${attempts} attempts`);
        }
        this.creationAttempts.set(templateNameOrType, attempts + 1);

        // Try to create the template
        const newTemplate = await this.createTemplateForType(templateNameOrType);
        
        // Register the new template
        this.registerTemplate(templateNameOrType, newTemplate);

        // Log successful creation
        logger.info('[EnhancedAgentManager] Successfully created and registered new agent type', {
          type: templateNameOrType,
          name: newTemplate.name
        });

        // Emit event for new template creation
        this.emit('template:auto-created', {
          type: templateNameOrType,
          template: newTemplate
        });

        // Now try creating the agent again with the new template
        try {
          const agentId = await super.createAgent(templateNameOrType, overrides);
          
          // Reset creation attempts on success
          this.creationAttempts.delete(templateNameOrType);
          
          return agentId;
        } catch (retryError) {
          logger.error('[EnhancedAgentManager] Failed to create agent even after template creation', {
            type: templateNameOrType,
            error: getErrorMessage(retryError)
          });
          throw retryError;
        }
      } else {
        // Not a template-related error, re-throw
        throw error;
      }
    }
  }

  /**
   * Create a template for a new agent type
   */
  private async createTemplateForType(agentType: string): Promise<AgentTemplate> {
    // Check if there's a custom handler for this type
    const customHandler = this.customHandlers.get(agentType);
    if (customHandler) {
      return await customHandler(agentType);
    }

    // Use the auto-creator to generate a template
    const templates = this.getTemplates();
    return await this.autoCreator.getOrCreateTemplate(agentType, templates);
  }

  /**
   * Register a new template
   */
  registerTemplate(agentType: string, template: AgentTemplate): void {
    const templates = this.getTemplates();
    this.autoCreator.registerTemplate(templates, agentType, template);
    
    // Store in memory for persistence
    this.storeTemplateInMemory(agentType, template);
  }

  /**
   * Store template in memory for persistence across sessions
   */
  private async storeTemplateInMemory(agentType: string, template: AgentTemplate): Promise<void> {
    const memory = this.getMemory();
    await memory.store(`template:${agentType}`, template, {
      type: 'agent-template',
      tags: ['template', 'auto-created', agentType],
      partition: 'config'
    });
  }

  /**
   * Load auto-created templates from memory
   */
  async loadAutoCreatedTemplates(): Promise<void> {
    const memory = this.getMemory();
    const logger = this.getLogger();

    try {
      const entries = await memory.query({
        type: 'state' as const,
        namespace: 'config',
        tags: ['template', 'auto-created']
      });

      for (const entry of entries) {
        if (entry.value && typeof entry.value === 'object' && 'type' in entry.value) {
          const template = entry.value as AgentTemplate;
          const agentType = template.type;
          
          // Register the loaded template
          this.registerTemplate(agentType, template);
          
          logger.info('[EnhancedAgentManager] Loaded auto-created template from memory', {
            type: agentType,
            name: template.name
          });
        }
      }
    } catch (error) {
      logger.warn('[EnhancedAgentManager] Failed to load auto-created templates', {
        error: getErrorMessage(error)
      });
    }
  }

  /**
   * Initialize the enhanced agent manager
   */
  async initialize(): Promise<void> {
    // Load any previously auto-created templates
    await this.loadAutoCreatedTemplates();
    
    // Call parent initialization
    await super.initialize();
  }

  /**
   * Add a custom template handler for specific agent types
   */
  addCustomTemplateHandler(
    agentType: string, 
    handler: (type: string) => Promise<AgentTemplate>
  ): void {
    this.customHandlers.set(agentType, handler);
  }

  /**
   * Remove a custom template handler
   */
  removeCustomTemplateHandler(agentType: string): void {
    this.customHandlers.delete(agentType);
  }

  /**
   * Get auto-creation statistics
   */
  getAutoCreationStats(): {
    enabled: boolean;
    createdTemplates: number;
    failedAttempts: Map<string, number>;
    customHandlers: string[];
  } {
    return {
      enabled: this.enableAutoCreation,
      createdTemplates: this.autoCreator.getCreatedTemplates().size,
      failedAttempts: new Map(this.creationAttempts),
      customHandlers: Array.from(this.customHandlers.keys())
    };
  }

  /**
   * Enable or disable auto-creation
   */
  setAutoCreation(enabled: boolean): void {
    this.enableAutoCreation = enabled;
    const logger = this.getLogger();
    logger.info('[EnhancedAgentManager] Auto-creation setting changed', { enabled });
  }

  /**
   * Clear auto-creation cache
   */
  clearAutoCreationCache(): void {
    this.autoCreator.clearCache();
    this.creationAttempts.clear();
  }

  // Private getters to access protected properties from parent
  private getTemplates(): Map<string, AgentTemplate> {
    return (this as any).templates;
  }

  private setTemplates(value: Map<string, AgentTemplate>): void {
    (this as any).templates = value;
  }

  private getLogger(): ILogger {
    return (this as any).logger;
  }

  private getMemory(): DistributedMemorySystem {
    return (this as any).memory;
  }
}