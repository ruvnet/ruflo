/**
 * Tool Bundle Organization System
 * 
 * Intelligent grouping, loading, and management of 87+ MCP tools
 * Part of the AIME (Autonomous Intelligent Multi-Agent Ecosystems) implementation
 */

import { RealToolLoader } from '../tools/real-tool-loader.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Simple error message helper to avoid TypeScript issues
const getErrorMessage = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Tool Bundle Categories
 */
export const TOOL_BUNDLE_CATEGORIES = {
  COORDINATION: 'coordination',
  EXECUTION: 'execution',
  ANALYSIS: 'analysis',
  COMMUNICATION: 'communication',
  MEMORY: 'memory',
  MONITORING: 'monitoring',
  UTILITY: 'utility',
  SPECIALIZED: 'specialized'
};

/**
 * Loading Strategies
 */
export const LOADING_STRATEGIES = {
  EAGER: 'eager',        // Load immediately on startup
  LAZY: 'lazy',          // Load on first use
  ON_DEMAND: 'onDemand'  // Load per request
};

/**
 * Tool Bundle Organizer
 * Manages the organization and loading of MCP tools
 */
export class ToolBundleOrganizer {
  constructor(logger) {
    this.logger = logger;
    this.bundles = new Map();
    this.toolToBundleMap = new Map();
    this.bundleMetadata = new Map();
    this.loadedTools = new Map();
    this.toolDependencies = new Map();
    this.performanceMetrics = new Map();
    
    // Initialize real tool loader
    this.realToolLoader = new RealToolLoader({
      logger: this.logger,
      cacheDir: join(dirname(dirname(fileURLToPath(import.meta.url))), 'cache/tools'),
      enableCaching: true,
      enableBackup: true
    });
    
    // Initialize default bundles
    this.initializeDefaultBundles();
    
    // Initialize the real tool loader
    this._initializeRealToolLoader();
  }

  /**
   * Initialize the real tool loader
   */
  async _initializeRealToolLoader() {
    try {
      // The RealToolLoader initializes itself in the constructor
      // We just need to wait for it to be ready
      await new Promise(resolve => {
        if (this.realToolLoader.loadedTools.size >= 0) {
          resolve();
        } else {
          this.realToolLoader.once('initialized', resolve);
        }
      });
      
      // Use stderr to prevent JSON-RPC interference
      console.error('Real Tool Loader initialized in ToolBundleOrganizer');
      
    } catch (error) {
      this.logger.error('Failed to initialize real tool loader:', error);
      // Continue without failing - fallback to minimal functionality
    }
  }

