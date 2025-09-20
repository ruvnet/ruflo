/**
 * MCP Tool Integration for AIME Actor Factory
 * 
 * Exposes the Enhanced Actor Factory as an MCP tool for Claude Flow
 */

import { EnhancedActorFactory } from './enhanced-actor-factory.js';

// Global factory instance
let actorFactory = null;

/**
 * Initialize the Actor Factory with Claude Flow integration
 */
export async function initializeActorFactory(claudeFlowAgentManager, toolBundleOrganizer) {
  if (!actorFactory) {
    actorFactory = new EnhancedActorFactory(claudeFlowAgentManager, toolBundleOrganizer);
    
    // Store globally for MCP access
    global.aimeActorFactory = actorFactory;
  }
  
  return actorFactory;
}

/**
 * MCP Tool: Create Dynamic Actor
 * 
 * Creates a specialized AI agent with sophisticated persona, knowledge,
 * environment, and format configurations based on task requirements.
 */
export async function createDynamicActor(params) {
  if (!actorFactory) {
    throw new Error('Actor Factory not initialized. Call initializeActorFactory first.');
  }
  
  // Validate parameters
  if (!params || typeof params !== 'object') {
    throw new Error('Invalid parameters. Expected object with actor specification.');
  }
  
  try {
    // Create the actor
    const actor = await actorFactory.createDynamicActor(params);
    
    return {
      success: true,
      actor: {
        id: actor.id,
        name: actor.name,
        type: actor.type,
        status: actor.status,
        capabilities: actor.metadata.capabilities,
        efficiency: actor.metadata.estimatedEfficiency,
        taskAlignment: actor.metadata.taskAlignment
      },
      message: `Successfully created ${actor.type} actor: ${actor.name}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to create actor: ${error.message}`
    };
  }
}

/**
 * MCP Tool: Create Actor from Template
 * 
 * Creates an actor using a predefined template with optional overrides
 */
export async function createActorFromTemplate(params) {
  if (!actorFactory) {
    throw new Error('Actor Factory not initialized. Call initializeActorFactory first.');
  }
  
  const { template, overrides = {} } = params;
  
  if (!template) {
    throw new Error('Template name is required');
  }
  
  try {
    const actor = await actorFactory.createFromTemplate(template, overrides);
    
    return {
      success: true,
      actor: {
        id: actor.id,
        name: actor.name,
        type: actor.type,
        template: template,
        status: actor.status
      },
      message: `Successfully created actor from template: ${template}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to create actor from template: ${error.message}`
    };
  }
}

/**
 * MCP Tool: Create Actor Swarm
 * 
 * Creates multiple coordinated actors for complex tasks
 */
export async function createActorSwarm(params) {
  if (!actorFactory) {
    throw new Error('Actor Factory not initialized. Call initializeActorFactory first.');
  }
  
  const { actors, topology = 'mesh' } = params;
  
  if (!actors || !Array.isArray(actors) || actors.length === 0) {
    throw new Error('Actors array is required and must not be empty');
  }
  
  try {
    const swarm = await actorFactory.createActorSwarm({
      actors,
      topology
    });
    
    return {
      success: true,
      swarm: {
        id: swarm.swarmId,
        topology: swarm.topology,
        actorCount: swarm.actors.length,
        coordinator: swarm.coordinator.name,
        actors: swarm.actors.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          role: a.swarmRole
        }))
      },
      message: `Successfully created swarm with ${swarm.actors.length} actors`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to create actor swarm: ${error.message}`
    };
  }
}

/**
 * MCP Tool: Find Optimal Actor
 * 
 * Finds the best existing actor for a task or creates one if needed
 */
export async function findOptimalActor(params) {
  if (!actorFactory) {
    throw new Error('Actor Factory not initialized. Call initializeActorFactory first.');
  }
  
  const { taskRequirements } = params;
  
  if (!taskRequirements) {
    throw new Error('Task requirements are required');
  }
  
  try {
    const actor = await actorFactory.findOptimalActor(taskRequirements);
    
    return {
      success: true,
      actor: {
        id: actor.id,
        name: actor.name,
        type: actor.type,
        status: actor.status,
        fitScore: actor.metadata.taskAlignment
      },
      message: `Found optimal actor: ${actor.name}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to find optimal actor: ${error.message}`
    };
  }
}

/**
 * MCP Tool: Update Actor
 * 
 * Updates an existing actor's configuration
 */
export async function updateActor(params) {
  if (!actorFactory) {
    throw new Error('Actor Factory not initialized. Call initializeActorFactory first.');
  }
  
  const { actorId, updates } = params;
  
  if (!actorId) {
    throw new Error('Actor ID is required');
  }
  
  if (!updates || typeof updates !== 'object') {
    throw new Error('Updates object is required');
  }
  
  try {
    const actor = await actorFactory.updateActor(actorId, updates);
    
    return {
      success: true,
      actor: {
        id: actor.id,
        name: actor.name,
        type: actor.type,
        status: actor.status,
        lastUpdated: actor.lastUpdated
      },
      message: `Successfully updated actor: ${actor.name}`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Failed to update actor: ${error.message}`
    };
  }
}

