#!/usr/bin/env node

/**
 * Main Test Runner for Gemini Flow Web UI
 * Executes all test suites and generates comprehensive reports
 */

const TestFramework = require('./framework/TestFramework');
const fs = require('fs').promises;
const path = require('path');

// Import all test suites
const neuralNetworkTests = require('./unit/NeuralNetworkView.test');
const toolIntegrationTests = require('./integration/ToolIntegration.test');
const e2eWorkflowTests = require('./e2e/FullWorkflow.test');
const performanceTests = require('./performance/LoadTesting.test');

async function runAllTests() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║        Gemini Flow Web UI - Comprehensive Test Suite          ║
║                    Testing 71+ MCP Tools                      ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const framework = new TestFramework();
  await framework.initialize();

  // Test suites to run
  const testSuites = [
    { ...neuralNetworkTests, category: 'unit' },
    { ...toolIntegrationTests, category: 'integration' },
    { ...e2eWorkflowTests, category: 'e2e' },
    { ...performanceTests, category: 'performance' }
  ];

  // Run test suites based on command line arguments
  const args = process.argv.slice(2);
  const runOnly = args.find(arg => arg.startsWith('--only='))?.split('=')[1];
  const skipCategories = args.find(arg => arg.startsWith('--skip='))?.split('=')[1]?.split(',') || [];
  
  let suitesToRun = testSuites;
  
  if (runOnly) {
    suitesToRun = testSuites.filter(suite => suite.category === runOnly);
  } else if (skipCategories.length > 0) {
    suitesToRun = testSuites.filter(suite => !skipCategories.includes(suite.category));
  }

  console.log(`\n🔧 Running ${suitesToRun.length} test suites...\n`);

  // Execute test suites
  for (const suite of suitesToRun) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📦 Category: ${suite.category.toUpperCase()}`);
    console.log(`${'═'.repeat(60)}`);
    
    try {
      await framework.runTestSuite(suite);
    } catch (error) {
      console.error(`\n❌ Fatal error in ${suite.name}:`, error);
    }
  }

  // Generate final report
  const report = framework.generateReport();
  
  // Display summary
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                      TEST SUMMARY                             ║
╚═══════════════════════════════════════════════════════════════╝

📊 Overall Results:
   Total Suites: ${report.summary.totalSuites}
   Total Tests: ${report.summary.totalTests}
   ✅ Passed: ${report.summary.passed}
   ❌ Failed: ${report.summary.failed}
   📈 Success Rate: ${report.summary.successRate}
   ⏱️  Duration: ${(report.summary.duration / 1000).toFixed(2)}s

🎯 Coverage:
   Tools Tested: ${report.coverage.tools.tested}/${report.coverage.tools.total} (${report.coverage.tools.percentage})
   Views Tested: ${report.coverage.views.tested}/${report.coverage.views.total} (${report.coverage.views.percentage})
`);

  // Display failed tests
  if (report.failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    report.failedTests.forEach(test => {
      console.log(`   - ${test.suite} > ${test.test}`);
      console.log(`     Error: ${test.error}`);
    });
  }

  // Display slow tests
  if (report.slowTests.length > 0) {
    console.log('\n🐌 Slowest Tests:');
    report.slowTests.forEach(test => {
      console.log(`   - ${test.suite} > ${test.test} (${test.duration}ms)`);
    });
  }

  // Save detailed report
  const reportPath = path.join(__dirname, 'reports', `test-report-${Date.now()}.json`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  // Generate HTML report
  await generateHTMLReport(report);

  // Cleanup
  await framework.cleanup();

  // Exit with appropriate code
  process.exit(report.summary.failed > 0 ? 1 : 0);
}

