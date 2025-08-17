/**
 * Enhanced Web UI - Main Entry Point
 * Modular UI architecture supporting 71+ MCP tools and CLI commands
 */

// Core Architecture Components
export { UIManager, VIEW_CATEGORIES, MCP_TOOL_CATEGORIES } from './core/UIManager.js';
export { MCPIntegrationLayer } from './core/MCPIntegrationLayer.js';
export { EventBus } from './core/EventBus.js';
export { ViewManager } from './core/ViewManager.js';
export { StateManager } from './core/StateManager.js';

// Component Library
export { ComponentLibrary } from './components/ComponentLibrary.js';

// Views
export { default as NeuralNetworkView } from './views/NeuralNetworkView.js';
export { default as GitHubIntegrationView } from './views/GitHubIntegrationView.js';
export { default as WorkflowAutomationView } from './views/WorkflowAutomationView.js';
export { default as DAAView } from './views/DAAView.js';

// Main UI Controllers
export { EnhancedWebUI } from './EnhancedWebUI.js';
export { EnhancedProcessUI, launchEnhancedUI } from './EnhancedProcessUI.js';

/**
 * Initialize Enhanced Web UI System
 * @param {Object} options Configuration options
 * @returns {Promise<EnhancedWebUI>} Initialized UI system
 */
export async function initializeEnhancedUI(options = {}) {
  const {
    mode = 'auto', // 'full', 'enhanced', 'fallback', 'auto'
    existingUI = null,
    enableAllFeatures = true,
  } = options;

  try {
    if (mode === 'full' || (mode === 'auto' && typeof window !== 'undefined')) {
      // Browser environment - full UI manager
      const { UIManager } = await import('./core/UIManager.js');
      const uiManager = new UIManager();
      await uiManager.initialize();
      return uiManager;
    } else if (mode === 'enhanced' || (mode === 'auto' && existingUI)) {
      // Enhanced process UI
      const { EnhancedWebUI } = await import('./EnhancedWebUI.js');
      const enhancedUI = new EnhancedWebUI();
      await enhancedUI.initialize(existingUI);
      return enhancedUI;
    } else {
      // Terminal/fallback mode
      const { EnhancedProcessUI } = await import('./EnhancedProcessUI.js');
      const processUI = new EnhancedProcessUI();
      return processUI;
    }
  } catch (error) {
    console.warn('Enhanced UI initialization failed, using fallback:', error);

    // Always provide fallback
    const { EnhancedProcessUI } = await import('./EnhancedProcessUI.js');
    const processUI = new EnhancedProcessUI();
    return processUI;
  }
}

/**
 * Launch Enhanced UI in terminal mode
 */
export async function launchTerminalUI() {
  const { launchEnhancedUI } = await import('./EnhancedProcessUI.js');
  return launchEnhancedUI();
}

/**
 * Tool Categories and Counts
 */
