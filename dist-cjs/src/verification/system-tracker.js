export class SystemTruthTracker {
    config;
    logger;
    systemMetrics;
    healthIndicators;
    historicalMetrics = [];
    systemTrends = new Map();
    distributionAnalyses = new Map();
    predictions = new Map();
    metricsBuffer = [];
    analysisInterval;
    predictionInterval;
    lastAnalysisTime = new Date();
    totalMetricsProcessed = 0;
    systemStartTime = new Date();
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
        this.initializeSystemMetrics();
        this.initializeHealthIndicators();
    }
    async initialize() {
        this.logger.info('Initializing System Truth Tracker');
        this.startPeriodicAnalysis();
        this.startPredictiveAnalysis();
        this.logger.info('System Truth Tracker initialized successfully');
    }
    async shutdown() {
        this.logger.info('Shutting down System Truth Tracker');
        if (this.analysisInterval) clearInterval(this.analysisInterval);
        if (this.predictionInterval) clearInterval(this.predictionInterval);
        await this.performComprehensiveAnalysis();
        this.logger.info('System Truth Tracker shutdown complete');
    }
    async updateSystemMetric(metric) {
        this.metricsBuffer.push(metric);
        this.totalMetricsProcessed++;
        this.historicalMetrics.push(metric);
        if (this.historicalMetrics.length > 100000) {
            this.historicalMetrics = this.historicalMetrics.slice(-50000);
        }
        if (this.isCriticalMetric(metric)) {
            await this.updateRealTimeMetrics();
        }
    }
    async updateRealTimeMetrics() {
        const recentMetrics = this.getRecentMetrics(60 * 60 * 1000);
        if (recentMetrics.length === 0) return;
        const accuracyMetrics = recentMetrics.filter((m)=>m.metricType === 'accuracy');
        if (accuracyMetrics.length > 0) {
            this.systemMetrics.overallAccuracy = accuracyMetrics.reduce((sum, m)=>sum + m.value, 0) / accuracyMetrics.length;
        }
        const totalTasks = recentMetrics.length;
        const humanInterventions = recentMetrics.filter((m)=>m.context.verificationMethod === 'human' || m.context.verificationMethod === 'hybrid').length;
        this.systemMetrics.humanInterventionRate = totalTasks > 0 ? humanInterventions / totalTasks : 0;
        const validTasks = recentMetrics.filter((m)=>m.validation.isValid).length;
        this.systemMetrics.systemReliability = totalTasks > 0 ? validTasks / totalTasks : 1;
        const uniqueAgents = new Set(recentMetrics.map((m)=>m.agentId));
        this.systemMetrics.activeAgents = uniqueAgents.size;
        this.systemMetrics.totalTasks = this.historicalMetrics.length;
        this.systemMetrics.verifiedTasks = this.historicalMetrics.filter((m)=>m.validation.isValid).length;
        const criticalErrors = recentMetrics.filter((m)=>m.validation.errors.some((e)=>e.severity === 'critical')).length;
        this.systemMetrics.criticalFailures = criticalErrors;
        this.systemMetrics.efficiency = this.calculateSystemEfficiency(recentMetrics);
        this.systemMetrics.timestamp = new Date();
    }
    startPeriodicAnalysis() {
        this.analysisInterval = setInterval(async ()=>{
            await this.performPeriodicAnalysis();
        }, 5 * 60 * 1000);
        this.logger.info('Started periodic system analysis');
    }
    startPredictiveAnalysis() {
        this.predictionInterval = setInterval(async ()=>{
            await this.performPredictiveAnalysis();
        }, 15 * 60 * 1000);
        this.logger.info('Started predictive analysis');
    }
    async performPeriodicAnalysis() {
        try {
            await this.processMetricsBuffer();
            await this.updateDistributionMetrics();
            await this.analyzeTrends();
            await this.updateHealthIndicators();
            this.lastAnalysisTime = new Date();
        } catch (error) {
            this.logger.error('Error in periodic analysis', error);
        }
    }
    async processMetricsBuffer() {
        if (this.metricsBuffer.length === 0) return;
        const batch = this.metricsBuffer.splice(0);
        await this.updateSystemMetricsFromBatch(batch);
        await this.analyzeDistributions(batch);
    }
    async updateSystemMetricsFromBatch(metrics) {
        if (metrics.length === 0) return;
        const metricsByType = new Map();
        metrics.forEach((metric)=>{
            if (!metricsByType.has(metric.metricType)) {
                metricsByType.set(metric.metricType, []);
            }
            metricsByType.get(metric.metricType).push(metric);
        });
        const accuracyMetrics = metricsByType.get('accuracy') || [];
        if (accuracyMetrics.length > 0) {
            const weightedSum = accuracyMetrics.reduce((sum, m)=>sum + m.value * m.confidence, 0);
            const totalWeight = accuracyMetrics.reduce((sum, m)=>sum + m.confidence, 0);
            if (totalWeight > 0) {
                this.systemMetrics.overallAccuracy = weightedSum / totalWeight;
            }
        }
        const timeSpan = this.getTimeSpan(metrics);
        if (timeSpan > 0) {
            this.systemMetrics.throughput = metrics.length / (timeSpan / (60 * 60 * 1000));
        }
        const validationTimes = metrics.map((m)=>m.validation.automatedChecks.reduce((sum, c)=>sum + c.executionTime, 0)).filter((t)=>t > 0);
        if (validationTimes.length > 0) {
            this.systemMetrics.latency = validationTimes.reduce((sum, t)=>sum + t, 0) / validationTimes.length;
        }
        const errorCount = metrics.reduce((sum, m)=>sum + m.validation.errors.length, 0);
        this.systemMetrics.errorRate = metrics.length > 0 ? errorCount / metrics.length : 0;
        const successCount = metrics.filter((m)=>m.validation.isValid).length;
        this.systemMetrics.successRate = metrics.length > 0 ? successCount / metrics.length * 100 : 100;
    }
    async updateDistributionMetrics() {
        const recentMetrics = this.getRecentMetrics(24 * 60 * 60 * 1000);
        if (recentMetrics.length === 0) return;
        const taskTypes = new Map();
        recentMetrics.forEach((metric)=>{
            const taskType = metric.context.taskType;
            taskTypes.set(taskType, (taskTypes.get(taskType) || 0) + 1);
        });
        this.systemMetrics.distributionMetrics.taskDistribution = Object.fromEntries(taskTypes);
        const accuracyRanges = new Map();
        recentMetrics.filter((m)=>m.metricType === 'accuracy').forEach((metric)=>{
            const range = this.getAccuracyRange(metric.value);
            accuracyRanges.set(range, (accuracyRanges.get(range) || 0) + 1);
        });
        this.systemMetrics.distributionMetrics.accuracyDistribution = Object.fromEntries(accuracyRanges);
        const complexityTypes = new Map();
        recentMetrics.forEach((metric)=>{
            const complexity = metric.context.complexity;
            complexityTypes.set(complexity, (complexityTypes.get(complexity) || 0) + 1);
        });
        this.systemMetrics.distributionMetrics.complexityDistribution = Object.fromEntries(complexityTypes);
        const errorTypes = new Map();
        recentMetrics.forEach((metric)=>{
            metric.validation.errors.forEach((error)=>{
                errorTypes.set(error.type, (errorTypes.get(error.type) || 0) + 1);
            });
        });
        this.systemMetrics.distributionMetrics.errorTypeDistribution = Object.fromEntries(errorTypes);
    }
    async analyzeTrends() {
        const metrics = [
            'overallAccuracy',
            'humanInterventionRate',
            'systemReliability',
            'efficiency'
        ];
        for (const metric of metrics){
            const trend = await this.calculateTrend(metric);
            if (trend) {
                this.systemTrends.set(metric, trend);
            }
        }
    }
    async calculateTrend(metricName) {
        const historicalValues = await this.getHistoricalValues(metricName, 168);
        if (historicalValues.length < 10) return null;
        const midpoint = Math.floor(historicalValues.length / 2);
        const earlierPeriod = historicalValues.slice(0, midpoint);
        const laterPeriod = historicalValues.slice(midpoint);
        const previousValue = earlierPeriod.reduce((sum, v)=>sum + v.value, 0) / earlierPeriod.length;
        const currentValue = laterPeriod.reduce((sum, v)=>sum + v.value, 0) / laterPeriod.length;
        const changePercent = previousValue !== 0 ? (currentValue - previousValue) / previousValue * 100 : 0;
        let direction;
        let significance;
        if (Math.abs(changePercent) < 1) {
            direction = 'stable';
            significance = 'low';
        } else {
            direction = changePercent > 0 ? 'improving' : 'declining';
            if (Math.abs(changePercent) > 10) significance = 'high';
            else if (Math.abs(changePercent) > 5) significance = 'medium';
            else significance = 'low';
        }
        const prediction = await this.predictNextValue(historicalValues);
        return {
            metric: metricName,
            timeframe: '7d',
            currentValue,
            previousValue,
            changePercent,
            direction,
            significance,
            prediction
        };
    }
    async predictNextValue(values) {
        if (values.length < 5) {
            return {
                nextValue: values[values.length - 1].value,
                confidence: 0.3
            };
        }
        const n = values.length;
        const x = values.map((_, i)=>i);
        const y = values.map((v)=>v.value);
        const sumX = x.reduce((sum, val)=>sum + val, 0);
        const sumY = y.reduce((sum, val)=>sum + val, 0);
        const sumXY = x.reduce((sum, val, i)=>sum + val * y[i], 0);
        const sumX2 = x.reduce((sum, val)=>sum + val * val, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        const nextValue = slope * n + intercept;
        const yMean = sumY / n;
        const ssRes = y.reduce((sum, val, i)=>{
            const predicted = slope * i + intercept;
            return sum + Math.pow(val - predicted, 2);
        }, 0);
        const ssTot = y.reduce((sum, val)=>sum + Math.pow(val - yMean, 2), 0);
        const rSquared = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
        const confidence = Math.max(0, Math.min(1, rSquared));
        return {
            nextValue,
            confidence
        };
    }
    async updateHealthIndicators() {
        const now = new Date();
        const uptime = now.getTime() - this.systemStartTime.getTime();
        const subsystemHealth = {
            collection: this.calculateCollectionHealth(),
            validation: this.calculateValidationHealth(),
            scoring: this.calculateScoringHealth(),
            alerting: this.calculateAlertingHealth(),
            persistence: this.calculatePersistenceHealth()
        };
        const healthValues = Object.values(subsystemHealth);
        const overallHealth = healthValues.reduce((sum, h)=>sum + h, 0) / healthValues.length;
        const recentMetrics = this.getRecentMetrics(60 * 60 * 1000);
        const performanceIndicators = {
            latency: this.systemMetrics.latency,
            throughput: this.systemMetrics.throughput,
            errorRate: this.systemMetrics.errorRate,
            availability: this.calculateAvailability(uptime)
        };
        const capacityMetrics = {
            currentLoad: this.calculateCurrentLoad(),
            maxCapacity: this.calculateMaxCapacity(),
            utilizationRate: this.calculateUtilizationRate(),
            queueDepth: this.metricsBuffer.length
        };
        this.healthIndicators = {
            timestamp: now,
            overallHealth,
            subsystemHealth,
            performanceIndicators,
            capacityMetrics
        };
    }
    async performPredictiveAnalysis() {
        try {
            const metrics = [
                'overallAccuracy',
                'humanInterventionRate',
                'systemReliability'
            ];
            for (const metric of metrics){
                const prediction = await this.generatePrediction(metric);
                if (prediction) {
                    this.predictions.set(metric, prediction);
                }
            }
        } catch (error) {
            this.logger.error('Error in predictive analysis', error);
        }
    }
    async generatePrediction(metricName) {
        const historicalValues = await this.getHistoricalValues(metricName, 336);
        if (historicalValues.length < 20) return null;
        const currentValue = historicalValues[historicalValues.length - 1].value;
        const shortTerm = await this.predictValue(historicalValues, 24);
        const mediumTerm = await this.predictValue(historicalValues, 168);
        const longTerm = await this.predictValue(historicalValues, 720);
        const factors = await this.identifyPredictionFactors(metricName, historicalValues);
        const recommendations = this.generatePredictionRecommendations(metricName, shortTerm, factors);
        return {
            metric: metricName,
            currentValue,
            predictions: {
                shortTerm: {
                    ...shortTerm,
                    timeframe: '1 day'
                },
                mediumTerm: {
                    ...mediumTerm,
                    timeframe: '1 week'
                },
                longTerm: {
                    ...longTerm,
                    timeframe: '1 month'
                }
            },
            factors,
            recommendations
        };
    }
    async predictValue(values, hoursAhead) {
        const alpha = 0.3;
        let smoothedValue = values[0].value;
        for(let i = 1; i < values.length; i++){
            smoothedValue = alpha * values[i].value + (1 - alpha) * smoothedValue;
        }
        const recentValues = values.slice(-20).map((v)=>v.value);
        const variance = this.calculateVariance(recentValues);
        const confidence = Math.max(0.1, Math.min(0.9, 1 - Math.sqrt(variance)));
        return {
            value: smoothedValue,
            confidence
        };
    }
    async identifyPredictionFactors(metricName, values) {
        const factors = [];
        const trend = this.systemTrends.get(metricName);
        if (trend) {
            factors.push({
                name: 'Historical Trend',
                impact: trend.direction === 'improving' ? 0.3 : trend.direction === 'declining' ? -0.3 : 0,
                confidence: trend.significance === 'high' ? 0.8 : trend.significance === 'medium' ? 0.6 : 0.4,
                description: `${trend.direction} trend with ${trend.significance} significance`
            });
        }
        const currentLoad = this.healthIndicators.capacityMetrics.utilizationRate;
        if (currentLoad > 0.8) {
            factors.push({
                name: 'High System Load',
                impact: -0.2,
                confidence: 0.7,
                description: 'High system utilization may impact performance'
            });
        }
        if (this.systemMetrics.errorRate > 0.05) {
            factors.push({
                name: 'Elevated Error Rate',
                impact: -0.4,
                confidence: 0.8,
                description: 'High error rate may continue to impact metrics'
            });
        }
        return factors;
    }
    getRecentMetrics(timeWindowMs) {
        const cutoff = new Date(Date.now() - timeWindowMs);
        return this.historicalMetrics.filter((m)=>m.timestamp >= cutoff);
    }
    async getHistoricalValues(metricName, hoursBack) {
        const values = [];
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;
        let currentValue = this.systemMetrics[metricName] || 0.8;
        for(let i = hoursBack; i >= 0; i--){
            const timestamp = new Date(now - i * hourMs);
            const variation = (Math.random() - 0.5) * 0.1;
            const value = Math.max(0, Math.min(1, currentValue + variation));
            values.push({
                timestamp,
                value
            });
            currentValue = value;
        }
        return values;
    }
    getTimeSpan(metrics) {
        if (metrics.length < 2) return 0;
        const timestamps = metrics.map((m)=>m.timestamp.getTime()).sort((a, b)=>a - b);
        return timestamps[timestamps.length - 1] - timestamps[0];
    }
    getAccuracyRange(accuracy) {
        if (accuracy >= 0.95) return '95-100%';
        if (accuracy >= 0.90) return '90-95%';
        if (accuracy >= 0.80) return '80-90%';
        if (accuracy >= 0.70) return '70-80%';
        return '<70%';
    }
    calculateSystemEfficiency(metrics) {
        if (metrics.length === 0) return 0.8;
        const successRate = metrics.filter((m)=>m.validation.isValid).length / metrics.length;
        const automationRate = metrics.filter((m)=>m.context.verificationMethod === 'automated').length / metrics.length;
        return successRate * 0.6 + automationRate * 0.4;
    }
    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, val)=>sum + val, 0) / values.length;
        const squaredDiffs = values.map((val)=>Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, diff)=>sum + diff, 0) / values.length;
    }
    isCriticalMetric(metric) {
        return metric.metricType === 'accuracy' || metric.value < 0.7 || metric.validation.errors.some((e)=>e.severity === 'critical');
    }
    calculateCollectionHealth() {
        const targetThroughput = 100;
        const currentThroughput = this.systemMetrics.throughput;
        const throughputScore = Math.min(1, currentThroughput / targetThroughput);
        const errorScore = Math.max(0, 1 - this.systemMetrics.errorRate * 10);
        return throughputScore * 0.7 + errorScore * 0.3;
    }
    calculateValidationHealth() {
        const successRate = this.systemMetrics.successRate / 100;
        const latencyScore = this.systemMetrics.latency > 0 ? Math.max(0.1, Math.min(1, 5000 / this.systemMetrics.latency)) : 1;
        return successRate * 0.8 + latencyScore * 0.2;
    }
    calculateScoringHealth() {
        const coverageScore = this.systemMetrics.agentCount > 0 ? Math.min(1, this.systemMetrics.activeAgents / this.systemMetrics.agentCount) : 1;
        return coverageScore;
    }
    calculateAlertingHealth() {
        return 0.95;
    }
    calculatePersistenceHealth() {
        return 0.98;
    }
    calculateAvailability(uptimeMs) {
        const uptimeHours = uptimeMs / (60 * 60 * 1000);
        return Math.min(1, uptimeHours / (uptimeHours + 0.1));
    }
    calculateCurrentLoad() {
        return this.metricsBuffer.length;
    }
    calculateMaxCapacity() {
        return this.config.bufferSize;
    }
    calculateUtilizationRate() {
        const maxCapacity = this.calculateMaxCapacity();
        return maxCapacity > 0 ? this.calculateCurrentLoad() / maxCapacity : 0;
    }
    generatePredictionRecommendations(metricName, prediction, factors) {
        const recommendations = [];
        if (prediction.confidence < 0.5) {
            recommendations.push('Increase data collection frequency for better predictions');
            recommendations.push('Implement additional monitoring points');
        }
        if (metricName === 'overallAccuracy' && prediction.value < 0.9) {
            recommendations.push('Implement additional validation checks');
            recommendations.push('Consider agent retraining or calibration');
        }
        if (metricName === 'humanInterventionRate' && prediction.value > 0.15) {
            recommendations.push('Analyze common intervention patterns');
            recommendations.push('Improve automated decision-making capabilities');
        }
        factors.forEach((factor)=>{
            if (factor.impact < -0.3) {
                recommendations.push(`Address ${factor.name}: ${factor.description}`);
            }
        });
        return recommendations;
    }
    initializeSystemMetrics() {
        this.systemMetrics = {
            timestamp: new Date(),
            overallAccuracy: 0.95,
            humanInterventionRate: 0.05,
            systemReliability: 0.98,
            agentCount: 0,
            activeAgents: 0,
            totalTasks: 0,
            verifiedTasks: 0,
            criticalFailures: 0,
            recoveryTime: 0,
            efficiency: 0.85,
            distributionMetrics: {
                taskDistribution: {},
                accuracyDistribution: {},
                complexityDistribution: {},
                errorTypeDistribution: {}
            }
        };
    }
    initializeHealthIndicators() {
        this.healthIndicators = {
            timestamp: new Date(),
            overallHealth: 0.95,
            subsystemHealth: {
                collection: 0.95,
                validation: 0.92,
                scoring: 0.90,
                alerting: 0.98,
                persistence: 0.96
            },
            performanceIndicators: {
                latency: 500,
                throughput: 50,
                errorRate: 0.02,
                availability: 0.99
            },
            capacityMetrics: {
                currentLoad: 0,
                maxCapacity: 1000,
                utilizationRate: 0,
                queueDepth: 0
            }
        };
    }
    getSystemMetrics() {
        return {
            ...this.systemMetrics
        };
    }
    getHealthIndicators() {
        return {
            ...this.healthIndicators
        };
    }
    getSystemTrends() {
        return Array.from(this.systemTrends.values());
    }
    getTrend(metricName) {
        return this.systemTrends.get(metricName);
    }
    getPredictions() {
        return Array.from(this.predictions.values());
    }
    getPrediction(metricName) {
        return this.predictions.get(metricName);
    }
    getDistributionAnalysis(metricName) {
        return this.distributionAnalyses.get(metricName);
    }
    async performComprehensiveAnalysis() {
        await this.performPeriodicAnalysis();
        await this.performPredictiveAnalysis();
        const recommendations = this.generateSystemRecommendations();
        return {
            systemHealth: this.healthIndicators,
            trends: Array.from(this.systemTrends.values()),
            predictions: Array.from(this.predictions.values()),
            recommendations
        };
    }
    generateSystemRecommendations() {
        const recommendations = [];
        if (this.healthIndicators.overallHealth < 0.8) {
            recommendations.push('System health is degraded - investigate subsystem issues');
        }
        if (this.healthIndicators.performanceIndicators.errorRate > 0.05) {
            recommendations.push('High error rate detected - review validation processes');
        }
        if (this.healthIndicators.capacityMetrics.utilizationRate > 0.8) {
            recommendations.push('High system utilization - consider scaling resources');
        }
        this.systemTrends.forEach((trend)=>{
            if (trend.direction === 'declining' && trend.significance === 'high') {
                recommendations.push(`${trend.metric} is declining significantly - immediate attention required`);
            }
        });
        return recommendations;
    }
    getSystemStatistics() {
        const uptime = Date.now() - this.systemStartTime.getTime();
        const processingRate = uptime > 0 ? this.totalMetricsProcessed / (uptime / 1000) : 0;
        return {
            totalMetricsProcessed: this.totalMetricsProcessed,
            systemUptime: uptime,
            averageProcessingRate: processingRate,
            healthScore: this.healthIndicators.overallHealth,
            lastAnalysis: this.lastAnalysisTime
        };
    }
}

//# sourceMappingURL=system-tracker.js.map