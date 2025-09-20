/**
 * System Validator - Comprehensive validation of integrated Claude Flow MCP system
 * Created by System Coordinator for integrated system optimization
 */

import { getErrorMessage } from '../utils/error-handler.js';
import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';
import type { SystemComponents } from './system-startup-manager.js';
import type { CommunicationBridge } from './communication-bridge.js';
import type { PerformanceOptimizer } from './performance-optimizer.js';

export interface ValidationResult {
  component: string;
  passed: boolean;
  score: number; // 0-100
  issues: ValidationIssue[];
  warnings: string[];
  recommendations: string[];
  executionTime: number;
}

export interface ValidationIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'functionality' | 'performance' | 'security' | 'configuration' | 'integration';
  description: string;
  impact: string;
  solution: string;
}

export interface SystemValidationReport {
  overall: {
    passed: boolean;
    score: number;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    executionTime: number;
  };
  components: ValidationResult[];
  integrationTests: ValidationResult[];
  performanceTests: ValidationResult[];
  securityTests: ValidationResult[];
  summary: string;
  recommendations: string[];
  timestamp: number;
}

export interface ValidationConfig {
  includePerformanceTests: boolean;
  includeSecurityTests: boolean;
  includeIntegrationTests: boolean;
  performanceThresholds: {
    responseTime: number;
    memoryUsage: number;
    cpuUsage: number;
    errorRate: number;
  };
  timeout: number;
  retries: number;
}

export class SystemValidator {
  private eventBus: EventBus;
  private logger: Logger;
  private config: ValidationConfig;
  private components: SystemComponents;
  private communicationBridge?: CommunicationBridge;
  private performanceOptimizer?: PerformanceOptimizer;

  constructor(
    components: SystemComponents,
    config: Partial<ValidationConfig> = {}
  ) {
    this.components = components;
    this.eventBus = components.eventBus;
    this.logger = components.logger;

    this.config = {
      includePerformanceTests: true,
      includeSecurityTests: true,
      includeIntegrationTests: true,
      performanceThresholds: {
        responseTime: 1000,
        memoryUsage: 80,
        cpuUsage: 80,
        errorRate: 0.05
      },
      timeout: 30000,
      retries: 3,
      ...config
    };
  }

  /**
   * Set additional components for validation
   */
  setCommunicationBridge(bridge: CommunicationBridge): void {
    this.communicationBridge = bridge;
  }

  setPerformanceOptimizer(optimizer: PerformanceOptimizer): void {
    this.performanceOptimizer = optimizer;
  }

  /**
   * Run comprehensive system validation
   */
  async validateSystem(): Promise<SystemValidationReport> {
    const startTime = Date.now();
    this.logger.info('Starting comprehensive system validation');

    const results: ValidationResult[] = [];
    
    try {
      // Component validation
      const componentResults = await this.validateComponents();
      results.push(...componentResults);

      // Integration tests
      if (this.config.includeIntegrationTests) {
        const integrationResults = await this.validateIntegration();
        results.push(...integrationResults);
      }

      // Performance tests
      if (this.config.includePerformanceTests) {
        const performanceResults = await this.validatePerformance();
        results.push(...performanceResults);
      }

      // Security tests
      if (this.config.includeSecurityTests) {
        const securityResults = await this.validateSecurity();
        results.push(...securityResults);
      }

      // Generate report
      const report = this.generateReport(results, Date.now() - startTime);
      
      // Emit validation complete event
      this.eventBus.emit('system:validation:complete', {
        report,
        timestamp: Date.now()
      });

      this.logger.info(`System validation completed: ${report.overall.score}% score`);
      return report;

    } catch (error) {
      this.logger.error('System validation failed', error);
      throw error;
    }
  }

