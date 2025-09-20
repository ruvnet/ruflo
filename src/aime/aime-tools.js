/**
 * AIME (Autonomous Intelligent Multi-Agent Ecosystems) Tools
 * Central export for all AIME-specific MCP tools
 */

// Simple error message helper to avoid TypeScript issues
const getErrorMessage = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};
import { ToolBundleOrganizer, createOrganizeDynamicToolBundleTool } from './tool-bundle-organizer.js';
import { UpdateProgressTool } from './update-progress-tool.js';
import { ProgressManagementModule } from './progress-management.js';
import { 
  initializeActorFactory,
  createDynamicActor,
  createActorFromTemplate,
  createActorSwarm,
  findOptimalActor,
  updateActor,
  getActorTemplates,
  getActiveActors
} from './actor-factory-tool.js';
import { createNeuralEngineTools } from './neural-tools.js';

/**
 * Create all AIME-specific MCP tools
 * @param {Object} logger - Logger instance
 * @param {Object} components - AIME components (progressManager, etc.)
 * @returns {Array} Array of MCP tool definitions
 */
export function createAIMETools(logger, components = {}) {
  const tools = [];
  
  // Initialize Tool Bundle Organizer
  const toolBundleOrganizer = new ToolBundleOrganizer(logger);
  
  // Initialize Actor Factory if agent manager is available
  if (components.agentManager || components.claudeFlowAgentManager) {
    initializeActorFactory(
      components.agentManager || components.claudeFlowAgentManager,
      toolBundleOrganizer
    );
  }
  
  // Add Neural Engine tools if available
  if (components.neuralEngine) {
    const neuralTools = createNeuralEngineTools(components.neuralEngine, logger);
    tools.push(...neuralTools);
  }
  
  // Add the organizeDynamicToolBundle tool
  tools.push(createOrganizeDynamicToolBundleTool(toolBundleOrganizer, logger));
  
  // Add bundle management tools
  tools.push({
    name: 'getBundleMetrics',
    description: 'Get performance metrics for a tool bundle',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: {
          type: 'string',
          description: 'Bundle ID to get metrics for'
        }
      },
      required: ['bundleId']
    },
    handler: async (input) => {
      try {
        const metrics = toolBundleOrganizer.getBundleMetrics(input.bundleId);
        return {
          success: true,
          metrics
        };
      } catch (error) {
        logger.error('Failed to get bundle metrics:', error);
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    }
  });
  
  tools.push({
    name: 'listToolBundles',
    description: 'List all registered tool bundles',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      try {
        const bundles = Array.from(toolBundleOrganizer.bundles.entries()).map(([id, bundle]) => ({
          id,
          name: bundle.name,
          category: bundle.category,
          toolCount: bundle.tools.length,
          loadingStrategy: bundle.loadingStrategy,
          priority: bundle.priority
        }));
        
        return {
          success: true,
          bundles
        };
      } catch (error) {
        logger.error('Failed to list tool bundles:', error);
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    }
  });
  
  tools.push({
    name: 'exportBundleConfig',
    description: 'Export a tool bundle configuration',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: {
          type: 'string',
          description: 'Bundle ID to export'
        }
      },
      required: ['bundleId']
    },
    handler: async (input) => {
      try {
        const config = toolBundleOrganizer.exportBundleConfig(input.bundleId);
        return {
          success: true,
          config
        };
      } catch (error) {
        logger.error('Failed to export bundle config:', error);
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    }
  });
  
  tools.push({
    name: 'importBundleConfig',
    description: 'Import a tool bundle configuration',
    inputSchema: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Bundle configuration to import',
          properties: {
            bundle: {
              type: 'object',
              required: ['id', 'tools']
            },
            metadata: {
              type: 'object'
            }
          },
          required: ['bundle']
        }
      },
      required: ['config']
    },
    handler: async (input) => {
      try {
        const bundleId = toolBundleOrganizer.importBundleConfig(input.config);
        return {
          success: true,
          bundleId
        };
      } catch (error) {
        logger.error('Failed to import bundle config:', error);
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    }
  });
  
  // Add progress management tools if progress manager is available
  if (components.progressManager) {
    tools.push({
      name: 'updateProgress',
      description: 'Update task progress for AIME actors',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'ID of the agent updating progress'
          },
          taskId: {
            type: 'string',
            description: 'The ID of the task being updated'
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'blocked'],
            description: 'Current status of the task'
          },
          message: {
            type: 'string',
            description: 'Descriptive message about the current progress or issue'
          },
          type: {
            type: 'string',
            enum: ['progress', 'milestone', 'obstacle', 'completion'],
            description: 'Type of update being reported'
          },
          progressPercentage: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Percentage completion (0-100)'
          },
          milestone: {
            type: 'string',
            description: 'Name of milestone achieved (if type is milestone)'
          },
          obstacle: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              severity: { 
                type: 'string',
                enum: ['low', 'medium', 'high', 'critical']
              },
              suggestedAction: { type: 'string' }
            },
            description: 'Details about obstacle encountered (if type is obstacle)'
          },
          metrics: {
            type: 'object',
            description: 'Performance or quality metrics related to the update'
          }
        },
        required: ['agentId', 'taskId', 'type']
      },
      handler: async (input) => {
        try {
          const updateTool = new UpdateProgressTool(components.progressManager, input.agentId);
          const result = await updateTool.execute(input);
          return result;
        } catch (error) {
          logger.error('Failed to update progress:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    tools.push({
      name: 'getProgressReport',
      description: 'Get comprehensive progress report for a mission',
      inputSchema: {
        type: 'object',
        properties: {
          missionId: {
            type: 'string',
            description: 'Mission ID to get report for'
          },
          includeMetrics: {
            type: 'boolean',
            description: 'Include detailed metrics in report',
            default: true
          }
        },
        required: ['missionId']
      },
      handler: async (input) => {
        try {
          const report = await components.progressManager.getMissionProgress(
            input.missionId,
            input.includeMetrics
          );
          return {
            success: true,
            report
          };
        } catch (error) {
          logger.error('Failed to get progress report:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
  }
  
  // Add Dynamic Planner tools (placeholder for future implementation)
  tools.push({
    name: 'createDynamicPlan',
    description: 'Create a dynamic plan using AIME planning algorithms',
    inputSchema: {
      type: 'object',
      properties: {
        mission: {
          type: 'object',
          description: 'Mission specification',
          properties: {
            name: { type: 'string' },
            objectives: { 
              type: 'array',
              items: { type: 'string' }
            },
            constraints: {
              type: 'object',
              properties: {
                timeLimit: { type: 'number' },
                resourceLimit: { type: 'number' },
                quality: { type: 'string', enum: ['low', 'medium', 'high'] }
              }
            },
            context: { type: 'object' }
          },
          required: ['name', 'objectives']
        },
        planType: {
          type: 'string',
          enum: ['strategic', 'tactical', 'hybrid'],
          default: 'hybrid',
          description: 'Type of plan to generate'
        }
      },
      required: ['mission']
    },
    handler: async (input) => {
      // Placeholder implementation - will be replaced with actual Dynamic Planner
      logger.info('Dynamic planning requested:', input);
      return {
        success: true,
        plan: {
          id: `plan_${Date.now()}`,
          type: input.planType,
          mission: input.mission.name,
          status: 'draft',
          message: 'Dynamic Planner integration pending'
        }
      };
    }
  });
  
  // Add Enhanced Actor Factory tools
  if (components.agentManager || components.claudeFlowAgentManager) {
    // Create Dynamic Actor
    tools.push({
      name: 'createDynamicActor',
      description: 'Create a specialized AI agent with custom persona, knowledge, and capabilities',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Actor type (e.g., developer, analyst, researcher)' },
          name: { type: 'string', description: 'Actor name' },
          traits: { 
            type: 'object', 
            description: 'Personality traits (0-1 values)',
            properties: {
              analytical: { type: 'number', minimum: 0, maximum: 1 },
              creative: { type: 'number', minimum: 0, maximum: 1 },
              methodical: { type: 'number', minimum: 0, maximum: 1 },
              collaborative: { type: 'number', minimum: 0, maximum: 1 },
              innovative: { type: 'number', minimum: 0, maximum: 1 }
            }
          },
          expertise: { 
            type: 'object', 
            description: 'Expertise areas',
            properties: {
              primary: { type: 'array', items: { type: 'string' } },
              secondary: { type: 'array', items: { type: 'string' } }
            }
          },
          knowledge: { 
            type: 'object', 
            description: 'Knowledge domains',
            properties: {
              domains: { type: 'array', items: { type: 'string' } },
              secondary: { type: 'array', items: { type: 'string' } }
            }
          },
          task: { type: 'object', description: 'Current task specification' },
          audience: { type: 'object', description: 'Target audience' },
          resources: { type: 'object', description: 'Resource requirements' },
          communicationStyle: { type: 'object', description: 'Communication preferences' }
        },
        required: []
      },
      handler: async (input) => {
        try {
          const result = await createDynamicActor(input);
          return result;
        } catch (error) {
          logger.error('Failed to create dynamic actor:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Create Actor from Template
    tools.push({
      name: 'createActorFromTemplate',
      description: 'Create an actor from a predefined template',
      inputSchema: {
        type: 'object',
        properties: {
          template: { 
            type: 'string', 
            description: 'Template name',
            enum: ['research-specialist', 'development-expert', 'system-architect', 'qa-engineer', 'project-coordinator']
          },
          overrides: { type: 'object', description: 'Properties to override' }
        },
        required: ['template']
      },
      handler: async (input) => {
        try {
          const result = await createActorFromTemplate(input);
          return result;
        } catch (error) {
          logger.error('Failed to create actor from template:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Create Actor Swarm
    tools.push({
      name: 'createActorSwarm',
      description: 'Create multiple coordinated actors for complex tasks',
      inputSchema: {
        type: 'object',
        properties: {
          actors: { 
            type: 'array', 
            description: 'Array of actor specifications',
            items: { type: 'object' }
          },
          topology: { 
            type: 'string', 
            description: 'Swarm topology',
            enum: ['mesh', 'hierarchical', 'ring', 'star'],
            default: 'mesh'
          }
        },
        required: ['actors']
      },
      handler: async (input) => {
        try {
          const result = await createActorSwarm(input);
          return result;
        } catch (error) {
          logger.error('Failed to create actor swarm:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Find Optimal Actor
    tools.push({
      name: 'findOptimalActor',
      description: 'Find the best existing actor for a task or create one if needed',
      inputSchema: {
        type: 'object',
        properties: {
          taskRequirements: { 
            type: 'object', 
            description: 'Task requirements and constraints',
            properties: {
              type: { type: 'string' },
              requiredExpertise: { type: 'array', items: { type: 'string' } },
              requiredTools: { type: 'array', items: { type: 'string' } },
              preferredTraits: { type: 'object' }
            }
          }
        },
        required: ['taskRequirements']
      },
      handler: async (input) => {
        try {
          const result = await findOptimalActor(input);
          return result;
        } catch (error) {
          logger.error('Failed to find optimal actor:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Update Actor
    tools.push({
      name: 'updateActor',
      description: 'Update an existing actor configuration',
      inputSchema: {
        type: 'object',
        properties: {
          actorId: { type: 'string', description: 'Actor ID' },
          updates: { 
            type: 'object', 
            description: 'Properties to update',
            properties: {
              persona: { type: 'object' },
              knowledge: { type: 'object' },
              environment: { type: 'object' },
              format: { type: 'object' }
            }
          }
        },
        required: ['actorId', 'updates']
      },
      handler: async (input) => {
        try {
          const result = await updateActor(input);
          return result;
        } catch (error) {
          logger.error('Failed to update actor:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Get Actor Templates
    tools.push({
      name: 'getActorTemplates',
      description: 'List available actor templates',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        try {
          const result = getActorTemplates();
          return result;
        } catch (error) {
          logger.error('Failed to get actor templates:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
    
    // Get Active Actors
    tools.push({
      name: 'getActiveActors',
      description: 'List all currently active actors',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        try {
          const result = getActiveActors();
          return result;
        } catch (error) {
          logger.error('Failed to get active actors:', error);
          return {
            success: false,
            error: getErrorMessage(error)
          };
        }
      }
    });
  } else {
    // Add placeholder if Actor Factory cannot be initialized
    logger.warn('Actor Factory not initialized - agent manager not available');
  }
  
  return tools;
}

/**
 * Get AIME tool context for integration
 */
export function getAIMEToolContext(components) {
  const toolBundleOrganizer = new ToolBundleOrganizer(components.logger);
  
  // Initialize Actor Factory if agent manager is available
  let actorFactory = null;
  if (components.agentManager || components.claudeFlowAgentManager) {
    actorFactory = initializeActorFactory(
      components.agentManager || components.claudeFlowAgentManager,
      toolBundleOrganizer
    );
  }
  
  return {
    toolBundleOrganizer,
    progressManager: components.progressManager,
    dynamicPlanner: components.dynamicPlanner,
    actorFactory
  };
}