/**
 * MCP Tool: Get Actor Templates
 * 
 * Lists available actor templates
 */
export function getActorTemplates() {
  const templates = [
    {
      name: 'research-specialist',
      description: 'Analytical researcher with strong documentation skills',
      traits: ['analytical', 'methodical', 'thorough'],
      bestFor: ['research', 'analysis', 'documentation']
    },
    {
      name: 'development-expert',
      description: 'Software developer with broad technical expertise',
      traits: ['creative', 'practical', 'collaborative'],
      bestFor: ['coding', 'debugging', 'architecture']
    },
    {
      name: 'system-architect',
      description: 'System designer focused on scalability and patterns',
      traits: ['analytical', 'strategic', 'methodical'],
      bestFor: ['design', 'architecture', 'planning']
    },
    {
      name: 'qa-engineer',
      description: 'Quality assurance specialist with attention to detail',
      traits: ['methodical', 'thorough', 'systematic'],
      bestFor: ['testing', 'quality', 'verification']
    },
    {
      name: 'project-coordinator',
      description: 'Collaborative coordinator for team and project management',
      traits: ['collaborative', 'organized', 'communicative'],
      bestFor: ['coordination', 'planning', 'communication']
    }
  ];
  
  return {
    success: true,
    templates: templates,
    message: `${templates.length} templates available`
  };
}

/**
 * MCP Tool: Get Active Actors
 * 
 * Lists all currently active actors
 */
export function getActiveActors() {
  if (!actorFactory) {
    return {
      success: false,
      error: 'Actor Factory not initialized',
      actors: []
    };
  }
  
  const actors = Array.from(actorFactory.activeActors.values()).map(actor => ({
    id: actor.id,
    name: actor.name,
    type: actor.type,
    status: actor.status,
    createdAt: actor.createdAt,
    efficiency: actor.metadata.estimatedEfficiency
  }));
  
  return {
    success: true,
    actors: actors,
    count: actors.length,
    message: `${actors.length} active actors`
  };
}

/**
 * Export MCP tool definitions
 */
export const actorFactoryTools = {
  createDynamicActor: {
    name: 'createDynamicActor',
    description: 'Create a specialized AI agent with custom persona, knowledge, and capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Actor type (e.g., developer, analyst, researcher)' },
        name: { type: 'string', description: 'Actor name' },
        traits: { type: 'object', description: 'Personality traits (0-1 values)' },
        expertise: { type: 'object', description: 'Expertise areas' },
        knowledge: { type: 'object', description: 'Knowledge domains' },
        task: { type: 'object', description: 'Current task specification' },
        audience: { type: 'object', description: 'Target audience' },
        resources: { type: 'object', description: 'Resource requirements' },
        communicationStyle: { type: 'object', description: 'Communication preferences' }
      },
      required: []
    }
  },
  
  createActorFromTemplate: {
    name: 'createActorFromTemplate',
    description: 'Create an actor from a predefined template',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template name' },
        overrides: { type: 'object', description: 'Properties to override' }
      },
      required: ['template']
    }
  },
  
  createActorSwarm: {
    name: 'createActorSwarm',
    description: 'Create multiple coordinated actors',
    inputSchema: {
      type: 'object',
      properties: {
        actors: { type: 'array', description: 'Array of actor specifications' },
        topology: { type: 'string', description: 'Swarm topology (mesh, hierarchical, ring, star)' }
      },
      required: ['actors']
    }
  },
  
  findOptimalActor: {
    name: 'findOptimalActor',
    description: 'Find the best actor for a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskRequirements: { type: 'object', description: 'Task requirements and constraints' }
      },
      required: ['taskRequirements']
    }
  },
  
  updateActor: {
    name: 'updateActor',
    description: 'Update an existing actor',
    inputSchema: {
      type: 'object',
      properties: {
        actorId: { type: 'string', description: 'Actor ID' },
        updates: { type: 'object', description: 'Properties to update' }
      },
      required: ['actorId', 'updates']
    }
  },
  
  getActorTemplates: {
    name: 'getActorTemplates',
    description: 'List available actor templates',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  
  getActiveActors: {
    name: 'getActiveActors',
    description: 'List all active actors',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
};

export default {
  initializeActorFactory,
  createDynamicActor,
  createActorFromTemplate,
  createActorSwarm,
  findOptimalActor,
  updateActor,
  getActorTemplates,
  getActiveActors,
  actorFactoryTools
};