  /**
   * Validate all system components
   */
  private async validateComponents(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Validate EventBus
    results.push(await this.validateEventBus());

    // Validate Logger
    results.push(await this.validateLogger());

    // Validate ConfigManager
    results.push(await this.validateConfigManager());

    // Validate Orchestrator
    results.push(await this.validateOrchestrator());

    // Validate MemoryManager
    if (this.components.memoryManager) {
      results.push(await this.validateMemoryManager());
    }

    // Validate SwarmCoordinator
    if (this.components.swarmCoordinator) {
      results.push(await this.validateSwarmCoordinator());
    }

    // Validate HealthCheckManager
    if (this.components.healthCheckManager) {
      results.push(await this.validateHealthCheckManager());
    }

    // Validate PersistenceManager
    results.push(await this.validatePersistenceManager());

    return results;
  }

  /**
   * Validate EventBus component
   */
  private async validateEventBus(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test event emission and listening
      let eventReceived = false;
      const testListener = () => { eventReceived = true; };
      
      this.eventBus.on('test:validation', testListener);
      this.eventBus.emit('test:validation', { test: true });
      
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async processing
      
      if (!eventReceived) {
        issues.push({
          severity: 'critical',
          category: 'functionality',
          description: 'EventBus failed to emit/receive test event',
          impact: 'System communication will not work',
          solution: 'Check EventBus implementation and Node.js EventEmitter'
        });
      }

      this.eventBus.off('test:validation', testListener);

      // Check for memory leaks (too many listeners)
      const listenerCount = this.eventBus.listenerCount('test:validation');
      if (listenerCount > 10) {
        warnings.push('High number of event listeners detected - potential memory leak');
        recommendations.push('Review event listener cleanup in components');
      }

      const passed = issues.length === 0;
      const score = passed ? 100 : Math.max(0, 100 - (issues.length * 25));

      return {
        component: 'EventBus',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'functionality',
        description: `EventBus validation failed: ${getErrorMessage(error)}`,
        impact: 'EventBus is not functional',
        solution: 'Check EventBus initialization and implementation'
      });