async function generateHTMLReport(report) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Gemini Flow Test Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 10px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #00d4ff;
      padding-bottom: 10px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .metric {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 2em;
      font-weight: bold;
      color: #00d4ff;
    }
    .metric-label {
      color: #666;
      margin-top: 5px;
    }
    .suite {
      margin: 20px 0;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      overflow: hidden;
    }
    .suite-header {
      background: #f8f9fa;
      padding: 15px;
      font-weight: bold;
      cursor: pointer;
    }
    .suite-content {
      padding: 20px;
    }
    .test {
      padding: 10px;
      margin: 5px 0;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .test.passed {
      background: #d4edda;
      color: #155724;
    }
    .test.failed {
      background: #f8d7da;
      color: #721c24;
    }
    .coverage-bar {
      background: #e0e0e0;
      height: 30px;
      border-radius: 15px;
      overflow: hidden;
      margin: 10px 0;
    }
    .coverage-fill {
      background: linear-gradient(90deg, #00d4ff, #0099cc);
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    }
    .chart {
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Gemini Flow Web UI Test Report</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    
    <div class="summary">
      <div class="metric">
        <div class="metric-value">${report.summary.totalTests}</div>
        <div class="metric-label">Total Tests</div>
      </div>
      <div class="metric">
        <div class="metric-value" style="color: #28a745">${report.summary.passed}</div>
        <div class="metric-label">Passed</div>
      </div>
      <div class="metric">
        <div class="metric-value" style="color: #dc3545">${report.summary.failed}</div>
        <div class="metric-label">Failed</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.successRate}</div>
        <div class="metric-label">Success Rate</div>
      </div>
    </div>
    
    <h2>📊 Coverage</h2>
    <div>
      <h3>Tools Coverage: ${report.coverage.tools.tested}/${report.coverage.tools.total}</h3>
      <div class="coverage-bar">
        <div class="coverage-fill" style="width: ${report.coverage.tools.percentage}">
          ${report.coverage.tools.percentage}
        </div>
      </div>
      
      <h3>Views Coverage: ${report.coverage.views.tested}/${report.coverage.views.total}</h3>
      <div class="coverage-bar">
        <div class="coverage-fill" style="width: ${report.coverage.views.percentage}">
          ${report.coverage.views.percentage}
        </div>
      </div>
    </div>
    
    <h2>📋 Test Suites</h2>
    ${report.suites.map(suite => `
      <div class="suite">
        <div class="suite-header">
          ${suite.name} - ${suite.passed}/${suite.tests.length} passed (${((suite.passed/suite.tests.length)*100).toFixed(1)}%)
        </div>
        <div class="suite-content">
          ${suite.tests.map(test => `
            <div class="test ${test.passed ? 'passed' : 'failed'}">
              <span>${test.passed ? '✅' : '❌'} ${test.name}</span>
              <span>${test.duration}ms</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
    
    ${report.failedTests.length > 0 ? `
      <h2>❌ Failed Tests</h2>
      <div style="background: #f8d7da; padding: 20px; border-radius: 8px;">
        ${report.failedTests.map(test => `
          <div style="margin: 10px 0;">
            <strong>${test.suite} > ${test.test}</strong><br>
            <code style="color: #721c24;">${test.error}</code>
          </div>
        `).join('')}
      </div>
    ` : ''}
    
    <h2>⏱️ Performance</h2>
    <div>
      <p>Total Duration: ${(report.summary.duration / 1000).toFixed(2)} seconds</p>
      <h3>Slowest Tests:</h3>
      <ul>
        ${report.slowTests.map(test => `
          <li>${test.suite} > ${test.test} - ${test.duration}ms</li>
        `).join('')}
      </ul>
    </div>
  </div>
</body>
</html>
  `;
  
  const htmlPath = path.join(__dirname, 'reports', `test-report-${Date.now()}.html`);
  await fs.writeFile(htmlPath, html);
  console.log(`\n🌐 HTML report saved to: ${htmlPath}`);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled rejection:', error);
  process.exit(1);
});

// Run tests
runAllTests().catch(error => {
  console.error('\n❌ Test runner failed:', error);
  process.exit(1);
});