  /**
   * Initialize default tool bundles based on tool categories
   */
  initializeDefaultBundles() {
    // Coordination Bundle - Swarm orchestration and agent management
    this.registerBundle({
      id: 'coordination',
      name: 'Coordination Tools',
      category: TOOL_BUNDLE_CATEGORIES.COORDINATION,
      description: 'Tools for swarm orchestration and agent coordination',
      loadingStrategy: LOADING_STRATEGIES.EAGER,
      priority: 100,
      tools: [
        'swarm_init',
        'agent_spawn',
        'task_orchestrate',
        'swarm_status',
        'agent_list',
        'agent_metrics',
        'swarm_monitor',
        'swarm_cleanup',
        'agent_communication',
        'topology_update'
      ],
      dependencies: ['memory', 'monitoring']
    });

    // Execution Bundle - Core execution and processing tools
    this.registerBundle({
      id: 'execution',
      name: 'Execution Tools',
      category: TOOL_BUNDLE_CATEGORIES.EXECUTION,
      description: 'Tools for task execution and neural processing',
      loadingStrategy: LOADING_STRATEGIES.EAGER,
      priority: 95,
      tools: [
        'execute_workflow',
        'run_command',
        'neural_train',
        'neural_predict',
        'neural_status',
        'terminal_create',
        'terminal_execute',
        'task_execute',
        'batch_execute',
        'parallel_execute'
      ],
      dependencies: ['memory']
    });

    // Analysis Bundle - Performance and metrics analysis
    this.registerBundle({
      id: 'analysis',
      name: 'Analysis Tools',
      category: TOOL_BUNDLE_CATEGORIES.ANALYSIS,
      description: 'Tools for performance analysis and metrics',
      loadingStrategy: LOADING_STRATEGIES.LAZY,
      priority: 80,
      tools: [
        'benchmark_run',
        'performance_analyze',
        'metrics_collect',
        'profile_generate',
        'bottleneck_detect',
        'optimization_suggest',
        'token_analyze',
        'cost_calculate',
        'efficiency_measure'
      ],
      dependencies: []
    });

    // Communication Bundle - External integrations and APIs
    this.registerBundle({
      id: 'communication',
      name: 'Communication Tools',
      category: TOOL_BUNDLE_CATEGORIES.COMMUNICATION,
      description: 'Tools for external communication and integrations',
      loadingStrategy: LOADING_STRATEGIES.ON_DEMAND,
      priority: 70,
      tools: [
        'github_create_pr',
        'github_merge_pr',
        'webhook_send',
        'notification_send',
        'api_call',
        'event_publish',
        'message_queue_send',
        'email_send',
        'slack_notify'
      ],
      dependencies: []
    });

    // Memory Bundle - Persistent storage and retrieval
    this.registerBundle({
      id: 'memory',
      name: 'Memory Tools',
      category: TOOL_BUNDLE_CATEGORIES.MEMORY,
      description: 'Tools for memory management and persistence',
      loadingStrategy: LOADING_STRATEGIES.EAGER,
      priority: 100,
      tools: [
        'memory_usage',
        'memory_store',
        'memory_retrieve',
        'memory_delete',
        'memory_export',
        'memory_import',
        'memory_query',
        'memory_compact',
        'memory_backup'
      ],
      dependencies: []
    });

    // Monitoring Bundle - System health and observability
    this.registerBundle({
      id: 'monitoring',
      name: 'Monitoring Tools',
      category: TOOL_BUNDLE_CATEGORIES.MONITORING,
      description: 'Tools for system monitoring and health checks',
      loadingStrategy: LOADING_STRATEGIES.EAGER,
      priority: 90,
      tools: [
        'health_check',
        'system_status',
        'resource_monitor',
        'error_track',
        'log_analyze',
        'alert_configure',
        'dashboard_update',
        'telemetry_collect',
        'updateHierarchicalProgress',
        'getHierarchy',
        'getCriticalPath',
        'getCoordinationProtocol'
      ],
      dependencies: ['memory']
    });

    // Utility Bundle - General purpose utilities
    this.registerBundle({
      id: 'utility',
      name: 'Utility Tools',
      category: TOOL_BUNDLE_CATEGORIES.UTILITY,
      description: 'General purpose utility tools',
      loadingStrategy: LOADING_STRATEGIES.LAZY,
      priority: 60,
      tools: [
        'config_get',
        'config_update',
        'validate_config',
        'features_detect',
        'version_info',
        'help_show',
        'documentation_get',
        'example_generate'
      ],
      dependencies: []
    });

    // Specialized Bundle - Domain-specific tools
    this.registerBundle({
      id: 'specialized',
      name: 'Specialized Tools',
      category: TOOL_BUNDLE_CATEGORIES.SPECIALIZED,
      description: 'Specialized tools for specific domains',
      loadingStrategy: LOADING_STRATEGIES.ON_DEMAND,
      priority: 50,
      tools: [
        'sparc_analyze',
        'ctm_reasoning',
        'hive_mind_activate',
        'quantum_simulate',
        'blockchain_verify',
        'ml_pipeline_create',
        'data_science_analyze',
        'security_scan'
      ],
      dependencies: ['execution', 'analysis']
    });
  }

