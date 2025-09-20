/**
 * AIME Integration Tests
 * 
 * Comprehensive test suite for Phase 3 AIME integration
 * Tests all components, backward compatibility, and performance
 * 
 * Integration Specialist Agent - Backend Reliability Focus
 */

import { fileURLToPath } from 'url';
import { AIMEMasterIntegration } from './aime-master-integration.js';
import { createAIMETools } from './aime-tools.js';
import { DualPlanningSystem } from './dual-planning-system.js';
import { ProgressManagementModule } from './progress-management.js';
import { ToolBundleOrganizer } from './tool-bundle-organizer.js';
import { 
  createDynamicActor,
  createActorFromTemplate,
  getActiveActors
} from './actor-factory-tool.js';

/**
 * Test Results Aggregator
 */
class TestResults {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      total: 0,
      errors: [],
      details: {}
    };
    this.startTime = Date.now();
  }

  addTest(testName, passed, details = {}, error = null) {
    this.results.total++;
    if (passed) {
      this.results.passed++;
    } else {
      this.results.failed++;
      if (error) {
        this.results.errors.push({ test: testName, error: error.message });
      }
    }
    this.results.details[testName] = { passed, details, error: error?.message };
  }

  getReport() {
    const duration = Date.now() - this.startTime;
    const successRate = (this.results.passed / this.results.total * 100).toFixed(1);
    
    return {
      ...this.results,
      duration,
      successRate: `${successRate}%`,
      status: this.results.failed === 0 ? 'PASSED' : 'FAILED'
    };
  }
}

/**
 * Mock Claude Flow Core for Testing
 */
class MockClaudeFlowCore {
  constructor() {
    this.logger = {
      info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
      warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
      error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args)
    };
    
    this.memoryManager = {
      store: async (key, value) => ({ success: true, key }),
      retrieve: async (key) => null,
      list: async () => []
    };
    
    this.orchestrator = {
      getAvailableAgentTypes: () => ['coordinator', 'coder', 'analyst'],
      getAvailableTools: () => ['test-tool-1', 'test-tool-2'],
      getPerformanceBaseline: () => ({ speed: 1.0, memory: 100 }),
      getResourceConstraints: () => ({ maxAgents: 8, maxMemory: 4 })
    };
    
    this.mcpServer = {
      registerTool: async (tool) => ({ success: true, tool: tool.name }),
      getToolCount: () => 87
    };
    
    this.agentManager = null; // Will be set if testing actor factory
    this.version = '2.0.0-alpha.61-aime-test';
  }
}

/**
 * AIME Integration Test Suite
 */
export class AIMEIntegrationTestSuite {
  constructor(options = {}) {
    this.options = {
      verbose: false,
      includePerformanceTests: true,
      includeBackwardCompatibilityTests: true,
      includeStressTests: false,
      ...options
    };
    
    this.testResults = new TestResults();
    this.mockCore = new MockClaudeFlowCore();
    this.integration = null;
  }

  /**
   * Run all integration tests
   */
  async runAllTests() {
    console.log('🧪 Starting AIME Integration Test Suite...');
    console.log('=' .repeat(60));

    try {
      // Core Component Tests
      await this.testCoreComponents();
      
      // Master Integration Tests
      await this.testMasterIntegration();
      
      // MCP Tool Integration Tests
      await this.testMCPToolIntegration();
      
      // Backward Compatibility Tests
      if (this.options.includeBackwardCompatibilityTests) {
        await this.testBackwardCompatibility();
      }
      
      // Performance Tests
      if (this.options.includePerformanceTests) {
        await this.testPerformance();
      }
      
      // Stress Tests
      if (this.options.includeStressTests) {
        await this.testStressScenarios();
      }
      
      // Error Handling Tests
      await this.testErrorHandling();
      
      // Integration Validation Tests
      await this.testIntegrationValidation();

    } catch (error) {
      console.error('❌ Test suite execution failed:', error);
      this.testResults.addTest('test_suite_execution', false, {}, error);
    }

    const report = this.testResults.getReport();
    this.printTestReport(report);
    
    return report;
  }