      return {
        component: 'EventBus',
        passed: false,
        score: 0,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate Logger component
   */
  private async validateLogger(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test logging functionality
      this.logger.debug('Test debug message');
      this.logger.info('Test info message');
      this.logger.warn('Test warning message');
      this.logger.error('Test error message');

      // Logger is working if no exceptions thrown
      const passed = true;
      const score = 100;

      return {
        component: 'Logger',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'functionality',
        description: `Logger validation failed: ${getErrorMessage(error)}`,
        impact: 'System logging will not work properly',
        solution: 'Check Logger implementation and configuration'
      });

      return {
        component: 'Logger',
        passed: false,
        score: 25,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate ConfigManager component
   */
  private async validateConfigManager(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test configuration loading
      const config = this.components.configManager.getConfig();
      
      if (!config) {
        issues.push({
          severity: 'critical',
          category: 'configuration',
          description: 'ConfigManager returned null/undefined configuration',
          impact: 'System will not have proper configuration',
          solution: 'Check configuration file and loading process'
        });
      }

      // Check for required configuration sections
      const requiredSections = ['orchestrator', 'memory', 'swarm'];
      for (const section of requiredSections) {
        if (!config[section]) {
          warnings.push(`Missing configuration section: ${section}`);
          recommendations.push(`Add ${section} configuration section with appropriate defaults`);
        }
      }

      const passed = issues.length === 0;
      const score = passed ? Math.max(50, 100 - (warnings.length * 10)) : 0;

      return {
        component: 'ConfigManager',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'functionality',
        description: `ConfigManager validation failed: ${getErrorMessage(error)}`,
        impact: 'Configuration system is not functional',
        solution: 'Check ConfigManager implementation and file access permissions'
      });

      return {
        component: 'ConfigManager',
        passed: false,
        score: 0,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate Orchestrator component
   */
  private async validateOrchestrator(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test health check
      const health = await this.components.orchestrator.performHealthCheck();
      
      if (!health.healthy) {
        issues.push({
          severity: 'high',
          category: 'functionality',
          description: 'Orchestrator health check failed',
          impact: 'Orchestration functionality may be impaired',
          solution: 'Check orchestrator components and dependencies'
        });
      }

      // Check individual health components
      if (!health.memory) {
        issues.push({
          severity: 'medium',
          category: 'functionality',
          description: 'Orchestrator memory health check failed',
          impact: 'Memory management may not work properly',
          solution: 'Check memory manager initialization'
        });
      }

      if (!health.terminalPool) {
        warnings.push('Terminal pool health check failed');
        recommendations.push('Initialize terminal pool if needed for operations');
      }

      if (!health.mcp) {
        warnings.push('MCP health check failed');
        recommendations.push('Check MCP server connections and configuration');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = health.healthy ? 100 : Math.max(25, 100 - (issues.length * 20));

      return {
        component: 'Orchestrator',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'functionality',
        description: `Orchestrator validation failed: ${getErrorMessage(error)}`,
        impact: 'Orchestrator is not functional',
        solution: 'Check Orchestrator initialization and dependencies'
      });

      return {
        component: 'Orchestrator',
        passed: false,
        score: 0,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate MemoryManager component
   */
  private async validateMemoryManager(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test memory operations
      const testEntry = {
        id: 'test-validation-entry',
        content: 'Test validation content',
        type: 'test',
        metadata: { validation: true },
        timestamp: Date.now(),
        bankId: 'validation-bank'
      };

      // Test store operation
      await this.components.memoryManager!.store(testEntry);

      // Test retrieve operation
      const retrieved = await this.components.memoryManager!.retrieve(testEntry.id);
      
      if (!retrieved) {
        issues.push({
          severity: 'critical',
          category: 'functionality',
          description: 'MemoryManager failed to retrieve stored entry',
          impact: 'Memory storage/retrieval is not working',
          solution: 'Check memory backend implementation and database connectivity'
        });
      } else if (retrieved.content !== testEntry.content) {
        issues.push({
          severity: 'high',
          category: 'functionality',
          description: 'MemoryManager retrieved corrupted data',
          impact: 'Data integrity issues in memory storage',
          solution: 'Check serialization/deserialization and storage backend'
        });
      }

      // Test query operation
      const queryResults = await this.components.memoryManager!.query({
        type: 'test',
        limit: 10
      });

      if (!Array.isArray(queryResults)) {
        issues.push({
          severity: 'medium',
          category: 'functionality',
          description: 'MemoryManager query returned invalid results',
          impact: 'Memory search functionality is impaired',
          solution: 'Check query implementation and indexing'
        });
      }

      // Test health status
      const healthStatus = await this.components.memoryManager!.getHealthStatus();
      
      if (!healthStatus.healthy) {
        issues.push({
          severity: 'high',
          category: 'functionality',
          description: 'MemoryManager health check failed',
          impact: 'Memory system may be unstable',
          solution: healthStatus.error || 'Check memory manager logs for details'
        });
      }

      // Cleanup test data
      try {
        await this.components.memoryManager!.delete(testEntry.id);
      } catch (error) {
        warnings.push('Failed to cleanup test data - may cause memory bloat');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(75, 100 - (issues.length * 15)) : Math.max(0, 50 - (issues.length * 25));

      return {
        component: 'MemoryManager',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'functionality',
        description: `MemoryManager validation failed: ${getErrorMessage(error)}`,
        impact: 'Memory management is not functional',
        solution: 'Check MemoryManager initialization and backend configuration'
      });

      return {
        component: 'MemoryManager',
        passed: false,
        score: 0,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate SwarmCoordinator component
   */
  private async validateSwarmCoordinator(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test swarm status
      const status = await (this.components.swarmCoordinator as any).getStatus?.() || {};
      
      // Check if swarm is properly initialized
      if (!status.initialized) {
        warnings.push('SwarmCoordinator not fully initialized');
        recommendations.push('Complete swarm initialization before starting operations');
      }

      // Test agent management (if methods exist)
      const agentCount = (this.components.swarmCoordinator as any).getAgentCount?.() || 0;
      
      if (agentCount < 0) {
        issues.push({
          severity: 'medium',
          category: 'functionality',
          description: 'Invalid agent count in SwarmCoordinator',
          impact: 'Agent management may not work correctly',
          solution: 'Check agent tracking implementation'
        });
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(75, 100 - (warnings.length * 10)) : Math.max(25, 75 - (issues.length * 25));

      return {
        component: 'SwarmCoordinator',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'functionality',
        description: `SwarmCoordinator validation failed: ${getErrorMessage(error)}`,
        impact: 'Swarm coordination may not work properly',
        solution: 'Check SwarmCoordinator implementation and initialization'
      });

      return {
        component: 'SwarmCoordinator',
        passed: false,
        score: 25,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate HealthCheckManager component
   */
  private async validateHealthCheckManager(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test health check execution
      const healthResult = await this.components.healthCheckManager!.performHealthCheck();
      
      if (!healthResult.healthy) {
        warnings.push('System health check indicates issues');
        recommendations.push('Review health check results and address reported issues');
      }

      // Test metrics collection (if available)
      const metrics = await (this.components.healthCheckManager as any).getMetrics?.() || null;
      
      if (!metrics) {
        warnings.push('Health metrics not available');
        recommendations.push('Enable metrics collection in health check configuration');
      }

      const passed = issues.length === 0;
      const score = passed ? Math.max(80, 100 - (warnings.length * 10)) : Math.max(50, 80 - (issues.length * 20));

      return {
        component: 'HealthCheckManager',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'functionality',
        description: `HealthCheckManager validation failed: ${getErrorMessage(error)}`,
        impact: 'Health monitoring will not work properly',
        solution: 'Check HealthCheckManager implementation and dependencies'
      });

      return {
        component: 'HealthCheckManager',
        passed: false,
        score: 25,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate PersistenceManager component
   */
  private async validatePersistenceManager(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test basic persistence operations
      const testAgent = {
        id: 'test-validation-agent',
        type: 'validation',
        name: 'Test Agent',
        status: 'active',
        createdAt: Date.now()
      };

      // Test agent storage and retrieval
      await this.components.persistenceManager.saveAgent(testAgent);
      const retrievedAgent = await this.components.persistenceManager.getAgent(testAgent.id);
      
      if (!retrievedAgent) {
        issues.push({
          severity: 'critical',
          category: 'functionality',
          description: 'PersistenceManager failed to retrieve stored agent',
          impact: 'Data persistence is not working',
          solution: 'Check database connectivity and schema'
        });
      } else if (retrievedAgent.name !== testAgent.name) {
        issues.push({
          severity: 'high',
          category: 'functionality',
          description: 'PersistenceManager retrieved corrupted agent data',
          impact: 'Data integrity issues in persistence layer',
          solution: 'Check database serialization and schema consistency'
        });
      }

      // Cleanup test data
      try {
        await this.components.persistenceManager.deleteAgent(testAgent.id);
      } catch (error) {
        warnings.push('Failed to cleanup test persistence data');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? 100 : Math.max(0, 100 - (issues.length * 30));

      return {
        component: 'PersistenceManager',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'critical',
        category: 'functionality',
        description: `PersistenceManager validation failed: ${getErrorMessage(error)}`,
        impact: 'Data persistence is not functional',
        solution: 'Check PersistenceManager initialization and database configuration'
      });

      return {
        component: 'PersistenceManager',
        passed: false,
        score: 0,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate system integration
   */
  private async validateIntegration(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Test component communication
    results.push(await this.validateComponentCommunication());

    // Test end-to-end workflows
    results.push(await this.validateEndToEndWorkflow());

    // Test error handling integration
    results.push(await this.validateErrorHandling());

    return results;
  }

  /**
   * Validate component communication
   */
  private async validateComponentCommunication(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      if (this.communicationBridge) {
        // Test communication bridge health
        const commHealth = this.communicationBridge.getHealthStatus();
        
        if (!commHealth.healthy) {
          issues.push({
            severity: 'high',
            category: 'integration',
            description: 'Communication bridge is not healthy',
            impact: 'Inter-component communication may fail',
            solution: 'Check communication bridge status and resolve reported issues'
          });
        }

        // Test message passing
        try {
          await this.communicationBridge.sendMessage('memory', 'health_check', {}, { timeout: 5000 });
        } catch (error) {
          issues.push({
            severity: 'medium',
            category: 'integration',
            description: 'Failed to send test message through communication bridge',
            impact: 'Component communication may be unreliable',
            solution: 'Check message routing and component handlers'
          });
        }
      } else {
        warnings.push('Communication bridge not available for testing');
        recommendations.push('Initialize communication bridge for optimal component integration');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(70, 100 - (issues.length * 15)) : Math.max(30, 70 - (issues.length * 20));

      return {
        component: 'ComponentCommunication',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'integration',
        description: `Component communication validation failed: ${getErrorMessage(error)}`,
        impact: 'Component integration may not work properly',
        solution: 'Check component initialization and communication setup'
      });

      return {
        component: 'ComponentCommunication',
        passed: false,
        score: 30,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate end-to-end workflow
   */
  private async validateEndToEndWorkflow(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test a complete workflow: orchestrator -> memory -> response
      if (this.components.memoryManager) {
        // Store data via orchestrator workflow
        const testData = {
          id: 'e2e-test-entry',
          content: 'End-to-end test data',
          type: 'workflow-test',
          metadata: { workflow: 'validation' },
          timestamp: Date.now(),
          bankId: 'validation-workflow'
        };

        await this.components.memoryManager.store(testData);
        
        // Retrieve through different path
        const retrieved = await this.components.memoryManager.retrieve(testData.id);
        
        if (!retrieved) {
          issues.push({
            severity: 'high',
            category: 'integration',
            description: 'End-to-end workflow failed: data not retrievable',
            impact: 'Complete workflows may not function correctly',
            solution: 'Check data flow between components'
          });
        }

        // Cleanup
        await this.components.memoryManager.delete(testData.id);
      } else {
        warnings.push('Memory manager not available for end-to-end testing');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(80, 100 - (warnings.length * 10)) : Math.max(40, 80 - (issues.length * 20));

      return {
        component: 'EndToEndWorkflow',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'high',
        category: 'integration',
        description: `End-to-end workflow validation failed: ${getErrorMessage(error)}`,
        impact: 'Complete system workflows may not work',
        solution: 'Check component integration and data flow'
      });

      return {
        component: 'EndToEndWorkflow',
        passed: false,
        score: 20,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate error handling integration
   */
  private async validateErrorHandling(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Test error propagation and handling
      let errorHandled = false;
      
      const errorHandler = (error: any) => {
        errorHandled = true;
      };

      this.eventBus.on('system:error', errorHandler);

      // Trigger a controlled error
      try {
        if (this.components.memoryManager) {
          await this.components.memoryManager.retrieve('non-existent-id-that-should-not-exist');
        }
      } catch (error) {
        // Expected error
      }

      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for error propagation

      if (!errorHandled) {
        warnings.push('Error handling events may not be properly propagated');
        recommendations.push('Ensure all components emit error events to the system event bus');
      }

      this.eventBus.off('system:error', errorHandler);

      const passed = issues.length === 0;
      const score = passed ? Math.max(75, 100 - (warnings.length * 15)) : Math.max(25, 75 - (issues.length * 25));

      return {
        component: 'ErrorHandling',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'medium',
        category: 'integration',
        description: `Error handling validation failed: ${getErrorMessage(error)}`,
        impact: 'Error handling may not work consistently across components',
        solution: 'Review error handling implementation in all components'
      });

      return {
        component: 'ErrorHandling',
        passed: false,
        score: 25,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate system performance
   */
  private async validatePerformance(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    if (this.performanceOptimizer) {
      results.push(await this.validatePerformanceMetrics());
      results.push(await this.validateResourceUsage());
    } else {
      results.push({
        component: 'PerformanceValidation',
        passed: false,
        score: 0,
        issues: [{
          severity: 'medium',
          category: 'performance',
          description: 'Performance optimizer not available for validation',
          impact: 'Cannot validate system performance characteristics',
          solution: 'Initialize performance optimizer for comprehensive validation'
        }],
        warnings: [],
        recommendations: ['Enable performance monitoring for better system insights'],
        executionTime: 0
      });
    }

    return results;
  }

  /**
   * Validate performance metrics
   */
  private async validatePerformanceMetrics(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      const metrics = this.performanceOptimizer!.getMetrics();
      
      if (!metrics) {
        issues.push({
          severity: 'medium',
          category: 'performance',
          description: 'Performance metrics not available',
          impact: 'Cannot monitor system performance',
          solution: 'Check performance optimizer initialization and metrics collection'
        });
      } else {
        const thresholds = this.config.performanceThresholds;

        // Check response time
        if (metrics.performance.responseTime > thresholds.responseTime) {
          issues.push({
            severity: 'medium',
            category: 'performance',
            description: `High response time: ${metrics.performance.responseTime}ms`,
            impact: 'System may feel slow to users',
            solution: 'Optimize slow operations and implement caching'
          });
        }

        // Check memory usage
        const memUsagePercent = (metrics.system.memoryUsage / metrics.system.memoryLimit) * 100;
        if (memUsagePercent > thresholds.memoryUsage) {
          issues.push({
            severity: memUsagePercent > 90 ? 'high' : 'medium',
            category: 'performance',
            description: `High memory usage: ${memUsagePercent.toFixed(1)}%`,
            impact: 'Risk of out-of-memory errors',
            solution: 'Implement memory cleanup or increase memory limits'
          });
        }

        // Check error rate
        if (metrics.performance.errorRate > thresholds.errorRate) {
          issues.push({
            severity: 'high',
            category: 'performance',
            description: `High error rate: ${(metrics.performance.errorRate * 100).toFixed(1)}%`,
            impact: 'System reliability is compromised',
            solution: 'Investigate and fix sources of errors'
          });
        }
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(60, 100 - (issues.length * 20)) : Math.max(20, 60 - (issues.length * 15));

      return {
        component: 'PerformanceMetrics',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'medium',
        category: 'performance',
        description: `Performance metrics validation failed: ${getErrorMessage(error)}`,
        impact: 'Cannot assess system performance',
        solution: 'Check performance monitoring implementation'
      });

      return {
        component: 'PerformanceMetrics',
        passed: false,
        score: 20,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate resource usage
   */
  private async validateResourceUsage(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      const metrics = this.performanceOptimizer!.getMetrics();
      
      if (metrics) {
        // Check heap usage
        const heapUsagePercent = (metrics.resources.heapUsed / metrics.resources.heapTotal) * 100;
        if (heapUsagePercent > 80) {
          warnings.push(`High heap usage: ${heapUsagePercent.toFixed(1)}%`);
          recommendations.push('Monitor memory allocation patterns and implement heap optimization');
        }

        // Check external memory
        if (metrics.resources.external > 100 * 1024 * 1024) { // 100MB
          warnings.push(`High external memory usage: ${(metrics.resources.external / 1024 / 1024).toFixed(1)}MB`);
          recommendations.push('Review external memory usage from buffers and native modules');
        }

        // Check for memory leaks (growing trend)
        // This would require historical data to implement properly
      }

      const passed = issues.length === 0;
      const score = passed ? Math.max(70, 100 - (warnings.length * 10)) : Math.max(30, 70 - (issues.length * 20));

      return {
        component: 'ResourceUsage',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'medium',
        category: 'performance',
        description: `Resource usage validation failed: ${getErrorMessage(error)}`,
        impact: 'Cannot assess resource utilization',
        solution: 'Check resource monitoring implementation'
      });

      return {
        component: 'ResourceUsage',
        passed: false,
        score: 30,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate system security
   */
  private async validateSecurity(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    
    // Basic security validation
    results.push(await this.validateBasicSecurity());
    
    return results;
  }

  /**
   * Validate basic security measures
   */
  private async validateBasicSecurity(): Promise<ValidationResult> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check for secure configurations
      const config = this.components.configManager.getConfig();
      
      // Check logging configuration
      if (config.logging?.level === 'debug') {
        warnings.push('Debug logging enabled - may expose sensitive information');
        recommendations.push('Use appropriate log level for production environment');
      }

      // Check for default credentials or keys
      if (config.security?.jwtSecret === 'default-secret' || !config.security?.jwtSecret) {
        issues.push({
          severity: 'high',
          category: 'security',
          description: 'Default or missing JWT secret',
          impact: 'Authentication tokens can be forged',
          solution: 'Set a strong, unique JWT secret in production'
        });
      }

      // Check file permissions (basic check)
      try {
        const fs = await import('fs/promises');
        const stats = await fs.stat(process.cwd());
        // Basic file permission validation would go here
      } catch (error) {
        warnings.push('Could not validate file permissions');
      }

      const passed = issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0;
      const score = passed ? Math.max(60, 100 - (warnings.length * 10)) : Math.max(20, 60 - (issues.length * 20));

      return {
        component: 'BasicSecurity',
        passed,
        score,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      issues.push({
        severity: 'medium',
        category: 'security',
        description: `Security validation failed: ${getErrorMessage(error)}`,
        impact: 'Cannot assess system security posture',
        solution: 'Review security configuration and validation process'
      });

      return {
        component: 'BasicSecurity',
        passed: false,
        score: 20,
        issues,
        warnings,
        recommendations,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Generate comprehensive validation report
   */
  private generateReport(results: ValidationResult[], executionTime: number): SystemValidationReport {
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    
    // Calculate overall score
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const overallScore = totalTests > 0 ? Math.round(totalScore / totalTests) : 0;
    
    // Categorize results
    const componentResults = results.filter(r => 
      !r.component.includes('Communication') && 
      !r.component.includes('Workflow') && 
      !r.component.includes('Performance') && 
      !r.component.includes('Security')
    );
    
    const integrationResults = results.filter(r => 
      r.component.includes('Communication') || 
      r.component.includes('Workflow') || 
      r.component.includes('ErrorHandling')
    );
    
    const performanceResults = results.filter(r => 
      r.component.includes('Performance') || 
      r.component.includes('Resource')
    );
    
    const securityResults = results.filter(r => 
      r.component.includes('Security')
    );

    // Generate summary
    const criticalIssues = results.flatMap(r => r.issues.filter(i => i.severity === 'critical')).length;
    const highIssues = results.flatMap(r => r.issues.filter(i => i.severity === 'high')).length;
    
    let summary = `System validation completed with ${overallScore}% overall score. `;
    
    if (criticalIssues > 0) {
      summary += `${criticalIssues} critical issues found requiring immediate attention. `;
    }
    
    if (highIssues > 0) {
      summary += `${highIssues} high-severity issues identified. `;
    }
    
    if (overallScore >= 90) {
      summary += 'System is in excellent condition.';
    } else if (overallScore >= 75) {
      summary += 'System is in good condition with minor issues.';
    } else if (overallScore >= 60) {
      summary += 'System has moderate issues that should be addressed.';
    } else {
      summary += 'System has significant issues requiring immediate attention.';
    }

    // Generate top recommendations
    const allRecommendations = results.flatMap(r => r.recommendations);
    const topRecommendations = [...new Set(allRecommendations)].slice(0, 5);

    return {
      overall: {
        passed: criticalIssues === 0 && highIssues === 0,
        score: overallScore,
        totalTests,
        passedTests,
        failedTests,
        executionTime
      },
      components: componentResults,
      integrationTests: integrationResults,
      performanceTests: performanceResults,
      securityTests: securityResults,
      summary,
      recommendations: topRecommendations,
      timestamp: Date.now()
    };
  }
}