  /**
   * Register a new tool bundle
   */
  registerBundle(bundleConfig) {
    const { id, tools, dependencies = [] } = bundleConfig;
    
    // Store bundle configuration
    this.bundles.set(id, bundleConfig);
    this.bundleMetadata.set(id, {
      registeredAt: Date.now(),
      loadCount: 0,
      lastLoadTime: null,
      averageLoadTime: 0,
      errors: []
    });

    // Map tools to bundle
    tools.forEach(tool => {
      this.toolToBundleMap.set(tool, id);
    });

    // Store dependencies
    dependencies.forEach(dep => {
      if (!this.toolDependencies.has(id)) {
        this.toolDependencies.set(id, new Set());
      }
      this.toolDependencies.get(id).add(dep);
    });

    // Use stderr to prevent JSON-RPC interference
    console.error(`Registered tool bundle: ${id} with ${tools.length} tools`);
    
    // Return the bundle ID
    return id;
  }

  /**
   * Create a new bundle (missing method that tests expect)
   */
  createBundle(bundleConfig) {
    return this.registerBundle(bundleConfig);
  }

  /**
   * Organize tools dynamically based on task context
   */
  async organizeDynamicToolBundle(taskContext, personaType) {
    try {
      const startTime = Date.now();

      // Analyze task requirements
      const requiredCategories = this.analyzeTaskRequirements(taskContext);
      const personaTools = this.getPersonaPreferredTools(personaType);

      // Build dynamic bundle
      const dynamicBundle = {
        id: `dynamic_${Date.now()}`,
        name: `Dynamic Bundle for ${taskContext.task || 'unknown task'}`,
        category: 'dynamic',
        tools: new Set(),
        dependencies: new Set(),
        metadata: {
          taskContext,
          personaType,
          createdAt: Date.now()
        }
      };

      // Add tools based on required categories
      requiredCategories.forEach(category => {
        const bundle = this.getBundleByCategory(category);
        if (bundle) {
          bundle.tools.forEach(tool => dynamicBundle.tools.add(tool));
          bundle.dependencies?.forEach(dep => dynamicBundle.dependencies.add(dep));
        }
      });

      // Add persona-specific tools
      personaTools.forEach(tool => dynamicBundle.tools.add(tool));

      // Resolve dependencies
      await this.resolveDependencies(dynamicBundle);

      // Optimize bundle size
      const optimizedBundle = await this.optimizeBundleSize(dynamicBundle);

      // Load tools based on strategy
      await this.loadBundle(optimizedBundle);

      const duration = Date.now() - startTime;
      // Use stderr to prevent JSON-RPC interference
      console.error(`Dynamic tool bundle organized in ${duration}ms with ${optimizedBundle.tools.size} tools`);

      return {
        bundleId: optimizedBundle.id,
        tools: Array.from(optimizedBundle.tools),
        dependencies: Array.from(optimizedBundle.dependencies),
        metadata: optimizedBundle.metadata,
        performanceMetrics: {
          organizationTime: duration,
          toolCount: optimizedBundle.tools.size,
          dependencyCount: optimizedBundle.dependencies.size
        }
      };
    } catch (error) {
      this.logger.error('Failed to organize dynamic tool bundle:', error);
      throw error;
    }
  }

  /**
   * Analyze task requirements to determine needed tool categories
   */
  analyzeTaskRequirements(taskContext) {
    const categories = new Set();

    // Always include coordination for multi-agent tasks
    if (taskContext.agentCount > 1 || taskContext.topology) {
      categories.add(TOOL_BUNDLE_CATEGORIES.COORDINATION);
    }

    // Add execution for any task
    categories.add(TOOL_BUNDLE_CATEGORIES.EXECUTION);

    // Add memory for stateful operations
    if (taskContext.requiresMemory || taskContext.persistentState) {
      categories.add(TOOL_BUNDLE_CATEGORIES.MEMORY);
    }

    // Add monitoring for production or critical tasks
    if (taskContext.environment === 'production' || taskContext.critical) {
      categories.add(TOOL_BUNDLE_CATEGORIES.MONITORING);
    }

    // Add analysis for performance-sensitive tasks
    if (taskContext.performanceCritical || taskContext.requiresOptimization) {
      categories.add(TOOL_BUNDLE_CATEGORIES.ANALYSIS);
    }

    // Add communication for external integrations
    if (taskContext.externalAPIs || taskContext.notifications) {
      categories.add(TOOL_BUNDLE_CATEGORIES.COMMUNICATION);
    }

    // Add specialized for domain-specific requirements
    if (taskContext.specialized || taskContext.domain) {
      categories.add(TOOL_BUNDLE_CATEGORIES.SPECIALIZED);
    }

    return categories;
  }

