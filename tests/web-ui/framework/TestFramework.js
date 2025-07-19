/**
 * Comprehensive Test Framework for Gemini Flow Web UI
 * Base framework for testing all 71+ MCP tools and UI components
 */

const { EventEmitter } = require('events');
const testConfig = require('../test-config');

class TestFramework extends EventEmitter {
  constructor() {
    super();
    this.testResults = new Map();
    this.coverage = {
      tools: new Set(),
      views: new Set(),
      components: new Set(),
      interactions: new Set()
    };
    this.startTime = null;
    this.isRunning = false;
  }

  /**
   * Initialize test framework
   */
  async initialize() {
    console.log('🧪 Initializing Gemini Flow Test Framework');
    console.log(`📊 Testing ${this.getTotalToolCount()} tools across ${Object.keys(testConfig.testCategories).length} categories`);
    
    this.startTime = Date.now();
    this.isRunning = true;
    
    // Setup test environment
    await this.setupEnvironment();
    
    // Load test utilities
    await this.loadUtilities();
    
    this.emit('initialized');
  }

  /**
   * Get total tool count
   */
  getTotalToolCount() {
    return Object.values(testConfig.testCategories)
      .reduce((total, cat) => total + cat.tools, 0);
  }

  /**
   * Setup test environment
   */
  async setupEnvironment() {
    // Mock browser environment if needed
    if (typeof window === 'undefined') {
      global.window = {
        localStorage: new Map(),
        sessionStorage: new Map(),
        location: { href: 'http://localhost:3000' },
        document: {
          createElement: () => ({ style: {}, appendChild: () => {} }),
          getElementById: () => null,
          querySelector: () => null,
          head: { appendChild: () => {} }
        }
      };
      global.document = global.window.document;
    }
    
    // Setup MCP mock server
    await this.setupMCPMockServer();
  }