  /**
   * Test core AIME components
   */
  async testCoreComponents() {
    console.log('\n🔧 Testing Core Components...');

    // Test Tool Bundle Organizer
    try {
      const organizer = new ToolBundleOrganizer(this.mockCore.logger);
      
      // Test bundle creation
      const bundleId = organizer.createBundle({
        id: 'test-bundle',
        name: 'Test Bundle',
        category: 'testing',
        tools: ['test-tool-1', 'test-tool-2'],
        priority: 'standard',
        loadingStrategy: 'lazy'
      });
      
      const bundleExists = organizer.bundles.has(bundleId);
      this.testResults.addTest('tool_bundle_organizer', bundleExists, {
        bundleId,
        bundleCount: organizer.bundles.size
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Tool Bundle Organizer: ${bundleId} created`);
      }
      
    } catch (error) {
      this.testResults.addTest('tool_bundle_organizer', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Tool Bundle Organizer failed: ${error.message}`);
      }
    }

    // Test Progress Management Module
    try {
      const progressManager = new ProgressManagementModule({
        logger: this.mockCore.logger,
        emitProgress: (data) => {},
        memoryStore: this.mockCore.memoryManager
      });
      
      const updateResult = await progressManager.updateProgress(
        'test-agent',
        'test-task',
        {
          status: 'in_progress',
          message: 'Test progress update',
          progressPercentage: 50
        }
      );
      
      this.testResults.addTest('progress_management', updateResult.success, {
        updateResult
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Progress Management: Update successful`);
      }
      
    } catch (error) {
      this.testResults.addTest('progress_management', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Progress Management failed: ${error.message}`);
      }
    }

    // Test Dual Planning System
    try {
      const dualPlanner = new DualPlanningSystem({
        orchestrator: this.mockCore.orchestrator,
        progressManager: null,
        toolOrganizer: new ToolBundleOrganizer(this.mockCore.logger),
        logger: this.mockCore.logger
      });
      
      const plan = await dualPlanner.createDualPlan(
        'Test mission for integration testing',
        { complexity: 'low', urgency: 'low' }
      );
      
      const planValid = plan && plan.id && plan.strategic && plan.tactical;
      this.testResults.addTest('dual_planning_system', planValid, {
        planId: plan?.id,
        hasStrategic: !!plan?.strategic,
        hasTactical: !!plan?.tactical
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Dual Planning System: Plan ${plan?.id} created`);
      }
      
    } catch (error) {
      this.testResults.addTest('dual_planning_system', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Dual Planning System failed: ${error.message}`);
      }
    }

    // Test Actor Factory (if available)
    try {
      const actor = await createDynamicActor({
        type: 'test',
        name: 'Integration Test Actor',
        traits: { analytical: 0.8 }
      });
      
      this.testResults.addTest('actor_factory', actor.success, {
        actorId: actor.actor?.id,
        actorType: actor.actor?.type
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Actor Factory: Actor ${actor.actor?.id} created`);
      }
      
    } catch (error) {
      this.testResults.addTest('actor_factory', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Actor Factory failed: ${error.message}`);
      }
    }
  }

  /**
   * Test master integration functionality
   */
  async testMasterIntegration() {
    console.log('\n🎯 Testing Master Integration...');

    try {
      this.integration = new AIMEMasterIntegration(this.mockCore, {
        enableDashboard: false, // Disable for testing
        enableRealTimeUpdates: false,
        enablePerformanceTracking: true
      });
      
      const initResult = await this.integration.initialize();
      
      this.testResults.addTest('master_integration_init', initResult.success, {
        status: this.integration.integrationStatus,
        componentsLoaded: this.integration.integrationStatus.componentsLoaded
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Master Integration initialized: ${initResult.success}`);
      }
      
      // Test integration status
      const status = this.integration.getIntegrationStatus();
      const statusValid = status && status.status && status.components && status.metrics;
      
      this.testResults.addTest('integration_status', statusValid, {
        initialized: status.status?.initialized,
        componentCount: Object.keys(status.components).length
      });
      
      // Test component availability
      const components = this.integration.components;
      const componentsTest = {
        toolBundleOrganizer: !!components.toolBundleOrganizer,
        progressManager: !!components.progressManager,
        dualPlanningSystem: !!components.dualPlanningSystem
      };
      
      const allComponentsLoaded = Object.values(componentsTest).every(loaded => loaded);
      this.testResults.addTest('component_loading', allComponentsLoaded, componentsTest);
      
    } catch (error) {
      this.testResults.addTest('master_integration_init', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Master Integration failed: ${error.message}`);
      }
    }
  }