  /**
   * Get persona-specific preferred tools
   */
  getPersonaPreferredTools(personaType) {
    const personaToolMap = {
      architect: ['swarm_init', 'topology_update', 'system_status', 'config_update'],
      developer: ['execute_workflow', 'terminal_execute', 'github_create_pr', 'memory_store'],
      analyst: ['benchmark_run', 'performance_analyze', 'metrics_collect', 'bottleneck_detect'],
      researcher: ['neural_train', 'memory_query', 'sparc_analyze', 'ctm_reasoning'],
      coordinator: ['agent_spawn', 'task_orchestrate', 'swarm_monitor', 'notification_send']
    };

    return personaToolMap[personaType] || [];
  }

  /**
   * Get bundle by category
   */
  getBundleByCategory(category) {
    for (const [id, bundle] of this.bundles) {
      if (bundle.category === category) {
        return bundle;
      }
    }
    return null;
  }

  /**
   * Resolve bundle dependencies
   */
  async resolveDependencies(bundle) {
    const resolved = new Set();
    const toResolve = Array.from(bundle.dependencies);

    while (toResolve.length > 0) {
      const dep = toResolve.shift();
      if (resolved.has(dep)) continue;

      const depBundle = this.bundles.get(dep);
      if (!depBundle) {
        // Use stderr to prevent JSON-RPC interference
        console.error(`Warning: Dependency ${dep} not found`);
        continue;
      }

      // Add dependency tools
      depBundle.tools.forEach(tool => bundle.tools.add(tool));

      // Add transitive dependencies
      if (depBundle.dependencies) {
        depBundle.dependencies.forEach(transDep => {
          if (!resolved.has(transDep)) {
            toResolve.push(transDep);
          }
        });
      }

      resolved.add(dep);
    }
  }

  /**
   * Optimize bundle size based on constraints
   */
  async optimizeBundleSize(bundle, maxTools = 50) {
    if (bundle.tools.size <= maxTools) {
      return bundle;
    }

    // Score tools by priority and relevance
    const toolScores = new Map();
    
    for (const tool of bundle.tools) {
      const bundleId = this.toolToBundleMap.get(tool);
      const toolBundle = this.bundles.get(bundleId);
      const priority = toolBundle?.priority || 0;
      const relevance = this.calculateToolRelevance(tool, bundle.metadata);
      
      toolScores.set(tool, priority * 0.6 + relevance * 0.4);
    }

    // Sort tools by score and take top N
    const sortedTools = Array.from(toolScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTools)
      .map(([tool]) => tool);

    bundle.tools = new Set(sortedTools);
    return bundle;
  }

  /**
   * Calculate tool relevance based on context
   */
  calculateToolRelevance(tool, metadata) {
    // Simple relevance scoring - can be enhanced with ML
    let score = 50; // Base score

    // Increase score for frequently used tools
    const usage = this.performanceMetrics.get(tool);
    if (usage && usage.useCount > 10) {
      score += Math.min(30, usage.useCount);
    }

    // Increase score for task-specific tools
    if (metadata.taskContext?.preferredTools?.includes(tool)) {
      score += 20;
    }

    return Math.min(100, score);
  }

  /**
   * Load a bundle based on its loading strategy
   */
  async loadBundle(bundle) {
    const strategy = bundle.loadingStrategy || LOADING_STRATEGIES.LAZY;

    switch (strategy) {
      case LOADING_STRATEGIES.EAGER:
        await this.loadToolsEager(bundle);
        break;
      case LOADING_STRATEGIES.LAZY:
        this.setupLazyLoading(bundle);
        break;
      case LOADING_STRATEGIES.ON_DEMAND:
        // Tools loaded only when requested
        // Use stderr to prevent JSON-RPC interference
        console.error(`Bundle ${bundle.id} configured for on-demand loading`);
        break;
    }
  }

