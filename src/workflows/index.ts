/**
 * Design Cloning Workflows - Complete Integration
 * 
 * This module provides the complete 2AS Design Cloning Suite integration
 * with all orchestration workflows, lifecycle management, progress tracking,
 * CLI interface, and optimization capabilities.
 * 
 * Created by: 🐜 Ant-Worker-Execute
 * Part of: Claude-Flow-MCP Design Cloning Suite
 */

export { 
  DesignCloningSuite, 
  WorkflowBatchProcessor, 
  WorkflowType, 
  WorkflowStatus,
  DESIGN_CLONING_MCPS 
} from './design-cloning-suite.js';

export { 
  WorkflowCoordinator, 
  ServerState,
  MCP_SERVER_CONFIGS 
} from './workflow-coordinator.js';

export { 
  ProgressTracker,
  ProgressStatus,
  ErrorCategory,
  RecoveryStrategy,
  type ProgressStep,
  type WorkflowError,
  type ProgressCheckpoint,
  type PerformanceMetrics
} from './progress-tracker.js';

export { 
  OptimizationEngine,
  CacheStrategy,
  type OptimizationConfig,
  type CacheEntry
} from './optimization-engine.js';

// CLI Commands Export
export { createDesignCloningCommand } from '../cli/commands/design-cloning.js';

/**
 * Workflow Templates Export
 * These JSON templates define the complete workflow configurations
 */
export const WORKFLOW_TEMPLATES = {
  GEMINI_STYLE: './templates/design-cloning/gemini-style-workflow.json',
  FIGMA_STYLE: './templates/design-cloning/figma-style-workflow.json',
  WEBSITE_SCRAPING: './templates/design-cloning/website-scraping-workflow.json'
};

/**
 * Complete Design Cloning Suite Factory
 * Provides easy initialization of the complete system
 */
export class DesignCloningSuiteFactory {
  /**
   * Create a complete design cloning suite with all components
   */
  static async createCompleteSuite(options: {
    logger?: any;
    cacheDir?: string;
    checkpointDir?: string;
    swarmOptions?: any;
    optimizationConfig?: any;
    enableProgressTracking?: boolean;
    enableOptimization?: boolean;
  } = {}) {
    const { 
      DesignCloningSuite, 
      WorkflowBatchProcessor 
    } = await import('./design-cloning-suite.js');
    
    const { WorkflowCoordinator } = await import('./workflow-coordinator.js');
    const { ProgressTracker } = await import('./progress-tracker.js');
    const { OptimizationEngine } = await import('./optimization-engine.js');

    // Initialize components
    const workflowCoordinator = new WorkflowCoordinator({
      logger: options.logger,
      healthCheckInterval: 30000,
      maxConcurrentStartups: 3
    });

    const progressTracker = options.enableProgressTracking !== false ? 
      new ProgressTracker({
        logger: options.logger,
        checkpointDir: options.checkpointDir || './checkpoints',
        enableMetricsCollection: true
      }) : null;

    const optimizationEngine = options.enableOptimization !== false ?
      new OptimizationEngine(options.optimizationConfig, options.logger) : null;

    const designCloningSuite = new DesignCloningSuite({
      logger: options.logger,
      swarmOptions: options.swarmOptions,
      progressTracker,
      optimizationEngine
    });

    const batchProcessor = new WorkflowBatchProcessor(designCloningSuite, {
      logger: options.logger,
      maxConcurrentWorkflows: 3
    });

    // Initialize all components
    await workflowCoordinator.initialize();
    await designCloningSuite.initialize();

    // Wire up event handlers for integration
    if (progressTracker) {
      designCloningSuite.on('workflowStarted', async (workflow) => {
        await progressTracker.initializeWorkflow(workflow.id, [
          { id: 'analysis', name: 'Design Analysis', description: 'Analyzing design patterns', weight: 0.3, maxRetries: 2 },
          { id: 'generation', name: 'Component Generation', description: 'Generating components', weight: 0.4, maxRetries: 2 },
          { id: 'integration', name: 'Project Integration', description: 'Integrating components', weight: 0.3, maxRetries: 1 }
        ]);
      });

      progressTracker.on('restartServerRequested', async ({ workflowId, stepId, error }) => {
        // Determine which server to restart based on the step
        const serverName = getServerNameFromStep(stepId);
        if (serverName) {
          try {
            await workflowCoordinator.stopServer(serverName);
            await workflowCoordinator.startServer(serverName, 'high');
          } catch (restartError) {
            console.error('Failed to restart server', { serverName, error: restartError });
          }
        }
      });
    }

    return {
      designCloningSuite,
      workflowCoordinator,
      progressTracker,
      optimizationEngine,
      batchProcessor,
      
      async shutdown() {
        await designCloningSuite.shutdown();
        await workflowCoordinator.shutdown();
        if (progressTracker) {
          await progressTracker.cleanup();
        }
        if (optimizationEngine) {
          await optimizationEngine.shutdown();
        }
      }
    };
  }

  /**
   * Create a lightweight suite for development/testing
   */
  static async createDevelopmentSuite(options: {
    logger?: any;
  } = {}) {
    return this.createCompleteSuite({
      ...options,
      enableProgressTracking: false,
      enableOptimization: false,
      swarmOptions: {
        maxAgents: 5,
        topology: 'mesh'
      }
    });
  }

