/**
 * Enhanced Actor Factory for AIME System
 * 
 * Creates specialized AI agents with sophisticated persona definitions,
 * knowledge domains, environment configurations, and communication formats.
 * 
 * Based on ByteDance's AIME framework integrated with Claude Flow v2
 */

import { PersonaSystem } from './actor-factory/persona-system.js';
import { KnowledgeSystem } from './actor-factory/knowledge-system.js';
import { EnvironmentSystem } from './actor-factory/environment-system.js';
import { FormatSystem } from './actor-factory/format-system.js';

export class EnhancedActorFactory {
  constructor(claudeFlowAgentManager, toolBundleOrganizer) {
    this.agentManager = claudeFlowAgentManager;
    this.toolBundleOrganizer = toolBundleOrganizer;
    
    // Initialize subsystems
    this.personaSystem = new PersonaSystem(
      this.agentManager?.neuralEngine,
      this.agentManager?.behaviorLibrary
    );
    
    this.knowledgeSystem = new KnowledgeSystem(
      this.agentManager?.knowledgeGraph,
      this.agentManager?.expertiseEvaluator
    );
    
    this.environmentSystem = new EnvironmentSystem(
      this.agentManager?.environment,
      this.agentManager?.securityManager
    );
    
    this.formatSystem = new FormatSystem(
      this.agentManager?.communicationEngine,
      this.agentManager?.formatterLibrary
    );
    
    // Actor registry and templates
    this.actorRegistry = new Map();
    this.actorTemplates = this.loadActorTemplates();
    this.activeActors = new Map();
    
    // Performance tracking
    this.performanceMetrics = new Map();
    this.creationHistory = [];
  }

  /**
   * Create a dynamic actor based on task requirements
   */
  async createDynamicActor(actorSpec) {
    const startTime = Date.now();
    
    try {
      // Validate actor specification
      this.validateActorSpec(actorSpec);
      
      // Generate unique actor ID
      const actorId = this.generateActorId(actorSpec.type || 'dynamic');
      
      // Build persona profile
      const persona = await this.personaSystem.definePersona({
        type: actorSpec.type || 'adaptive',
        name: actorSpec.name || `Actor_${actorId}`,
        traits: actorSpec.traits,
        riskTolerance: actorSpec.riskTolerance,
        adaptabilityLevel: actorSpec.adaptabilityLevel,
        primaryExpertise: actorSpec.expertise?.primary,
        secondaryExpertise: actorSpec.expertise?.secondary
      });
      
      // Build knowledge profile
      const knowledge = await this.knowledgeSystem.buildKnowledgeProfile({
        knowledge: {
          primaryDomains: actorSpec.knowledge?.domains || [],
          secondaryDomains: actorSpec.knowledge?.secondary || []
        },
        context: actorSpec.context || {},
        learningRate: actorSpec.learningRate,
        learningStyle: actorSpec.learningStyle
      });
      
      // Configure environment
      const environment = await this.environmentSystem.configureActorEnvironment(
        {
          persona,
          currentTask: actorSpec.task,
          maxProcesses: actorSpec.resources?.maxProcesses,
          maxThreads: actorSpec.resources?.maxThreads,
          maxConnections: actorSpec.resources?.maxConnections,
          auditingLevel: actorSpec.auditingLevel,
          securityContext: actorSpec.securityContext
        },
        actorId
      );
      
      // Define format preferences
      const format = await this.formatSystem.defineActorFormat({
        persona,
        currentTask: actorSpec.task,
        audience: actorSpec.audience,
        context: actorSpec.context,
        formality: actorSpec.communicationStyle?.formality,
        verbosity: actorSpec.communicationStyle?.verbosity,
        technicalLevel: actorSpec.communicationStyle?.technicalLevel,
        primaryFormat: actorSpec.outputFormat?.primary,
        alternativeFormats: actorSpec.outputFormat?.alternatives,
        reportingFrequency: actorSpec.reporting?.frequency,
        reportingDetail: actorSpec.reporting?.detail,
        codeStyle: actorSpec.codeStyle
      });
      
      // Create actor instance
      const actor = {
        id: actorId,
        type: actorSpec.type || 'dynamic',
        name: actorSpec.name || `Actor_${actorId}`,
        persona,
        knowledge,
        environment,
        format,
        status: 'initialized',
        createdAt: new Date().toISOString(),
        metadata: {
          creationTime: Date.now() - startTime,
          taskAlignment: this.calculateTaskAlignment(actorSpec, persona, knowledge),
          estimatedEfficiency: this.estimateActorEfficiency(persona, knowledge, environment),
          capabilities: this.aggregateCapabilities(persona, knowledge, environment)
        }
      };
      
      // Register actor
      this.activeActors.set(actorId, actor);
      this.recordCreation(actor);
      
      // Initialize actor with Claude Flow
      if (this.agentManager?.spawnAgent) {
        await this.initializeWithClaudeFlow(actor);
      }
      
      return actor;
      
    } catch (error) {
      console.error('Failed to create dynamic actor:', error);
      throw new Error(`Actor creation failed: ${error.message}`);
    }
  }