  /**
   * Load tools eagerly (immediately)
   */
  async loadToolsEager(bundle) {
    const startTime = Date.now();
    const tools = Array.from(bundle.tools || bundle.tools);
    
    try {
      await Promise.all(tools.map(tool => this.loadTool(tool)));
      
      const duration = Date.now() - startTime;
      const metadata = this.bundleMetadata.get(bundle.id);
      if (metadata) {
        metadata.loadCount++;
        metadata.lastLoadTime = duration;
        metadata.averageLoadTime = 
          (metadata.averageLoadTime * (metadata.loadCount - 1) + duration) / metadata.loadCount;
      }
      
      // Use stderr to prevent JSON-RPC interference
      console.error(`Eagerly loaded ${tools.length} tools in ${duration}ms`);
    } catch (error) {
      this.logger.error(`Failed to load bundle ${bundle.id}:`, error);
      const metadata = this.bundleMetadata.get(bundle.id);
      if (metadata) {
        metadata.errors.push({
          timestamp: Date.now(),
          error: getErrorMessage(error)
        });
      }
      throw error;
    }
  }

  /**
   * Setup lazy loading for tools using real tool loader
   */
  setupLazyLoading(bundle) {
    const tools = Array.from(bundle.tools || bundle.tools);
    
    tools.forEach(tool => {
      // Create a proxy that loads the real tool on first access
      this.loadedTools.set(tool, {
        loaded: false,
        type: 'lazy',
        loader: async () => {
          const toolData = this.loadedTools.get(tool);
          if (!toolData.loaded) {
            const realTool = await this.loadTool(tool);
            toolData.loaded = true;
            toolData.tool = realTool;
            toolData.server = realTool.server;
            toolData.capabilities = realTool.metadata?.capabilities || [];
          }
          return toolData.tool;
        }
      });
    });
    
    // Use stderr to prevent JSON-RPC interference
    console.error(`Setup real lazy loading for ${tools.length} tools`);
  }

  /**
   * Load a single tool using the real tool loader
   */
  async loadTool(toolName) {
    try {
      // Record performance metrics
      const startTime = Date.now();
      
      // Use real tool loader instead of simulation
      const tool = await this.realToolLoader.loadTool(toolName);
      
      const duration = Date.now() - startTime;
      
      // Update metrics with real data
      if (!this.performanceMetrics.has(toolName)) {
        this.performanceMetrics.set(toolName, {
          loadTime: duration,
          useCount: 0,
          errors: 0,
          lastUsed: null,
          realTool: true,
          server: tool.server || 'unknown',
          capabilities: tool.metadata?.capabilities || []
        });
      } else {
        const metrics = this.performanceMetrics.get(toolName);
        metrics.loadTime = (metrics.loadTime + duration) / 2;
        metrics.realTool = true;
        metrics.server = tool.server || metrics.server;
      }
      
      // Store the real tool instead of mock data
      this.loadedTools.set(toolName, { 
        loaded: true, 
        loadedAt: Date.now(),
        tool: tool,
        type: 'real',
        server: tool.server,
        capabilities: tool.metadata?.capabilities || []
      });
      
      this.logger.debug(`Real tool loaded: ${toolName} from ${tool.server} in ${duration}ms`);
      
      return tool;
      
    } catch (error) {
      this.logger.error(`Failed to load real tool ${toolName}:`, error);
      
      const metrics = this.performanceMetrics.get(toolName);
      if (metrics) {
        metrics.errors++;
      }
      
      // Try fallback loading mechanism with real implementation
      await this.loadToolWithFallback(toolName);
    }
  }