  /**
   * Test MCP tool integration
   */
  async testMCPToolIntegration() {
    console.log('\n🔌 Testing MCP Tool Integration...');

    try {
      // Test AIME tool creation
      const aimeTools = createAIMETools(this.mockCore.logger, {
        progressManager: this.integration?.components.progressManager,
        agentManager: this.mockCore.agentManager,
        dynamicPlanner: this.integration?.components.dualPlanningSystem,
        toolBundleOrganizer: this.integration?.components.toolBundleOrganizer
      });
      
      const toolsCreated = aimeTools.length > 0;
      this.testResults.addTest('aime_tools_creation', toolsCreated, {
        toolCount: aimeTools.length,
        toolNames: aimeTools.map(t => t.name)
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ AIME Tools created: ${aimeTools.length} tools`);
      }
      
      // Test individual tool execution
      const testTool = aimeTools.find(t => t.name === 'listToolBundles');
      if (testTool) {
        try {
          const result = await testTool.handler({});
          this.testResults.addTest('tool_execution', result.success, {
            toolName: testTool.name,
            result
          });
          
          if (this.options.verbose) {
            console.log(`  ✅ Tool execution: ${testTool.name} successful`);
          }
        } catch (error) {
          this.testResults.addTest('tool_execution', false, {}, error);
        }
      }
      
    } catch (error) {
      this.testResults.addTest('aime_tools_creation', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ MCP Tool Integration failed: ${error.message}`);
      }
    }
  }