  /**
   * Create actor from predefined template
   */
  async createFromTemplate(templateName, overrides = {}) {
    const template = this.actorTemplates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found`);
    }
    
    // Merge template with overrides
    const actorSpec = this.mergeSpecs(template, overrides);
    
    return this.createDynamicActor(actorSpec);
  }

  /**
   * Batch create multiple actors for swarm operations
   */
  async createActorSwarm(swarmSpec) {
    const actors = [];
    const swarmId = this.generateSwarmId();
    
    for (const actorSpec of swarmSpec.actors) {
      const actor = await this.createDynamicActor({
        ...actorSpec,
        swarmId,
        swarmRole: actorSpec.role
      });
      actors.push(actor);
    }
    
    // Configure swarm communication channels
    await this.configureSwarmCommunication(actors, swarmSpec.topology);
    
    return {
      swarmId,
      actors,
      topology: swarmSpec.topology,
      coordinator: actors.find(a => a.swarmRole === 'coordinator') || actors[0]
    };
  }

  /**
   * Update actor configuration dynamically
   */
  async updateActor(actorId, updates) {
    const actor = this.activeActors.get(actorId);
    if (!actor) {
      throw new Error(`Actor '${actorId}' not found`);
    }
    
    // Update persona if needed
    if (updates.persona) {
      actor.persona = await this.personaSystem.updatePersona(
        actor.persona,
        updates.persona
      );
    }
    
    // Update knowledge if needed
    if (updates.knowledge) {
      actor.knowledge = await this.knowledgeSystem.updateKnowledge(
        actor.knowledge,
        updates.knowledge
      );
    }
    
    // Update environment if needed
    if (updates.environment) {
      actor.environment = await this.environmentSystem.updateEnvironment(
        actor.environment,
        updates.environment
      );
    }
    
    // Update format if needed
    if (updates.format) {
      actor.format = await this.formatSystem.updateFormat(
        actor.format,
        updates.format
      );
    }
    
    actor.lastUpdated = new Date().toISOString();
    
    return actor;
  }

  /**
   * Get optimal actor for a specific task
   */
  async findOptimalActor(taskRequirements) {
    let bestActor = null;
    let bestScore = -1;
    
    for (const [actorId, actor] of this.activeActors) {
      const score = this.calculateActorTaskFit(actor, taskRequirements);
      if (score > bestScore) {
        bestScore = score;
        bestActor = actor;
      }
    }
    
    // If no suitable actor exists, create one
    if (!bestActor || bestScore < 0.7) {
      const actorSpec = this.deriveActorSpecFromTask(taskRequirements);
      bestActor = await this.createDynamicActor(actorSpec);
    }
    
    return bestActor;
  }

  /**
   * Initialize actor with Claude Flow agent system
   */
  async initializeWithClaudeFlow(actor) {
    if (!this.agentManager?.spawnAgent) {
      console.warn('Claude Flow agent manager not available');
      return;
    }
    
    // Map actor to Claude Flow agent type
    const agentType = this.mapToClaudeFlowAgentType(actor);
    
    // Spawn corresponding Claude Flow agent
    const claudeFlowAgent = await this.agentManager.spawnAgent({
      type: agentType,
      name: actor.name,
      metadata: {
        actorId: actor.id,
        persona: actor.persona.traits,
        expertise: actor.knowledge.domains.primary
      }
    });
    
    actor.claudeFlowAgentId = claudeFlowAgent.id;
  }

  /**
   * Helper methods
   */
  
  validateActorSpec(spec) {
    if (!spec || typeof spec !== 'object') {
      throw new Error('Invalid actor specification');
    }
    
    // Validate required fields based on type
    if (spec.type === 'specialist' && !spec.expertise?.primary?.length) {
      throw new Error('Specialist actors require primary expertise domains');
    }
  }
  
  generateActorId(type) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `actor_${type}_${timestamp}_${random}`;
  }
  
  generateSwarmId() {
    return `swarm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  calculateTaskAlignment(actorSpec, persona, knowledge) {
    // Calculate how well the actor aligns with its intended task
    let alignment = 0.5; // Base alignment
    
    // Factor in expertise match
    if (actorSpec.task && knowledge.domains.primary.length > 0) {
      alignment += 0.2;
    }
    
    // Factor in persona fit
    if (persona.traits.methodical > 0.7 && actorSpec.task?.type === 'analysis') {
      alignment += 0.15;
    }
    
    if (persona.traits.creative > 0.7 && actorSpec.task?.type === 'design') {
      alignment += 0.15;
    }
    
    return Math.min(alignment, 1.0);
  }
  
  estimateActorEfficiency(persona, knowledge, environment) {
    // Estimate actor efficiency based on configuration
    let efficiency = 0.6; // Base efficiency
    
    // Knowledge depth bonus
    efficiency += knowledge.experienceLevels.overall * 0.2;
    
    // Resource availability bonus
    if (environment.resourceLimits.concurrent.maxProcesses > 5) {
      efficiency += 0.1;
    }
    
    // Adaptability bonus
    if (persona.decisionFramework.adaptabilityLevel === 'high') {
      efficiency += 0.1;
    }
    
    return Math.min(efficiency, 1.0);
  }
  
  aggregateCapabilities(persona, knowledge, environment) {
    return {
      technical: knowledge.specializations.technical,
      tools: environment.toolAccess.availableTools,
      collaboration: persona.traits.collaborative > 0.6,
      autonomous: persona.decisionFramework.adaptabilityLevel === 'high',
      learningRate: knowledge.learningProfile.learningRate
    };
  }
  
  calculateActorTaskFit(actor, taskRequirements) {
    let fitScore = 0;
    let factors = 0;
    
    // Check expertise match
    if (taskRequirements.requiredExpertise) {
      const expertiseMatch = this.calculateExpertiseMatch(
        actor.knowledge.domains.primary,
        taskRequirements.requiredExpertise
      );
      fitScore += expertiseMatch;
      factors++;
    }
    
    // Check tool availability
    if (taskRequirements.requiredTools) {
      const toolMatch = this.calculateToolMatch(
        actor.environment.toolAccess.availableTools,
        taskRequirements.requiredTools
      );
      fitScore += toolMatch;
      factors++;
    }
    
    // Check persona fit
    if (taskRequirements.preferredTraits) {
      const traitMatch = this.calculateTraitMatch(
        actor.persona.traits,
        taskRequirements.preferredTraits
      );
      fitScore += traitMatch;
      factors++;
    }
    
    return factors > 0 ? fitScore / factors : 0;
  }
  
  calculateExpertiseMatch(actorExpertise, requiredExpertise) {
    const matches = requiredExpertise.filter(req => 
      actorExpertise.some(exp => exp.name === req)
    );
    return matches.length / requiredExpertise.length;
  }
  
  calculateToolMatch(availableTools, requiredTools) {
    const matches = requiredTools.filter(req => 
      availableTools.includes(req)
    );
    return matches.length / requiredTools.length;
  }
  
  calculateTraitMatch(actorTraits, preferredTraits) {
    let totalDifference = 0;
    let traitCount = 0;
    
    for (const [trait, preferredValue] of Object.entries(preferredTraits)) {
      if (actorTraits[trait] !== undefined) {
        totalDifference += Math.abs(actorTraits[trait] - preferredValue);
        traitCount++;
      }
    }
    
    return traitCount > 0 ? 1 - (totalDifference / traitCount) : 0;
  }
  
  deriveActorSpecFromTask(taskRequirements) {
    // Intelligently derive actor specification from task requirements
    const spec = {
      type: taskRequirements.type || 'adaptive',
      name: `TaskActor_${taskRequirements.name || 'Dynamic'}`,
      traits: {},
      expertise: {
        primary: taskRequirements.requiredExpertise || [],
        secondary: taskRequirements.optionalExpertise || []
      },
      knowledge: {
        domains: taskRequirements.requiredExpertise || [],
        secondary: taskRequirements.optionalExpertise || []
      },
      task: taskRequirements
    };
    
    // Derive traits from task type
    if (taskRequirements.type === 'analysis') {
      spec.traits.analytical = 0.8;
      spec.traits.methodical = 0.8;
    } else if (taskRequirements.type === 'creative') {
      spec.traits.creative = 0.8;
      spec.traits.innovative = 0.8;
    } else if (taskRequirements.type === 'coordination') {
      spec.traits.collaborative = 0.8;
      spec.traits.methodical = 0.7;
    }
    
    return spec;
  }
  
  mapToClaudeFlowAgentType(actor) {
    // Map AIME actor types to Claude Flow agent types
    const typeMapping = {
      'analyst': 'analyst',
      'developer': 'coder',
      'architect': 'architect',
      'coordinator': 'coordinator',
      'researcher': 'researcher',
      'tester': 'tester'
    };
    
    return typeMapping[actor.type] || 'coder';
  }
  
  mergeSpecs(template, overrides) {
    // Deep merge template with overrides
    return {
      ...template,
      ...overrides,
      traits: { ...template.traits, ...overrides.traits },
      expertise: { ...template.expertise, ...overrides.expertise },
      knowledge: { ...template.knowledge, ...overrides.knowledge },
      resources: { ...template.resources, ...overrides.resources },
      communicationStyle: { ...template.communicationStyle, ...overrides.communicationStyle },
      outputFormat: { ...template.outputFormat, ...overrides.outputFormat },
      reporting: { ...template.reporting, ...overrides.reporting }
    };
  }
  
  async configureSwarmCommunication(actors, topology) {
    // Configure communication channels based on topology
    switch (topology) {
      case 'mesh':
        // Every actor can communicate with every other actor
        for (const actor of actors) {
          actor.communicationChannels = actors
            .filter(a => a.id !== actor.id)
            .map(a => a.id);
        }
        break;
        
      case 'hierarchical':
        // Tree-like communication structure
        const coordinator = actors.find(a => a.swarmRole === 'coordinator');
        if (coordinator) {
          for (const actor of actors) {
            if (actor.id !== coordinator.id) {
              actor.communicationChannels = [coordinator.id];
              actor.parent = coordinator.id;
            }
          }
          coordinator.communicationChannels = actors
            .filter(a => a.id !== coordinator.id)
            .map(a => a.id);
        }
        break;
        
      case 'ring':
        // Each actor communicates with neighbors
        for (let i = 0; i < actors.length; i++) {
          const next = (i + 1) % actors.length;
          const prev = (i - 1 + actors.length) % actors.length;
          actors[i].communicationChannels = [actors[prev].id, actors[next].id];
        }
        break;
        
      case 'star':
        // All actors communicate through central hub
        const hub = actors.find(a => a.swarmRole === 'hub') || actors[0];
        for (const actor of actors) {
          if (actor.id !== hub.id) {
            actor.communicationChannels = [hub.id];
          }
        }
        hub.communicationChannels = actors
          .filter(a => a.id !== hub.id)
          .map(a => a.id);
        break;
    }
  }
  
  recordCreation(actor) {
    this.creationHistory.push({
      actorId: actor.id,
      timestamp: actor.createdAt,
      type: actor.type,
      efficiency: actor.metadata.estimatedEfficiency
    });
    
    // Track performance metrics
    const typeMetrics = this.performanceMetrics.get(actor.type) || {
      count: 0,
      totalCreationTime: 0,
      avgEfficiency: 0
    };
    
    typeMetrics.count++;
    typeMetrics.totalCreationTime += actor.metadata.creationTime;
    typeMetrics.avgEfficiency = 
      (typeMetrics.avgEfficiency * (typeMetrics.count - 1) + actor.metadata.estimatedEfficiency) / 
      typeMetrics.count;
    
    this.performanceMetrics.set(actor.type, typeMetrics);
  }
  
  loadActorTemplates() {
    const templates = new Map();
    
    // Research Specialist Template
    templates.set('research-specialist', {
      type: 'researcher',
      traits: {
        analytical: 0.9,
        creative: 0.6,
        methodical: 0.8,
        collaborative: 0.5,
        innovative: 0.7
      },
      expertise: {
        primary: ['research', 'analysis', 'data-synthesis'],
        secondary: ['documentation', 'reporting']
      },
      knowledge: {
        domains: ['research-methods', 'data-analysis', 'academic-writing'],
        secondary: ['statistics', 'visualization']
      },
      learningRate: 'fast',
      learningStyle: 'theoretical',
      communicationStyle: {
        formality: 'formal',
        verbosity: 'detailed',
        technicalLevel: 'high'
      },
      outputFormat: {
        primary: 'structured-report',
        alternatives: ['markdown', 'json', 'latex']
      }
    });
    
    // Development Expert Template
    templates.set('development-expert', {
      type: 'developer',
      traits: {
        analytical: 0.7,
        creative: 0.8,
        methodical: 0.8,
        collaborative: 0.7,
        innovative: 0.8
      },
      expertise: {
        primary: ['software-development', 'architecture', 'debugging'],
        secondary: ['testing', 'documentation']
      },
      knowledge: {
        domains: ['programming', 'design-patterns', 'best-practices'],
        secondary: ['devops', 'security']
      },
      learningRate: 'adaptive',
      learningStyle: 'experiential',
      communicationStyle: {
        formality: 'casual',
        verbosity: 'concise',
        technicalLevel: 'adaptive'
      },
      outputFormat: {
        primary: 'code',
        alternatives: ['markdown', 'comments']
      },
      codeStyle: {
        indentation: 2,
        quotes: 'single',
        semicolons: true,
        lineLength: 100,
        commentStyle: 'jsdoc',
        namingConvention: 'camelCase'
      }
    });
    
    // System Architect Template
    templates.set('system-architect', {
      type: 'architect',
      traits: {
        analytical: 0.9,
        creative: 0.7,
        methodical: 0.9,
        collaborative: 0.8,
        innovative: 0.6
      },
      expertise: {
        primary: ['system-design', 'architecture-patterns', 'scalability'],
        secondary: ['security', 'performance-optimization']
      },
      knowledge: {
        domains: ['distributed-systems', 'cloud-architecture', 'microservices'],
        secondary: ['databases', 'networking']
      },
      learningRate: 'moderate',
      learningStyle: 'conceptual',
      communicationStyle: {
        formality: 'formal',
        verbosity: 'balanced',
        technicalLevel: 'high'
      },
      outputFormat: {
        primary: 'diagram',
        alternatives: ['markdown', 'uml', 'yaml']
      }
    });
    
    // QA Engineer Template
    templates.set('qa-engineer', {
      type: 'tester',
      traits: {
        analytical: 0.9,
        creative: 0.4,
        methodical: 0.95,
        collaborative: 0.6,
        innovative: 0.5
      },
      expertise: {
        primary: ['testing', 'quality-assurance', 'test-automation'],
        secondary: ['debugging', 'performance-testing']
      },
      knowledge: {
        domains: ['testing-methodologies', 'automation-frameworks', 'ci-cd'],
        secondary: ['security-testing', 'accessibility']
      },
      learningRate: 'moderate',
      learningStyle: 'procedural',
      communicationStyle: {
        formality: 'formal',
        verbosity: 'detailed',
        technicalLevel: 'moderate'
      },
      outputFormat: {
        primary: 'test-report',
        alternatives: ['json', 'markdown', 'junit']
      }
    });
    
    // Coordinator Template
    templates.set('project-coordinator', {
      type: 'coordinator',
      traits: {
        analytical: 0.6,
        creative: 0.5,
        methodical: 0.8,
        collaborative: 0.95,
        innovative: 0.6
      },
      expertise: {
        primary: ['project-management', 'coordination', 'communication'],
        secondary: ['risk-management', 'resource-planning']
      },
      knowledge: {
        domains: ['agile-methodologies', 'team-dynamics', 'stakeholder-management'],
        secondary: ['budgeting', 'scheduling']
      },
      learningRate: 'adaptive',
      learningStyle: 'interpersonal',
      communicationStyle: {
        formality: 'adaptive',
        verbosity: 'balanced',
        technicalLevel: 'low'
      },
      outputFormat: {
        primary: 'status-report',
        alternatives: ['markdown', 'gantt', 'dashboard']
      },
      reporting: {
        frequency: 'frequent',
        detail: 'summary',
        triggers: ['milestone', 'blocker', 'risk']
      }
    });
    
    return templates;
  }
}

// Export for MCP tool integration
export async function createDynamicActorTool(params) {
  // This function will be exposed as an MCP tool
  const factory = global.aimeActorFactory;
  if (!factory) {
    throw new Error('AIME Actor Factory not initialized');
  }
  
  return factory.createDynamicActor(params);
}

// Export factory class and tool function
export default EnhancedActorFactory;