  /**
   * Load tool with fallback mechanism using real tool loader
   */
  async loadToolWithFallback(toolName) {
    const fallbackStrategies = [
      () => this.realToolLoader.loadFromCache(toolName),
      () => this.realToolLoader.loadFromBackup(toolName),
      () => this.realToolLoader.loadMinimalVersion(toolName)
    ];

    for (const strategy of fallbackStrategies) {
      try {
        const tool = await strategy();
        
        // Store the fallback tool
        this.loadedTools.set(toolName, {
          loaded: true,
          loadedAt: Date.now(),
          tool: tool,
          type: 'fallback',
          server: tool.server || 'fallback',
          capabilities: tool.metadata?.capabilities || []
        });
        
        // Use stderr to prevent JSON-RPC interference
        console.error(`Loaded ${toolName} using real fallback strategy: ${tool.status}`);
        return tool;
      } catch (error) {
        continue;
      }
    }

    throw new Error(`Failed to load tool ${toolName} with all real fallback strategies`);
  }

  /**
   * Load tool from cache (delegated to real tool loader)
   */
  async loadFromCache(toolName) {
    return await this.realToolLoader.loadFromCache(toolName);
  }

  /**
   * Load tool from backup (delegated to real tool loader)
   */
  async loadFromBackup(toolName) {
    return await this.realToolLoader.loadFromBackup(toolName);
  }

  /**
   * Load minimal version of tool (delegated to real tool loader)
   */
  async loadMinimalVersion(toolName) {
    const tool = await this.realToolLoader.loadMinimalVersion(toolName);
    
    // Update our local tracking
    this.loadedTools.set(toolName, {
      loaded: true,
      minimal: true,
      loadedAt: Date.now(),
      tool: tool,
      type: 'minimal',
      server: 'minimal',
      capabilities: ['basic']
    });
    
    return tool;
  }

  /**
   * Get bundle performance metrics
   */
  getBundleMetrics(bundleId) {
    const metadata = this.bundleMetadata.get(bundleId);
    const bundle = this.bundles.get(bundleId);
    
    if (!metadata || !bundle) {
      return null;
    }

    const toolMetrics = [];
    const tools = Array.from(bundle.tools || []);
    
    tools.forEach(tool => {
      const metrics = this.performanceMetrics.get(tool);
      if (metrics) {
        toolMetrics.push({
          tool,
          ...metrics
        });
      }
    });

    return {
      bundleId,
      metadata,
      toolMetrics,
      summary: {
        totalTools: tools.length,
        loadedTools: toolMetrics.filter(m => this.loadedTools.get(m.tool)?.loaded).length,
        averageLoadTime: metadata.averageLoadTime,
        totalErrors: toolMetrics.reduce((sum, m) => sum + (m.errors || 0), 0),
        totalUsage: toolMetrics.reduce((sum, m) => sum + (m.useCount || 0), 0)
      }
    };
  }

  /**
   * Export bundle configuration
   */
  exportBundleConfig(bundleId) {
    const bundle = this.bundles.get(bundleId);
    const metadata = this.bundleMetadata.get(bundleId);
    const metrics = this.getBundleMetrics(bundleId);

    return {
      bundle,
      metadata,
      metrics,
      exportedAt: Date.now()
    };
  }

  /**
   * Import bundle configuration
   */
  importBundleConfig(config) {
    const { bundle, metadata } = config;
    
    if (!bundle || !bundle.id) {
      throw new Error('Invalid bundle configuration');
    }

    this.registerBundle(bundle);
    
    if (metadata) {
      this.bundleMetadata.set(bundle.id, metadata);
    }

    return bundle.id;
  }

  /**
   * Get real tool information
   */
  getRealToolInfo(toolName) {
    const loadedTool = this.loadedTools.get(toolName);
    const realTool = this.realToolLoader.getTool(toolName);
    
    return {
      loaded: loadedTool?.loaded || false,
      type: loadedTool?.type || 'unknown',
      server: loadedTool?.server || 'unknown',
      capabilities: loadedTool?.capabilities || [],
      realToolData: realTool || null,
      metrics: this.performanceMetrics.get(toolName) || null
    };
  }