export const TOOL_CATEGORIES_INFO = {
  neural: {
    name: 'Neural Network Tools',
    count: 15,
    tools: [
      'neural_train',
      'neural_predict',
      'neural_status',
      'neural_patterns',
      'model_load',
      'model_save',
      'pattern_recognize',
      'cognitive_analyze',
      'learning_adapt',
      'neural_compress',
      'ensemble_create',
      'transfer_learn',
      'neural_explain',
      'wasm_optimize',
      'inference_run',
    ],
  },
  memory: {
    name: 'Memory & Persistence Tools',
    count: 10,
    tools: [
      'memory_usage',
      'memory_backup',
      'memory_restore',
      'memory_compress',
      'memory_sync',
      'cache_manage',
      'state_snapshot',
      'context_restore',
      'memory_analytics',
      'memory_persist',
    ],
  },
  monitoring: {
    name: 'Monitoring & Analysis Tools',
    count: 13,
    tools: [
      'performance_report',
      'bottleneck_analyze',
      'token_usage',
      'benchmark_run',
      'metrics_collect',
      'trend_analysis',
      'cost_analysis',
      'quality_assess',
      'error_analysis',
      'usage_stats',
      'health_check',
      'swarm_monitor',
      'agent_metrics',
    ],
  },
  workflow: {
    name: 'Workflow & Automation Tools',
    count: 11,
    tools: [
      'workflow_create',
      'workflow_execute',
      'automation_setup',
      'pipeline_create',
      'scheduler_manage',
      'trigger_setup',
      'workflow_template',
      'batch_process',
      'parallel_execute',
      'sparc_mode',
      'task_orchestrate',
    ],
  },
  github: {
    name: 'GitHub Integration Tools',
    count: 8,
    tools: [
      'github_repo_analyze',
      'github_pr_manage',
      'github_issue_track',
      'github_release_coord',
      'github_workflow_auto',
      'github_code_review',
      'github_sync_coord',
      'github_metrics',
    ],
  },
  daa: {
    name: 'Dynamic Agent Architecture Tools',
    count: 8,
    tools: [
      'daa_agent_create',
      'daa_capability_match',
      'daa_resource_alloc',
      'daa_lifecycle_manage',
      'daa_communication',
      'daa_consensus',
      'daa_fault_tolerance',
      'daa_optimization',
    ],
  },
  system: {
    name: 'System & Utilities Tools',
    count: 6,
    tools: [
      'security_scan',
      'backup_create',
      'restore_system',
      'log_analysis',
      'diagnostic_run',
      'config_manage',
    ],
  },
  cli: {
    name: 'CLI Command Bridge',
    count: 9,
    commands: [
      'hive-mind',
      'github',
      'training',
      'analysis',
      'automation',
      'coordination',
      'hooks',
      'mcp',
      'config',
    ],
  },
};

/**
 * Get total tool count
 */
export function getTotalToolCount() {
  return Object.values(TOOL_CATEGORIES_INFO).reduce((total, category) => {
    return total + category.count;
  }, 0);
}

/**
 * Get architecture information
 */
export function getArchitectureInfo() {
  return {
    version: '2.0.0',
    totalTools: getTotalToolCount(),
    categories: Object.keys(TOOL_CATEGORIES_INFO).length,
    features: [
      'Modular view system',
      'MCP tool integration',
      'Real-time updates',
      'State persistence',
      'Event-driven architecture',
      'Component library',
      'Responsive design',
      'Fallback modes',
      'Tool statistics',
      'Cross-platform support',
    ],
    compatibility: {
      browser: true,
      node: true,
      terminal: true,
      vscode: true,
    },
  };
}

// Auto-initialization for browser environments
if (typeof window !== 'undefined') {
  // Check if we should auto-initialize
  window.claudeFlowEnhancedUI = {
    initialize: initializeEnhancedUI,
    launch: launchTerminalUI,
    getInfo: getArchitectureInfo,
    toolCategories: TOOL_CATEGORIES_INFO,
  };

  // Auto-enhance existing UI if present
  window.addEventListener('DOMContentLoaded', async () => {
    if (window.claudeFlowProcessUI && !window.claudeFlowEnhanced) {
      try {
        console.log('🎨 Auto-enhancing existing process UI...');
        const enhancedUI = await initializeEnhancedUI({
          mode: 'enhanced',
          existingUI: window.claudeFlowProcessUI,
        });
        window.claudeFlowEnhanced = enhancedUI;
        console.log('✅ Enhanced UI auto-initialization complete');
      } catch (error) {
        console.warn('Enhanced UI auto-initialization failed:', error);
      }
    }
  });
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeEnhancedUI,
    launchTerminalUI,
    getArchitectureInfo,
    TOOL_CATEGORIES_INFO,
    getTotalToolCount,
  };
}

export default {
  initializeEnhancedUI,
  launchTerminalUI,
  getArchitectureInfo,
  TOOL_CATEGORIES_INFO,
  getTotalToolCount,
};
