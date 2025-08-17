/**
 * Analysis & Monitoring Tools for Claude Flow Web UI
 * Agent 2 - Analysis & Monitoring Tools Developer
 *
 * Features:
 * - 13 analysis and monitoring tools
 * - Real-time dashboards and visualizations
 * - WebSocket integration for live data
 * - Export functionality for reports
 * - 4 main tabs: Metrics, Reports, Analysis, Health
 */

class AnalysisTools {
  constructor() {
    this.ws = null;
    this.charts = {};
    this.currentTab = 'metrics';
    this.isConnected = false;
    this.metricsCache = new Map();
    this.updateInterval = null;
    this.init();
  }

  init() {
    this.setupWebSocket();
    this.setupEventListeners();
    this.initializeCharts();
    this.startRealTimeUpdates();
  }

  setupWebSocket() {
    try {
      this.ws = new WebSocket('ws://localhost:3000/analysis');

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('Analysis WebSocket connected');
        this.updateConnectionStatus('connected');
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        this.handleWebSocketData(data);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.log('Analysis WebSocket disconnected');
        this.updateConnectionStatus('disconnected');
        setTimeout(() => this.setupWebSocket(), 5000);
      };

      this.ws.onerror = (error) => {
        console.error('Analysis WebSocket error:', error);
        this.updateConnectionStatus('error');
      };
    } catch (error) {
      console.error('Failed to setup WebSocket:', error);
      this.updateConnectionStatus('error');
    }
  }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.analysis-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Export buttons
    document.querySelectorAll('.export-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const format = e.target.dataset.format;
        const type = e.target.dataset.type;
        this.exportData(type, format);
      });
    });

    // Tool buttons
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tool = e.target.dataset.tool;
        this.executeTool(tool);
      });
    });

    // Refresh buttons
    document.querySelectorAll('.refresh-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const section = e.target.dataset.section;
        this.refreshSection(section);
      });
    });
  }

  initializeCharts() {
    // Performance metrics chart
    this.charts.performance = new Chart(document.getElementById('performance-chart'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Response Time (ms)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
          },
          {
            label: 'Throughput (req/s)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          },
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: 'Time',
            },
          },
          y: {
            display: true,
            title: {
              display: true,
              text: 'Value',
            },
          },
        },
      },
    });

    // Token usage chart
    this.charts.tokenUsage = new Chart(document.getElementById('token-usage-chart'), {
      type: 'doughnut',
      data: {
        labels: ['Input Tokens', 'Output Tokens', 'Cached Tokens'],
        datasets: [
          {
            data: [0, 0, 0],
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b'],
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
          },
        },
      },
    });

    // System health chart
    this.charts.systemHealth = new Chart(document.getElementById('system-health-chart'), {
      type: 'radar',
      data: {
        labels: ['CPU', 'Memory', 'Disk', 'Network', 'API', 'Database'],
        datasets: [
          {
            label: 'Health Score',
            data: [100, 100, 100, 100, 100, 100],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#10b981',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
          },
        },
      },
    });

    // Load monitoring chart
    this.charts.loadMonitor = new Chart(document.getElementById('load-monitor-chart'), {
      type: 'bar',
      data: {
        labels: ['1m', '5m', '15m', '30m', '1h', '24h'],
        datasets: [
          {
            label: 'Average Load',
            data: [0, 0, 0, 0, 0, 0],
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: '#3b82f6',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  }

  startRealTimeUpdates() {
    this.updateInterval = setInterval(() => {
      if (this.isConnected) {
        this.requestMetricsUpdate();
      }
    }, 5000);
  }

  requestMetricsUpdate() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'request_metrics',
          timestamp: Date.now(),
        }),
      );
    }
  }

  handleWebSocketData(data) {
    switch (data.type) {
      case 'metrics_update':
        this.updateMetrics(data.payload);
        break;
      case 'alert':
        this.handleAlert(data.payload);
        break;
      case 'health_status':
        this.updateHealthStatus(data.payload);
        break;
      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  }

  updateMetrics(metrics) {
    this.metricsCache.set('latest', metrics);

    // Update performance chart
    if (this.charts.performance && metrics.performance) {
      const chart = this.charts.performance;
      const now = new Date().toLocaleTimeString();

      chart.data.labels.push(now);
      chart.data.datasets[0].data.push(metrics.performance.responseTime);
      chart.data.datasets[1].data.push(metrics.performance.throughput);

      // Keep only last 20 data points
      if (chart.data.labels.length > 20) {
        chart.data.labels.shift();
        chart.data.datasets[0].data.shift();
        chart.data.datasets[1].data.shift();
      }

      chart.update('none');
    }

    // Update token usage chart
    if (this.charts.tokenUsage && metrics.tokens) {
      const chart = this.charts.tokenUsage;
      chart.data.datasets[0].data = [
        metrics.tokens.input,
        metrics.tokens.output,
        metrics.tokens.cached,
      ];
      chart.update('none');
    }

    // Update system health chart
    if (this.charts.systemHealth && metrics.health) {
      const chart = this.charts.systemHealth;
      chart.data.datasets[0].data = [
        metrics.health.cpu,
        metrics.health.memory,
        metrics.health.disk,
        metrics.health.network,
        metrics.health.api,
        metrics.health.database,
      ];
      chart.update('none');
    }

    // Update load monitor chart
    if (this.charts.loadMonitor && metrics.load) {
      const chart = this.charts.loadMonitor;
      chart.data.datasets[0].data = [
        metrics.load.oneMin,
        metrics.load.fiveMin,
        metrics.load.fifteenMin,
        metrics.load.thirtyMin,
        metrics.load.oneHour,
        metrics.load.twentyFourHour,
      ];
      chart.update('none');
    }

    // Update metric displays
    this.updateMetricDisplays(metrics);
  }

  updateMetricDisplays(metrics) {
    // Performance metrics
    const perfSection = document.getElementById('performance-metrics');
    if (perfSection && metrics.performance) {
      perfSection.innerHTML = `
                <div class="metric-card">
                    <div class="metric-label">Response Time</div>
                    <div class="metric-value">${metrics.performance.responseTime}ms</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Throughput</div>
                    <div class="metric-value">${metrics.performance.throughput} req/s</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Error Rate</div>
                    <div class="metric-value">${metrics.performance.errorRate}%</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Uptime</div>
                    <div class="metric-value">${metrics.performance.uptime}</div>
                </div>
            `;
    }

    // Token usage metrics
    const tokenSection = document.getElementById('token-metrics');
    if (tokenSection && metrics.tokens) {
      const total = metrics.tokens.input + metrics.tokens.output + metrics.tokens.cached;
      tokenSection.innerHTML = `
                <div class="metric-card">
                    <div class="metric-label">Total Tokens</div>
                    <div class="metric-value">${total.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Input Tokens</div>
                    <div class="metric-value">${metrics.tokens.input.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Output Tokens</div>
                    <div class="metric-value">${metrics.tokens.output.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                    <div class="metric-label">Cache Hit Rate</div>
                    <div class="metric-value">${((metrics.tokens.cached / total) * 100).toFixed(1)}%</div>
                </div>
            `;
    }

    // System health status
    const healthSection = document.getElementById('health-status');
    if (healthSection && metrics.health) {
      const overallHealth = Math.round(
        (metrics.health.cpu +
          metrics.health.memory +
          metrics.health.disk +
          metrics.health.network +
          metrics.health.api +
          metrics.health.database) /
          6,
      );

      healthSection.innerHTML = `
                <div class="health-overview">
                    <div class="health-score ${this.getHealthClass(overallHealth)}">
                        ${overallHealth}%
                    </div>
                    <div class="health-label">Overall Health</div>
                </div>
                <div class="health-components">
                    <div class="health-component">
                        <span class="component-name">CPU</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.cpu)}">${metrics.health.cpu}%</span>
                    </div>
                    <div class="health-component">
                        <span class="component-name">Memory</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.memory)}">${metrics.health.memory}%</span>
                    </div>
                    <div class="health-component">
                        <span class="component-name">Disk</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.disk)}">${metrics.health.disk}%</span>
                    </div>
                    <div class="health-component">
                        <span class="component-name">Network</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.network)}">${metrics.health.network}%</span>
                    </div>
                    <div class="health-component">
                        <span class="component-name">API</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.api)}">${metrics.health.api}%</span>
                    </div>
                    <div class="health-component">
                        <span class="component-name">Database</span>
                        <span class="component-value ${this.getHealthClass(metrics.health.database)}">${metrics.health.database}%</span>
                    </div>
                </div>
            `;
    }
  }

  getHealthClass(score) {
    if (score >= 90) return 'health-excellent';
    if (score >= 70) return 'health-good';
    if (score >= 50) return 'health-warning';
    return 'health-critical';
  }

  handleAlert(alert) {
    const alertsContainer = document.getElementById('alerts-container');
    if (alertsContainer) {
      const alertElement = document.createElement('div');
      alertElement.className = `alert alert-${alert.severity}`;
      alertElement.innerHTML = `
                <div class="alert-header">
                    <span class="alert-title">${alert.title}</span>
                    <span class="alert-timestamp">${new Date(alert.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="alert-message">${alert.message}</div>
                <button class="alert-dismiss" onclick="this.parentElement.remove()">×</button>
            `;
      alertsContainer.insertBefore(alertElement, alertsContainer.firstChild);

      // Auto-dismiss after 10 seconds for info alerts
      if (alert.severity === 'info') {
        setTimeout(() => {
          if (alertElement.parentElement) {
            alertElement.remove();
          }
        }, 10000);
      }
    }
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    // Update tab buttons
    document.querySelectorAll('.analysis-tab').forEach((tab) => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content panels
    document.querySelectorAll('.analysis-panel').forEach((panel) => {
      panel.classList.remove('active');
    });
    document.getElementById(`${tabName}-panel`).classList.add('active');

    // Refresh charts when switching tabs
    setTimeout(() => {
      Object.values(this.charts).forEach((chart) => {
        if (chart && chart.resize) {
          chart.resize();
        }
      });
    }, 100);
  }

  // Tool execution methods
  async executeTool(toolName) {
    const button = document.querySelector(`[data-tool="${toolName}"]`);
    if (button) {
      button.classList.add('loading');
      button.disabled = true;
    }

    try {
      switch (toolName) {
        case 'performance_report':
          await this.performanceReport();
          break;
        case 'bottleneck_analyze':
          await this.bottleneckAnalyze();
          break;
        case 'token_usage':
          await this.tokenUsage();
          break;
        case 'benchmark_run':
          await this.benchmarkRun();
          break;
        case 'metrics_collect':
          await this.metricsCollect();
          break;
        case 'trend_analysis':
          await this.trendAnalysis();
          break;
        case 'cost_analysis':
          await this.costAnalysis();
          break;
        case 'quality_assess':
          await this.qualityAssess();
          break;
        case 'error_analysis':
          await this.errorAnalysis();
          break;
        case 'usage_stats':
          await this.usageStats();
          break;
        case 'health_check':
          await this.healthCheck();
          break;
        case 'load_monitor':
          await this.loadMonitor();
          break;
        case 'capacity_plan':
          await this.capacityPlan();
          break;
        default:
          console.warn('Unknown tool:', toolName);
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      this.showError(`Failed to execute ${toolName}: ${error.message}`);
    } finally {
      if (button) {
        button.classList.remove('loading');
        button.disabled = false;
      }
    }
  }

  // Tool implementations
  async performanceReport() {
    try {
      const report = await this.fetchAnalysisData('/api/analysis/performance-report');
      this.displayReport('performance-report-output', report);
      await this.notifyToolCompletion('performance_report');
    } catch (error) {
      this.displayError(
        'performance-report-output',
        'Unable to fetch performance report. Please ensure the analysis service is running.',
      );
    }
  }

  async bottleneckAnalyze() {
    try {
      const analysis = await this.fetchAnalysisData('/api/analysis/bottleneck-analyze');
      this.displayAnalysis('bottleneck-analysis-output', analysis);
      await this.notifyToolCompletion('bottleneck_analyze');
    } catch (error) {
      this.displayError(
        'bottleneck-analysis-output',
        'Unable to fetch bottleneck analysis. Please ensure the analysis service is running.',
      );
    }
  }

  async tokenUsage() {
    try {
      const usage = await this.fetchAnalysisData('/api/analysis/token-usage');
      this.displayUsage('token-usage-output', usage);
      await this.notifyToolCompletion('token_usage');
    } catch (error) {
      this.displayError(
        'token-usage-output',
        'Unable to fetch token usage data. Please ensure the analysis service is running.',
      );
    }
  }

  async benchmarkRun() {
    try {
      const benchmark = await this.fetchAnalysisData('/api/analysis/benchmark-run');
      this.displayBenchmark('benchmark-output', benchmark);
      await this.notifyToolCompletion('benchmark_run');
    } catch (error) {
      this.displayError(
        'benchmark-output',
        'Unable to run benchmark. Please ensure the analysis service is running.',
      );
    }
  }

  async metricsCollect() {
    try {
      const metrics = await this.fetchAnalysisData('/api/analysis/metrics-collect');
      this.displayMetrics('metrics-output', metrics);
      await this.notifyToolCompletion('metrics_collect');
    } catch (error) {
      this.displayError(
        'metrics-output',
        'Unable to collect metrics. Please ensure the analysis service is running.',
      );
    }
  }

  async trendAnalysis() {
    try {
      const trends = await this.fetchAnalysisData('/api/analysis/trend-analysis');
      this.displayTrends('trends-output', trends);
      await this.notifyToolCompletion('trend_analysis');
    } catch (error) {
      this.displayError(
        'trends-output',
        'Unable to fetch trend analysis. Please ensure the analysis service is running.',
      );
    }
  }

  async costAnalysis() {
    try {
      const costs = await this.fetchAnalysisData('/api/analysis/cost-analysis');
      this.displayCosts('costs-output', costs);
      await this.notifyToolCompletion('cost_analysis');
    } catch (error) {
      this.displayError(
        'costs-output',
        'Unable to fetch cost analysis. Please ensure the analysis service is running.',
      );
    }
  }

  async qualityAssess() {
    try {
      const quality = await this.fetchAnalysisData('/api/analysis/quality-assess');
      this.displayQuality('quality-output', quality);
      await this.notifyToolCompletion('quality_assess');
    } catch (error) {
      this.displayError(
        'quality-output',
        'Unable to assess quality. Please ensure the analysis service is running.',
      );
    }
  }

  async errorAnalysis() {
    try {
      const errors = await this.fetchAnalysisData('/api/analysis/error-analysis');
      this.displayErrors('errors-output', errors);
      await this.notifyToolCompletion('error_analysis');
    } catch (error) {
      this.displayError(
        'errors-output',
        'Unable to fetch error analysis. Please ensure the analysis service is running.',
      );
    }
  }

  async usageStats() {
    try {
      const stats = await this.fetchAnalysisData('/api/analysis/usage-stats');
      this.displayStats('stats-output', stats);
      await this.notifyToolCompletion('usage_stats');
    } catch (error) {
      this.displayError(
        'stats-output',
        'Unable to fetch usage statistics. Please ensure the analysis service is running.',
      );
    }
  }

  async healthCheck() {
    try {
      const health = await this.fetchAnalysisData('/api/analysis/health-check');
      this.displayHealth('health-output', health);
      await this.notifyToolCompletion('health_check');
    } catch (error) {
      this.displayError(
        'health-output',
        'Unable to perform health check. Please ensure the analysis service is running.',
      );
    }
  }

  async loadMonitor() {
    try {
      const load = await this.fetchAnalysisData('/api/analysis/load-monitor');
      this.displayLoad('load-output', load);
      await this.notifyToolCompletion('load_monitor');
    } catch (error) {
      this.displayError(
        'load-output',
        'Unable to monitor load. Please ensure the analysis service is running.',
      );
    }
  }

  async capacityPlan() {
    try {
      const capacity = await this.fetchAnalysisData('/api/analysis/capacity-plan');
      this.displayCapacity('capacity-output', capacity);
      await this.notifyToolCompletion('capacity_plan');
    } catch (error) {
      this.displayError(
        'capacity-output',
        'Unable to fetch capacity plan. Please ensure the analysis service is running.',
      );
    }
  }

  async fetchAnalysisData(endpoint) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Fetch error:', error);
      // Show error message instead of falling back to mock data
      this.showError(`Failed to fetch data from ${endpoint}: ${error.message}`);
      throw error; // Re-throw to let calling functions handle the error
    }
  }

  getMockData(endpoint) {
    const mockData = {
      '/api/analysis/performance-report': {
        summary: 'System performance is within acceptable ranges',
        metrics: {
          averageResponseTime: 245,
          throughput: 1250,
          errorRate: 0.02,
          uptime: '99.8%',
        },
        recommendations: [
          'Consider caching frequently accessed data',
          'Optimize database queries for better performance',
          'Monitor memory usage during peak hours',
        ],
      },
      '/api/analysis/bottleneck-analyze': {
        bottlenecks: [
          { component: 'Database', severity: 'medium', impact: 'Response time +15%' },
          { component: 'API Gateway', severity: 'low', impact: 'Throughput -5%' },
        ],
        recommendations: [
          'Add database read replicas',
          'Implement connection pooling',
          'Optimize slow queries',
        ],
      },
      '/api/analysis/token-usage': {
        totalTokens: 2450000,
        inputTokens: 1200000,
        outputTokens: 950000,
        cachedTokens: 300000,
        cost: 245.5,
        efficiency: 85.2,
      },
    };
    return mockData[endpoint] || { message: 'No data available' };
  }

  displayReport(containerId, report) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
            <div class="report-summary">
                <h3>Performance Report</h3>
                <p>${report.summary}</p>
            </div>
            <div class="report-metrics">
                <div class="metric-grid">
                    <div class="metric-item">
                        <label>Average Response Time</label>
                        <span>${report.metrics.averageResponseTime}ms</span>
                    </div>
                    <div class="metric-item">
                        <label>Throughput</label>
                        <span>${report.metrics.throughput} req/s</span>
                    </div>
                    <div class="metric-item">
                        <label>Error Rate</label>
                        <span>${(report.metrics.errorRate * 100).toFixed(2)}%</span>
                    </div>
                    <div class="metric-item">
                        <label>Uptime</label>
                        <span>${report.metrics.uptime}</span>
                    </div>
                </div>
            </div>
            <div class="report-recommendations">
                <h4>Recommendations</h4>
                <ul>
                    ${report.recommendations.map((rec) => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
        `;
  }

  displayAnalysis(containerId, analysis) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
            <div class="analysis-results">
                <h3>Bottleneck Analysis</h3>
                <div class="bottleneck-list">
                    ${analysis.bottlenecks
                      .map(
                        (bottleneck) => `
                        <div class="bottleneck-item severity-${bottleneck.severity}">
                            <div class="bottleneck-component">${bottleneck.component}</div>
                            <div class="bottleneck-severity">${bottleneck.severity}</div>
                            <div class="bottleneck-impact">${bottleneck.impact}</div>
                        </div>
                    `,
                      )
                      .join('')}
                </div>
                <div class="analysis-recommendations">
                    <h4>Recommendations</h4>
                    <ul>
                        ${analysis.recommendations.map((rec) => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
  }

  displayUsage(containerId, usage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
            <div class="usage-overview">
                <h3>Token Usage Analysis</h3>
                <div class="usage-stats">
                    <div class="usage-stat">
                        <label>Total Tokens</label>
                        <span>${usage.totalTokens.toLocaleString()}</span>
                    </div>
                    <div class="usage-stat">
                        <label>Input Tokens</label>
                        <span>${usage.inputTokens.toLocaleString()}</span>
                    </div>
                    <div class="usage-stat">
                        <label>Output Tokens</label>
                        <span>${usage.outputTokens.toLocaleString()}</span>
                    </div>
                    <div class="usage-stat">
                        <label>Cached Tokens</label>
                        <span>${usage.cachedTokens.toLocaleString()}</span>
                    </div>
                    <div class="usage-stat">
                        <label>Total Cost</label>
                        <span>$${usage.cost.toFixed(2)}</span>
                    </div>
                    <div class="usage-stat">
                        <label>Efficiency</label>
                        <span>${usage.efficiency.toFixed(1)}%</span>
                    </div>
                </div>
            </div>
        `;
  }

  exportData(type, format) {
    const data = this.metricsCache.get('latest') || {};
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${type}_${timestamp}.${format}`;

    if (format === 'json') {
      this.downloadJSON(data, filename);
    } else if (format === 'csv') {
      this.downloadCSV(data, filename);
    }
  }

  downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadCSV(data, filename) {
    const csv = this.jsonToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  jsonToCSV(json) {
    const flatten = (obj, prefix = '') => {
      const flattened = {};
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          Object.assign(flattened, flatten(obj[key], prefix + key + '.'));
        } else {
          // Convert arrays to JSON strings for CSV
          flattened[prefix + key] = Array.isArray(obj[key]) ? JSON.stringify(obj[key]) : obj[key];
        }
      }
      return flattened;
    };

    const flattened = flatten(json);
    const headers = Object.keys(flattened);
    const valueRow = headers
      .map((header) => {
        const value = flattened[header];
        if (value === null || value === undefined) {
          return '';
        }
        let strValue = String(value);
        // Escape CSV values that contain commas, quotes, or newlines
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          strValue = '"' + strValue.replace(/"/g, '""') + '"';
        }
        return strValue;
      })
      .join(',');

    return [headers.join(','), valueRow].join('\n');
  }

  refreshSection(section) {
    switch (section) {
      case 'metrics':
        this.requestMetricsUpdate();
        break;
      case 'charts':
        Object.values(this.charts).forEach((chart) => {
          if (chart && chart.update) {
            chart.update();
          }
        });
        break;
      case 'alerts':
        document.getElementById('alerts-container').innerHTML = '';
        break;
      default:
        console.warn('Unknown section:', section);
    }
  }

  updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
      statusElement.className = `connection-status ${status}`;
      statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  showError(message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    document.body.appendChild(errorElement);

    setTimeout(() => {
      errorElement.remove();
    }, 5000);
  }

  displayError(containerId, message) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
            <div class="error-container">
                <div class="error-icon">❌</div>
                <div class="error-message">
                    <h4>Error</h4>
                    <p>${message}</p>
                </div>
                <div class="error-actions">
                    <button class="retry-btn" onclick="location.reload()">Retry</button>
                    <button class="dismiss-btn" onclick="this.parentElement.parentElement.remove()">Dismiss</button>
                </div>
            </div>
        `;
  }

  async notifyToolCompletion(toolName) {
    try {
      // Notify swarm of tool completion
      const response = await fetch('/api/swarm/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `${toolName} completed`,
          timestamp: Date.now(),
          agent: 'analysis-tools',
        }),
      });

      if (!response.ok) {
        console.warn('Failed to notify swarm');
      }
    } catch (error) {
      console.error('Error notifying swarm:', error);
    }
  }

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    if (this.ws) {
      this.ws.close();
    }

    Object.values(this.charts).forEach((chart) => {
      if (chart && chart.destroy) {
        chart.destroy();
      }
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.analysisTools = new AnalysisTools();
});

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AnalysisTools;
}
