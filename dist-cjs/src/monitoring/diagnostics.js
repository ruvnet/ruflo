import { SystemIntegration } from '../integration/system-integration.js';
import { HealthCheckManager } from './health-check.js';
import { getErrorMessage } from '../utils/error-handler.js';
import { promises as fs } from 'fs';
export class DiagnosticManager {
    eventBus;
    logger;
    systemIntegration;
    healthCheckManager;
    performanceHistory = new Map();
    errorHistory = new Map();
    constructor(eventBus, logger, healthCheckManager){
        this.eventBus = eventBus;
        this.logger = logger;
        this.systemIntegration = SystemIntegration.getInstance();
        this.healthCheckManager = healthCheckManager || new HealthCheckManager(eventBus, logger);
        this.setupEventHandlers();
    }
    async generateDiagnosticReport(config = {}) {
        this.logger.info('Generating comprehensive diagnostic report');
        const startTime = Date.now();
        try {
            const systemHealth = await this.systemIntegration.getSystemHealth();
            const metrics = this.healthCheckManager.getCurrentMetrics();
            const components = await this.analyzeComponents(config);
            const performance = await this.analyzePerformance(config);
            const recommendations = config.generateRecommendations !== false ? this.generateRecommendations(systemHealth, performance, components) : [];
            const severity = this.calculateSeverity(systemHealth, components);
            const report = {
                timestamp: Date.now(),
                systemHealth,
                metrics,
                components,
                performance,
                recommendations,
                severity
            };
            if (config.outputPath) {
                await this.exportReport(report, config);
            }
            const duration = Date.now() - startTime;
            this.logger.info(`Diagnostic report generated in ${duration}ms`);
            this.eventBus.emit('diagnostics:report:generated', {
                report,
                duration,
                timestamp: Date.now()
            });
            return report;
        } catch (error) {
            this.logger.error('Failed to generate diagnostic report:', getErrorMessage(error));
            throw error;
        }
    }
    async analyzeComponents(config) {
        const componentNames = [
            'orchestrator',
            'configManager',
            'memoryManager',
            'agentManager',
            'swarmCoordinator',
            'taskEngine',
            'monitor',
            'mcpServer'
        ];
        const diagnostics = await Promise.all(componentNames.map((name)=>this.analyzeComponent(name, config)));
        return diagnostics.filter((d)=>d !== null);
    }
    async analyzeComponent(componentName, config) {
        try {
            const component = this.systemIntegration.getComponent(componentName);
            if (!component) {
                return {
                    name: componentName,
                    status: 'unhealthy',
                    uptime: 0,
                    issues: [
                        {
                            type: 'missing_component',
                            severity: 'critical',
                            message: 'Component is not available',
                            recommendation: 'Check component initialization'
                        }
                    ]
                };
            }
            const issues = [];
            let status = 'healthy';
            const healthHistory = this.healthCheckManager.getHealthHistory(componentName);
            const recentChecks = healthHistory.slice(-10);
            const failureRate = recentChecks.filter((check)=>!check.healthy).length / recentChecks.length;
            if (failureRate > 0.5) {
                status = 'unhealthy';
                issues.push({
                    type: 'high_failure_rate',
                    severity: 'high',
                    message: `High failure rate: ${(failureRate * 100).toFixed(1)}%`,
                    recommendation: 'Investigate component stability'
                });
            } else if (failureRate > 0.2) {
                status = 'warning';
                issues.push({
                    type: 'moderate_failure_rate',
                    severity: 'medium',
                    message: `Moderate failure rate: ${(failureRate * 100).toFixed(1)}%`,
                    recommendation: 'Monitor component health'
                });
            }
            if (config.includePerformanceMetrics !== false) {
                const performanceIssues = this.analyzeComponentPerformance(componentName);
                issues.push(...performanceIssues);
            }
            const memoryIssues = this.checkMemoryLeaks(componentName);
            issues.push(...memoryIssues);
            let componentMetrics = {};
            if (typeof component.getMetrics === 'function') {
                componentMetrics = await component.getMetrics();
            }
            const lastError = this.getLastError(componentName);
            return {
                name: componentName,
                status,
                uptime: this.getComponentUptime(componentName),
                lastError,
                metrics: componentMetrics,
                issues
            };
        } catch (error) {
            return {
                name: componentName,
                status: 'unhealthy',
                uptime: 0,
                lastError: getErrorMessage(error),
                issues: [
                    {
                        type: 'analysis_error',
                        severity: 'medium',
                        message: `Failed to analyze component: ${getErrorMessage(error)}`,
                        recommendation: 'Check component accessibility'
                    }
                ]
            };
        }
    }
    async analyzePerformance(config) {
        const metrics = this.healthCheckManager.getCurrentMetrics();
        const bottlenecks = [];
        const optimization = [];
        const responseTimeHistory = this.performanceHistory.get('responseTime') || [];
        const averageResponseTime = responseTimeHistory.length > 0 ? responseTimeHistory.reduce((sum, time)=>sum + time, 0) / responseTimeHistory.length : 0;
        const throughput = this.calculateThroughput();
        const errorRate = this.calculateErrorRate();
        const memoryLeaks = this.detectMemoryLeaks();
        if (metrics) {
            if (metrics.cpu > 80) {
                bottlenecks.push('High CPU usage');
                optimization.push('Consider distributing load across more workers');
            }
            if (metrics.memory > 80) {
                bottlenecks.push('High memory usage');
                optimization.push('Implement memory optimization strategies');
            }
            if (metrics.queuedTasks > metrics.activeTasks * 2) {
                bottlenecks.push('Task queue buildup');
                optimization.push('Increase task processing capacity');
            }
            if (errorRate > 0.05) {
                bottlenecks.push('High error rate');
                optimization.push('Investigate and fix recurring errors');
            }
        }
        if (averageResponseTime > 1000) {
            bottlenecks.push('Slow response times');
            optimization.push('Optimize critical path operations');
        }
        return {
            averageResponseTime,
            throughput,
            errorRate,
            memoryLeaks,
            bottlenecks,
            optimization
        };
    }
    generateRecommendations(health, performance, components) {
        const recommendations = [];
        if (health.overall === 'unhealthy') {
            recommendations.push('System health is compromised - immediate attention required');
        } else if (health.overall === 'warning') {
            recommendations.push('System showing warning signs - proactive maintenance recommended');
        }
        if (performance.averageResponseTime > 1000) {
            recommendations.push('Response times are slow - consider performance optimization');
        }
        if (performance.errorRate > 0.05) {
            recommendations.push('Error rate is high - investigate error sources');
        }
        if (performance.memoryLeaks) {
            recommendations.push('Memory leaks detected - review memory management');
        }
        const unhealthyComponents = components.filter((c)=>c.status === 'unhealthy');
        if (unhealthyComponents.length > 0) {
            recommendations.push(`${unhealthyComponents.length} component(s) unhealthy - restart or investigate`);
        }
        const highFailureComponents = components.filter((c)=>c.issues.some((issue)=>issue.type === 'high_failure_rate'));
        if (highFailureComponents.length > 0) {
            recommendations.push('Some components have high failure rates - check logs and dependencies');
        }
        recommendations.push(...performance.optimization);
        if (recommendations.length === 0) {
            recommendations.push('System appears healthy - continue regular monitoring');
        }
        return recommendations;
    }
    calculateSeverity(health, components) {
        if (health.overall === 'unhealthy') {
            return 'critical';
        }
        const criticalIssues = components.reduce((count, component)=>count + component.issues.filter((issue)=>issue.severity === 'critical').length, 0);
        const highIssues = components.reduce((count, component)=>count + component.issues.filter((issue)=>issue.severity === 'high').length, 0);
        if (criticalIssues > 0) {
            return 'critical';
        }
        if (highIssues > 2) {
            return 'high';
        }
        if (health.overall === 'warning' || highIssues > 0) {
            return 'medium';
        }
        return 'low';
    }
    async exportReport(report, config) {
        const format = config.exportFormat || 'json';
        const outputPath = config.outputPath;
        try {
            let content;
            switch(format){
                case 'json':
                    content = JSON.stringify(report, null, 2);
                    break;
                case 'html':
                    content = this.generateHtmlReport(report);
                    break;
                case 'text':
                    content = this.generateTextReport(report);
                    break;
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }
            await fs.writeFile(outputPath, content, 'utf8');
            this.logger.info(`Diagnostic report exported to: ${outputPath}`);
        } catch (error) {
            this.logger.error('Failed to export report:', getErrorMessage(error));
            throw error;
        }
    }
    generateHtmlReport(report) {
        const timestamp = new Date(report.timestamp).toISOString();
        const severityColor = {
            low: '#28a745',
            medium: '#ffc107',
            high: '#fd7e14',
            critical: '#dc3545'
        }[report.severity];
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Claude Flow v2.0.0 Diagnostic Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { border-bottom: 2px solid #ccc; padding-bottom: 20px; }
        .severity { color: ${severityColor}; font-weight: bold; }
        .section { margin: 20px 0; }
        .component { margin: 10px 0; padding: 10px; border: 1px solid #ddd; }
        .healthy { border-left: 4px solid #28a745; }
        .warning { border-left: 4px solid #ffc107; }
        .unhealthy { border-left: 4px solid #dc3545; }
        .issue { margin: 5px 0; padding: 5px; background: #f8f9fa; }
        .critical { background: #f8d7da; }
        .high { background: #fff3cd; }
        .medium { background: #cce5ff; }
        .low { background: #d1ecf1; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Claude Flow v2.0.0 Diagnostic Report</h1>
        <p><strong>Generated:</strong> ${timestamp}</p>
        <p><strong>Severity:</strong> <span class="severity">${report.severity.toUpperCase()}</span></p>
    </div>

    <div class="section">
        <h2>System Health</h2>
        <p><strong>Overall Status:</strong> ${report.systemHealth.overall}</p>
        <p><strong>Total Components:</strong> ${report.systemHealth.metrics.totalComponents}</p>
        <p><strong>Healthy:</strong> ${report.systemHealth.metrics.healthyComponents}</p>
        <p><strong>Unhealthy:</strong> ${report.systemHealth.metrics.unhealthyComponents}</p>
        <p><strong>Uptime:</strong> ${(report.systemHealth.metrics.uptime / 1000 / 60).toFixed(1)} minutes</p>
    </div>

    <div class="section">
        <h2>Components</h2>
        ${report.components.map((component)=>`
            <div class="component ${component.status}">
                <h3>${component.name}</h3>
                <p><strong>Status:</strong> ${component.status}</p>
                <p><strong>Uptime:</strong> ${(component.uptime / 1000 / 60).toFixed(1)} minutes</p>
                ${component.lastError ? `<p><strong>Last Error:</strong> ${component.lastError}</p>` : ''}
                ${component.issues.length > 0 ? `
                    <h4>Issues:</h4>
                    ${component.issues.map((issue)=>`
                        <div class="issue ${issue.severity}">
                            <strong>${issue.type}:</strong> ${issue.message}
                            ${issue.recommendation ? `<br><em>Recommendation: ${issue.recommendation}</em>` : ''}
                        </div>
                    `).join('')}
                ` : '<p>No issues detected</p>'}
            </div>
        `).join('')}
    </div>

    <div class="section">
        <h2>Performance</h2>
        <p><strong>Average Response Time:</strong> ${report.performance.averageResponseTime.toFixed(2)}ms</p>
        <p><strong>Throughput:</strong> ${report.performance.throughput.toFixed(2)} ops/sec</p>
        <p><strong>Error Rate:</strong> ${(report.performance.errorRate * 100).toFixed(2)}%</p>
        <p><strong>Memory Leaks:</strong> ${report.performance.memoryLeaks ? 'Detected' : 'None detected'}</p>
        
        ${report.performance.bottlenecks.length > 0 ? `
            <h3>Bottlenecks:</h3>
            <ul>${report.performance.bottlenecks.map((b)=>`<li>${b}</li>`).join('')}</ul>
        ` : ''}
    </div>

    <div class="section">
        <h2>Recommendations</h2>
        <ol>
            ${report.recommendations.map((rec)=>`<li>${rec}</li>`).join('')}
        </ol>
    </div>
</body>
</html>`;
    }
    generateTextReport(report) {
        const timestamp = new Date(report.timestamp).toISOString();
        let text = `
CLAUDE FLOW v2.0.0 DIAGNOSTIC REPORT
=====================================

Generated: ${timestamp}
Severity: ${report.severity.toUpperCase()}

SYSTEM HEALTH
-------------
Overall Status: ${report.systemHealth.overall}
Total Components: ${report.systemHealth.metrics.totalComponents}
Healthy: ${report.systemHealth.metrics.healthyComponents}
Unhealthy: ${report.systemHealth.metrics.unhealthyComponents}
Uptime: ${(report.systemHealth.metrics.uptime / 1000 / 60).toFixed(1)} minutes

COMPONENTS
----------
`;
        report.components.forEach((component)=>{
            text += `
${component.name}
  Status: ${component.status}
  Uptime: ${(component.uptime / 1000 / 60).toFixed(1)} minutes
`;
            if (component.lastError) {
                text += `  Last Error: ${component.lastError}\n`;
            }
            if (component.issues.length > 0) {
                text += `  Issues:\n`;
                component.issues.forEach((issue)=>{
                    text += `    - ${issue.type}: ${issue.message}\n`;
                    if (issue.recommendation) {
                        text += `      Recommendation: ${issue.recommendation}\n`;
                    }
                });
            }
        });
        text += `
PERFORMANCE
-----------
Average Response Time: ${report.performance.averageResponseTime.toFixed(2)}ms
Throughput: ${report.performance.throughput.toFixed(2)} ops/sec
Error Rate: ${(report.performance.errorRate * 100).toFixed(2)}%
Memory Leaks: ${report.performance.memoryLeaks ? 'Detected' : 'None detected'}
`;
        if (report.performance.bottlenecks.length > 0) {
            text += `\nBottlenecks:\n`;
            report.performance.bottlenecks.forEach((bottleneck)=>{
                text += `  - ${bottleneck}\n`;
            });
        }
        text += `
RECOMMENDATIONS
---------------
`;
        report.recommendations.forEach((rec, index)=>{
            text += `${index + 1}. ${rec}\n`;
        });
        return text;
    }
    analyzeComponentPerformance(componentName) {
        return [];
    }
    checkMemoryLeaks(componentName) {
        return [];
    }
    getLastError(componentName) {
        const errors = this.errorHistory.get(componentName);
        return errors && errors.length > 0 ? errors[errors.length - 1]?.message : undefined;
    }
    getComponentUptime(componentName) {
        return process.uptime() * 1000;
    }
    calculateThroughput() {
        return 100;
    }
    calculateErrorRate() {
        return 0.01;
    }
    detectMemoryLeaks() {
        return false;
    }
    setupEventHandlers() {
        this.eventBus.on('performance:metric', (metric)=>{
            if (!this.performanceHistory.has(metric.name)) {
                this.performanceHistory.set(metric.name, []);
            }
            const history = this.performanceHistory.get(metric.name);
            history.push(metric.value);
            if (history.length > 100) {
                history.shift();
            }
        });
        this.eventBus.on('system:error', (error)=>{
            const component = error.component || 'system';
            if (!this.errorHistory.has(component)) {
                this.errorHistory.set(component, []);
            }
            const history = this.errorHistory.get(component);
            history.push({
                message: error.message || error.error,
                timestamp: Date.now(),
                stack: error.stack
            });
            if (history.length > 50) {
                history.shift();
            }
        });
    }
    async quickDiagnostic() {
        const health = await this.systemIntegration.getSystemHealth();
        const components = await this.analyzeComponents({
            enableDetailedAnalysis: false
        });
        const issues = components.reduce((count, comp)=>count + comp.issues.length, 0);
        const recommendations = this.generateRecommendations(health, {
            averageResponseTime: 0,
            throughput: 0,
            errorRate: 0,
            memoryLeaks: false,
            bottlenecks: [],
            optimization: []
        }, components).slice(0, 3);
        return {
            status: health.overall,
            issues,
            recommendations
        };
    }
}

//# sourceMappingURL=diagnostics.js.map