/**
 * Manager Registry - Central routing system for Claude Flow MCP v2.0.0
 * Routes tool calls to appropriate managers based on tool name prefixes
 */

export class ManagerRegistry {
  constructor() {
    this.managers = new Map();
    this.toolRoutes = new Map();
    this.performance = {
      toolExecutions: new Map(),
      errorCounts: new Map(),
      averageExecutionTimes: new Map()
    };
  }

  /**
   * Register a manager with its tool prefixes
   * @param {string} name - Manager name 
   * @param {object} manager - Manager instance
   * @param {string[]} prefixes - Array of tool name prefixes this manager handles
   */
  registerManager(name, manager, prefixes) {
    this.managers.set(name, manager);
    
    // Register tool routing for each prefix
    prefixes.forEach(prefix => {
      this.toolRoutes.set(prefix, manager);
    });
    
    console.log(`✅ Registered ${name} manager with prefixes: ${prefixes.join(', ')}`);
  }

  /**
   * Get the appropriate manager for a tool name
   * @param {string} toolName - Name of the tool
   * @returns {object} Manager instance
   */
  getManagerForTool(toolName) {
    // Extract prefix from tool name (everything before first underscore)
    const prefix = toolName.split('_')[0];
    
    // Try exact prefix match first
    let manager = this.toolRoutes.get(prefix);
    
    if (manager) {
      return manager;
    }
    
    // Fallback: check for partial matches in registered prefixes
    for (const [registeredPrefix, registeredManager] of this.toolRoutes.entries()) {
      if (toolName.startsWith(registeredPrefix)) {
        return registeredManager;
      }
    }
    
    // Final fallback: return performance manager for unknown tools
    return this.managers.get('performance');
  }

  /**
   * Record tool execution metrics
   * @param {string} toolName - Tool that was executed
   * @param {number} executionTime - Time taken in milliseconds
   * @param {boolean} success - Whether execution was successful
   */
  recordExecution(toolName, executionTime, success) {
    // Update execution count
    const currentCount = this.performance.toolExecutions.get(toolName) || 0;
    this.performance.toolExecutions.set(toolName, currentCount + 1);
    
    // Update error count if failed
    if (!success) {
      const errorCount = this.performance.errorCounts.get(toolName) || 0;
      this.performance.errorCounts.set(toolName, errorCount + 1);
    }
    
    // Update average execution time
    const currentAvg = this.performance.averageExecutionTimes.get(toolName) || 0;
    const newAvg = (currentAvg + executionTime) / 2;
    this.performance.averageExecutionTimes.set(toolName, newAvg);
  }

  /**
   * Get performance statistics for all registered managers
   * @returns {object} Performance statistics
   */
  getPerformanceStats() {
    const stats = {
      managers: {},
      totalExecutions: 0,
      totalErrors: 0,
      averageResponseTime: 0
    };

    // Aggregate statistics by manager
    for (const [managerName, manager] of this.managers.entries()) {
      stats.managers[managerName] = {
        status: manager.isHealthy ? manager.isHealthy() : 'unknown',
        toolsHandled: Array.from(this.toolRoutes.entries())
          .filter(([prefix, mgr]) => mgr === manager)
          .map(([prefix]) => prefix),
        executionCount: 0,
        errorCount: 0,
        avgResponseTime: 0
      };
    }

    // Calculate totals
    for (const [toolName, execCount] of this.performance.toolExecutions.entries()) {
      stats.totalExecutions += execCount;
      
      const errors = this.performance.errorCounts.get(toolName) || 0;
      stats.totalErrors += errors;
    }

    // Calculate average response time across all tools
    const responseTimes = Array.from(this.performance.averageExecutionTimes.values());
    if (responseTimes.length > 0) {
      stats.averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    }

    return stats;
  }

  /**
   * Get health status of all managers
   * @returns {object} Health status
   */
  async getHealthStatus() {
    const health = {
      overall: 'healthy',
      managers: {},
      registryStats: {
        totalManagers: this.managers.size,
        totalToolRoutes: this.toolRoutes.size,
        uptime: process.uptime()
      }
    };

    let unhealthyCount = 0;

    // Check health of each manager
    for (const [name, manager] of this.managers.entries()) {
      try {
        if (manager.getHealth) {
          health.managers[name] = await manager.getHealth();
        } else {
          health.managers[name] = { status: 'unknown', message: 'No health check available' };
        }

        if (health.managers[name].status !== 'healthy') {
          unhealthyCount++;
        }
      } catch (error) {
        health.managers[name] = { 
          status: 'error', 
          message: error.message 
        };
        unhealthyCount++;
      }
    }

    // Set overall health based on manager health
    if (unhealthyCount === 0) {
      health.overall = 'healthy';
    } else if (unhealthyCount < this.managers.size / 2) {
      health.overall = 'degraded';
    } else {
      health.overall = 'unhealthy';
    }

    return health;
  }

  /**
   * List all registered managers and their capabilities
   * @returns {object} Manager information
   */
  listManagers() {
    const managerList = {};

    for (const [name, manager] of this.managers.entries()) {
      const prefixes = Array.from(this.toolRoutes.entries())
        .filter(([prefix, mgr]) => mgr === manager)
        .map(([prefix]) => prefix);

      managerList[name] = {
        prefixes,
        toolCount: prefixes.length,
        status: manager.isHealthy ? manager.isHealthy() : 'unknown',
        capabilities: manager.getCapabilities ? manager.getCapabilities() : []
      };
    }

    return managerList;
  }

  /**
   * Cleanup all managers
   */
  async cleanup() {
    console.log('🔄 Cleaning up manager registry...');
    
    for (const [name, manager] of this.managers.entries()) {
      try {
        if (manager.cleanup) {
          await manager.cleanup();
        }
      } catch (error) {
        console.warn(`Warning: Cleanup failed for ${name}:`, error.message);
      }
    }
    
    this.managers.clear();
    this.toolRoutes.clear();
    this.performance.toolExecutions.clear();
    this.performance.errorCounts.clear();
    this.performance.averageExecutionTimes.clear();
  }
}

export default ManagerRegistry;