/**
 * LALO MVP Performance Benchmark Suite
 * Comprehensive performance testing for all components
 */

const { performance } = require('perf_hooks');
const axios = require('axios');

class LALOBenchmark {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'http://localhost:3000';
    this.iterations = config.iterations || 100;
    this.concurrency = config.concurrency || 10;
    this.warmupRounds = config.warmupRounds || 5;
    this.results = {
      langgraph: [],
      governance: [],
      mcp: [],
      rag: [],
      nl2sql: [],
      endToEnd: []
    };
  }

  async runAllBenchmarks() {
    console.log('🚀 Starting LALO MVP Performance Benchmarks...\n');

    await this.warmup();

    console.log('📊 Running Component Benchmarks...');
    await this.benchmarkLangGraph();
    await this.benchmarkGovernance();
    await this.benchmarkMCP();
    await this.benchmarkRAG();
    await this.benchmarkNL2SQL();

    console.log('🔄 Running End-to-End Benchmarks...');
    await this.benchmarkEndToEnd();

    console.log('💾 Running Memory Usage Tests...');
    await this.benchmarkMemoryUsage();

    console.log('⚡ Running Concurrent Load Tests...');
    await this.benchmarkConcurrentLoad();

    this.generateReport();
  }

  async warmup() {
    console.log('🔥 Warming up system...');
    for (let i = 0; i < this.warmupRounds; i++) {
      await this.makeRequest('/api/health');
      await this.delay(100);
    }
    console.log('✅ Warmup complete\n');
  }

  async benchmarkLangGraph() {
    console.log('🔍 Benchmarking LangGraph workflows...');

    const workflows = [
      { name: 'simple_linear', complexity: 'low' },
      { name: 'conditional_branching', complexity: 'medium' },
      { name: 'parallel_execution', complexity: 'high' },
      { name: 'nested_workflows', complexity: 'very_high' }
    ];

    for (const workflow of workflows) {
      const times = [];

      for (let i = 0; i < this.iterations; i++) {
        const start = performance.now();

        try {
          await this.makeRequest('/api/langgraph/execute', {
            method: 'POST',
            data: {
              workflow: workflow.name,
              input: { data: `test-${i}` }
            }
          });

          const duration = performance.now() - start;
          times.push(duration);
        } catch (error) {
          console.error(`LangGraph ${workflow.name} error:`, error.message);
        }
      }

      this.results.langgraph.push({
        workflow: workflow.name,
        complexity: workflow.complexity,
        avgTime: this.average(times),
        minTime: Math.min(...times),
        maxTime: Math.max(...times),
        p95: this.percentile(times, 95),
        p99: this.percentile(times, 99),
        successRate: times.length / this.iterations
      });
    }
  }

  async benchmarkGovernance() {
    console.log('🛡️ Benchmarking Governance engine...');

    const scenarios = [
      { name: 'simple_permission_check', users: 1, resources: 1 },
      { name: 'bulk_permission_check', users: 10, resources: 5 },
      { name: 'complex_policy_evaluation', users: 1, resources: 1, policies: 20 },
      { name: 'hierarchical_role_check', users: 5, resources: 10, hierarchy: true }
    ];

    for (const scenario of scenarios) {
      const times = [];

      for (let i = 0; i < this.iterations; i++) {
        const start = performance.now();

        try {
          await this.makeRequest('/api/governance/evaluate', {
            method: 'POST',
            data: {
              scenario: scenario.name,
              user: `user-${i % scenario.users}`,
              resource: `resource-${i % scenario.resources}`,
              action: 'read'
            }
          });

          const duration = performance.now() - start;
          times.push(duration);
        } catch (error) {
          console.error(`Governance ${scenario.name} error:`, error.message);
        }
      }

      this.results.governance.push({
        scenario: scenario.name,
        avgTime: this.average(times),
        p95: this.percentile(times, 95),
        throughput: this.iterations / (this.sum(times) / 1000),
        successRate: times.length / this.iterations
      });
    }
  }

  async benchmarkMCP() {
    console.log('🔗 Benchmarking MCP coordination...');

    const operations = [
      { name: 'node_registration', payload: 'small' },
      { name: 'task_distribution', payload: 'medium' },
      { name: 'coordination_message', payload: 'small' },
      { name: 'bulk_coordination', payload: 'large' }
    ];

    for (const operation of operations) {
      const times = [];

      for (let i = 0; i < this.iterations; i++) {
        const start = performance.now();

        try {
          await this.makeRequest('/api/mcp/coordinate', {
            method: 'POST',
            data: {
              operation: operation.name,
              nodeId: `node-${i}`,
              payload: this.generatePayload(operation.payload)
            }
          });

          const duration = performance.now() - start;
          times.push(duration);
        } catch (error) {
          console.error(`MCP ${operation.name} error:`, error.message);
        }
      }

      this.results.mcp.push({
        operation: operation.name,
        avgTime: this.average(times),
        p95: this.percentile(times, 95),
        messagesPerSecond: this.iterations / (this.sum(times) / 1000),
        successRate: times.length / this.iterations
      });
    }
  }

  async benchmarkRAG() {
    console.log('🔍 Benchmarking RAG retrieval...');

    const queries = [
      { text: 'simple query', expectedResults: 5 },
      { text: 'complex multi-term query with specific context', expectedResults: 10 },
      { text: 'very detailed query with multiple constraints and filters', expectedResults: 15 },
      { text: 'short', expectedResults: 20 }
    ];

    for (const query of queries) {
      const times = [];
      const relevanceScores = [];

      for (let i = 0; i < this.iterations; i++) {
        const start = performance.now();

        try {
          const response = await this.makeRequest('/api/rag/retrieve', {
            method: 'POST',
            data: {
              query: query.text,
              maxResults: query.expectedResults
            }
          });

          const duration = performance.now() - start;
          times.push(duration);

          if (response.data && response.data.results) {
            const avgRelevance = response.data.results.reduce((sum, r) => sum + r.score, 0) / response.data.results.length;
            relevanceScores.push(avgRelevance);
          }
        } catch (error) {
          console.error(`RAG query error:`, error.message);
        }
      }

      this.results.rag.push({
        queryLength: query.text.length,
        avgTime: this.average(times),
        p95: this.percentile(times, 95),
        avgRelevance: this.average(relevanceScores),
        queriesPerSecond: this.iterations / (this.sum(times) / 1000),
        successRate: times.length / this.iterations
      });
    }
  }

  async benchmarkNL2SQL() {
    console.log('💾 Benchmarking NL2SQL generation...');

    const queries = [
      { nl: 'show all users', complexity: 'simple' },
      { nl: 'show users with their departments', complexity: 'medium' },
      { nl: 'show top 10 users by sales with department and manager info', complexity: 'complex' },
      { nl: 'complex aggregation query with multiple joins and subqueries', complexity: 'very_complex' }
    ];

    for (const query of queries) {
      const times = [];
      const sqlLengths = [];

      for (let i = 0; i < this.iterations; i++) {
        const start = performance.now();

        try {
          const response = await this.makeRequest('/api/nl2sql/generate', {
            method: 'POST',
            data: {
              naturalLanguage: query.nl
            }
          });

          const duration = performance.now() - start;
          times.push(duration);

          if (response.data && response.data.sql) {
            sqlLengths.push(response.data.sql.length);
          }
        } catch (error) {
          console.error(`NL2SQL generation error:`, error.message);
        }
      }

      this.results.nl2sql.push({
        complexity: query.complexity,
        nlLength: query.nl.length,
        avgTime: this.average(times),
        p95: this.percentile(times, 95),
        avgSQLLength: this.average(sqlLengths),
        generationsPerSecond: this.iterations / (this.sum(times) / 1000),
        successRate: times.length / this.iterations
      });
    }
  }

  async benchmarkEndToEnd() {
    console.log('🎯 Benchmarking end-to-end pipeline...');

    const scenarios = [
      {
        name: 'simple_data_query',
        query: 'Show me recent user activity'
      },
      {
        name: 'complex_analytics_query',
        query: 'Analyze user engagement patterns and generate insights with historical data'
      },
      {
        name: 'multi_component_query',
        query: 'Use our documentation to help generate a comprehensive user report with sales data'
      }
    ];

    for (const scenario of scenarios) {
      const times = [];
      const componentTimes = [];

      for (let i = 0; i < Math.min(this.iterations, 50); i++) { // Fewer iterations for E2E
        const start = performance.now();

        try {
          const response = await this.makeRequest('/api/lalo/query', {
            method: 'POST',
            data: {
              query: scenario.query,
              user: {
                id: `test-user-${i}`,
                role: 'analyst',
                permissions: ['read:data', 'read:analytics']
              }
            }
          });

          const duration = performance.now() - start;
          times.push(duration);

          if (response.data && response.data.metadata) {
            componentTimes.push(response.data.metadata.componentTimes);
          }
        } catch (error) {
          console.error(`E2E ${scenario.name} error:`, error.message);
        }
      }

      this.results.endToEnd.push({
        scenario: scenario.name,
        avgTime: this.average(times),
        p95: this.percentile(times, 95),
        p99: this.percentile(times, 99),
        avgComponentBreakdown: this.averageComponentTimes(componentTimes),
        successRate: times.length / Math.min(this.iterations, 50)
      });
    }
  }

  async benchmarkMemoryUsage() {
    console.log('💾 Benchmarking memory usage...');

    const initialMemory = process.memoryUsage();
    const memorySnapshots = [];

    // Process multiple queries and track memory
    for (let i = 0; i < 20; i++) {
      await this.makeRequest('/api/lalo/query', {
        method: 'POST',
        data: {
          query: `Memory test query ${i} with increasing complexity and data size`,
          user: { id: `memory-test-${i}`, role: 'analyst' }
        }
      });

      if (i % 5 === 0) {
        memorySnapshots.push(process.memoryUsage());
        await this.delay(1000); // Allow garbage collection
      }
    }

    const finalMemory = process.memoryUsage();

    this.results.memory = {
      initialHeapUsed: initialMemory.heapUsed,
      finalHeapUsed: finalMemory.heapUsed,
      heapGrowth: finalMemory.heapUsed - initialMemory.heapUsed,
      maxHeapUsed: Math.max(...memorySnapshots.map(s => s.heapUsed)),
      snapshots: memorySnapshots
    };
  }

  async benchmarkConcurrentLoad() {
    console.log('⚡ Benchmarking concurrent load...');

    const concurrencyLevels = [1, 5, 10, 20, 50];

    for (const concurrency of concurrencyLevels) {
      console.log(`  Testing ${concurrency} concurrent requests...`);

      const promises = [];
      const startTime = performance.now();

      for (let i = 0; i < concurrency; i++) {
        promises.push(
          this.makeRequest('/api/lalo/query', {
            method: 'POST',
            data: {
              query: `Concurrent test query ${i}`,
              user: { id: `concurrent-user-${i}`, role: 'analyst' }
            }
          }).catch(error => ({ error: error.message }))
        );
      }

      const results = await Promise.all(promises);
      const totalTime = performance.now() - startTime;

      const successfulRequests = results.filter(r => !r.error).length;
      const errorRate = (results.length - successfulRequests) / results.length;

      this.results.concurrent = this.results.concurrent || [];
      this.results.concurrent.push({
        concurrency,
        totalTime,
        successfulRequests,
        errorRate,
        requestsPerSecond: successfulRequests / (totalTime / 1000),
        avgResponseTime: totalTime / concurrency
      });
    }
  }

  generateReport() {
    console.log('\n📊 LALO MVP Performance Benchmark Report');
    console.log('='.repeat(50));

    // Component performance summary
    console.log('\n🔧 Component Performance:');
    this.printComponentSummary('LangGraph', this.results.langgraph);
    this.printComponentSummary('Governance', this.results.governance);
    this.printComponentSummary('MCP', this.results.mcp);
    this.printComponentSummary('RAG', this.results.rag);
    this.printComponentSummary('NL2SQL', this.results.nl2sql);

    // End-to-end performance
    console.log('\n🎯 End-to-End Performance:');
    this.results.endToEnd.forEach(result => {
      console.log(`  ${result.scenario}:`);
      console.log(`    Avg Time: ${result.avgTime.toFixed(2)}ms`);
      console.log(`    P95: ${result.p95.toFixed(2)}ms`);
      console.log(`    Success Rate: ${(result.successRate * 100).toFixed(1)}%`);
    });

    // Memory usage
    console.log('\n💾 Memory Usage:');
    console.log(`  Initial Heap: ${(this.results.memory.initialHeapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Final Heap: ${(this.results.memory.finalHeapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Growth: ${(this.results.memory.heapGrowth / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Max Heap: ${(this.results.memory.maxHeapUsed / 1024 / 1024).toFixed(2)} MB`);

    // Concurrent performance
    console.log('\n⚡ Concurrent Load Performance:');
    this.results.concurrent.forEach(result => {
      console.log(`  ${result.concurrency} concurrent:`);
      console.log(`    RPS: ${result.requestsPerSecond.toFixed(2)}`);
      console.log(`    Error Rate: ${(result.errorRate * 100).toFixed(1)}%`);
      console.log(`    Avg Response: ${result.avgResponseTime.toFixed(2)}ms`);
    });

    // Performance recommendations
    console.log('\n💡 Performance Recommendations:');
    this.generateRecommendations();

    // Save detailed results
    this.saveResults();
  }

  printComponentSummary(name, results) {
    if (results.length === 0) return;

    const avgTimes = results.map(r => r.avgTime || r.avgTime);
    const p95Times = results.map(r => r.p95);
    const successRates = results.map(r => r.successRate);

    console.log(`  ${name}:`);
    console.log(`    Avg Time: ${this.average(avgTimes).toFixed(2)}ms`);
    console.log(`    P95: ${this.average(p95Times).toFixed(2)}ms`);
    console.log(`    Success Rate: ${(this.average(successRates) * 100).toFixed(1)}%`);
  }

  generateRecommendations() {
    const recommendations = [];

    // Check for slow components
    if (this.results.endToEnd.some(r => r.avgTime > 1000)) {
      recommendations.push('⚠️  E2E response times > 1s detected. Consider optimizing slow components.');
    }

    // Check memory growth
    if (this.results.memory.heapGrowth > 100 * 1024 * 1024) { // 100MB
      recommendations.push('🧠 High memory growth detected. Check for memory leaks.');
    }

    // Check error rates
    const avgErrorRate = this.average(this.results.concurrent.map(r => r.errorRate));
    if (avgErrorRate > 0.05) { // 5% error rate
      recommendations.push('🚨 High error rate under load. Review error handling and capacity.');
    }

    // Check concurrent performance
    const maxRPS = Math.max(...this.results.concurrent.map(r => r.requestsPerSecond));
    if (maxRPS < 10) {
      recommendations.push('📈 Low concurrent throughput. Consider scaling or optimization.');
    }

    recommendations.forEach(rec => console.log(`    ${rec}`));

    if (recommendations.length === 0) {
      console.log('    ✅ All performance metrics look good!');
    }
  }

  async saveResults() {
    const report = {
      timestamp: new Date().toISOString(),
      configuration: {
        iterations: this.iterations,
        concurrency: this.concurrency,
        baseUrl: this.baseUrl
      },
      results: this.results,
      summary: this.generateSummaryStats()
    };

    const fs = require('fs');
    const path = require('path');

    const reportPath = path.join(__dirname, '../reports', `benchmark-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  }

  generateSummaryStats() {
    return {
      totalTests: Object.values(this.results).flat().length,
      avgE2ETime: this.average(this.results.endToEnd.map(r => r.avgTime)),
      overallSuccessRate: this.calculateOverallSuccessRate(),
      maxConcurrentRPS: Math.max(...this.results.concurrent.map(r => r.requestsPerSecond))
    };
  }

  calculateOverallSuccessRate() {
    const allResults = [
      ...this.results.langgraph,
      ...this.results.governance,
      ...this.results.mcp,
      ...this.results.rag,
      ...this.results.nl2sql,
      ...this.results.endToEnd
    ];

    return this.average(allResults.map(r => r.successRate));
  }

  // Utility methods
  async makeRequest(url, options = {}) {
    return axios({
      url: `${this.baseUrl}${url}`,
      method: options.method || 'GET',
      data: options.data,
      timeout: 30000,
      ...options
    });
  }

  generatePayload(size) {
    const sizes = {
      small: 100,
      medium: 1000,
      large: 10000
    };
    return 'x'.repeat(sizes[size] || 100);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  average(arr) {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }

  sum(arr) {
    return arr.reduce((a, b) => a + b, 0);
  }

  percentile(arr, p) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * (p / 100)) - 1;
    return sorted[index] || 0;
  }

  averageComponentTimes(componentTimesArray) {
    if (componentTimesArray.length === 0) return {};

    const components = Object.keys(componentTimesArray[0] || {});
    const averages = {};

    components.forEach(component => {
      const times = componentTimesArray.map(ct => ct[component]).filter(t => t !== undefined);
      averages[component] = this.average(times);
    });

    return averages;
  }
}

// CLI execution
if (require.main === module) {
  const config = {
    baseUrl: process.env.LALO_BASE_URL || 'http://localhost:3000',
    iterations: parseInt(process.env.BENCHMARK_ITERATIONS) || 50,
    concurrency: parseInt(process.env.BENCHMARK_CONCURRENCY) || 10
  };

  const benchmark = new LALOBenchmark(config);
  benchmark.runAllBenchmarks().catch(console.error);
}

module.exports = LALOBenchmark;