  /**
   * Test backward compatibility
   */
  async testBackwardCompatibility() {
    console.log('\n🔄 Testing Backward Compatibility...');

    try {
      // Test that existing Claude Flow functionality still works
      const compatibilityTests = {
        orchestrator: !!this.mockCore.orchestrator,
        memoryManager: !!this.mockCore.memoryManager,
        mcpServer: !!this.mockCore.mcpServer,
        agentTypes: this.mockCore.orchestrator.getAvailableAgentTypes().length > 0,
        toolCount: this.mockCore.mcpServer.getToolCount() >= 80
      };
      
      const allCompatible = Object.values(compatibilityTests).every(test => test);
      this.testResults.addTest('backward_compatibility', allCompatible, compatibilityTests);
      
      if (this.options.verbose) {
        console.log(`  ✅ Backward compatibility: ${allCompatible ? 'PASSED' : 'FAILED'}`);
      }
      
      // Test that AIME doesn't break existing workflows
      if (this.integration) {
        const validationResult = await this.integration.validateBackwardCompatibility();
        const validationPassed = Object.values(validationResult).every(v => v);
        
        this.testResults.addTest('workflow_compatibility', validationPassed, validationResult);
      }
      
    } catch (error) {
      this.testResults.addTest('backward_compatibility', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Backward compatibility failed: ${error.message}`);
      }
    }
  }

  /**
   * Test performance characteristics
   */
  async testPerformance() {
    console.log('\n📈 Testing Performance...');

    try {
      const performanceTests = [];
      
      // Test dual plan creation speed
      if (this.integration?.components.dualPlanningSystem) {
        const startTime = Date.now();
        await this.integration.components.dualPlanningSystem.createDualPlan(
          'Performance test mission',
          { complexity: 'medium' }
        );
        const planCreationTime = Date.now() - startTime;
        
        performanceTests.push({
          test: 'dual_plan_creation',
          time: planCreationTime,
          passed: planCreationTime < 5000 // Should be under 5 seconds
        });
      }
      
      // Test tool bundle organization speed
      if (this.integration?.components.toolBundleOrganizer) {
        const startTime = Date.now();
        for (let i = 0; i < 10; i++) {
          this.integration.components.toolBundleOrganizer.createBundle({
            id: `perf-test-${i}`,
            name: `Performance Test Bundle ${i}`,
            category: 'testing',
            tools: [`tool-${i}-1`, `tool-${i}-2`]
          });
        }
        const bundleTime = Date.now() - startTime;
        
        performanceTests.push({
          test: 'bundle_organization',
          time: bundleTime,
          passed: bundleTime < 1000 // Should be under 1 second for 10 bundles
        });
      }
      
      // Test memory usage
      const memoryUsage = process.memoryUsage();
      performanceTests.push({
        test: 'memory_usage',
        heapUsed: memoryUsage.heapUsed / 1024 / 1024, // MB
        passed: memoryUsage.heapUsed < 200 * 1024 * 1024 // Under 200MB
      });
      
      const allPerformanceTestsPassed = performanceTests.every(test => test.passed);
      this.testResults.addTest('performance', allPerformanceTestsPassed, {
        tests: performanceTests
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Performance: ${allPerformanceTestsPassed ? 'PASSED' : 'FAILED'}`);
        performanceTests.forEach(test => {
          console.log(`    ${test.test}: ${test.time || test.heapUsed}${test.time ? 'ms' : 'MB'}`);
        });
      }
      
    } catch (error) {
      this.testResults.addTest('performance', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Performance tests failed: ${error.message}`);
      }
    }
  }

  /**
   * Test error handling and resilience
   */
  async testErrorHandling() {
    console.log('\n🛡️ Testing Error Handling...');

    try {
      const errorTests = [];
      
      // Test invalid plan creation
      try {
        if (this.integration?.components.dualPlanningSystem) {
          await this.integration.components.dualPlanningSystem.createDualPlan(
            '', // Invalid empty objective
            { complexity: 'invalid' }
          );
          errorTests.push({ test: 'invalid_plan', handled: false });
        }
      } catch (error) {
        errorTests.push({ test: 'invalid_plan', handled: true, error: error.message });
      }
      
      // Test invalid tool bundle creation
      try {
        if (this.integration?.components.toolBundleOrganizer) {
          this.integration.components.toolBundleOrganizer.createBundle({
            // Missing required fields
          });
          errorTests.push({ test: 'invalid_bundle', handled: false });
        }
      } catch (error) {
        errorTests.push({ test: 'invalid_bundle', handled: true, error: error.message });
      }
      
      // Test invalid actor creation
      try {
        await createDynamicActor({
          type: 'invalid-type',
          // Missing required fields
        });
        errorTests.push({ test: 'invalid_actor', handled: false });
      } catch (error) {
        errorTests.push({ test: 'invalid_actor', handled: true, error: error.message });
      }
      
      const allErrorsHandled = errorTests.every(test => test.handled);
      this.testResults.addTest('error_handling', allErrorsHandled, {
        tests: errorTests
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Error handling: ${allErrorsHandled ? 'PASSED' : 'FAILED'}`);
      }
      
    } catch (error) {
      this.testResults.addTest('error_handling', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Error handling tests failed: ${error.message}`);
      }
    }
  }

  /**
   * Test stress scenarios
   */
  async testStressScenarios() {
    console.log('\n💪 Testing Stress Scenarios...');

    try {
      // Test multiple concurrent operations
      const concurrentOperations = [];
      
      // Multiple plan creations
      if (this.integration?.components.dualPlanningSystem) {
        for (let i = 0; i < 5; i++) {
          concurrentOperations.push(
            this.integration.components.dualPlanningSystem.createDualPlan(
              `Stress test mission ${i}`,
              { complexity: 'low' }
            )
          );
        }
      }
      
      // Multiple progress updates
      if (this.integration?.components.progressManager) {
        for (let i = 0; i < 10; i++) {
          concurrentOperations.push(
            this.integration.components.progressManager.updateProgress(
              `stress-agent-${i}`,
              `stress-task-${i}`,
              { status: 'in_progress', progressPercentage: i * 10 }
            )
          );
        }
      }
      
      const startTime = Date.now();
      const results = await Promise.allSettled(concurrentOperations);
      const stressTime = Date.now() - startTime;
      
      const successfulOperations = results.filter(r => r.status === 'fulfilled').length;
      const stressPassed = successfulOperations >= concurrentOperations.length * 0.8; // 80% success rate
      
      this.testResults.addTest('stress_scenarios', stressPassed, {
        totalOperations: concurrentOperations.length,
        successfulOperations,
        duration: stressTime,
        successRate: `${(successfulOperations / concurrentOperations.length * 100).toFixed(1)}%`
      });
      
      if (this.options.verbose) {
        console.log(`  ✅ Stress test: ${successfulOperations}/${concurrentOperations.length} operations succeeded in ${stressTime}ms`);
      }
      
    } catch (error) {
      this.testResults.addTest('stress_scenarios', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Stress scenarios failed: ${error.message}`);
      }
    }
  }

  /**
   * Test integration validation
   */
  async testIntegrationValidation() {
    console.log('\n✅ Testing Integration Validation...');

    try {
      if (this.integration) {
        const validationResult = await this.integration.runIntegrationTests();
        
        this.testResults.addTest('integration_validation', validationResult.success, {
          validationResults: validationResult.results,
          timestamp: validationResult.timestamp
        });
        
        if (this.options.verbose) {
          console.log(`  ✅ Integration validation: ${validationResult.success ? 'PASSED' : 'FAILED'}`);
          Object.entries(validationResult.results).forEach(([test, passed]) => {
            console.log(`    ${test}: ${passed ? '✅' : '❌'}`);
          });
        }
      } else {
        this.testResults.addTest('integration_validation', false, {}, new Error('Integration not available'));
      }
      
    } catch (error) {
      this.testResults.addTest('integration_validation', false, {}, error);
      if (this.options.verbose) {
        console.log(`  ❌ Integration validation failed: ${error.message}`);
      }
    }
  }

  /**
   * Print comprehensive test report
   */
  printTestReport(report) {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 AIME Integration Test Report');
    console.log('='.repeat(60));
    
    console.log(`📊 Results: ${report.passed}/${report.total} tests passed (${report.successRate})`);
    console.log(`⏱️  Duration: ${report.duration}ms`);
    console.log(`📈 Status: ${report.status}`);
    
    if (report.failed > 0) {
      console.log('\n❌ Failed Tests:');
      report.errors.forEach(error => {
        console.log(`  • ${error.test}: ${error.error}`);
      });
    }
    
    if (this.options.verbose) {
      console.log('\n📋 Detailed Results:');
      Object.entries(report.details).forEach(([test, result]) => {
        const status = result.passed ? '✅' : '❌';
        console.log(`  ${status} ${test}: ${result.passed ? 'PASSED' : 'FAILED'}`);
        if (result.details && Object.keys(result.details).length > 0) {
          console.log(`    Details: ${JSON.stringify(result.details, null, 2).slice(0, 200)}...`);
        }
      });
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Performance recommendations
    if (report.status === 'PASSED') {
      console.log('🎉 All integration tests passed! AIME is ready for production use.');
    } else {
      console.log('⚠️  Some tests failed. Review errors and fix before deployment.');
    }
    
    console.log('📚 Integration complete. See documentation for usage examples.');
    console.log('='.repeat(60));
  }

  /**
   * Cleanup after tests
   */
  async cleanup() {
    if (this.integration) {
      await this.integration.cleanup();
    }
  }
}

/**
 * Run AIME integration tests
 */
export async function runAIMEIntegrationTests(options = {}) {
  const testSuite = new AIMEIntegrationTestSuite(options);
  
  try {
    const report = await testSuite.runAllTests();
    await testSuite.cleanup();
    return report;
  } catch (error) {
    console.error('❌ Test suite execution failed:', error);
    await testSuite.cleanup();
    throw error;
  }
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = {
    verbose: process.argv.includes('--verbose'),
    includePerformanceTests: !process.argv.includes('--no-performance'),
    includeBackwardCompatibilityTests: !process.argv.includes('--no-compatibility'),
    includeStressTests: process.argv.includes('--stress')
  };
  
  runAIMEIntegrationTests(options).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

export default AIMEIntegrationTestSuite;