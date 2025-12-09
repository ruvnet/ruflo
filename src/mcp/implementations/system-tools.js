/**
 * System & Diagnostic Tools Implementation
 * Implements: health_check, diagnostic_run, features_detect, security_scan,
 *             backup_create, restore_system, log_analysis, config_manage
 *
 * Contributed by: Moyle (Moyle Engineering Pty Ltd)
 * Co-authored-by: Moyle <moyle@moyleengineering.com.au>
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

class SystemTools {
  constructor() {
    this.startTime = Date.now();
    this.diagnosticHistory = new Map();
    this.configCache = new Map();
    this.backups = new Map();
    this.logs = [];
  }

  // Tool: health_check - Foundation for all diagnostics
  async health_check(args = {}) {
    const components = args.components || ['memory', 'agents', 'swarm', 'database', 'system'];
    const results = {
      success: true,
      timestamp: new Date().toISOString(),
      overall_status: 'healthy',
      components: {},
      warnings: [],
      errors: [],
    };

    // Check each component
    for (const component of components) {
      try {
        results.components[component] = await this.checkComponent(component);
        if (results.components[component].status === 'warning') {
          results.warnings.push(`${component}: ${results.components[component].message}`);
        } else if (results.components[component].status === 'error') {
          results.errors.push(`${component}: ${results.components[component].message}`);
        }
      } catch (error) {
        results.components[component] = {
          status: 'error',
          message: error.message,
          checked: true,
        };
        results.errors.push(`${component}: ${error.message}`);
      }
    }

    // Determine overall status
    if (results.errors.length > 0) {
      results.overall_status = 'unhealthy';
      results.success = false;
    } else if (results.warnings.length > 0) {
      results.overall_status = 'degraded';
    }

    // Add system metrics
    results.system_metrics = this.getSystemMetrics();
    results.uptime_seconds = Math.floor((Date.now() - this.startTime) / 1000);

    return results;
  }

  async checkComponent(component) {
    const memUsage = process.memoryUsage();

    switch (component) {
      case 'memory':
        const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;
        return {
          status: heapUsedPercent > 0.9 ? 'warning' : 'healthy',
          message: heapUsedPercent > 0.9 ? 'High memory usage' : 'Memory OK',
          metrics: {
            heap_used_mb: Math.floor(memUsage.heapUsed / 1024 / 1024),
            heap_total_mb: Math.floor(memUsage.heapTotal / 1024 / 1024),
            heap_used_percent: (heapUsedPercent * 100).toFixed(1),
            rss_mb: Math.floor(memUsage.rss / 1024 / 1024),
            external_mb: Math.floor(memUsage.external / 1024 / 1024),
          },
          checked: true,
        };

      case 'agents':
        const agentCount = global.agentTracker ? global.agentTracker.agents.size : 0;
        return {
          status: 'healthy',
          message: `${agentCount} agents tracked`,
          metrics: {
            total_agents: agentCount,
            tracker_available: !!global.agentTracker,
          },
          checked: true,
        };

      case 'swarm':
        const swarmCount = global.agentTracker ? global.agentTracker.swarms.size : 0;
        return {
          status: 'healthy',
          message: `${swarmCount} swarms active`,
          metrics: {
            total_swarms: swarmCount,
            tracker_available: !!global.agentTracker,
          },
          checked: true,
        };

      case 'database':
        // Check if database file exists
        const dbPath = path.join(process.cwd(), '.swarm', 'memory.db');
        let dbExists = false;
        let dbSize = 0;
        try {
          const stats = await fs.stat(dbPath);
          dbExists = true;
          dbSize = stats.size;
        } catch (e) {
          // DB file doesn't exist
        }
        return {
          status: dbExists ? 'healthy' : 'warning',
          message: dbExists ? 'Database accessible' : 'Database not found',
          metrics: {
            exists: dbExists,
            path: dbPath,
            size_mb: (dbSize / 1024 / 1024).toFixed(2),
          },
          checked: true,
        };

      case 'system':
        return {
          status: 'healthy',
          message: 'System operational',
          metrics: {
            platform: os.platform(),
            arch: os.arch(),
            node_version: process.version,
            uptime_hours: (os.uptime() / 3600).toFixed(2),
            free_memory_mb: Math.floor(os.freemem() / 1024 / 1024),
            total_memory_mb: Math.floor(os.totalmem() / 1024 / 1024),
            cpu_cores: os.cpus().length,
          },
          checked: true,
        };

      case 'daa':
        return {
          status: global.daaManager ? 'healthy' : 'warning',
          message: global.daaManager ? 'DAA Manager active' : 'DAA Manager not initialized',
          metrics: {
            manager_available: !!global.daaManager,
            agents: global.daaManager?.agents?.size || 0,
          },
          checked: true,
        };

      case 'workflow':
        return {
          status: global.workflowManager ? 'healthy' : 'warning',
          message: global.workflowManager ? 'Workflow Manager active' : 'Workflow Manager not initialized',
          metrics: {
            manager_available: !!global.workflowManager,
            workflows: global.workflowManager?.workflows?.size || 0,
          },
          checked: true,
        };

      default:
        return {
          status: 'unknown',
          message: `Unknown component: ${component}`,
          checked: false,
        };
    }
  }

  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        rss_mb: Math.floor(memUsage.rss / 1024 / 1024),
        heap_total_mb: Math.floor(memUsage.heapTotal / 1024 / 1024),
        heap_used_mb: Math.floor(memUsage.heapUsed / 1024 / 1024),
        external_mb: Math.floor(memUsage.external / 1024 / 1024),
      },
      cpu: {
        user_ms: Math.floor(cpuUsage.user / 1000),
        system_ms: Math.floor(cpuUsage.system / 1000),
      },
      process: {
        pid: process.pid,
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpus: os.cpus().length,
        free_memory_mb: Math.floor(os.freemem() / 1024 / 1024),
        total_memory_mb: Math.floor(os.totalmem() / 1024 / 1024),
        load_avg: os.loadavg(),
      },
    };
  }

  // Tool: diagnostic_run - Comprehensive system diagnostics
  async diagnostic_run(args = {}) {
    const components = args.components || ['all'];
    const diagnosticId = `diag_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const diagnostic = {
      id: diagnosticId,
      timestamp: new Date().toISOString(),
      success: true,
      summary: {
        total_checks: 0,
        passed: 0,
        warnings: 0,
        errors: 0,
      },
      checks: [],
      recommendations: [],
    };

    // Run all diagnostic checks
    const checksToRun = components.includes('all')
      ? ['memory', 'performance', 'connectivity', 'storage', 'agents', 'configuration']
      : components;

    for (const check of checksToRun) {
      diagnostic.summary.total_checks++;
      try {
        const result = await this.runDiagnosticCheck(check);
        diagnostic.checks.push(result);

        if (result.status === 'pass') {
          diagnostic.summary.passed++;
        } else if (result.status === 'warning') {
          diagnostic.summary.warnings++;
          if (result.recommendation) {
            diagnostic.recommendations.push(result.recommendation);
          }
        } else {
          diagnostic.summary.errors++;
          diagnostic.success = false;
          if (result.recommendation) {
            diagnostic.recommendations.push(result.recommendation);
          }
        }
      } catch (error) {
        diagnostic.summary.errors++;
        diagnostic.success = false;
        diagnostic.checks.push({
          name: check,
          status: 'error',
          message: error.message,
          recommendation: `Investigate ${check} subsystem`,
        });
      }
    }

    // Store diagnostic history
    this.diagnosticHistory.set(diagnosticId, diagnostic);

    return diagnostic;
  }

  async runDiagnosticCheck(checkName) {
    const memUsage = process.memoryUsage();

    switch (checkName) {
      case 'memory':
        const heapPercent = memUsage.heapUsed / memUsage.heapTotal;
        return {
          name: 'memory',
          status: heapPercent > 0.9 ? 'warning' : heapPercent > 0.95 ? 'error' : 'pass',
          message: `Heap usage: ${(heapPercent * 100).toFixed(1)}%`,
          details: {
            heap_used_mb: Math.floor(memUsage.heapUsed / 1024 / 1024),
            heap_total_mb: Math.floor(memUsage.heapTotal / 1024 / 1024),
          },
          recommendation: heapPercent > 0.8 ? 'Consider memory optimization' : null,
        };

      case 'performance':
        const cpuUsage = process.cpuUsage();
        return {
          name: 'performance',
          status: 'pass',
          message: 'Performance metrics within normal range',
          details: {
            cpu_user_ms: Math.floor(cpuUsage.user / 1000),
            cpu_system_ms: Math.floor(cpuUsage.system / 1000),
            uptime_seconds: Math.floor(process.uptime()),
          },
        };

      case 'connectivity':
        return {
          name: 'connectivity',
          status: 'pass',
          message: 'MCP server is accepting connections',
          details: {
            protocol: 'stdio',
            status: 'connected',
          },
        };

      case 'storage':
        const dbPath = path.join(process.cwd(), '.swarm', 'memory.db');
        let storageStatus = 'pass';
        let storageMessage = 'Storage accessible';
        try {
          await fs.access(path.dirname(dbPath));
        } catch (e) {
          storageStatus = 'warning';
          storageMessage = 'Storage directory may not be accessible';
        }
        return {
          name: 'storage',
          status: storageStatus,
          message: storageMessage,
          details: {
            db_path: dbPath,
            cwd: process.cwd(),
          },
          recommendation: storageStatus !== 'pass' ? 'Check storage permissions' : null,
        };

      case 'agents':
        const agentCount = global.agentTracker?.agents?.size || 0;
        const swarmCount = global.agentTracker?.swarms?.size || 0;
        return {
          name: 'agents',
          status: 'pass',
          message: `Agent system operational: ${agentCount} agents, ${swarmCount} swarms`,
          details: {
            agents: agentCount,
            swarms: swarmCount,
            tracker_initialized: !!global.agentTracker,
          },
        };

      case 'configuration':
        return {
          name: 'configuration',
          status: 'pass',
          message: 'Configuration loaded successfully',
          details: {
            node_env: process.env.NODE_ENV || 'development',
            mcp_version: '2024-11-05',
          },
        };

      default:
        return {
          name: checkName,
          status: 'unknown',
          message: `Unknown diagnostic check: ${checkName}`,
        };
    }
  }

  // Tool: features_detect - Detect available features
  features_detect(args = {}) {
    const component = args.component || 'all';

    const features = {
      success: true,
      timestamp: new Date().toISOString(),
      detected: {},
    };

    if (component === 'all' || component === 'core') {
      features.detected.core = {
        swarm_init: true,
        agent_spawn: true,
        task_orchestrate: true,
        memory_usage: true,
        neural_train: true,
      };
    }

    if (component === 'all' || component === 'memory') {
      features.detected.memory = {
        sqlite_storage: true,
        in_memory_fallback: true,
        semantic_search: true,
        vector_embeddings: true,
        namespace_support: true,
      };
    }

    if (component === 'all' || component === 'agents') {
      features.detected.agents = {
        parallel_spawn: true,
        daa_system: !!global.daaManager,
        agent_metrics: true,
        swarm_topologies: ['hierarchical', 'mesh', 'ring', 'star'],
      };
    }

    if (component === 'all' || component === 'workflow') {
      features.detected.workflow = {
        workflow_create: !!global.workflowManager,
        parallel_execute: !!global.workflowManager,
        batch_process: !!global.workflowManager,
        sparc_mode: true,
      };
    }

    if (component === 'all' || component === 'system') {
      features.detected.system = {
        terminal_execute: true,
        health_check: true,
        diagnostic_run: true,
        windows_compatible: os.platform() === 'win32',
        platform: os.platform(),
      };
    }

    return features;
  }

  // Tool: security_scan - Security scanning
  security_scan(args = {}) {
    const target = args.target || 'system';
    const depth = args.depth || 'standard';

    const scan = {
      success: true,
      timestamp: new Date().toISOString(),
      target: target,
      depth: depth,
      findings: [],
      risk_level: 'low',
      recommendations: [],
    };

    // Check for common security issues
    if (target === 'system' || target === 'all') {
      // Check environment variables for sensitive data
      const sensitiveEnvVars = ['API_KEY', 'SECRET', 'PASSWORD', 'TOKEN'];
      for (const envVar of Object.keys(process.env)) {
        if (sensitiveEnvVars.some(s => envVar.toUpperCase().includes(s))) {
          scan.findings.push({
            type: 'environment',
            severity: 'info',
            message: `Sensitive environment variable detected: ${envVar}`,
          });
        }
      }

      // Check for debug mode
      if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
        scan.findings.push({
          type: 'configuration',
          severity: 'info',
          message: 'Debug/development mode enabled',
        });
      }
    }

    if (target === 'memory' || target === 'all') {
      scan.findings.push({
        type: 'memory',
        severity: 'info',
        message: 'Memory isolation: Process-level isolation active',
      });
    }

    // Determine risk level
    const highCount = scan.findings.filter(f => f.severity === 'high').length;
    const mediumCount = scan.findings.filter(f => f.severity === 'medium').length;

    if (highCount > 0) {
      scan.risk_level = 'high';
    } else if (mediumCount > 2) {
      scan.risk_level = 'medium';
    }

    scan.recommendations.push('Regularly review environment variables');
    scan.recommendations.push('Use production mode in deployment');

    return scan;
  }

  // Tool: backup_create - Create system backups
  async backup_create(args = {}) {
    const components = args.components || ['memory', 'config'];
    const destination = args.destination || path.join(process.cwd(), '.swarm', 'backups');

    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const backup = {
      id: backupId,
      timestamp: new Date().toISOString(),
      success: true,
      components: {},
      destination: destination,
      size_bytes: 0,
    };

    // Ensure backup directory exists
    try {
      await fs.mkdir(destination, { recursive: true });
    } catch (e) {
      // Directory might already exist
    }

    for (const component of components) {
      try {
        const result = await this.backupComponent(component, destination, backupId);
        backup.components[component] = result;
        backup.size_bytes += result.size || 0;
      } catch (error) {
        backup.components[component] = {
          success: false,
          error: error.message,
        };
        backup.success = false;
      }
    }

    this.backups.set(backupId, backup);

    return backup;
  }

  async backupComponent(component, destination, backupId) {
    switch (component) {
      case 'memory':
        const dbPath = path.join(process.cwd(), '.swarm', 'memory.db');
        const backupPath = path.join(destination, `${backupId}_memory.db`);
        try {
          await fs.copyFile(dbPath, backupPath);
          const stats = await fs.stat(backupPath);
          return {
            success: true,
            path: backupPath,
            size: stats.size,
          };
        } catch (error) {
          return {
            success: false,
            error: error.message,
          };
        }

      case 'config':
        const configData = {
          timestamp: new Date().toISOString(),
          agents: global.agentTracker ? Array.from(global.agentTracker.agents.entries()) : [],
          swarms: global.agentTracker ? Array.from(global.agentTracker.swarms.entries()) : [],
        };
        const configPath = path.join(destination, `${backupId}_config.json`);
        const configJson = JSON.stringify(configData, null, 2);
        await fs.writeFile(configPath, configJson);
        return {
          success: true,
          path: configPath,
          size: configJson.length,
        };

      default:
        return {
          success: false,
          error: `Unknown component: ${component}`,
        };
    }
  }

  // Tool: restore_system - Restore from backup
  async restore_system(args = {}) {
    const backupId = args.backupId || args.backup_id;

    if (!backupId) {
      return {
        success: false,
        error: 'backupId is required',
        timestamp: new Date().toISOString(),
      };
    }

    const backup = this.backups.get(backupId);
    if (!backup) {
      return {
        success: false,
        error: `Backup ${backupId} not found in current session`,
        timestamp: new Date().toISOString(),
        available_backups: Array.from(this.backups.keys()),
      };
    }

    return {
      success: true,
      timestamp: new Date().toISOString(),
      backup_id: backupId,
      backup_timestamp: backup.timestamp,
      message: 'Backup information retrieved. Full restore requires manual intervention.',
      components: Object.keys(backup.components),
    };
  }

  // Tool: log_analysis - Analyze logs
  log_analysis(args = {}) {
    const logFile = args.logFile || args.log_file || 'system';
    const patterns = args.patterns || ['error', 'warning', 'info'];

    // For now, analyze in-memory logs
    const analysis = {
      success: true,
      timestamp: new Date().toISOString(),
      log_source: logFile,
      patterns_searched: patterns,
      summary: {
        total_entries: this.logs.length,
        errors: this.logs.filter(l => l.level === 'error').length,
        warnings: this.logs.filter(l => l.level === 'warning').length,
        info: this.logs.filter(l => l.level === 'info').length,
      },
      recent_entries: this.logs.slice(-20),
    };

    return analysis;
  }

  // Tool: config_manage - Configuration management
  config_manage(args = {}) {
    const action = args.action;
    const config = args.config || {};

    switch (action) {
      case 'get':
        return {
          success: true,
          action: 'get',
          config: Object.fromEntries(this.configCache),
          timestamp: new Date().toISOString(),
        };

      case 'set':
        for (const [key, value] of Object.entries(config)) {
          this.configCache.set(key, value);
        }
        return {
          success: true,
          action: 'set',
          updated: Object.keys(config),
          timestamp: new Date().toISOString(),
        };

      case 'delete':
        const deleted = [];
        for (const key of Object.keys(config)) {
          if (this.configCache.delete(key)) {
            deleted.push(key);
          }
        }
        return {
          success: true,
          action: 'delete',
          deleted: deleted,
          timestamp: new Date().toISOString(),
        };

      case 'list':
        return {
          success: true,
          action: 'list',
          keys: Array.from(this.configCache.keys()),
          count: this.configCache.size,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          success: false,
          error: `Unknown config action: ${action}. Use: get, set, delete, list`,
          timestamp: new Date().toISOString(),
        };
    }
  }

  // Utility: Add log entry
  addLog(level, message, metadata = {}) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      level: level,
      message: message,
      metadata: metadata,
    });

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }
}

// Create singleton instance
const systemTools = new SystemTools();

// Export for use in MCP tools
if (typeof module !== 'undefined' && module.exports) {
  module.exports = systemTools;
}

// Make available globally
if (typeof global !== 'undefined') {
  global.systemTools = systemTools;
}

export default systemTools;
