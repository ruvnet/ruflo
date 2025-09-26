import { EventEmitter } from 'node:events';
export class RealTimeMonitor extends EventEmitter {
    logger;
    eventBus;
    memory;
    config;
    timeSeries = new Map();
    activeAlerts = new Map();
    alertHistory = [];
    monitoringInterval;
    healthCheckInterval;
    alertRules = new Map();
    healthChecks = new Map();
    systemMetrics;
    agentMetrics = new Map();
    swarmMetrics;
    dashboards = new Map();
    lastMetricsUpdate = new Date();
    metricsBuffer = [];
    alertProcessor;
    constructor(config, logger, eventBus, memory){
        super();
        this.logger = logger;
        this.eventBus = eventBus;
        this.memory = memory;
        this.config = {
            updateInterval: 5000,
            retentionPeriod: 86400000,
            alertingEnabled: true,
            alertThresholds: {
                cpu: {
                    warning: 70,
                    critical: 90
                },
                memory: {
                    warning: 80,
                    critical: 95
                },
                disk: {
                    warning: 85,
                    critical: 95
                },
                errorRate: {
                    warning: 5,
                    critical: 10
                },
                responseTime: {
                    warning: 5000,
                    critical: 10000
                },
                queueDepth: {
                    warning: 10,
                    critical: 20
                },
                agentHealth: {
                    warning: 0.7,
                    critical: 0.5
                },
                swarmUtilization: {
                    warning: 0.8,
                    critical: 0.95
                }
            },
            metricsEnabled: true,
            tracingEnabled: true,
            dashboardEnabled: true,
            exportEnabled: false,
            exportFormat: 'json',
            debugMode: false,
            ...config
        };
        this.systemMetrics = this.initializeSystemMetrics();
        this.swarmMetrics = this.initializeSwarmMetrics();
        this.setupEventHandlers();
        this.initializeDefaultAlertRules();
        this.initializeDefaultDashboards();
    }
    setupEventHandlers() {
        this.eventBus.on('agent:metrics-update', (data)=>{
            this.updateAgentMetrics(data.agentId, data.metrics);
        });
        this.eventBus.on('agent:status-changed', (data)=>{
            this.recordMetric('agent.status.change', 1, {
                agentId: data.agentId,
                from: data.from,
                to: data.to
            });
        });
        this.eventBus.on('task:started', (data)=>{
            this.recordMetric('task.started', 1, {
                taskId: data.taskId,
                agentId: data.agentId
            });
        });
        this.eventBus.on('task:completed', (data)=>{
            this.recordMetric('task.completed', 1, {
                taskId: data.taskId
            });
            this.recordMetric('task.duration', data.duration, {
                taskId: data.taskId
            });
        });
        this.eventBus.on('task:failed', (data)=>{
            this.recordMetric('task.failed', 1, {
                taskId: data.taskId,
                error: data.error
            });
        });
        this.eventBus.on('system:resource-update', (data)=>{
            this.updateSystemMetrics(data);
        });
        this.eventBus.on('swarm:metrics-update', (data)=>{
            this.updateSwarmMetrics(data.metrics);
        });
        this.eventBus.on('error', (data)=>{
            this.handleError(data);
        });
    }
    async initialize() {
        this.logger.info('Initializing real-time monitor', {
            updateInterval: this.config.updateInterval,
            alerting: this.config.alertingEnabled,
            dashboard: this.config.dashboardEnabled
        });
        this.startMetricsCollection();
        this.startHealthChecks();
        if (this.config.alertingEnabled) {
            this.startAlertProcessing();
        }
        this.initializeHealthChecks();
        this.emit('monitor:initialized');
    }
    async shutdown() {
        this.logger.info('Shutting down real-time monitor');
        if (this.monitoringInterval) clearInterval(this.monitoringInterval);
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        if (this.alertProcessor) clearInterval(this.alertProcessor);
        await this.flushMetrics();
        this.emit('monitor:shutdown');
    }
    startMetricsCollection() {
        this.monitoringInterval = setInterval(()=>{
            this.collectSystemMetrics();
            this.processMetricsBuffer();
            this.cleanupOldMetrics();
        }, this.config.updateInterval);
        this.logger.info('Started metrics collection', {
            interval: this.config.updateInterval
        });
    }
    async collectSystemMetrics() {
        try {
            this.systemMetrics = {
                ...this.systemMetrics,
                timestamp: new Date(),
                cpuUsage: await this.getCpuUsage(),
                memoryUsage: await this.getMemoryUsage(),
                diskUsage: await this.getDiskUsage(),
                networkUsage: await this.getNetworkUsage()
            };
            this.recordMetric('system.cpu', this.systemMetrics.cpuUsage);
            this.recordMetric('system.memory', this.systemMetrics.memoryUsage);
            this.recordMetric('system.disk', this.systemMetrics.diskUsage);
            this.recordMetric('system.network', this.systemMetrics.networkUsage);
            await this.updateSwarmLevelMetrics();
        } catch (error) {
            this.logger.error('Failed to collect system metrics', error);
        }
    }
    async updateSwarmLevelMetrics() {
        const agents = Array.from(this.agentMetrics.values());
        this.swarmMetrics = {
            ...this.swarmMetrics,
            agentUtilization: this.calculateAgentUtilization(agents),
            throughput: this.calculateSwarmThroughput(agents),
            latency: this.calculateAverageLatency(agents),
            efficiency: this.calculateSwarmEfficiency(agents),
            reliability: this.calculateSwarmReliability(agents),
            averageQuality: this.calculateAverageQuality(agents)
        };
        this.recordMetric('swarm.utilization', this.swarmMetrics.agentUtilization);
        this.recordMetric('swarm.throughput', this.swarmMetrics.throughput);
        this.recordMetric('swarm.latency', this.swarmMetrics.latency);
        this.recordMetric('swarm.efficiency', this.swarmMetrics.efficiency);
        this.recordMetric('swarm.reliability', this.swarmMetrics.reliability);
    }
    recordMetric(name, value, tags = {}) {
        const point = {
            timestamp: new Date(),
            value,
            tags
        };
        this.metricsBuffer.push({
            ...point,
            tags: {
                ...tags,
                metric: name
            }
        });
        if (this.isCriticalMetric(name)) {
            this.processMetricPoint(name, point);
        }
    }
    processMetricsBuffer() {
        if (this.metricsBuffer.length === 0) return;
        const metricGroups = new Map();
        for (const point of this.metricsBuffer){
            const metricName = point.tags.metric || 'unknown';
            const group = metricGroups.get(metricName) || [];
            group.push(point);
            metricGroups.set(metricName, group);
        }
        for (const [metricName, points] of metricGroups){
            for (const point of points){
                this.processMetricPoint(metricName, point);
            }
        }
        this.metricsBuffer = [];
    }
    processMetricPoint(metricName, point) {
        let series = this.timeSeries.get(metricName);
        if (!series) {
            series = {
                name: metricName,
                points: [],
                aggregations: {
                    min: point.value,
                    max: point.value,
                    avg: point.value,
                    sum: point.value,
                    count: 1
                },
                lastUpdated: point.timestamp
            };
            this.timeSeries.set(metricName, series);
        }
        series.points.push(point);
        series.lastUpdated = point.timestamp;
        series.aggregations.count++;
        series.aggregations.sum += point.value;
        series.aggregations.avg = series.aggregations.sum / series.aggregations.count;
        series.aggregations.min = Math.min(series.aggregations.min, point.value);
        series.aggregations.max = Math.max(series.aggregations.max, point.value);
        if (this.config.alertingEnabled) {
            this.checkAlertsForMetric(metricName, point);
        }
    }
    startAlertProcessing() {
        this.alertProcessor = setInterval(()=>{
            this.processAlerts();
        }, 1000);
        this.logger.info('Started alert processing');
    }
    processAlerts() {
        const now = new Date();
        for (const [alertId, alert] of this.activeAlerts){
            if (!alert.resolved) {
                const rule = this.alertRules.get(alert.context.ruleId);
                if (rule && this.isAlertResolved(rule, alert)) {
                    this.resolveAlert(alertId, 'condition_resolved');
                }
            }
        }
        this.cleanupResolvedAlerts();
    }
    checkAlertsForMetric(metricName, point) {
        for (const [ruleId, rule] of this.alertRules){
            if (rule.enabled && rule.metric === metricName) {
                this.evaluateAlertRule(rule, point);
            }
        }
    }
    evaluateAlertRule(rule, point) {
        const conditionMet = this.evaluateCondition(rule.condition, point.value, rule.threshold);
        if (conditionMet) {
            const existingAlert = Array.from(this.activeAlerts.values()).find((alert)=>alert.context.ruleId === rule.id && !alert.resolved);
            if (!existingAlert) {
                this.createAlert(rule, point);
            }
        }
    }
    createAlert(rule, triggeringPoint) {
        const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const alert = {
            id: alertId,
            timestamp: new Date(),
            level: rule.severity,
            type: this.getAlertTypeFromMetric(rule.metric),
            message: `${rule.name}: ${rule.metric} ${rule.condition} ${rule.threshold} (current: ${triggeringPoint.value})`,
            source: 'real-time-monitor',
            context: {
                ruleId: rule.id,
                metric: rule.metric,
                value: triggeringPoint.value,
                threshold: rule.threshold,
                tags: {
                    ...rule.tags,
                    ...triggeringPoint.tags
                }
            },
            acknowledged: false,
            resolved: false,
            escalationLevel: 0
        };
        this.activeAlerts.set(alertId, alert);
        this.alertHistory.push(alert);
        this.logger.warn('Alert created', {
            alertId,
            rule: rule.name,
            metric: rule.metric,
            value: triggeringPoint.value,
            threshold: rule.threshold
        });
        this.emit('alert:created', {
            alert
        });
        this.executeAlertActions(rule, alert);
    }
    executeAlertActions(rule, alert) {
        for (const action of rule.actions){
            if (!action.enabled) continue;
            try {
                switch(action.type){
                    case 'log':
                        this.logger.warn(`ALERT: ${alert.message}`, alert.context);
                        break;
                    case 'email':
                        this.sendEmailAlert(alert, action.config);
                        break;
                    case 'webhook':
                        this.sendWebhookAlert(alert, action.config);
                        break;
                    case 'auto-scale':
                        this.triggerAutoScale(alert, action.config);
                        break;
                    case 'restart':
                        this.triggerRestart(alert, action.config);
                        break;
                    default:
                        this.logger.warn('Unknown alert action type', {
                            type: action.type
                        });
                }
            } catch (error) {
                this.logger.error('Failed to execute alert action', {
                    alertId: alert.id,
                    actionType: action.type,
                    error
                });
            }
        }
    }
    resolveAlert(alertId, reason) {
        const alert = this.activeAlerts.get(alertId);
        if (!alert) return;
        alert.resolved = true;
        alert.context.resolutionReason = reason;
        alert.context.resolvedAt = new Date();
        this.logger.info('Alert resolved', {
            alertId,
            reason
        });
        this.emit('alert:resolved', {
            alert,
            reason
        });
    }
    startHealthChecks() {
        this.healthCheckInterval = setInterval(()=>{
            this.performHealthChecks();
        }, 30000);
        this.logger.info('Started health checks');
    }
    async performHealthChecks() {
        const checks = Array.from(this.healthChecks.values());
        const promises = checks.map((check)=>this.executeHealthCheck(check));
        await Promise.allSettled(promises);
    }
    async executeHealthCheck(check) {
        try {
            let isHealthy = false;
            switch(check.type){
                case 'http':
                    isHealthy = await this.performHttpHealthCheck(check);
                    break;
                case 'tcp':
                    isHealthy = await this.performTcpHealthCheck(check);
                    break;
                case 'custom':
                    if (check.customCheck) {
                        isHealthy = await check.customCheck();
                    }
                    break;
            }
            this.recordMetric(`healthcheck.${check.name}`, isHealthy ? 1 : 0, {
                type: check.type,
                target: check.target
            });
        } catch (error) {
            this.logger.error('Health check failed', {
                check: check.name,
                error
            });
            this.recordMetric(`healthcheck.${check.name}`, 0, {
                type: check.type,
                target: check.target,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    createDashboard(title, panels) {
        const dashboardId = `dashboard-${Date.now()}`;
        const dashboard = {
            title,
            panels,
            refreshInterval: 30000,
            timeRange: {
                start: new Date(Date.now() - 3600000),
                end: new Date()
            },
            filters: {}
        };
        this.dashboards.set(dashboardId, dashboard);
        this.emit('dashboard:created', {
            dashboardId,
            dashboard
        });
        return dashboardId;
    }
    getDashboardData(dashboardId) {
        const dashboard = this.dashboards.get(dashboardId);
        if (!dashboard) return null;
        const data = {
            dashboard,
            panels: []
        };
        for (const panel of dashboard.panels){
            const panelData = {
                id: panel.id,
                title: panel.title,
                type: panel.type,
                data: this.getPanelData(panel, dashboard.timeRange)
            };
            data.panels.push(panelData);
        }
        return data;
    }
    getPanelData(panel, timeRange) {
        const data = {};
        for (const metricName of panel.metrics){
            const series = this.timeSeries.get(metricName);
            if (series) {
                const filteredPoints = series.points.filter((point)=>point.timestamp >= timeRange.start && point.timestamp <= timeRange.end);
                data[metricName] = {
                    points: filteredPoints,
                    aggregations: this.calculateAggregations(filteredPoints)
                };
            }
        }
        return data;
    }
    async getCpuUsage() {
        return Math.random() * 100;
    }
    async getMemoryUsage() {
        return Math.random() * 100;
    }
    async getDiskUsage() {
        return Math.random() * 100;
    }
    async getNetworkUsage() {
        return Math.random() * 1024 * 1024;
    }
    updateAgentMetrics(agentId, metrics) {
        this.agentMetrics.set(agentId, metrics);
        this.recordMetric('agent.cpu', metrics.cpuUsage, {
            agentId
        });
        this.recordMetric('agent.memory', metrics.memoryUsage, {
            agentId
        });
        this.recordMetric('agent.tasks.completed', metrics.tasksCompleted, {
            agentId
        });
        this.recordMetric('agent.tasks.failed', metrics.tasksFailed, {
            agentId
        });
        this.recordMetric('agent.response.time', metrics.responseTime, {
            agentId
        });
    }
    updateSystemMetrics(data) {
        this.systemMetrics = {
            ...this.systemMetrics,
            ...data
        };
    }
    updateSwarmMetrics(metrics) {
        this.swarmMetrics = {
            ...this.swarmMetrics,
            ...metrics
        };
    }
    handleError(data) {
        this.recordMetric('error.count', 1, {
            type: data.type || 'unknown',
            source: data.source || 'unknown'
        });
        if (data.severity === 'critical') {
            const alertId = `error-alert-${Date.now()}`;
            const alert = {
                id: alertId,
                timestamp: new Date(),
                level: 'critical',
                type: 'system',
                message: `Critical error: ${data.message}`,
                source: data.source || 'unknown',
                context: data,
                acknowledged: false,
                resolved: false,
                escalationLevel: 0
            };
            this.activeAlerts.set(alertId, alert);
            this.emit('alert:created', {
                alert
            });
        }
    }
    isCriticalMetric(name) {
        const criticalMetrics = [
            'system.cpu',
            'system.memory',
            'system.disk',
            'agent.health',
            'task.failed',
            'error.count'
        ];
        return criticalMetrics.includes(name);
    }
    evaluateCondition(condition, value, threshold) {
        switch(condition){
            case 'gt':
                return value > threshold;
            case 'gte':
                return value >= threshold;
            case 'lt':
                return value < threshold;
            case 'lte':
                return value <= threshold;
            case 'eq':
                return value === threshold;
            default:
                return false;
        }
    }
    isAlertResolved(rule, alert) {
        const series = this.timeSeries.get(rule.metric);
        if (!series || series.points.length === 0) return false;
        const recentPoints = series.points.slice(-5);
        const allResolved = recentPoints.every((point)=>!this.evaluateCondition(rule.condition, point.value, rule.threshold));
        return allResolved;
    }
    getAlertTypeFromMetric(metric) {
        if (metric.includes('system')) return 'system';
        if (metric.includes('agent')) return 'agent';
        if (metric.includes('task')) return 'task';
        if (metric.includes('swarm')) return 'swarm';
        if (metric.includes('performance')) return 'performance';
        if (metric.includes('resource')) return 'resource';
        return 'custom';
    }
    calculateAgentUtilization(agents) {
        if (agents.length === 0) return 0;
        const totalUtilization = agents.reduce((sum, agent)=>sum + agent.cpuUsage, 0);
        return totalUtilization / agents.length;
    }
    calculateSwarmThroughput(agents) {
        return agents.reduce((sum, agent)=>sum + (agent.tasksCompleted || 0), 0);
    }
    calculateAverageLatency(agents) {
        if (agents.length === 0) return 0;
        const totalLatency = agents.reduce((sum, agent)=>sum + agent.responseTime, 0);
        return totalLatency / agents.length;
    }
    calculateSwarmEfficiency(agents) {
        if (agents.length === 0) return 0;
        const totalTasks = agents.reduce((sum, agent)=>sum + (agent.tasksCompleted || 0) + (agent.tasksFailed || 0), 0);
        const completedTasks = agents.reduce((sum, agent)=>sum + (agent.tasksCompleted || 0), 0);
        return totalTasks > 0 ? completedTasks / totalTasks : 1;
    }
    calculateSwarmReliability(agents) {
        if (agents.length === 0) return 1;
        const totalReliability = agents.reduce((sum, agent)=>sum + (agent.successRate || 1), 0);
        return totalReliability / agents.length;
    }
    calculateAverageQuality(agents) {
        if (agents.length === 0) return 0.8;
        const totalQuality = agents.reduce((sum, agent)=>sum + (agent.codeQuality || 0.8), 0);
        return totalQuality / agents.length;
    }
    calculateAggregations(points) {
        if (points.length === 0) {
            return {
                min: 0,
                max: 0,
                avg: 0,
                sum: 0,
                count: 0
            };
        }
        const values = points.map((p)=>p.value);
        return {
            min: Math.min(...values),
            max: Math.max(...values),
            avg: values.reduce((sum, val)=>sum + val, 0) / values.length,
            sum: values.reduce((sum, val)=>sum + val, 0),
            count: values.length
        };
    }
    cleanupOldMetrics() {
        const cutoff = new Date(Date.now() - this.config.retentionPeriod);
        for (const [name, series] of this.timeSeries){
            series.points = series.points.filter((point)=>point.timestamp > cutoff);
            if (series.points.length === 0) {
                this.timeSeries.delete(name);
            }
        }
    }
    cleanupResolvedAlerts() {
        const cutoff = new Date(Date.now() - 86400000);
        for (const [alertId, alert] of this.activeAlerts){
            if (alert.resolved && alert.timestamp < cutoff) {
                this.activeAlerts.delete(alertId);
            }
        }
        this.alertHistory = this.alertHistory.filter((alert)=>alert.timestamp > cutoff).slice(-1000);
    }
    async flushMetrics() {
        if (this.metricsBuffer.length > 0) {
            this.processMetricsBuffer();
        }
        if (this.config.exportEnabled) {
            await this.exportMetrics();
        }
    }
    async exportMetrics() {
        try {
            const exportData = {
                timestamp: new Date(),
                timeSeries: Array.from(this.timeSeries.entries()),
                systemMetrics: this.systemMetrics,
                swarmMetrics: this.swarmMetrics,
                activeAlerts: Array.from(this.activeAlerts.values())
            };
            await this.memory.store('monitoring:export', exportData, {
                type: 'monitoring-export',
                partition: 'metrics'
            });
        } catch (error) {
            this.logger.error('Failed to export metrics', error);
        }
    }
    initializeDefaultAlertRules() {
        const rules = [
            {
                id: 'cpu-warning',
                name: 'High CPU Usage',
                enabled: true,
                metric: 'system.cpu',
                condition: 'gt',
                threshold: this.config.alertThresholds.cpu.warning,
                duration: 60000,
                severity: 'warning',
                tags: {
                    category: 'system'
                },
                actions: [
                    {
                        type: 'log',
                        config: {},
                        enabled: true
                    }
                ],
                suppressions: []
            },
            {
                id: 'memory-critical',
                name: 'Critical Memory Usage',
                enabled: true,
                metric: 'system.memory',
                condition: 'gt',
                threshold: this.config.alertThresholds.memory.critical,
                duration: 30000,
                severity: 'critical',
                tags: {
                    category: 'system'
                },
                actions: [
                    {
                        type: 'log',
                        config: {},
                        enabled: true
                    },
                    {
                        type: 'auto-scale',
                        config: {
                            action: 'scale-down'
                        },
                        enabled: true
                    }
                ],
                suppressions: []
            }
        ];
        rules.forEach((rule)=>this.alertRules.set(rule.id, rule));
    }
    initializeDefaultDashboards() {
        const systemDashboard = this.createDashboard('System Overview', [
            {
                id: 'cpu-panel',
                title: 'CPU Usage',
                type: 'line',
                metrics: [
                    'system.cpu'
                ],
                config: {
                    width: 6,
                    height: 4,
                    position: {
                        x: 0,
                        y: 0
                    },
                    visualization: {
                        yAxis: {
                            max: 100
                        }
                    }
                }
            },
            {
                id: 'memory-panel',
                title: 'Memory Usage',
                type: 'gauge',
                metrics: [
                    'system.memory'
                ],
                config: {
                    width: 6,
                    height: 4,
                    position: {
                        x: 6,
                        y: 0
                    },
                    visualization: {
                        max: 100,
                        threshold: [
                            70,
                            90
                        ]
                    }
                }
            }
        ]);
        this.logger.info('Created default dashboard', {
            dashboardId: systemDashboard
        });
    }
    initializeHealthChecks() {
        this.healthChecks.set('system', {
            name: 'system',
            type: 'custom',
            target: 'local',
            interval: 30000,
            timeout: 5000,
            retries: 3,
            customCheck: async ()=>{
                return this.systemMetrics.cpuUsage < 95 && this.systemMetrics.memoryUsage < 95;
            }
        });
    }
    async performHttpHealthCheck(check) {
        return true;
    }
    async performTcpHealthCheck(check) {
        return true;
    }
    async sendEmailAlert(alert, config) {
        this.logger.info('Email alert sent', {
            alertId: alert.id
        });
    }
    async sendWebhookAlert(alert, config) {
        this.logger.info('Webhook alert sent', {
            alertId: alert.id
        });
    }
    async triggerAutoScale(alert, config) {
        this.logger.info('Auto-scale triggered', {
            alertId: alert.id,
            action: config.action
        });
        this.eventBus.emit('autoscale:triggered', {
            alert,
            config
        });
    }
    async triggerRestart(alert, config) {
        this.logger.info('Restart triggered', {
            alertId: alert.id
        });
        this.eventBus.emit('restart:triggered', {
            alert,
            config
        });
    }
    initializeSystemMetrics() {
        return {
            timestamp: new Date(),
            cpuUsage: 0,
            memoryUsage: 0,
            diskUsage: 0,
            networkUsage: 0,
            activeSwarms: 0,
            totalAgents: 0,
            activeAgents: 0,
            totalTasks: 0,
            runningTasks: 0,
            throughput: 0,
            latency: 0,
            errorRate: 0,
            successRate: 100,
            resourceUtilization: {},
            queueLengths: {}
        };
    }
    initializeSwarmMetrics() {
        return {
            throughput: 0,
            latency: 0,
            efficiency: 1.0,
            reliability: 1.0,
            averageQuality: 0.8,
            defectRate: 0,
            reworkRate: 0,
            resourceUtilization: {},
            costEfficiency: 1.0,
            agentUtilization: 0,
            agentSatisfaction: 0.8,
            collaborationEffectiveness: 0.8,
            scheduleVariance: 0,
            deadlineAdherence: 1.0
        };
    }
    getSystemMetrics() {
        return {
            ...this.systemMetrics
        };
    }
    getSwarmMetrics() {
        return {
            ...this.swarmMetrics
        };
    }
    getActiveAlerts() {
        return Array.from(this.activeAlerts.values());
    }
    getAlertHistory(limit = 100) {
        return this.alertHistory.slice(-limit);
    }
    getTimeSeries(metricName) {
        return this.timeSeries.get(metricName);
    }
    getAllTimeSeries() {
        return Array.from(this.timeSeries.values());
    }
    acknowledgeAlert(alertId, acknowledgedBy) {
        const alert = this.activeAlerts.get(alertId);
        if (alert) {
            alert.acknowledged = true;
            alert.assignedTo = acknowledgedBy;
            this.emit('alert:acknowledged', {
                alert,
                acknowledgedBy
            });
        }
    }
    createAlertRule(rule) {
        const ruleId = `rule-${Date.now()}`;
        this.alertRules.set(ruleId, {
            ...rule,
            id: ruleId
        });
        return ruleId;
    }
    updateAlertRule(ruleId, updates) {
        const rule = this.alertRules.get(ruleId);
        if (rule) {
            this.alertRules.set(ruleId, {
                ...rule,
                ...updates
            });
        }
    }
    deleteAlertRule(ruleId) {
        this.alertRules.delete(ruleId);
    }
    getAlertRules() {
        return Array.from(this.alertRules.values());
    }
    getMonitoringStatistics() {
        return {
            metricsCount: this.timeSeries.size,
            activeAlerts: this.activeAlerts.size,
            alertRules: this.alertRules.size,
            healthChecks: this.healthChecks.size,
            dashboards: this.dashboards.size,
            uptime: Date.now() - this.lastMetricsUpdate.getTime()
        };
    }
}

//# sourceMappingURL=real-time-monitor.js.map