  /**
   * Setup MCP mock server for testing
   */
  async setupMCPMockServer() {
    this.mcpMock = {
      tools: new Map(),
      responses: new Map(),
      latency: 50, // Simulated latency
      
      execute: async (toolName, params) => {
        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, this.mcpMock.latency));
        
        // Track tool usage
        this.coverage.tools.add(toolName);
        
        // Return mock response
        const mockResponse = this.mcpMock.responses.get(toolName);
        if (mockResponse) {
          return typeof mockResponse === 'function' ? mockResponse(params) : mockResponse;
        }
        
        // Default response
        return {
          success: true,
          tool: toolName,
          params: params,
          timestamp: Date.now(),
          mock: true
        };
      }
    };
  }

  /**
   * Load test utilities
   */
  async loadUtilities() {
    this.utils = {
      // Wait for element
      waitForElement: async (selector, timeout = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Element ${selector} not found within ${timeout}ms`);
      },
      
      // Simulate user interaction
      simulateClick: (element) => {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        element.dispatchEvent(event);
      },
      
      // Measure performance
      measurePerformance: async (fn, name) => {
        const start = performance.now();
        const memStart = performance.memory?.usedJSHeapSize || 0;
        
        const result = await fn();
        
        const duration = performance.now() - start;
        const memUsed = (performance.memory?.usedJSHeapSize || 0) - memStart;
        
        return {
          name,
          duration,
          memoryUsed: memUsed / 1024 / 1024, // MB
          result
        };
      },
      
      // Generate test data
      generateTestData: (type) => {
        return testConfig.testData[type] ? testConfig.testData[type]() : {};
      }
    };
  }

  /**
   * Run test suite
   */
  async runTestSuite(suite) {
    console.log(`\n🔧 Running test suite: ${suite.name}`);
    const suiteResults = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      coverage: {
        tools: new Set(),
        views: new Set()
      }
    };
    
    const suiteStart = Date.now();
    
    for (const test of suite.tests) {
      try {
        if (test.skip) {
          suiteResults.skipped++;
          continue;
        }
        
        const result = await this.runTest(test);
        suiteResults.tests.push(result);
        
        if (result.passed) {
          suiteResults.passed++;
        } else {
          suiteResults.failed++;
        }
        
        // Update coverage
        result.coverage?.tools?.forEach(tool => {
          this.coverage.tools.add(tool);
          suiteResults.coverage.tools.add(tool);
        });
        
        result.coverage?.views?.forEach(view => {
          this.coverage.views.add(view);
          suiteResults.coverage.views.add(view);
        });
        
      } catch (error) {
        console.error(`❌ Test error: ${test.name}`, error);
        suiteResults.failed++;
        suiteResults.tests.push({
          name: test.name,
          passed: false,
          error: error.message,
          duration: 0
        });
      }
    }
    
    suiteResults.duration = Date.now() - suiteStart;
    this.testResults.set(suite.name, suiteResults);
    
    console.log(`✅ Suite completed: ${suiteResults.passed} passed, ${suiteResults.failed} failed, ${suiteResults.skipped} skipped`);
    
    return suiteResults;
  }

  /**
   * Run individual test
   */
  async runTest(test) {
    console.log(`  📝 ${test.name}`);
    const testStart = Date.now();
    
    const result = {
      name: test.name,
      passed: false,
      duration: 0,
      assertions: [],
      coverage: {
        tools: new Set(),
        views: new Set()
      }
    };
    
    try {
      // Setup test context
      const context = this.createTestContext(test);
      
      // Run before hook
      if (test.before) {
        await test.before(context);
      }
      
      // Run test
      await test.fn(context);
      
      // Run after hook
      if (test.after) {
        await test.after(context);
      }
      
      // Check assertions
      result.passed = context.assertions.every(a => a.passed);
      result.assertions = context.assertions;
      result.coverage = context.coverage;
      
    } catch (error) {
      result.error = error.message;
      result.stack = error.stack;
      result.passed = false;
    }
    
    result.duration = Date.now() - testStart;
    
    const status = result.passed ? '✅' : '❌';
    console.log(`    ${status} ${result.duration}ms`);
    
    return result;
  }

  /**
   * Create test context
   */
  createTestContext(test) {
    const context = {
      test: test,
      assertions: [],
      coverage: {
        tools: new Set(),
        views: new Set()
      },
      
      // Assertion helpers
      assert: {
        equal: (actual, expected, message) => {
          const passed = actual === expected;
          context.assertions.push({
            type: 'equal',
            actual,
            expected,
            passed,
            message: message || `Expected ${actual} to equal ${expected}`
          });
          if (!passed) throw new Error(message || `Assertion failed: ${actual} !== ${expected}`);
        },
        
        truthy: (value, message) => {
          const passed = !!value;
          context.assertions.push({
            type: 'truthy',
            value,
            passed,
            message: message || `Expected ${value} to be truthy`
          });
          if (!passed) throw new Error(message || `Expected truthy value, got ${value}`);
        },
        
        includes: (array, item, message) => {
          const passed = array.includes(item);
          context.assertions.push({
            type: 'includes',
            array,
            item,
            passed,
            message: message || `Expected array to include ${item}`
          });
          if (!passed) throw new Error(message || `Array does not include ${item}`);
        },
        
        throws: async (fn, message) => {
          let threw = false;
          try {
            await fn();
          } catch (e) {
            threw = true;
          }
          context.assertions.push({
            type: 'throws',
            threw,
            passed: threw,
            message: message || `Expected function to throw`
          });
          if (!threw) throw new Error(message || `Expected function to throw`);
        }
      },
      
      // Test utilities
      utils: this.utils,
      
      // MCP mock
      mcp: this.mcpMock,
      
      // Track coverage
      trackTool: (toolName) => {
        context.coverage.tools.add(toolName);
      },
      
      trackView: (viewName) => {
        context.coverage.views.add(viewName);
      }
    };
    
    return context;
  }

  /**
   * Generate test report
   */
  generateReport() {
    const duration = Date.now() - this.startTime;
    const totalTests = Array.from(this.testResults.values())
      .reduce((sum, suite) => sum + suite.tests.length, 0);
    const totalPassed = Array.from(this.testResults.values())
      .reduce((sum, suite) => sum + suite.passed, 0);
    const totalFailed = Array.from(this.testResults.values())
      .reduce((sum, suite) => sum + suite.failed, 0);
    
    const report = {
      summary: {
        duration,
        totalSuites: this.testResults.size,
        totalTests,
        passed: totalPassed,
        failed: totalFailed,
        successRate: (totalPassed / totalTests * 100).toFixed(2) + '%'
      },
      coverage: {
        tools: {
          tested: this.coverage.tools.size,
          total: this.getTotalToolCount(),
          percentage: (this.coverage.tools.size / this.getTotalToolCount() * 100).toFixed(2) + '%'
        },
        views: {
          tested: this.coverage.views.size,
          total: Object.values(testConfig.testCategories).flatMap(c => c.views).length,
          percentage: (this.coverage.views.size / Object.values(testConfig.testCategories).flatMap(c => c.views).length * 100).toFixed(2) + '%'
        }
      },
      suites: Array.from(this.testResults.values()),
      failedTests: this.getFailedTests(),
      slowTests: this.getSlowTests(),
      timestamp: new Date().toISOString()
    };
    
    return report;
  }

  /**
   * Get failed tests
   */
  getFailedTests() {
    const failed = [];
    this.testResults.forEach(suite => {
      suite.tests.forEach(test => {
        if (!test.passed) {
          failed.push({
            suite: suite.name,
            test: test.name,
            error: test.error,
            duration: test.duration
          });
        }
      });
    });
    return failed;
  }

  /**
   * Get slow tests
   */
  getSlowTests(threshold = 1000) {
    const slow = [];
    this.testResults.forEach(suite => {
      suite.tests.forEach(test => {
        if (test.duration > threshold) {
          slow.push({
            suite: suite.name,
            test: test.name,
            duration: test.duration
          });
        }
      });
    });
    return slow.sort((a, b) => b.duration - a.duration).slice(0, 10);
  }

  /**
   * Cleanup after tests
   */
  async cleanup() {
    this.isRunning = false;
    this.emit('completed', this.generateReport());
  }
}

module.exports = TestFramework;