  /**
   * Create a production-ready suite with all optimizations
   */
  static async createProductionSuite(options: {
    logger?: any;
    cacheDir?: string;
    checkpointDir?: string;
  } = {}) {
    return this.createCompleteSuite({
      ...options,
      enableProgressTracking: true,
      enableOptimization: true,
      swarmOptions: {
        maxAgents: 15,
        topology: 'hierarchical',
        enableFailover: true,
        enableLoadBalancing: true
      },
      optimizationConfig: {
        caching: {
          enabled: true,
          strategy: 'hybrid',
          maxMemorySize: 200 * 1024 * 1024, // 200MB
          maxDiskSize: 2 * 1024 * 1024 * 1024, // 2GB
        },
        parallelization: {
          enabled: true,
          maxConcurrentTasks: 8,
          adaptiveScaling: true
        },
        monitoring: {
          enabled: true,
          bottleneckDetection: true,
          adaptiveOptimization: true
        }
      }
    });
  }
}

/**
 * Helper function to determine server name from step ID
 */
function getServerNameFromStep(stepId: string): string | null {
  const stepToServerMap: Record<string, string> = {
    'design-analysis': 'design-analysis-mcp',
    'component-generation': 'component-library-mcp',
    'project-scaffolding': 'project-generator-mcp',
    'asset-integration': 'asset-manager-mcp',
    'content-scraping': 'website-scraper-mcp',
    'visual-capture': 'browser-extension-mcp',
    'batch-analysis': 'design-analysis-mcp',
    'pattern-recognition': 'enhanced-memory-mcp'
  };

  return stepToServerMap[stepId] || null;
}

/**
 * Workflow Execution Utilities
 */
export class WorkflowExecutionUtils {
  /**
   * Execute workflow with full monitoring and optimization
   */
  static async executeWithFullMonitoring(
    suite: any,
    workflowType: string,
    input: any,
    options: any = {}
  ) {
    const startTime = Date.now();
    
    try {
      let result;
      
      switch (workflowType) {
        case 'gemini-style':
          result = await suite.designCloningSuite.executeGeminiStyleClone(input, options);
          break;
        case 'figma-style':
          result = await suite.designCloningSuite.executeFigmaStyleLibrary(input, options);
          break;
        case 'website-scraping':
          result = await suite.designCloningSuite.executeWebsiteScrapingClone(input, options);
          break;
        default:
          throw new Error(`Unknown workflow type: ${workflowType}`);
      }

      const executionTime = Date.now() - startTime;
      
      return {
        success: true,
        result,
        executionTime,
        metrics: suite.optimizationEngine?.getPerformanceMetrics() || null
      };
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        error: error.message,
        executionTime,
        metrics: suite.optimizationEngine?.getPerformanceMetrics() || null
      };
    }
  }

  /**
   * Execute batch workflow with optimization
   */
  static async executeBatchWithOptimization(
    suite: any,
    workflowType: string,
    inputs: any[],
    options: any = {}
  ) {
    const startTime = Date.now();
    
    try {
      let result;
      
      switch (workflowType) {
        case 'gemini-style':
          result = await suite.batchProcessor.processBatchGeminiStyle(inputs, options);
          break;
        case 'website-scraping':
          result = await suite.batchProcessor.processBatchWebsiteScraping(inputs, options);
          break;
        default:
          throw new Error(`Batch processing not supported for workflow type: ${workflowType}`);
      }

      const executionTime = Date.now() - startTime;
      
      return {
        success: true,
        result,
        executionTime,
        totalItems: inputs.length,
        successfulItems: result.successful.length,
        failedItems: result.failed.length,
        metrics: suite.optimizationEngine?.getPerformanceMetrics() || null
      };
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      return {
        success: false,
        error: error.message,
        executionTime,
        totalItems: inputs.length,
        metrics: suite.optimizationEngine?.getPerformanceMetrics() || null
      };
    }
  }
}

/**
 * Configuration Templates
 */
export const CONFIG_TEMPLATES = {
  DEVELOPMENT: {
    swarmOptions: {
      maxAgents: 5,
      topology: 'mesh',
      enableFailover: false,
      enableLoadBalancing: true
    },
    optimizationConfig: {
      caching: { enabled: false },
      parallelization: { maxConcurrentTasks: 2 },
      monitoring: { enabled: false }
    }
  },
  
  PRODUCTION: {
    swarmOptions: {
      maxAgents: 15,
      topology: 'hierarchical',
      enableFailover: true,
      enableLoadBalancing: true
    },
    optimizationConfig: {
      caching: {
        enabled: true,
        strategy: 'hybrid',
        maxMemorySize: 200 * 1024 * 1024,
        maxDiskSize: 2 * 1024 * 1024 * 1024
      },
      parallelization: {
        enabled: true,
        maxConcurrentTasks: 8,
        adaptiveScaling: true
      },
      monitoring: {
        enabled: true,
        bottleneckDetection: true,
        adaptiveOptimization: true
      }
    }
  },
  
  HIGH_PERFORMANCE: {
    swarmOptions: {
      maxAgents: 25,
      topology: 'hybrid',
      enableFailover: true,
      enableLoadBalancing: true
    },
    optimizationConfig: {
      caching: {
        enabled: true,
        strategy: 'distributed',
        maxMemorySize: 500 * 1024 * 1024,
        maxDiskSize: 5 * 1024 * 1024 * 1024
      },
      parallelization: {
        enabled: true,
        maxConcurrentTasks: 12,
        adaptiveScaling: true
      },
      monitoring: {
        enabled: true,
        bottleneckDetection: true,
        adaptiveOptimization: true
      }
    }
  }
};

/**
 * Default export - Factory for easy usage
 */
export default DesignCloningSuiteFactory;