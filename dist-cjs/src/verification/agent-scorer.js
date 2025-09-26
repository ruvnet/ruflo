export class AgentTruthScorer {
    config;
    logger;
    telemetryConfig;
    agentData = new Map();
    agentScores = new Map();
    benchmarkScores = new Map();
    industryBenchmarks = new Map();
    constructor(telemetryConfig, logger){
        this.telemetryConfig = telemetryConfig;
        this.logger = logger;
        this.config = {
            windowSizes: {
                recent: 15,
                short: 4,
                medium: 7,
                long: 4
            },
            weights: {
                accuracy: 0.30,
                reliability: 0.25,
                consistency: 0.20,
                efficiency: 0.15,
                adaptability: 0.10
            },
            benchmarks: {
                minAccuracy: 0.90,
                minReliability: 0.85,
                minConsistency: 0.80,
                minEfficiency: 0.75,
                targetTasksPerHour: 10
            },
            riskThresholds: {
                low: 0.85,
                medium: 0.70,
                high: 0.50
            }
        };
        this.initializeBenchmarks();
    }
    async initialize() {
        this.logger.info('Initializing Agent Truth Scorer', {
            weights: this.config.weights,
            benchmarks: this.config.benchmarks
        });
        await this.loadHistoricalData();
        this.logger.info('Agent Truth Scorer initialized successfully');
    }
    async shutdown() {
        this.logger.info('Shutting down Agent Truth Scorer');
        await this.persistScoringData();
        this.logger.info('Agent Truth Scorer shutdown complete');
    }
    async updateAgentMetric(metric) {
        const agentId = metric.agentId;
        let agentData = this.agentData.get(agentId);
        if (!agentData) {
            agentData = {
                agentId,
                metrics: [],
                recentMetrics: [],
                taskHistory: [],
                errorHistory: []
            };
            this.agentData.set(agentId, agentData);
        }
        agentData.metrics.push(metric);
        const recentCutoff = new Date(Date.now() - this.config.windowSizes.recent * 60 * 1000);
        agentData.recentMetrics = agentData.metrics.filter((m)=>m.timestamp >= recentCutoff);
        await this.updateTaskHistory(agentData, metric);
        await this.updateErrorHistory(agentData, metric);
        if (this.shouldRecalculateScore(metric)) {
            await this.calculateAgentScore(agentId);
        }
    }
    async calculateAgentScore(agentId) {
        const agentData = this.agentData.get(agentId);
        if (!agentData || agentData.metrics.length === 0) {
            return null;
        }
        try {
            const components = await this.calculateComponentScores(agentData);
            const overallScore = this.calculateWeightedScore(components);
            const recentPerformance = await this.generatePerformanceWindows(agentData);
            const trends = await this.analyzeTrends(agentData);
            const benchmarks = await this.generateBenchmarkComparisons(agentId, components);
            const riskAssessment = await this.assessRisk(agentData, components);
            const score = {
                agentId,
                timestamp: new Date(),
                overallScore,
                components,
                recentPerformance,
                trends,
                benchmarks,
                riskAssessment
            };
            this.agentScores.set(agentId, score);
            this.logger.debug('Calculated agent score', {
                agentId,
                overallScore: overallScore.toFixed(3),
                components
            });
            return score;
        } catch (error) {
            this.logger.error('Error calculating agent score', {
                agentId,
                error
            });
            return null;
        }
    }
    async calculateComponentScores(agentData) {
        const shortTermMetrics = this.getMetricsInWindow(agentData.metrics, this.config.windowSizes.short * 60 * 60 * 1000);
        return {
            accuracy: await this.calculateAccuracyScore(shortTermMetrics),
            reliability: await this.calculateReliabilityScore(shortTermMetrics),
            consistency: await this.calculateConsistencyScore(shortTermMetrics),
            efficiency: await this.calculateEfficiencyScore(agentData),
            adaptability: await this.calculateAdaptabilityScore(agentData)
        };
    }
    async calculateAccuracyScore(metrics) {
        if (metrics.length === 0) return 0;
        const accuracyMetrics = metrics.filter((m)=>m.metricType === 'accuracy');
        if (accuracyMetrics.length === 0) return 0.8;
        let totalWeight = 0;
        let weightedSum = 0;
        accuracyMetrics.forEach((metric, index)=>{
            const age = Date.now() - metric.timestamp.getTime();
            const weight = Math.exp(-age / (24 * 60 * 60 * 1000));
            totalWeight += weight * metric.confidence;
            weightedSum += metric.value * weight * metric.confidence;
        });
        return totalWeight > 0 ? Math.min(1, weightedSum / totalWeight) : 0;
    }
    async calculateReliabilityScore(metrics) {
        if (metrics.length === 0) return 0;
        const reliabilityMetrics = metrics.filter((m)=>m.metricType === 'reliability');
        const validationScores = metrics.map((m)=>m.validation.score);
        const successRate = validationScores.filter((score)=>score >= 0.8).length / validationScores.length;
        const variance = this.calculateVariance(validationScores);
        const consistencyScore = Math.max(0, 1 - variance);
        return successRate * 0.7 + consistencyScore * 0.3;
    }
    async calculateConsistencyScore(metrics) {
        if (metrics.length < 3) return 0.8;
        const values = metrics.map((m)=>m.value);
        const confidences = metrics.map((m)=>m.confidence);
        const valueCV = this.calculateCoefficientOfVariation(values);
        const confidenceCV = this.calculateCoefficientOfVariation(confidences);
        const valueConsistency = Math.max(0, 1 - valueCV);
        const confidenceConsistency = Math.max(0, 1 - confidenceCV);
        return valueConsistency * 0.6 + confidenceConsistency * 0.4;
    }
    async calculateEfficiencyScore(agentData) {
        const recentTasks = agentData.taskHistory.filter((task)=>task.timestamp > new Date(Date.now() - this.config.windowSizes.short * 60 * 60 * 1000));
        if (recentTasks.length === 0) return 0.8;
        const hoursSpanned = this.config.windowSizes.short;
        const tasksPerHour = recentTasks.length / hoursSpanned;
        const throughputScore = Math.min(1, tasksPerHour / this.config.benchmarks.targetTasksPerHour);
        const durationEfficiency = this.calculateDurationEfficiency(recentTasks);
        const interventionRate = recentTasks.filter((t)=>t.interventionRequired).length / recentTasks.length;
        const interventionScore = Math.max(0, 1 - interventionRate * 2);
        return throughputScore * 0.4 + durationEfficiency * 0.4 + interventionScore * 0.2;
    }
    async calculateAdaptabilityScore(agentData) {
        const recentTasks = agentData.taskHistory.filter((task)=>task.timestamp > new Date(Date.now() - this.config.windowSizes.medium * 24 * 60 * 60 * 1000));
        if (recentTasks.length < 5) return 0.7;
        const taskTypes = new Set(recentTasks.map((t)=>t.taskType));
        const performanceByType = new Map();
        recentTasks.forEach((task)=>{
            if (!performanceByType.has(task.taskType)) {
                performanceByType.set(task.taskType, []);
            }
            performanceByType.get(task.taskType).push(task.accuracy);
        });
        let adaptabilitySum = 0;
        let typeCount = 0;
        for (const [taskType, accuracies] of performanceByType){
            if (accuracies.length >= 2) {
                const avgAccuracy = accuracies.reduce((sum, acc)=>sum + acc, 0) / accuracies.length;
                adaptabilitySum += avgAccuracy;
                typeCount++;
            }
        }
        const adaptabilityScore = typeCount > 0 ? adaptabilitySum / typeCount : 0.7;
        const diversityBonus = Math.min(0.1, taskTypes.size * 0.02);
        return Math.min(1, adaptabilityScore + diversityBonus);
    }
    calculateWeightedScore(components) {
        const weights = this.config.weights;
        return components.accuracy * weights.accuracy + components.reliability * weights.reliability + components.consistency * weights.consistency + components.efficiency * weights.efficiency + components.adaptability * weights.adaptability;
    }
    async generatePerformanceWindows(agentData) {
        const windows = [];
        const now = new Date();
        const recentStart = new Date(now.getTime() - this.config.windowSizes.recent * 60 * 1000);
        windows.push(await this.createPerformanceWindow('recent', recentStart, now, agentData));
        const shortStart = new Date(now.getTime() - this.config.windowSizes.short * 60 * 60 * 1000);
        windows.push(await this.createPerformanceWindow('short', shortStart, now, agentData));
        const mediumStart = new Date(now.getTime() - this.config.windowSizes.medium * 24 * 60 * 60 * 1000);
        windows.push(await this.createPerformanceWindow('medium', mediumStart, now, agentData));
        const longStart = new Date(now.getTime() - this.config.windowSizes.long * 7 * 24 * 60 * 60 * 1000);
        windows.push(await this.createPerformanceWindow('long', longStart, now, agentData));
        return windows;
    }
    async createPerformanceWindow(period, startTime, endTime, agentData) {
        const windowMetrics = agentData.metrics.filter((m)=>m.timestamp >= startTime && m.timestamp <= endTime);
        const windowTasks = agentData.taskHistory.filter((t)=>t.timestamp >= startTime && t.timestamp <= endTime);
        const successfulTasks = windowTasks.filter((t)=>t.success).length;
        const accuracyValues = windowMetrics.filter((m)=>m.metricType === 'accuracy').map((m)=>m.value);
        const confidenceValues = windowMetrics.map((m)=>m.confidence);
        const interventions = windowTasks.filter((t)=>t.interventionRequired).length;
        const criticalErrors = agentData.errorHistory.filter((e)=>e.timestamp >= startTime && e.timestamp <= endTime && e.severity === 'critical').length;
        return {
            period,
            startTime,
            endTime,
            metrics: {
                totalTasks: windowTasks.length,
                successfulTasks,
                averageAccuracy: accuracyValues.length > 0 ? accuracyValues.reduce((sum, val)=>sum + val, 0) / accuracyValues.length : 0,
                averageConfidence: confidenceValues.length > 0 ? confidenceValues.reduce((sum, val)=>sum + val, 0) / confidenceValues.length : 0,
                humanInterventions: interventions,
                criticalErrors
            }
        };
    }
    async analyzeTrends(agentData) {
        const trends = [];
        const metricTypes = [
            'accuracy',
            'reliability',
            'consistency',
            'efficiency'
        ];
        for (const metricType of metricTypes){
            const trend = await this.analyzeTrendForMetric(agentData, metricType);
            if (trend) {
                trends.push(trend);
            }
        }
        return trends;
    }
    async analyzeTrendForMetric(agentData, metricType) {
        const relevantMetrics = agentData.metrics.filter((m)=>m.metricType === metricType).sort((a, b)=>a.timestamp.getTime() - b.timestamp.getTime());
        if (relevantMetrics.length < 5) return null;
        const values = relevantMetrics.map((m)=>m.value);
        const times = relevantMetrics.map((m)=>m.timestamp.getTime());
        const { slope, correlation } = this.calculateLinearTrend(times, values);
        let direction;
        if (Math.abs(slope) < 0.001) {
            direction = 'stable';
        } else {
            direction = slope > 0 ? 'improving' : 'declining';
        }
        const confidence = Math.abs(correlation);
        const rate = Math.abs(slope);
        return {
            metric: metricType,
            direction,
            rate,
            confidence,
            timespan: 'medium'
        };
    }
    async generateBenchmarkComparisons(agentId, components) {
        const comparisons = [];
        const benchmarks = this.config.benchmarks;
        comparisons.push({
            category: 'accuracy',
            agentScore: components.accuracy,
            benchmarkScore: benchmarks.minAccuracy,
            percentile: this.calculatePercentile(components.accuracy, 'accuracy'),
            comparison: components.accuracy >= benchmarks.minAccuracy ? 'above' : 'below'
        });
        comparisons.push({
            category: 'reliability',
            agentScore: components.reliability,
            benchmarkScore: benchmarks.minReliability,
            percentile: this.calculatePercentile(components.reliability, 'reliability'),
            comparison: components.reliability >= benchmarks.minReliability ? 'above' : 'below'
        });
        comparisons.push({
            category: 'consistency',
            agentScore: components.consistency,
            benchmarkScore: benchmarks.minConsistency,
            percentile: this.calculatePercentile(components.consistency, 'consistency'),
            comparison: components.consistency >= benchmarks.minConsistency ? 'above' : 'below'
        });
        comparisons.push({
            category: 'efficiency',
            agentScore: components.efficiency,
            benchmarkScore: benchmarks.minEfficiency,
            percentile: this.calculatePercentile(components.efficiency, 'efficiency'),
            comparison: components.efficiency >= benchmarks.minEfficiency ? 'above' : 'below'
        });
        return comparisons;
    }
    async assessRisk(agentData, components) {
        const riskFactors = [];
        if (components.accuracy < this.config.riskThresholds.medium) {
            riskFactors.push({
                name: 'Low Accuracy',
                severity: components.accuracy < this.config.riskThresholds.high ? 0.8 : 0.5,
                probability: 0.9,
                impact: 'High risk of incorrect outputs',
                trend: this.getTrendDirection(agentData, 'accuracy')
            });
        }
        if (components.reliability < this.config.riskThresholds.medium) {
            riskFactors.push({
                name: 'Low Reliability',
                severity: components.reliability < this.config.riskThresholds.high ? 0.7 : 0.4,
                probability: 0.8,
                impact: 'Frequent task failures',
                trend: this.getTrendDirection(agentData, 'reliability')
            });
        }
        if (components.efficiency < this.config.riskThresholds.medium) {
            riskFactors.push({
                name: 'Low Efficiency',
                severity: 0.4,
                probability: 0.7,
                impact: 'Reduced throughput and increased costs',
                trend: this.getTrendDirection(agentData, 'efficiency')
            });
        }
        const recentErrors = agentData.errorHistory.filter((e)=>e.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000));
        if (recentErrors.length > 5) {
            riskFactors.push({
                name: 'High Error Rate',
                severity: 0.6,
                probability: 0.8,
                impact: 'Increased human intervention required',
                trend: 'increasing'
            });
        }
        const maxSeverity = riskFactors.length > 0 ? Math.max(...riskFactors.map((f)=>f.severity)) : 0;
        let level;
        if (maxSeverity >= 0.8) level = 'critical';
        else if (maxSeverity >= 0.6) level = 'high';
        else if (maxSeverity >= 0.3) level = 'medium';
        else level = 'low';
        return {
            level,
            factors: riskFactors,
            recommendations: this.generateRecommendations(riskFactors),
            mitigationStrategies: this.generateMitigationStrategies(riskFactors)
        };
    }
    getMetricsInWindow(metrics, windowMs) {
        const cutoff = new Date(Date.now() - windowMs);
        return metrics.filter((m)=>m.timestamp >= cutoff);
    }
    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, val)=>sum + val, 0) / values.length;
        const squaredDiffs = values.map((val)=>Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, diff)=>sum + diff, 0) / values.length;
    }
    calculateCoefficientOfVariation(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, val)=>sum + val, 0) / values.length;
        if (mean === 0) return 0;
        const variance = this.calculateVariance(values);
        const stdDev = Math.sqrt(variance);
        return stdDev / mean;
    }
    calculateDurationEfficiency(tasks) {
        if (tasks.length === 0) return 0.8;
        const complexityGroups = new Map();
        tasks.forEach((task)=>{
            if (!complexityGroups.has(task.complexity)) {
                complexityGroups.set(task.complexity, []);
            }
            complexityGroups.get(task.complexity).push(task.duration);
        });
        const expectedDurations = {
            low: 5,
            medium: 15,
            high: 45,
            critical: 120
        };
        let totalEfficiency = 0;
        let groupCount = 0;
        for (const [complexity, durations] of complexityGroups){
            const avgDuration = durations.reduce((sum, d)=>sum + d, 0) / durations.length;
            const expected = expectedDurations[complexity] || 15;
            const efficiency = Math.min(1, expected / avgDuration);
            totalEfficiency += efficiency;
            groupCount++;
        }
        return groupCount > 0 ? totalEfficiency / groupCount : 0.8;
    }
    calculateLinearTrend(x, y) {
        const n = x.length;
        if (n < 2) return {
            slope: 0,
            correlation: 0
        };
        const sumX = x.reduce((sum, val)=>sum + val, 0);
        const sumY = y.reduce((sum, val)=>sum + val, 0);
        const sumXY = x.reduce((sum, val, i)=>sum + val * y[i], 0);
        const sumX2 = x.reduce((sum, val)=>sum + val * val, 0);
        const sumY2 = y.reduce((sum, val)=>sum + val * val, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        const correlation = denominator !== 0 ? numerator / denominator : 0;
        return {
            slope,
            correlation
        };
    }
    calculatePercentile(score, category) {
        const allScores = Array.from(this.agentScores.values()).map((s)=>s.components[category]).filter((s)=>s !== undefined).sort((a, b)=>a - b);
        if (allScores.length === 0) return 50;
        const index = allScores.findIndex((s)=>s >= score);
        return index === -1 ? 100 : index / allScores.length * 100;
    }
    getTrendDirection(agentData, metricType) {
        const recentMetrics = agentData.metrics.filter((m)=>m.metricType === metricType).slice(-10);
        if (recentMetrics.length < 3) return 'stable';
        const values = recentMetrics.map((m)=>m.value);
        const firstHalf = values.slice(0, Math.floor(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        const firstAvg = firstHalf.reduce((sum, val)=>sum + val, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, val)=>sum + val, 0) / secondHalf.length;
        const diff = secondAvg - firstAvg;
        if (Math.abs(diff) < 0.01) return 'stable';
        return diff > 0 ? 'increasing' : 'decreasing';
    }
    generateRecommendations(riskFactors) {
        const recommendations = [];
        riskFactors.forEach((factor)=>{
            switch(factor.name){
                case 'Low Accuracy':
                    recommendations.push('Implement additional validation steps');
                    recommendations.push('Review training data quality');
                    recommendations.push('Consider accuracy-focused training sessions');
                    break;
                case 'Low Reliability':
                    recommendations.push('Increase redundancy in critical tasks');
                    recommendations.push('Implement circuit breaker patterns');
                    recommendations.push('Add health check monitoring');
                    break;
                case 'Low Efficiency':
                    recommendations.push('Optimize task distribution algorithms');
                    recommendations.push('Review resource allocation');
                    recommendations.push('Consider task batching strategies');
                    break;
                case 'High Error Rate':
                    recommendations.push('Implement better error handling');
                    recommendations.push('Add preventive validation checks');
                    recommendations.push('Review error patterns for systemic issues');
                    break;
            }
        });
        return Array.from(new Set(recommendations));
    }
    generateMitigationStrategies(riskFactors) {
        const strategies = [];
        const hasAccuracyRisk = riskFactors.some((f)=>f.name.includes('Accuracy'));
        const hasReliabilityRisk = riskFactors.some((f)=>f.name.includes('Reliability'));
        const hasEfficiencyRisk = riskFactors.some((f)=>f.name.includes('Efficiency'));
        if (hasAccuracyRisk) {
            strategies.push('Increase human oversight for critical tasks');
            strategies.push('Implement staged rollback procedures');
            strategies.push('Add confidence-based task routing');
        }
        if (hasReliabilityRisk) {
            strategies.push('Implement automatic failover mechanisms');
            strategies.push('Add task retry logic with exponential backoff');
            strategies.push('Create backup processing pipelines');
        }
        if (hasEfficiencyRisk) {
            strategies.push('Implement dynamic load balancing');
            strategies.push('Add performance-based task assignment');
            strategies.push('Create efficiency monitoring dashboards');
        }
        return strategies;
    }
    shouldRecalculateScore(metric) {
        return metric.value < 0.7 || metric.confidence < 0.5 || metric.validation.errors.some((e)=>e.severity === 'critical') || metric.metricType === 'accuracy';
    }
    async updateTaskHistory(agentData, metric) {
        const taskPerformance = {
            taskId: metric.taskId,
            timestamp: metric.timestamp,
            taskType: metric.context.taskType,
            complexity: metric.context.complexity,
            duration: 0,
            accuracy: metric.value,
            success: metric.validation.isValid,
            interventionRequired: metric.context.verificationMethod === 'human',
            errorCount: metric.validation.errors.length
        };
        agentData.taskHistory.push(taskPerformance);
        if (agentData.taskHistory.length > 1000) {
            agentData.taskHistory = agentData.taskHistory.slice(-1000);
        }
    }
    async updateErrorHistory(agentData, metric) {
        metric.validation.errors.forEach((error)=>{
            const errorAnalysis = {
                timestamp: metric.timestamp,
                errorType: error.type,
                severity: error.severity,
                frequency: 1,
                impact: error.impact,
                resolved: false,
                pattern: this.identifyErrorPattern(error, agentData.errorHistory)
            };
            agentData.errorHistory.push(errorAnalysis);
        });
        if (agentData.errorHistory.length > 500) {
            agentData.errorHistory = agentData.errorHistory.slice(-500);
        }
    }
    identifyErrorPattern(error, errorHistory) {
        const recentSimilar = errorHistory.filter((e)=>e.errorType === error.type && e.timestamp > new Date(Date.now() - 24 * 60 * 60 * 1000));
        if (recentSimilar.length >= 3) return 'recurring';
        if (recentSimilar.length >= 2) return 'intermittent';
        return 'isolated';
    }
    initializeBenchmarks() {
        this.benchmarkScores.set('accuracy', 0.92);
        this.benchmarkScores.set('reliability', 0.88);
        this.benchmarkScores.set('consistency', 0.85);
        this.benchmarkScores.set('efficiency', 0.80);
        this.benchmarkScores.set('adaptability', 0.75);
    }
    async loadHistoricalData() {
        this.logger.debug('Loading historical agent scoring data');
    }
    async persistScoringData() {
        this.logger.debug('Persisting agent scoring data');
    }
    getAgentScore(agentId) {
        return this.agentScores.get(agentId);
    }
    getAllAgentScores() {
        return Array.from(this.agentScores.values());
    }
    getTopPerformers(limit = 10) {
        return Array.from(this.agentScores.values()).sort((a, b)=>b.overallScore - a.overallScore).slice(0, limit);
    }
    getAgentsByRiskLevel(riskLevel) {
        return Array.from(this.agentScores.values()).filter((score)=>score.riskAssessment.level === riskLevel);
    }
    getPerformanceStatistics() {
        const scores = Array.from(this.agentScores.values());
        return {
            totalAgents: scores.length,
            averageScore: scores.length > 0 ? scores.reduce((sum, s)=>sum + s.overallScore, 0) / scores.length : 0,
            highPerformers: scores.filter((s)=>s.overallScore >= 0.9).length,
            atRiskAgents: scores.filter((s)=>s.riskAssessment.level === 'high' || s.riskAssessment.level === 'critical').length,
            improvingAgents: scores.filter((s)=>s.trends.some((t)=>t.direction === 'improving' && t.confidence > 0.7)).length,
            decliningAgents: scores.filter((s)=>s.trends.some((t)=>t.direction === 'declining' && t.confidence > 0.7)).length
        };
    }
}

//# sourceMappingURL=agent-scorer.js.map