  /**
   * Get all real tool information
   */
  getAllRealToolInfo() {
    const allTools = {};
    
    // Get from loaded tools
    for (const [toolName, toolData] of this.loadedTools) {
      allTools[toolName] = this.getRealToolInfo(toolName);
    }
    
    // Get from real tool loader
    const realToolNames = this.realToolLoader.getLoadedTools();
    for (const toolName of realToolNames) {
      if (!allTools[toolName]) {
        allTools[toolName] = this.getRealToolInfo(toolName);
      }
    }
    
    return allTools;
  }

  /**
   * Get real tool loader metrics
   */
  getRealToolLoaderMetrics() {
    return this.realToolLoader.getLoadingMetrics();
  }

  /**
   * Check if tool is actually loaded (not just simulated)
   */
  isRealToolLoaded(toolName) {
    const loadedTool = this.loadedTools.get(toolName);
    return loadedTool?.loaded && loadedTool?.type !== 'mock';
  }

  /**
   * Execute a real tool
   */
  async executeRealTool(toolName, parameters = {}) {
    try {
      const toolData = this.loadedTools.get(toolName);
      
      if (!toolData || !toolData.loaded) {
        // Try to load the tool first
        await this.loadTool(toolName);
      }
      
      const realTool = this.realToolLoader.getTool(toolName);
      if (realTool && realTool.execute) {
        const result = await realTool.execute(parameters);
        
        // Update usage metrics
        const metrics = this.performanceMetrics.get(toolName);
        if (metrics) {
          metrics.useCount = (metrics.useCount || 0) + 1;
          metrics.lastUsed = Date.now();
        }
        
        return result;
      } else {
        throw new Error(`Tool ${toolName} not available or not executable`);
      }
    } catch (error) {
      this.logger.error(`Failed to execute real tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup resources including real tool loader
   */
  async cleanup() {
    try {
      // Use stderr to prevent JSON-RPC interference
      console.error('Cleaning up ToolBundleOrganizer...');
      
      // Cleanup real tool loader
      if (this.realToolLoader && this.realToolLoader.shutdown) {
        await this.realToolLoader.shutdown();
      }
      
      // Clear all maps
      this.bundles.clear();
      this.toolToBundleMap.clear();
      this.bundleMetadata.clear();
      this.loadedTools.clear();
      this.toolDependencies.clear();
      this.performanceMetrics.clear();
      
      // Use stderr to prevent JSON-RPC interference
      console.error('ToolBundleOrganizer cleanup complete');
      
    } catch (error) {
      this.logger.error('ToolBundleOrganizer cleanup failed:', error);
    }
  }
}

/**
 * Create the organizeDynamicToolBundle MCP tool
 */
export function createOrganizeDynamicToolBundleTool(organizer, logger) {
  return {
    name: 'organizeDynamicToolBundle',
    description: 'Dynamically organize tools into optimized bundles based on task context',
    inputSchema: {
      type: 'object',
      properties: {
        taskContext: {
          type: 'object',
          description: 'Task context information',
          properties: {
            task: { type: 'string', description: 'Task description' },
            agentCount: { type: 'number', description: 'Number of agents' },
            topology: { type: 'string', description: 'Swarm topology' },
            requiresMemory: { type: 'boolean', description: 'Requires persistent memory' },
            environment: { type: 'string', description: 'Execution environment' },
            critical: { type: 'boolean', description: 'Is critical task' },
            performanceCritical: { type: 'boolean', description: 'Performance sensitive' },
            externalAPIs: { type: 'boolean', description: 'Uses external APIs' },
            specialized: { type: 'boolean', description: 'Requires specialized tools' },
            preferredTools: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Preferred tools for this task'
            }
          },
          required: ['task']
        },
        personaType: {
          type: 'string',
          description: 'Agent persona type',
          enum: ['architect', 'developer', 'analyst', 'researcher', 'coordinator']
        }
      },
      required: ['taskContext']
    },
    handler: async (input) => {
      try {
        const result = await organizer.organizeDynamicToolBundle(
          input.taskContext,
          input.personaType
        );
        
        return {
          success: true,
          result
        };
      } catch (error) {
        logger.error('Failed to organize dynamic tool bundle:', error);
        return {
          success: false,
          error: getErrorMessage(error)
        };
      }
    }
  };
}