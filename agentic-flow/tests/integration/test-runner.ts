/**
 * Integration Test Runner and Reporting System
 * Coordinates integration test execution and generates comprehensive reports
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TestSuite {
  name: string;
  file: string;
  category: 'integration' | 'e2e' | 'performance' | 'security';
  timeout?: number;
  environment?: Record<string, string>;
  tags?: string[];
}

export interface TestResult {
  suite: string;
  status: 'passed' | 'failed' | 'skipped' | 'timeout';
  duration: number;
  tests: {
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    duration: number;
    error?: string;
  }[];
  coverage?: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  metrics?: Record<string, any>;
}

export interface TestRunConfig {
  suites?: string[];
  categories?: string[];
  tags?: string[];
  parallel?: boolean;
  maxParallel?: number;
  timeout?: number;
  environment?: Record<string, string>;
  generateReport?: boolean;
  reportFormat?: 'json' | 'html' | 'junit' | 'all';
  outputDir?: string;
}

export class IntegrationTestRunner extends EventEmitter {
  private testSuites: TestSuite[] = [];
  private results: TestResult[] = [];
  private runningProcesses: Map<string, ChildProcess> = new Map();
  private config: TestRunConfig;

  constructor(config: TestRunConfig = {}) {
    super();
    this.config = {
      parallel: true,
      maxParallel: 4,
      timeout: 300000, // 5 minutes default
      generateReport: true,
      reportFormat: 'all',
      outputDir: './test-reports',
      ...config
    };

    this.registerTestSuites();
  }

  /**
   * Register all integration test suites
   */
  private registerTestSuites(): void {
    this.testSuites = [
      {
        name: 'Provider Integration',
        file: 'provider-integration.test.ts',
        category: 'integration',
        timeout: 120000,
        tags: ['providers', 'llm', 'api']
      },
      {
        name: 'Agent Coordination',
        file: 'agent-coordination.test.ts',
        category: 'integration',
        timeout: 180000,
        tags: ['agents', 'coordination', 'teamwork']
      },
      {
        name: 'Workflow Execution',
        file: 'workflow-execution.test.ts',
        category: 'integration',
        timeout: 240000,
        tags: ['workflows', 'execution', 'state-management']
      },
      {
        name: 'End-to-End Scenarios',
        file: 'end-to-end-scenarios.test.ts',
        category: 'e2e',
        timeout: 360000,
        tags: ['e2e', 'scenarios', 'full-system']
      },
      {
        name: 'Performance and Load',
        file: 'performance-load.test.ts',
        category: 'performance',
        timeout: 600000,
        tags: ['performance', 'load', 'scalability']
      },
      {
        name: 'Security and Reliability',
        file: 'security-reliability.test.ts',
        category: 'security',
        timeout: 300000,
        tags: ['security', 'reliability', 'fault-tolerance']
      },
      {
        name: 'Cross-Component Integration',
        file: 'cross-component.test.ts',
        category: 'integration',
        timeout: 300000,
        tags: ['cross-component', 'integration', 'data-flow']
      }
    ];
  }

  /**
   * Run integration tests based on configuration
   */
  async runTests(): Promise<TestResult[]> {
    this.emit('run:started', { totalSuites: this.getSelectedSuites().length });
    
    try {
      // Ensure output directory exists
      await this.ensureOutputDirectory();
      
      const selectedSuites = this.getSelectedSuites();
      this.results = [];

      if (this.config.parallel) {
        await this.runTestsInParallel(selectedSuites);
      } else {
        await this.runTestsSequentially(selectedSuites);
      }

      // Generate reports
      if (this.config.generateReport) {
        await this.generateReports();
      }

      this.emit('run:completed', { 
        results: this.results,
        summary: this.generateSummary()
      });

      return this.results;

    } catch (error) {
      this.emit('run:error', { error });
      throw error;
    }
  }

  /**
   * Get test suites based on filters
   */
  private getSelectedSuites(): TestSuite[] {
    let suites = [...this.testSuites];

    // Filter by suite names
    if (this.config.suites && this.config.suites.length > 0) {
      suites = suites.filter(suite => 
        this.config.suites!.some(name => 
          suite.name.toLowerCase().includes(name.toLowerCase())
        )
      );
    }

    // Filter by categories
    if (this.config.categories && this.config.categories.length > 0) {
      suites = suites.filter(suite => 
        this.config.categories!.includes(suite.category)
      );
    }

    // Filter by tags
    if (this.config.tags && this.config.tags.length > 0) {
      suites = suites.filter(suite => 
        suite.tags && suite.tags.some(tag => 
          this.config.tags!.includes(tag)
        )
      );
    }

    return suites;
  }

  /**
   * Run tests in parallel
   */
  private async runTestsInParallel(suites: TestSuite[]): Promise<void> {
    const maxParallel = Math.min(this.config.maxParallel || 4, suites.length);
    const promises: Promise<void>[] = [];
    let currentIndex = 0;

    const runNext = async (): Promise<void> => {
      if (currentIndex >= suites.length) return;
      
      const suite = suites[currentIndex++];
      await this.runTestSuite(suite);
      
      // Continue with next suite
      if (currentIndex < suites.length) {
        await runNext();
      }
    };

    // Start parallel execution
    for (let i = 0; i < maxParallel; i++) {
      promises.push(runNext());
    }

    await Promise.all(promises);
  }

  /**
   * Run tests sequentially
   */
  private async runTestsSequentially(suites: TestSuite[]): Promise<void> {
    for (const suite of suites) {
      await this.runTestSuite(suite);
    }
  }

  /**
   * Run a single test suite
   */
  private async runTestSuite(suite: TestSuite): Promise<void> {
    const startTime = Date.now();
    this.emit('suite:started', { suite: suite.name });

    try {
      const result = await this.executeTestSuite(suite);
      const duration = Date.now() - startTime;
      
      const testResult: TestResult = {
        suite: suite.name,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        duration,
        tests: this.parseTestOutput(result.output),
        coverage: this.parseCoverageOutput(result.output),
        metrics: this.parseMetricsOutput(result.output)
      };

      this.results.push(testResult);
      this.emit('suite:completed', { suite: suite.name, result: testResult });

    } catch (error) {
      const duration = Date.now() - startTime;
      const testResult: TestResult = {
        suite: suite.name,
        status: 'failed',
        duration,
        tests: [],
        metrics: {}
      };

      this.results.push(testResult);
      this.emit('suite:failed', { suite: suite.name, error, result: testResult });
    }
  }

  /**
   * Execute test suite using Jest
   */
  private async executeTestSuite(suite: TestSuite): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      const testFile = path.join(__dirname, suite.file);
      const timeout = suite.timeout || this.config.timeout || 300000;
      
      // Jest command with configuration
      const jestArgs = [
        '--testPathPattern=' + testFile,
        '--verbose',
        '--json',
        '--coverage',
        '--coverageReporters=json',
        '--forceExit',
        '--detectOpenHandles',
        `--testTimeout=${timeout}`
      ];

      // Set up environment
      const env = {
        ...process.env,
        ...this.config.environment,
        ...suite.environment,
        NODE_ENV: 'test',
        JEST_WORKER_ID: '1'
      };

      const jestProcess = spawn('npx', ['jest', ...jestArgs], {
        env,
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.runningProcesses.set(suite.name, jestProcess);

      let output = '';
      let errorOutput = '';

      jestProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      jestProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      jestProcess.on('close', (code) => {
        this.runningProcesses.delete(suite.name);
        resolve({
          exitCode: code || 0,
          output: output + errorOutput
        });
      });

      jestProcess.on('error', (error) => {
        this.runningProcesses.delete(suite.name);
        reject(error);
      });

      // Set up timeout
      setTimeout(() => {
        if (this.runningProcesses.has(suite.name)) {
          jestProcess.kill('SIGTERM');
          setTimeout(() => {
            if (this.runningProcesses.has(suite.name)) {
              jestProcess.kill('SIGKILL');
            }
          }, 5000);
        }
      }, timeout + 30000); // Add 30s buffer to Jest timeout
    });
  }

  /**
   * Parse Jest test output
   */
  private parseTestOutput(output: string): TestResult['tests'] {
    const tests: TestResult['tests'] = [];
    
    try {
      // Look for Jest JSON output
      const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
      if (jsonMatch) {
        const jestResult = JSON.parse(jsonMatch[0]);
        
        if (jestResult.testResults && jestResult.testResults.length > 0) {
          const testFile = jestResult.testResults[0];
          
          testFile.assertionResults?.forEach((assertion: any) => {
            tests.push({
              name: assertion.title,
              status: assertion.status === 'passed' ? 'passed' : 'failed',
              duration: assertion.duration || 0,
              error: assertion.failureMessages?.join('\n')
            });
          });
        }
      }
    } catch (error) {
      // Fallback to regex parsing
      const testMatches = output.match(/✓|✗\s+(.+)\s+\((\d+)\s*ms\)/g);
      if (testMatches) {
        testMatches.forEach(match => {
          const [, name, duration] = match.match(/([✓✗])\s+(.+)\s+\((\d+)\s*ms\)/) || [];
          tests.push({
            name: name || 'Unknown Test',
            status: match.startsWith('✓') ? 'passed' : 'failed',
            duration: parseInt(duration) || 0
          });
        });
      }
    }

    return tests;
  }

  /**
   * Parse coverage output
   */
  private parseCoverageOutput(output: string): TestResult['coverage'] {
    try {
      const coverageMatch = output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
      if (coverageMatch) {
        return {
          statements: parseFloat(coverageMatch[1]),
          branches: parseFloat(coverageMatch[2]),
          functions: parseFloat(coverageMatch[3]),
          lines: parseFloat(coverageMatch[4])
        };
      }
    } catch (error) {
      // Coverage parsing failed
    }
    return undefined;
  }

  /**
   * Parse custom metrics from test output
   */
  private parseMetricsOutput(output: string): Record<string, any> {
    const metrics: Record<string, any> = {};
    
    try {
      // Look for custom metrics in test output
      const metricsMatches = output.match(/=== .+ Test Metrics ===([\s\S]*?)=========/g);
      if (metricsMatches) {
        metricsMatches.forEach(match => {
          const lines = match.split('\n');
          lines.forEach(line => {
            const metricMatch = line.match(/^\s*(.+?):\s*(.+)$/);
            if (metricMatch) {
              const [, key, value] = metricMatch;
              const numericValue = parseFloat(value);
              metrics[key.trim()] = isNaN(numericValue) ? value.trim() : numericValue;
            }
          });
        });
      }
    } catch (error) {
      // Metrics parsing failed
    }

    return metrics;
  }

  /**
   * Generate test summary
   */
  private generateSummary(): any {
    const summary = {
      totalSuites: this.results.length,
      passedSuites: this.results.filter(r => r.status === 'passed').length,
      failedSuites: this.results.filter(r => r.status === 'failed').length,
      skippedSuites: this.results.filter(r => r.status === 'skipped').length,
      totalTests: this.results.reduce((sum, r) => sum + r.tests.length, 0),
      passedTests: this.results.reduce((sum, r) => sum + r.tests.filter(t => t.status === 'passed').length, 0),
      failedTests: this.results.reduce((sum, r) => sum + r.tests.filter(t => t.status === 'failed').length, 0),
      totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0),
      avgDuration: this.results.length > 0 ? this.results.reduce((sum, r) => sum + r.duration, 0) / this.results.length : 0,
      overallSuccessRate: this.results.length > 0 ? (this.results.filter(r => r.status === 'passed').length / this.results.length) * 100 : 0
    };

    // Add coverage summary if available
    const coverageResults = this.results.filter(r => r.coverage);
    if (coverageResults.length > 0) {
      summary['coverage'] = {
        statements: coverageResults.reduce((sum, r) => sum + r.coverage!.statements, 0) / coverageResults.length,
        branches: coverageResults.reduce((sum, r) => sum + r.coverage!.branches, 0) / coverageResults.length,
        functions: coverageResults.reduce((sum, r) => sum + r.coverage!.functions, 0) / coverageResults.length,
        lines: coverageResults.reduce((sum, r) => sum + r.coverage!.lines, 0) / coverageResults.length
      };
    }

    return summary;
  }

  /**
   * Generate test reports
   */
  private async generateReports(): Promise<void> {
    const outputDir = this.config.outputDir!;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Generate JSON report
    if (this.config.reportFormat === 'json' || this.config.reportFormat === 'all') {
      await this.generateJSONReport(outputDir, timestamp);
    }

    // Generate HTML report
    if (this.config.reportFormat === 'html' || this.config.reportFormat === 'all') {
      await this.generateHTMLReport(outputDir, timestamp);
    }

    // Generate JUnit XML report
    if (this.config.reportFormat === 'junit' || this.config.reportFormat === 'all') {
      await this.generateJUnitReport(outputDir, timestamp);
    }

    this.emit('reports:generated', { outputDir });
  }

  /**
   * Generate JSON report
   */
  private async generateJSONReport(outputDir: string, timestamp: string): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.generateSummary(),
      results: this.results,
      config: this.config
    };

    const reportPath = path.join(outputDir, `integration-test-report-${timestamp}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  }

  /**
   * Generate HTML report
   */
  private async generateHTMLReport(outputDir: string, timestamp: string): Promise<void> {
    const summary = this.generateSummary();
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agentic Flow Integration Test Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #667eea; }
        .metric-value { font-size: 2em; font-weight: bold; color: #333; }
        .metric-label { color: #666; margin-top: 5px; }
        .suite { margin-bottom: 20px; border: 1px solid #e1e5e9; border-radius: 8px; overflow: hidden; }
        .suite-header { background: #f8f9fa; padding: 15px; border-bottom: 1px solid #e1e5e9; }
        .suite-title { font-weight: bold; margin: 0; }
        .suite-status { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; margin-left: 10px; }
        .status-passed { background: #d4edda; color: #155724; }
        .status-failed { background: #f8d7da; color: #721c24; }
        .tests { padding: 15px; }
        .test { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f3f4; }
        .test:last-child { border-bottom: none; }
        .test-name { flex: 1; }
        .test-duration { color: #666; font-size: 0.9em; margin-right: 10px; }
        .test-status { padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .progress-bar { width: 100%; height: 20px; background: #e9ecef; border-radius: 10px; overflow: hidden; margin: 10px 0; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, #28a745, #20c997); transition: width 0.3s ease; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Agentic Flow Integration Test Report</h1>
            <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="content">
            <div class="summary">
                <div class="metric">
                    <div class="metric-value">${summary.totalSuites}</div>
                    <div class="metric-label">Test Suites</div>
                </div>
                <div class="metric">
                    <div class="metric-value">${summary.totalTests}</div>
                    <div class="metric-label">Total Tests</div>
                </div>
                <div class="metric">
                    <div class="metric-value">${summary.overallSuccessRate.toFixed(1)}%</div>
                    <div class="metric-label">Success Rate</div>
                </div>
                <div class="metric">
                    <div class="metric-value">${(summary.totalDuration / 1000).toFixed(1)}s</div>
                    <div class="metric-label">Total Duration</div>
                </div>
            </div>

            <div class="progress-bar">
                <div class="progress-fill" style="width: ${summary.overallSuccessRate}%"></div>
            </div>

            <h2>Test Suites</h2>
            ${this.results.map(result => `
                <div class="suite">
                    <div class="suite-header">
                        <h3 class="suite-title">
                            ${result.suite}
                            <span class="suite-status status-${result.status}">${result.status.toUpperCase()}</span>
                        </h3>
                        <div>Duration: ${(result.duration / 1000).toFixed(2)}s | Tests: ${result.tests.length}</div>
                    </div>
                    <div class="tests">
                        ${result.tests.map(test => `
                            <div class="test">
                                <div class="test-name">${test.name}</div>
                                <div class="test-duration">${test.duration}ms</div>
                                <div class="test-status status-${test.status}">${test.status}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}

            ${summary.coverage ? `
                <h2>Coverage Report</h2>
                <div class="summary">
                    <div class="metric">
                        <div class="metric-value">${summary.coverage.statements.toFixed(1)}%</div>
                        <div class="metric-label">Statements</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${summary.coverage.branches.toFixed(1)}%</div>
                        <div class="metric-label">Branches</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${summary.coverage.functions.toFixed(1)}%</div>
                        <div class="metric-label">Functions</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">${summary.coverage.lines.toFixed(1)}%</div>
                        <div class="metric-label">Lines</div>
                    </div>
                </div>
            ` : ''}
        </div>
    </div>
</body>
</html>`;

    const reportPath = path.join(outputDir, `integration-test-report-${timestamp}.html`);
    await fs.writeFile(reportPath, html);
  }

  /**
   * Generate JUnit XML report
   */
  private async generateJUnitReport(outputDir: string, timestamp: string): Promise<void> {
    const summary = this.generateSummary();
    
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Agentic Flow Integration Tests" 
           tests="${summary.totalTests}" 
           failures="${summary.failedTests}" 
           time="${(summary.totalDuration / 1000).toFixed(3)}">
${this.results.map(result => `
  <testsuite name="${result.suite}" 
             tests="${result.tests.length}" 
             failures="${result.tests.filter(t => t.status === 'failed').length}" 
             time="${(result.duration / 1000).toFixed(3)}">
${result.tests.map(test => `
    <testcase name="${test.name}" 
              time="${(test.duration / 1000).toFixed(3)}"
              classname="${result.suite}">
${test.status === 'failed' ? `
      <failure message="Test failed">${test.error || 'Test failed without error message'}</failure>
` : ''}
    </testcase>`).join('')}
  </testsuite>`).join('')}
</testsuites>`;

    const reportPath = path.join(outputDir, `integration-test-report-${timestamp}.xml`);
    await fs.writeFile(reportPath, xml);
  }

  /**
   * Ensure output directory exists
   */
  private async ensureOutputDirectory(): Promise<void> {
    try {
      await fs.access(this.config.outputDir!);
    } catch {
      await fs.mkdir(this.config.outputDir!, { recursive: true });
    }
  }

  /**
   * Stop all running tests
   */
  async stopAllTests(): Promise<void> {
    const processes = Array.from(this.runningProcesses.values());
    
    for (const process of processes) {
      process.kill('SIGTERM');
    }

    // Wait a bit, then force kill if needed
    setTimeout(() => {
      for (const process of processes) {
        if (!process.killed) {
          process.kill('SIGKILL');
        }
      }
    }, 5000);

    this.runningProcesses.clear();
  }

  /**
   * Get current test status
   */
  getStatus(): {
    running: boolean;
    totalSuites: number;
    completedSuites: number;
    runningSuites: string[];
    results: TestResult[];
  } {
    return {
      running: this.runningProcesses.size > 0,
      totalSuites: this.getSelectedSuites().length,
      completedSuites: this.results.length,
      runningSuites: Array.from(this.runningProcesses.keys()),
      results: this.results
    };
  }
}

/**
 * CLI interface for test runner
 */
export async function runIntegrationTests(config: TestRunConfig = {}): Promise<void> {
  const runner = new IntegrationTestRunner(config);
  
  // Set up event listeners for CLI output
  runner.on('run:started', (data) => {
    console.log(`🚀 Starting integration tests (${data.totalSuites} suites)`);
    console.log('=' .repeat(60));
  });

  runner.on('suite:started', (data) => {
    console.log(`📋 Running: ${data.suite}`);
  });

  runner.on('suite:completed', (data) => {
    const status = data.result.status === 'passed' ? '✅' : '❌';
    const duration = (data.result.duration / 1000).toFixed(2);
    console.log(`${status} ${data.suite} (${duration}s, ${data.result.tests.length} tests)`);
  });

  runner.on('suite:failed', (data) => {
    console.log(`❌ ${data.suite} - FAILED`);
    if (data.error) {
      console.log(`   Error: ${data.error.message}`);
    }
  });

  runner.on('reports:generated', (data) => {
    console.log(`📊 Reports generated in: ${data.outputDir}`);
  });

  runner.on('run:completed', (data) => {
    console.log('=' .repeat(60));
    console.log('🎯 Integration Test Summary:');
    console.log(`   Total Suites: ${data.summary.totalSuites}`);
    console.log(`   Passed: ${data.summary.passedSuites} ✅`);
    console.log(`   Failed: ${data.summary.failedSuites} ❌`);
    console.log(`   Success Rate: ${data.summary.overallSuccessRate.toFixed(1)}%`);
    console.log(`   Total Duration: ${(data.summary.totalDuration / 1000).toFixed(2)}s`);
    
    if (data.summary.coverage) {
      console.log(`   Coverage: ${data.summary.coverage.lines.toFixed(1)}% lines`);
    }
    
    console.log('=' .repeat(60));
  });

  try {
    const results = await runner.runTests();
    const summary = runner['generateSummary']();
    
    // Exit with error code if tests failed
    if (summary.failedSuites > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Integration test run failed:', error.message);
    process.exit(1);
  }
}

// Export for programmatic use
export { TestRunConfig, TestResult, TestSuite };