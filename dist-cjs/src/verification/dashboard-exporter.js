export class DashboardExporter {
    config;
    logger;
    dashboards = new Map();
    reportTemplates = new Map();
    scheduledReports = new Map();
    dataProcessors = new Map();
    visualizationCache = new Map();
    exportQueue = [];
    activeExports = new Set();
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
        this.initializeDataProcessors();
        this.initializeDefaultDashboards();
    }
    async initialize() {
        this.logger.info('Initializing Dashboard Exporter', {
            dashboardEnabled: this.config.dashboardEnabled,
            exportFormat: this.config.exportFormat
        });
        await this.loadDashboardConfigurations();
        this.startScheduledReports();
        this.logger.info('Dashboard Exporter initialized successfully', {
            dashboards: this.dashboards.size,
            reportTemplates: this.reportTemplates.size
        });
    }
    async shutdown() {
        this.logger.info('Shutting down Dashboard Exporter');
        this.stopScheduledReports();
        await this.waitForActiveExports();
        await this.saveDashboardConfigurations();
        this.logger.info('Dashboard Exporter shutdown complete');
    }
    async generateDashboard(data) {
        try {
            const summary = await this.generateSummary(data);
            const charts = await this.generateCharts(data);
            const tables = await this.generateTables(data);
            const insights = await this.generateInsights(data);
            const dashboardData = {
                timestamp: new Date(),
                summary,
                charts,
                tables,
                insights
            };
            this.cacheDashboardData(dashboardData);
            return dashboardData;
        } catch (error) {
            this.logger.error('Error generating dashboard', error);
            throw error;
        }
    }
    async generateSummary(data) {
        const { systemMetrics, agentScores, activeAlerts } = data;
        const healthScore = this.calculateOverallHealth(systemMetrics, agentScores);
        return {
            overallHealth: healthScore,
            truthAccuracy: systemMetrics.overallAccuracy,
            humanInterventionRate: systemMetrics.humanInterventionRate,
            systemEfficiency: systemMetrics.efficiency,
            alertCount: activeAlerts.length
        };
    }
    async generateCharts(data) {
        const { systemMetrics, agentScores, truthMetrics, activeAlerts } = data;
        return {
            accuracyTrend: await this.generateAccuracyTrend(truthMetrics),
            interventionTrend: await this.generateInterventionTrend(truthMetrics),
            agentPerformance: await this.generateAgentPerformanceChart(agentScores),
            errorDistribution: await this.generateErrorDistribution(truthMetrics),
            systemLoad: await this.generateSystemLoadChart(systemMetrics)
        };
    }
    async generateTables(data) {
        const { agentScores, activeAlerts } = data;
        return {
            topPerformers: await this.generateTopPerformers(agentScores),
            recentAlerts: activeAlerts.slice(-10).map(this.formatAlertForTable),
            criticalIssues: await this.generateCriticalIssues(data)
        };
    }
    async generateInsights(data) {
        const insights = [];
        const performanceInsight = await this.analyzePerformanceInsights(data);
        if (performanceInsight) insights.push(performanceInsight);
        const efficiencyInsight = await this.analyzeEfficiencyInsights(data);
        if (efficiencyInsight) insights.push(efficiencyInsight);
        const qualityInsight = await this.analyzeQualityInsights(data);
        if (qualityInsight) insights.push(qualityInsight);
        const riskInsight = await this.analyzeRiskInsights(data);
        if (riskInsight) insights.push(riskInsight);
        return insights;
    }
    async generateAccuracyTrend(truthMetrics) {
        const accuracyMetrics = truthMetrics.filter((m)=>m.metricType === 'accuracy').sort((a, b)=>a.timestamp.getTime() - b.timestamp.getTime());
        const hourlyData = new Map();
        accuracyMetrics.forEach((metric)=>{
            const hour = Math.floor(metric.timestamp.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000);
            if (!hourlyData.has(hour)) {
                hourlyData.set(hour, []);
            }
            hourlyData.get(hour).push(metric.value);
        });
        const dataPoints = [];
        for (const [hour, values] of hourlyData){
            const average = values.reduce((sum, val)=>sum + val, 0) / values.length;
            dataPoints.push({
                timestamp: new Date(hour),
                value: average,
                label: `${values.length} samples`
            });
        }
        return dataPoints.slice(-24);
    }
    async generateInterventionTrend(truthMetrics) {
        const hourlyData = new Map();
        truthMetrics.forEach((metric)=>{
            const hour = Math.floor(metric.timestamp.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000);
            if (!hourlyData.has(hour)) {
                hourlyData.set(hour, {
                    total: 0,
                    interventions: 0
                });
            }
            const data = hourlyData.get(hour);
            data.total++;
            if (metric.context.verificationMethod === 'human' || metric.context.verificationMethod === 'hybrid') {
                data.interventions++;
            }
        });
        const dataPoints = [];
        for (const [hour, data] of hourlyData){
            const rate = data.total > 0 ? data.interventions / data.total : 0;
            dataPoints.push({
                timestamp: new Date(hour),
                value: rate,
                label: `${data.interventions}/${data.total}`
            });
        }
        return dataPoints.slice(-24);
    }
    async generateAgentPerformanceChart(agentScores) {
        return agentScores.sort((a, b)=>b.overallScore - a.overallScore).slice(0, 20).map((score)=>{
            const recentWindow = score.recentPerformance.find((w)=>w.period === 'recent');
            const trend = this.calculateTrend(score.trends);
            return {
                agentId: score.agentId,
                score: score.overallScore,
                trend,
                tasks: recentWindow?.metrics.totalTasks || 0,
                accuracy: score.components.accuracy
            };
        });
    }
    async generateErrorDistribution(truthMetrics) {
        const errorCounts = new Map();
        const severityCounts = new Map();
        let totalErrors = 0;
        truthMetrics.forEach((metric)=>{
            metric.validation.errors.forEach((error)=>{
                totalErrors++;
                errorCounts.set(error.type, (errorCounts.get(error.type) || 0) + 1);
                severityCounts.set(error.severity, (severityCounts.get(error.severity) || 0) + 1);
            });
        });
        const distribution = [];
        for (const [errorType, count] of errorCounts){
            distribution.push({
                category: errorType,
                count,
                percentage: totalErrors > 0 ? count / totalErrors * 100 : 0,
                severity: 'mixed'
            });
        }
        return distribution.sort((a, b)=>b.count - a.count).slice(0, 10);
    }
    async generateSystemLoadChart(systemMetrics) {
        const dataPoints = [];
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;
        for(let i = 23; i >= 0; i--){
            const timestamp = new Date(now - i * hourMs);
            const baseLoad = systemMetrics.totalTasks / 24;
            const variation = (Math.random() - 0.5) * 0.3;
            const load = Math.max(0, baseLoad * (1 + variation));
            const capacity = systemMetrics.agentCount * 10;
            const utilization = capacity > 0 ? Math.min(1, load / capacity) : 0;
            dataPoints.push({
                timestamp,
                load,
                capacity,
                utilization
            });
        }
        return dataPoints;
    }
    async generateTopPerformers(agentScores) {
        return agentScores.sort((a, b)=>b.overallScore - a.overallScore).slice(0, 10).map((score, index)=>{
            const recentWindow = score.recentPerformance.find((w)=>w.period === 'recent');
            return {
                rank: index + 1,
                agentId: score.agentId,
                score: score.overallScore,
                tasks: recentWindow?.metrics.totalTasks || 0,
                accuracy: score.components.accuracy,
                efficiency: score.components.efficiency
            };
        });
    }
    formatAlertForTable = (alert)=>({
            id: alert.id,
            timestamp: alert.timestamp,
            severity: alert.severity,
            type: alert.type,
            message: alert.message.substring(0, 100) + (alert.message.length > 100 ? '...' : ''),
            source: alert.source,
            resolved: alert.resolved
        });
    async generateCriticalIssues(data) {
        const { systemMetrics, agentScores, activeAlerts } = data;
        const issues = [];
        if (systemMetrics.overallAccuracy < 0.9) {
            issues.push({
                id: 'system-accuracy-low',
                severity: 'critical',
                description: `System accuracy (${(systemMetrics.overallAccuracy * 100).toFixed(1)}%) below target`,
                affectedAgents: [
                    'system-wide'
                ],
                impact: 'High risk of incorrect outputs across all agents',
                eta: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });
        }
        const problematicAgents = agentScores.filter((score)=>score.riskAssessment.level === 'critical' || score.riskAssessment.level === 'high');
        if (problematicAgents.length > 0) {
            issues.push({
                id: 'agents-at-risk',
                severity: problematicAgents.some((a)=>a.riskAssessment.level === 'critical') ? 'critical' : 'high',
                description: `${problematicAgents.length} agents at risk`,
                affectedAgents: problematicAgents.map((a)=>a.agentId),
                impact: 'Reduced system reliability and increased intervention needs',
                eta: new Date(Date.now() + 12 * 60 * 60 * 1000)
            });
        }
        const criticalAlerts = activeAlerts.filter((a)=>a.severity === 'critical' || a.severity === 'emergency');
        if (criticalAlerts.length > 5) {
            issues.push({
                id: 'high-alert-volume',
                severity: 'high',
                description: `${criticalAlerts.length} critical alerts active`,
                affectedAgents: [
                    ...new Set(criticalAlerts.map((a)=>a.source))
                ],
                impact: 'System may be overwhelmed, requiring immediate attention',
                eta: new Date(Date.now() + 2 * 60 * 60 * 1000)
            });
        }
        return issues.slice(0, 5);
    }
    async analyzePerformanceInsights(data) {
        const { systemMetrics, agentScores } = data;
        const avgScore = agentScores.length > 0 ? agentScores.reduce((sum, s)=>sum + s.overallScore, 0) / agentScores.length : 0;
        if (avgScore < 0.8) {
            return {
                type: 'performance',
                title: 'Performance Below Target',
                description: `Average agent performance (${(avgScore * 100).toFixed(1)}%) is below the 80% target. Consider reviewing agent training or task distribution.`,
                impact: 'high',
                actionable: true,
                recommendations: [
                    'Review agent training data quality',
                    'Analyze common failure patterns',
                    'Consider load balancing adjustments',
                    'Implement performance coaching for underperforming agents'
                ]
            };
        }
        if (systemMetrics.throughput < 50) {
            return {
                type: 'performance',
                title: 'Low System Throughput',
                description: `Current throughput (${systemMetrics.throughput.toFixed(1)} tasks/hour) is below expected levels.`,
                impact: 'medium',
                actionable: true,
                recommendations: [
                    'Scale up agent capacity',
                    'Optimize task routing algorithms',
                    'Reduce task complexity where possible'
                ]
            };
        }
        return null;
    }
    async analyzeEfficiencyInsights(data) {
        const { systemMetrics } = data;
        if (systemMetrics.humanInterventionRate > 0.15) {
            return {
                type: 'efficiency',
                title: 'High Human Intervention Rate',
                description: `Human intervention rate (${(systemMetrics.humanInterventionRate * 100).toFixed(1)}%) exceeds the 10% target, indicating automation gaps.`,
                impact: 'medium',
                actionable: true,
                recommendations: [
                    'Identify common intervention patterns',
                    'Improve agent decision-making capabilities',
                    'Implement better confidence scoring',
                    'Add more automated validation rules'
                ]
            };
        }
        if (systemMetrics.efficiency < 0.8) {
            return {
                type: 'efficiency',
                title: 'System Efficiency Below Target',
                description: `Current system efficiency (${(systemMetrics.efficiency * 100).toFixed(1)}%) is below the 80% target.`,
                impact: 'medium',
                actionable: true,
                recommendations: [
                    'Optimize resource allocation',
                    'Reduce task processing overhead',
                    'Implement caching strategies'
                ]
            };
        }
        return null;
    }
    async analyzeQualityInsights(data) {
        const { systemMetrics, truthMetrics } = data;
        if (systemMetrics.overallAccuracy < 0.95) {
            const recentErrors = truthMetrics.filter((m)=>m.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000)).flatMap((m)=>m.validation.errors);
            const commonErrors = this.getTopErrorTypes(recentErrors);
            return {
                type: 'quality',
                title: 'Accuracy Below Target',
                description: `System accuracy (${(systemMetrics.overallAccuracy * 100).toFixed(1)}%) is below the 95% target. Most common error: ${commonErrors[0]?.type || 'unknown'}.`,
                impact: 'high',
                actionable: true,
                recommendations: [
                    `Focus on resolving ${commonErrors[0]?.type || 'common'} errors`,
                    'Implement additional validation checks',
                    'Review training data for bias or gaps',
                    'Consider ensemble approaches for critical tasks'
                ]
            };
        }
        return null;
    }
    async analyzeRiskInsights(data) {
        const { agentScores } = data;
        const highRiskAgents = agentScores.filter((s)=>s.riskAssessment.level === 'high' || s.riskAssessment.level === 'critical');
        if (highRiskAgents.length > agentScores.length * 0.2) {
            return {
                type: 'risk',
                title: 'High Risk Agent Population',
                description: `${highRiskAgents.length} agents (${(highRiskAgents.length / agentScores.length * 100).toFixed(1)}%) are classified as high risk.`,
                impact: 'high',
                actionable: true,
                recommendations: [
                    'Implement immediate monitoring for at-risk agents',
                    'Consider redistributing tasks away from high-risk agents',
                    'Investigate common risk factors',
                    'Implement risk mitigation strategies'
                ]
            };
        }
        return null;
    }
    async exportDashboard(dashboardId, format, options) {
        const exportId = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const exportJob = {
            id: exportId,
            type: 'dashboard',
            target: dashboardId,
            format,
            options: options || {},
            status: 'pending',
            createdAt: new Date(),
            progress: 0
        };
        this.exportQueue.push(exportJob);
        this.processExportQueue();
        return exportId;
    }
    async generateReport(templateId, options) {
        const template = this.reportTemplates.get(templateId);
        if (!template) {
            throw new Error(`Report template not found: ${templateId}`);
        }
        const exportId = `report-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const exportJob = {
            id: exportId,
            type: 'report',
            target: templateId,
            format: template.format,
            options: options || {},
            status: 'pending',
            createdAt: new Date(),
            progress: 0
        };
        this.exportQueue.push(exportJob);
        this.processExportQueue();
        return exportId;
    }
    async processExportQueue() {
        if (this.exportQueue.length === 0 || this.activeExports.size >= 3) {
            return;
        }
        const job = this.exportQueue.shift();
        if (!job) return;
        this.activeExports.add(job.id);
        job.status = 'processing';
        try {
            const result = await this.executeExportJob(job);
            job.status = 'completed';
            job.result = result;
            job.completedAt = new Date();
            this.logger.info('Export job completed', {
                jobId: job.id,
                type: job.type,
                format: job.format.type,
                duration: job.completedAt.getTime() - job.createdAt.getTime()
            });
        } catch (error) {
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
            this.logger.error('Export job failed', {
                jobId: job.id,
                error: job.error
            });
        } finally{
            this.activeExports.delete(job.id);
            job.progress = 100;
            setTimeout(()=>this.processExportQueue(), 100);
        }
    }
    async executeExportJob(job) {
        switch(job.type){
            case 'dashboard':
                return await this.exportDashboardData(job);
            case 'report':
                return await this.generateReportData(job);
            default:
                throw new Error(`Unknown export type: ${job.type}`);
        }
    }
    async exportDashboardData(job) {
        job.progress = 50;
        const data = {
            dashboardId: job.target,
            exportedAt: new Date(),
            format: job.format.type,
            data: {}
        };
        job.progress = 100;
        return {
            format: job.format.type,
            size: JSON.stringify(data).length,
            path: `/exports/${job.id}.${job.format.type}`,
            data: job.format.type === 'json' ? data : `Exported data (${job.format.type})`
        };
    }
    async generateReportData(job) {
        const template = this.reportTemplates.get(job.target);
        if (!template) {
            throw new Error(`Report template not found: ${job.target}`);
        }
        job.progress = 25;
        const sections = await Promise.all(template.sections.map((section)=>this.generateReportSection(section)));
        job.progress = 75;
        const reportData = {
            template: template.name,
            type: template.type,
            generatedAt: new Date(),
            sections
        };
        job.progress = 100;
        return {
            format: template.format.type,
            size: JSON.stringify(reportData).length,
            path: `/reports/${job.id}.${template.format.type}`,
            data: reportData
        };
    }
    async generateReportSection(section) {
        switch(section.type){
            case 'summary':
                return {
                    type: 'summary',
                    title: section.title,
                    data: {}
                };
            case 'chart':
                return {
                    type: 'chart',
                    title: section.title,
                    data: []
                };
            case 'table':
                return {
                    type: 'table',
                    title: section.title,
                    data: []
                };
            case 'text':
                return {
                    type: 'text',
                    title: section.title,
                    content: section.template || ''
                };
            case 'alert_summary':
                return {
                    type: 'alert_summary',
                    title: section.title,
                    data: []
                };
            default:
                return {
                    type: 'unknown',
                    title: section.title,
                    data: null
                };
        }
    }
    calculateOverallHealth(systemMetrics, agentScores) {
        const systemHealth = systemMetrics.overallAccuracy * 0.4 + systemMetrics.systemReliability * 0.3 + systemMetrics.efficiency * 0.2 + (1 - systemMetrics.humanInterventionRate) * 0.1;
        const agentHealth = agentScores.length > 0 ? agentScores.reduce((sum, score)=>sum + score.overallScore, 0) / agentScores.length : 0.8;
        return systemHealth * 0.6 + agentHealth * 0.4;
    }
    calculateTrend(trends) {
        const improvingTrends = trends.filter((t)=>t.direction === 'improving').length;
        const decliningTrends = trends.filter((t)=>t.direction === 'declining').length;
        if (improvingTrends > decliningTrends) return 'up';
        if (decliningTrends > improvingTrends) return 'down';
        return 'stable';
    }
    getTopErrorTypes(errors) {
        const errorCounts = new Map();
        errors.forEach((error)=>{
            errorCounts.set(error.type, (errorCounts.get(error.type) || 0) + 1);
        });
        return Array.from(errorCounts.entries()).map(([type, count])=>({
                type,
                count
            })).sort((a, b)=>b.count - a.count);
    }
    cacheDashboardData(data) {
        const cacheKey = `dashboard-${data.timestamp.toISOString()}`;
    }
    initializeDataProcessors() {
        this.dataProcessors.set('accuracy', new AccuracyProcessor());
        this.dataProcessors.set('efficiency', new EfficiencyProcessor());
        this.dataProcessors.set('alerts', new AlertProcessor());
    }
    initializeDefaultDashboards() {
        const defaultDashboard = {
            title: 'Truth Telemetry Overview',
            description: 'Comprehensive view of system truth metrics and agent performance',
            refreshInterval: 30000,
            timeRange: {
                default: '24h',
                options: [
                    '1h',
                    '6h',
                    '24h',
                    '7d',
                    '30d'
                ]
            },
            panels: [
                {
                    id: 'accuracy-trend',
                    title: 'Accuracy Trend',
                    type: 'chart',
                    chartType: 'line',
                    dataSource: 'truthMetrics',
                    query: 'SELECT timestamp, AVG(value) FROM truth_metrics WHERE metric_type = "accuracy" GROUP BY hour',
                    position: {
                        x: 0,
                        y: 0,
                        width: 6,
                        height: 4
                    },
                    config: {
                        yAxis: {
                            min: 0,
                            max: 1,
                            label: 'Accuracy'
                        },
                        colors: [
                            '#2196F3'
                        ],
                        thresholds: [
                            {
                                value: 0.95,
                                color: '#4CAF50',
                                condition: 'gt'
                            },
                            {
                                value: 0.9,
                                color: '#FF9800',
                                condition: 'gt'
                            }
                        ]
                    }
                },
                {
                    id: 'system-health',
                    title: 'System Health',
                    type: 'stat',
                    dataSource: 'systemMetrics',
                    query: 'SELECT overall_health FROM system_metrics ORDER BY timestamp DESC LIMIT 1',
                    position: {
                        x: 6,
                        y: 0,
                        width: 3,
                        height: 2
                    },
                    config: {
                        format: {
                            decimals: 1,
                            suffix: '%'
                        },
                        thresholds: [
                            {
                                value: 95,
                                color: '#4CAF50',
                                condition: 'gt'
                            },
                            {
                                value: 80,
                                color: '#FF9800',
                                condition: 'gt'
                            }
                        ]
                    }
                }
            ],
            filters: [
                {
                    id: 'timeRange',
                    name: 'Time Range',
                    type: 'dropdown',
                    field: 'timestamp',
                    options: [
                        {
                            label: 'Last Hour',
                            value: '1h'
                        },
                        {
                            label: 'Last 24 Hours',
                            value: '24h'
                        },
                        {
                            label: 'Last Week',
                            value: '7d'
                        }
                    ],
                    defaultValue: '24h'
                }
            ],
            layout: {
                type: 'grid',
                gridSize: {
                    columns: 12,
                    rows: 8
                },
                responsive: true,
                breakpoints: {
                    lg: {
                        columns: 12,
                        margin: 16,
                        padding: 16
                    },
                    md: {
                        columns: 8,
                        margin: 12,
                        padding: 12
                    },
                    sm: {
                        columns: 4,
                        margin: 8,
                        padding: 8
                    }
                }
            },
            styling: {
                theme: 'light',
                primaryColor: '#2196F3',
                secondaryColor: '#FFC107',
                backgroundColor: '#FFFFFF',
                textColor: '#333333',
                borderColor: '#E0E0E0',
                fontFamily: 'Inter, sans-serif',
                fontSize: {
                    small: '12px',
                    medium: '14px',
                    large: '16px'
                }
            }
        };
        this.dashboards.set('default', defaultDashboard);
    }
    async loadDashboardConfigurations() {
        this.logger.debug('Loading dashboard configurations');
    }
    async saveDashboardConfigurations() {
        this.logger.debug('Saving dashboard configurations');
    }
    startScheduledReports() {
        for (const [templateId, template] of this.reportTemplates){
            if (template.schedule) {
                const interval = this.calculateScheduleInterval(template.schedule);
                if (interval > 0) {
                    const timeout = setInterval(()=>{
                        this.generateReport(templateId);
                    }, interval);
                    this.scheduledReports.set(templateId, timeout);
                }
            }
        }
    }
    stopScheduledReports() {
        for (const timeout of this.scheduledReports.values()){
            clearInterval(timeout);
        }
        this.scheduledReports.clear();
    }
    calculateScheduleInterval(schedule) {
        if (!schedule) return 0;
        switch(schedule.frequency){
            case 'hourly':
                return 60 * 60 * 1000;
            case 'daily':
                return 24 * 60 * 60 * 1000;
            case 'weekly':
                return 7 * 24 * 60 * 60 * 1000;
            case 'monthly':
                return 30 * 24 * 60 * 60 * 1000;
            default:
                return 0;
        }
    }
    async waitForActiveExports() {
        while(this.activeExports.size > 0){
            await new Promise((resolve)=>setTimeout(resolve, 1000));
        }
    }
    getDashboardConfiguration(dashboardId) {
        return this.dashboards.get(dashboardId);
    }
    getAllDashboards() {
        return Array.from(this.dashboards.values());
    }
    createDashboard(config) {
        const dashboardId = `dashboard-${Date.now()}`;
        this.dashboards.set(dashboardId, {
            ...config
        });
        return dashboardId;
    }
    updateDashboard(dashboardId, updates) {
        const dashboard = this.dashboards.get(dashboardId);
        if (!dashboard) return false;
        this.dashboards.set(dashboardId, {
            ...dashboard,
            ...updates
        });
        return true;
    }
    deleteDashboard(dashboardId) {
        return this.dashboards.delete(dashboardId);
    }
    getExportStatus(exportId) {
        return this.exportQueue.find((job)=>job.id === exportId) || null;
    }
    cancelExport(exportId) {
        const jobIndex = this.exportQueue.findIndex((job)=>job.id === exportId);
        if (jobIndex >= 0) {
            this.exportQueue.splice(jobIndex, 1);
            return true;
        }
        return false;
    }
}
let DataProcessor = class DataProcessor {
};
let AccuracyProcessor = class AccuracyProcessor extends DataProcessor {
    async process(data, options) {
        return data.filter((m)=>m.metricType === 'accuracy');
    }
};
let EfficiencyProcessor = class EfficiencyProcessor extends DataProcessor {
    async process(data, options) {
        return data.filter((m)=>m.metricType === 'efficiency');
    }
};
let AlertProcessor = class AlertProcessor extends DataProcessor {
    async process(data, options) {
        return data.filter((a)=>!a.resolved);
    }
};

//# sourceMappingURL=dashboard-exporter.js.map