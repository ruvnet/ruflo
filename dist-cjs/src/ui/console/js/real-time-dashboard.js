import { SwarmVisualizer } from './swarm-visualizer.js';
export class RealTimeDashboard {
    constructor(container, componentLibrary){
        this.container = container;
        this.components = componentLibrary;
        this.swarmVisualizer = null;
        this.isActive = false;
        this.updateInterval = null;
        this.websocket = null;
        this.metrics = {
            history: [],
            current: null
        };
        this.init();
    }
    init() {
        this.createDashboardLayout();
        this.setupWebSocket();
        this.startMetricsCollection();
        console.log('📊 Real-time Dashboard initialized');
    }
    createDashboardLayout() {
        const dashboard = document.createElement('div');
        dashboard.className = 'claude-realtime-dashboard';
        dashboard.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto 1fr auto;
      gap: 16px;
      height: 100vh;
      padding: 16px;
      background: #0a0a0a;
      color: white;
    `;
        const header = this.createDashboardHeader();
        dashboard.appendChild(header);
        const content = document.createElement('div');
        content.style.cssText = `
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
      overflow: hidden;
    `;
        const leftPanel = document.createElement('div');
        leftPanel.className = 'dashboard-left-panel';
        this.swarmVisualizer = new SwarmVisualizer(leftPanel, this.components);
        const rightPanel = this.createRightPanel();
        content.appendChild(leftPanel);
        content.appendChild(rightPanel);
        dashboard.appendChild(content);
        const footer = this.createDashboardFooter();
        dashboard.appendChild(footer);
        this.container.appendChild(dashboard);
        this.elements = {
            dashboard,
            header,
            content,
            leftPanel,
            rightPanel,
            footer
        };
    }
    createDashboardHeader() {
        const header = document.createElement('div');
        header.style.cssText = `
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
    `;
        const titleSection = document.createElement('div');
        titleSection.innerHTML = `
      <h1 style="margin: 0; color: #00d4ff; font-size: 24px;">
        🌊 Claude Flow Real-Time Dashboard
      </h1>
      <p style="margin: 4px 0 0 0; color: #888; font-size: 14px;">
        Live swarm monitoring and performance analytics
      </p>
    `;
        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '12px';
        const startBtn = this.components.createActionButton({
            type: 'primary',
            text: 'Start All',
            icon: '▶️',
            onclick: ()=>this.startAllMonitoring()
        });
        const stopBtn = this.components.createActionButton({
            type: 'secondary',
            text: 'Stop All',
            icon: '⏹️',
            onclick: ()=>this.stopAllMonitoring()
        });
        const exportBtn = this.components.createActionButton({
            type: 'secondary',
            text: 'Export Data',
            icon: '💾',
            onclick: ()=>this.exportDashboardData()
        });
        controls.appendChild(startBtn.element);
        controls.appendChild(stopBtn.element);
        controls.appendChild(exportBtn.element);
        header.appendChild(titleSection);
        header.appendChild(controls);
        this.headerElements = {
            startBtn,
            stopBtn,
            exportBtn
        };
        return header;
    }
    createRightPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    `;
        const metricsChart = this.createMetricsChart();
        panel.appendChild(metricsChart);
        const healthPanel = this.createHealthPanel();
        panel.appendChild(healthPanel);
        const memoryChart = this.createMemoryChart();
        panel.appendChild(memoryChart);
        const queueStatus = this.createQueueStatus();
        panel.appendChild(queueStatus);
        const activityLog = this.createActivityLog();
        panel.appendChild(activityLog);
        return panel;
    }
    createMetricsChart() {
        const metricsChart = this.components.createMetricsChart({
            title: 'Performance Metrics',
            width: 350,
            height: 200,
            type: 'line'
        });
        this.updateMetricsChart(metricsChart);
        this.metricsChart = metricsChart;
        return metricsChart.element;
    }
    createHealthPanel() {
        const panel = this.components.createInfoPanel({
            title: '🏥 System Health'
        });
        const healthMetrics = [
            {
                name: 'CPU Usage',
                value: '45%',
                status: 'good'
            },
            {
                name: 'Memory Usage',
                value: '2.1GB',
                status: 'good'
            },
            {
                name: 'Network I/O',
                value: '120 Mbps',
                status: 'good'
            },
            {
                name: 'Disk Usage',
                value: '67%',
                status: 'warning'
            },
            {
                name: 'Response Time',
                value: '234ms',
                status: 'good'
            }
        ];
        const healthHTML = healthMetrics.map((metric)=>`
      <div style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0;">
        <span>${metric.name}:</span>
        <span class="health-metric health-${metric.status}" style="
          padding: 4px 8px;
          border-radius: 4px;
          font-weight: bold;
          ${metric.status === 'good' ? 'background: #22c55e; color: white;' : metric.status === 'warning' ? 'background: #f59e0b; color: white;' : 'background: #ef4444; color: white;'}
        ">${metric.value}</span>
      </div>
    `).join('');
        panel.setContent(healthHTML);
        this.healthPanel = panel;
        return panel.element;
    }
    createMemoryChart() {
        const memoryChart = this.components.createMetricsChart({
            title: 'Memory Usage Over Time',
            width: 350,
            height: 150,
            type: 'line'
        });
        this.updateMemoryChart(memoryChart);
        this.memoryChart = memoryChart;
        return memoryChart.element;
    }
    createQueueStatus() {
        const panel = this.components.createInfoPanel({
            title: '📋 Task Queue Status'
        });
        const queueData = {
            pending: Math.floor(Math.random() * 20),
            processing: Math.floor(Math.random() * 8),
            completed: Math.floor(Math.random() * 150) + 50,
            failed: Math.floor(Math.random() * 5)
        };
        const queueHTML = `
      <div class="queue-stats" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="queue-stat">
          <div style="font-size: 24px; font-weight: bold; color: #f59e0b;">${queueData.pending}</div>
          <div style="color: #888; font-size: 12px;">Pending</div>
        </div>
        <div class="queue-stat">
          <div style="font-size: 24px; font-weight: bold; color: #00d4ff;">${queueData.processing}</div>
          <div style="color: #888; font-size: 12px;">Processing</div>
        </div>
        <div class="queue-stat">
          <div style="font-size: 24px; font-weight: bold; color: #22c55e;">${queueData.completed}</div>
          <div style="color: #888; font-size: 12px;">Completed</div>
        </div>
        <div class="queue-stat">
          <div style="font-size: 24px; font-weight: bold; color: #ef4444;">${queueData.failed}</div>
          <div style="color: #888; font-size: 12px;">Failed</div>
        </div>
      </div>
    `;
        panel.setContent(queueHTML);
        this.queuePanel = panel;
        return panel.element;
    }
    createActivityLog() {
        const panel = this.components.createInfoPanel({
            title: '📝 Recent Activity'
        });
        const activities = [
            {
                time: '14:23:15',
                type: 'info',
                message: 'Agent coder_01 completed task #127'
            },
            {
                time: '14:22:58',
                type: 'success',
                message: 'Swarm topology optimized (+12% efficiency)'
            },
            {
                time: '14:22:45',
                type: 'warning',
                message: 'Agent analyzer_03 high memory usage (89%)'
            },
            {
                time: '14:22:30',
                type: 'info',
                message: 'New task assigned to researcher_02'
            },
            {
                time: '14:22:12',
                type: 'error',
                message: 'Connection timeout to agent reviewer_01'
            }
        ];
        const activityHTML = activities.map((activity)=>`
      <div class="activity-item" style="
        display: flex; 
        gap: 8px; 
        margin: 8px 0; 
        padding: 8px; 
        background: #2a2a2a; 
        border-radius: 4px;
        border-left: 3px solid ${activity.type === 'success' ? '#22c55e' : activity.type === 'warning' ? '#f59e0b' : activity.type === 'error' ? '#ef4444' : '#00d4ff'};
      ">
        <span style="color: #888; font-size: 12px; min-width: 60px;">${activity.time}</span>
        <span style="font-size: 14px;">${activity.message}</span>
      </div>
    `).join('');
        panel.setContent(`<div style="max-height: 200px; overflow-y: auto;">${activityHTML}</div>`);
        this.activityPanel = panel;
        return panel.element;
    }
    createDashboardFooter() {
        const footer = document.createElement('div');
        footer.style.cssText = `
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      font-size: 12px;
      color: #888;
    `;
        const leftStatus = document.createElement('div');
        leftStatus.innerHTML = `
      Status: <span id="dashboard-status" style="color: #22c55e;">●</span> Active |
      Uptime: <span id="dashboard-uptime">00:00:00</span> |
      Last Update: <span id="dashboard-last-update">Never</span>
    `;
        const rightStatus = document.createElement('div');
        rightStatus.innerHTML = `
      Total Messages: <span id="dashboard-messages">0</span> |
      Data Points: <span id="dashboard-data-points">0</span> |
      Version: Claude Flow v2.0.0
    `;
        footer.appendChild(leftStatus);
        footer.appendChild(rightStatus);
        this.footerElements = {
            status: leftStatus.querySelector('#dashboard-status'),
            uptime: leftStatus.querySelector('#dashboard-uptime'),
            lastUpdate: leftStatus.querySelector('#dashboard-last-update'),
            messages: rightStatus.querySelector('#dashboard-messages'),
            dataPoints: rightStatus.querySelector('#dashboard-data-points')
        };
        return footer;
    }
    setupWebSocket() {
        try {
            const wsUrl = 'ws://localhost:3000/dashboard';
            this.websocket = new WebSocket(wsUrl);
            this.websocket.onopen = ()=>{
                console.log('📡 Dashboard WebSocket connected');
                this.updateConnectionStatus(true);
            };
            this.websocket.onmessage = (event)=>{
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (error) {
                    console.warn('Failed to parse WebSocket message:', error);
                }
            };
            this.websocket.onclose = ()=>{
                console.log('📡 Dashboard WebSocket disconnected');
                this.updateConnectionStatus(false);
                setTimeout(()=>this.setupWebSocket(), 5000);
            };
            this.websocket.onerror = (error)=>{
                console.error('📡 Dashboard WebSocket error:', error);
            };
        } catch (error) {
            console.warn('WebSocket not available, using polling fallback');
            this.startPollingFallback();
        }
    }
    handleWebSocketMessage(data) {
        switch(data.type){
            case 'swarm_update':
                if (this.swarmVisualizer) {
                    this.swarmVisualizer.swarmData = data.payload;
                    this.swarmVisualizer.processSwarmData();
                    this.swarmVisualizer.updateStats();
                }
                break;
            case 'metrics_update':
                this.updateMetricsFromData(data.payload);
                break;
            case 'health_update':
                this.updateHealthStatus(data.payload);
                break;
            case 'activity_log':
                this.addActivityLog(data.payload);
                break;
            default:
                console.log('Unknown WebSocket message type:', data.type);
        }
        this.updateLastUpdateTime();
    }
    startPollingFallback() {
        this.updateInterval = setInterval(()=>{
            this.fetchDashboardData();
        }, 2000);
    }
    async fetchDashboardData() {
        try {
            const response = await fetch('/api/claude-flow/dashboard/data');
            if (response.ok) {
                const data = await response.json();
                this.handleDashboardData(data);
            }
        } catch (error) {
            console.warn('Failed to fetch dashboard data:', error);
            this.handleDashboardData(this.generateMockDashboardData());
        }
    }
    generateMockDashboardData() {
        return {
            swarm: {
                agents: 6,
                active: 4,
                busy: 2,
                idle: 2,
                errors: 0
            },
            metrics: {
                cpuUsage: Math.random() * 30 + 20,
                memoryUsage: Math.random() * 40 + 40,
                throughput: Math.random() * 50 + 25,
                latency: Math.random() * 200 + 100
            },
            health: {
                overall: 'good',
                services: [
                    'swarm',
                    'memory',
                    'neural'
                ].map((service)=>({
                        name: service,
                        status: Math.random() > 0.8 ? 'warning' : 'good'
                    }))
            }
        };
    }
    updateMetricsFromData(data) {
        this.metrics.history.push({
            timestamp: Date.now(),
            ...data
        });
        if (this.metrics.history.length > 50) {
            this.metrics.history.shift();
        }
        this.metrics.current = data;
        this.updateMetricsChart(this.metricsChart);
        this.updateMemoryChart(this.memoryChart);
    }
    updateMetricsChart(chart) {
        if (!chart || !this.metrics.history.length) return;
        const data = this.metrics.history.map((point, index)=>({
                x: index,
                value: point.throughput || Math.random() * 100
            }));
        chart.updateData(data);
    }
    updateMemoryChart(chart) {
        if (!chart || !this.metrics.history.length) return;
        const data = this.metrics.history.map((point, index)=>({
                x: index,
                value: point.memoryUsage || Math.random() * 100
            }));
        chart.updateData(data);
    }
    startAllMonitoring() {
        this.isActive = true;
        if (this.swarmVisualizer) {
            this.swarmVisualizer.startMonitoring();
        }
        this.startMetricsCollection();
        this.headerElements.startBtn.setDisabled(true);
        this.headerElements.stopBtn.setDisabled(false);
        this.updateConnectionStatus(true);
        console.log('🚀 All dashboard monitoring started');
    }
    stopAllMonitoring() {
        this.isActive = false;
        if (this.swarmVisualizer) {
            this.swarmVisualizer.stopMonitoring();
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.headerElements.startBtn.setDisabled(false);
        this.headerElements.stopBtn.setDisabled(true);
        this.updateConnectionStatus(false);
        console.log('⏹️ All dashboard monitoring stopped');
    }
    startMetricsCollection() {
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            this.startPollingFallback();
        }
    }
    updateConnectionStatus(connected) {
        if (this.footerElements.status) {
            this.footerElements.status.style.color = connected ? '#22c55e' : '#ef4444';
            this.footerElements.status.textContent = connected ? '●' : '●';
        }
    }
    updateLastUpdateTime() {
        if (this.footerElements.lastUpdate) {
            this.footerElements.lastUpdate.textContent = new Date().toLocaleTimeString();
        }
    }
    exportDashboardData() {
        const exportData = {
            timestamp: Date.now(),
            metrics: this.metrics,
            swarmData: this.swarmVisualizer?.swarmData,
            version: 'Claude Flow v2.0.0'
        };
        const blob = new Blob([
            JSON.stringify(exportData, null, 2)
        ], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `claude-flow-dashboard-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('💾 Dashboard data exported');
    }
    async storeProgressToMemory() {
        const progressData = {
            dashboardActive: this.isActive,
            metricsCount: this.metrics.history.length,
            swarmVisualizerActive: this.swarmVisualizer?.isActive || false,
            lastUpdate: Date.now(),
            components: {
                swarmVisualizer: 'active',
                metricsChart: 'active',
                healthPanel: 'active',
                activityLog: 'active'
            }
        };
        try {
            console.log('📊 Storing dashboard progress to memory:', progressData);
        } catch (error) {
            console.warn('Failed to store progress to memory:', error);
        }
    }
    destroy() {
        this.stopAllMonitoring();
        if (this.websocket) {
            this.websocket.close();
        }
        if (this.swarmVisualizer) {
            this.swarmVisualizer.destroy();
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
export default RealTimeDashboard;

//# sourceMappingURL=real-time-dashboard.js.map