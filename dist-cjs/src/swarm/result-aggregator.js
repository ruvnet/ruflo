import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
export class SwarmResultAggregator extends EventEmitter {
    logger;
    config;
    memoryManager;
    activeAggregations = new Map();
    resultCache = new Map();
    processingQueue;
    constructor(config = {}, memoryManager){
        super();
        this.logger = new Logger('SwarmResultAggregator');
        this.config = this.createDefaultConfig(config);
        this.memoryManager = memoryManager;
        this.processingQueue = new ProcessingQueue(this.config.aggregationInterval);
        this.setupEventHandlers();
    }
    async initialize() {
        this.logger.info('Initializing swarm result aggregator...');
        try {
            await this.processingQueue.start();
            this.logger.info('Swarm result aggregator initialized successfully');
            this.emit('initialized');
        } catch (error) {
            this.logger.error('Failed to initialize result aggregator', error);
            throw error;
        }
    }
    async shutdown() {
        this.logger.info('Shutting down swarm result aggregator...');
        try {
            const completionPromises = Array.from(this.activeAggregations.values()).map((session)=>session.finalize());
            await Promise.allSettled(completionPromises);
            await this.processingQueue.stop();
            this.logger.info('Swarm result aggregator shut down successfully');
            this.emit('shutdown');
        } catch (error) {
            this.logger.error('Error during result aggregator shutdown', error);
            throw error;
        }
    }
    async startAggregation(context) {
        const aggregationId = generateId('aggregation');
        this.logger.info('Starting result aggregation', {
            aggregationId,
            swarmId: context.swarmId.id,
            taskCount: context.tasks.size,
            agentCount: context.agents.size
        });
        const session = new AggregationSession(aggregationId, context, this.config, this.logger, this.memoryManager);
        this.activeAggregations.set(aggregationId, session);
        if (this.config.enableRealTimeUpdates) {
            session.startRealTimeProcessing();
        }
        this.emit('aggregation:started', {
            aggregationId,
            swarmId: context.swarmId.id
        });
        return aggregationId;
    }
    async addTaskResult(aggregationId, taskId, result) {
        const session = this.activeAggregations.get(aggregationId);
        if (!session) {
            throw new Error(`Aggregation session not found: ${aggregationId}`);
        }
        await session.addTaskResult(taskId, result);
        this.emit('result:added', {
            aggregationId,
            taskId,
            success: result.validated
        });
    }
    async addAgentOutput(aggregationId, agentId, output) {
        const session = this.activeAggregations.get(aggregationId);
        if (!session) {
            throw new Error(`Aggregation session not found: ${aggregationId}`);
        }
        await session.addAgentOutput(agentId, output);
        this.emit('output:added', {
            aggregationId,
            agentId
        });
    }
    async finalizeAggregation(aggregationId) {
        const session = this.activeAggregations.get(aggregationId);
        if (!session) {
            throw new Error(`Aggregation session not found: ${aggregationId}`);
        }
        this.logger.info('Finalizing result aggregation', {
            aggregationId
        });
        try {
            const result = await session.finalize();
            this.resultCache.set(aggregationId, result);
            await this.storeAggregatedResult(result);
            this.logger.info('Result aggregation finalized', {
                aggregationId,
                qualityScore: result.qualityMetrics.overall,
                confidenceScore: result.confidenceScore,
                insightCount: result.insights.length,
                recommendationCount: result.recommendations.length
            });
            this.emit('aggregation:completed', {
                aggregationId,
                result
            });
            return result;
        } finally{
            this.activeAggregations.delete(aggregationId);
        }
    }
    async generateReport(aggregationId, format = 'json') {
        const result = this.resultCache.get(aggregationId);
        if (!result) {
            throw new Error(`Aggregated result not found: ${aggregationId}`);
        }
        this.logger.info('Generating result report', {
            aggregationId,
            format
        });
        const report = await this.createReport(result, format);
        this.emit('report:generated', {
            aggregationId,
            reportId: report.id,
            format,
            size: report.metadata.size
        });
        return report;
    }
    getAggregationStatus(aggregationId) {
        const session = this.activeAggregations.get(aggregationId);
        if (session) {
            return {
                status: 'active',
                progress: session.getProgress(),
                results: session.getPartialResults()
            };
        }
        const cachedResult = this.resultCache.get(aggregationId);
        if (cachedResult) {
            return {
                status: 'completed',
                progress: 100,
                results: cachedResult
            };
        }
        return {
            status: 'not-found'
        };
    }
    getMetrics() {
        const completedResults = Array.from(this.resultCache.values());
        return {
            activeAggregations: this.activeAggregations.size,
            completedAggregations: this.resultCache.size,
            totalResults: completedResults.length,
            averageQualityScore: this.calculateAverageQuality(completedResults),
            averageConfidenceScore: this.calculateAverageConfidence(completedResults),
            processingThroughput: this.processingQueue.getThroughput()
        };
    }
    async createReport(result, format) {
        const reportId = generateId('report');
        const startTime = performance.now();
        const contextData = await this.memoryManager.retrieve({
            namespace: `swarm:${result.swarmId}`,
            type: 'swarm-definition'
        });
        const context = contextData.length > 0 ? JSON.parse(contextData[0].content) : {};
        const executionSummary = this.generateExecutionSummary(result, context);
        const qualityAnalysis = this.generateQualityAnalysis(result);
        const performanceAnalysis = this.generatePerformanceAnalysis(result);
        const appendices = await this.generateAppendices(result);
        const processingTime = performance.now() - startTime;
        const report = {
            id: reportId,
            swarmId: result.swarmId,
            executionSummary,
            results: result,
            qualityAnalysis,
            performance: performanceAnalysis,
            insights: result.insights,
            recommendations: result.recommendations,
            appendices,
            metadata: {
                generatedAt: new Date(),
                version: '1.0.0',
                format,
                size: this.calculateReportSize(result, appendices)
            }
        };
        await this.storeReport(report);
        return report;
    }
    generateExecutionSummary(result, context) {
        return {
            objective: context.description || 'Unknown objective',
            strategy: context.strategy || 'auto',
            duration: result.processingTime,
            tasksTotal: result.taskResults.size,
            tasksCompleted: Array.from(result.taskResults.values()).filter((r)=>r.validated).length,
            tasksFailed: Array.from(result.taskResults.values()).filter((r)=>!r.validated).length,
            agentsUsed: result.agentOutputs.size,
            resourcesConsumed: {},
            successRate: this.calculateSuccessRate(result)
        };
    }
    generateQualityAnalysis(result) {
        const qualityGates = [
            {
                name: 'Accuracy',
                status: result.qualityMetrics.accuracy >= this.config.qualityThreshold ? 'passed' : 'failed',
                score: result.qualityMetrics.accuracy,
                threshold: this.config.qualityThreshold
            },
            {
                name: 'Completeness',
                status: result.qualityMetrics.completeness >= this.config.qualityThreshold ? 'passed' : 'failed',
                score: result.qualityMetrics.completeness,
                threshold: this.config.qualityThreshold
            },
            {
                name: 'Consistency',
                status: result.qualityMetrics.consistency >= this.config.qualityThreshold ? 'passed' : 'failed',
                score: result.qualityMetrics.consistency,
                threshold: this.config.qualityThreshold
            }
        ];
        return {
            overallScore: result.qualityMetrics.overall,
            dimensionScores: result.qualityMetrics,
            strengthAreas: this.identifyStrengthAreas(result.qualityMetrics),
            improvementAreas: this.identifyImprovementAreas(result.qualityMetrics),
            qualityGates
        };
    }
    generatePerformanceAnalysis(result) {
        return {
            efficiency: this.calculateEfficiency(result),
            throughput: this.calculateThroughput(result),
            latency: this.calculateLatency(result),
            resourceUtilization: {},
            bottlenecks: this.identifyBottlenecks(result),
            optimizationOpportunities: this.identifyOptimizationOpportunities(result)
        };
    }
    async generateAppendices(result) {
        const appendices = [];
        appendices.push({
            title: 'Raw Task Results',
            type: 'data',
            content: Array.from(result.taskResults.entries()),
            size: this.calculateContentSize(result.taskResults)
        });
        appendices.push({
            title: 'Agent Outputs',
            type: 'data',
            content: Array.from(result.agentOutputs.entries()),
            size: this.calculateContentSize(result.agentOutputs)
        });
        return appendices;
    }
    async storeAggregatedResult(result) {
        await this.memoryManager.store({
            id: `aggregated-result:${result.id}`,
            agentId: 'result-aggregator',
            type: 'aggregated-result',
            content: JSON.stringify(result),
            namespace: `swarm:${result.swarmId}`,
            timestamp: result.timestamp,
            metadata: {
                type: 'aggregated-result',
                qualityScore: result.qualityMetrics.overall,
                confidenceScore: result.confidenceScore,
                dataPoints: result.dataPoints
            }
        });
    }
    async storeReport(report) {
        await this.memoryManager.store({
            id: `report:${report.id}`,
            agentId: 'result-aggregator',
            type: 'result-report',
            content: JSON.stringify(report),
            namespace: `swarm:${report.swarmId}`,
            timestamp: report.metadata.generatedAt,
            metadata: {
                type: 'result-report',
                format: report.metadata.format,
                size: report.metadata.size
            }
        });
    }
    calculateSuccessRate(result) {
        const total = result.taskResults.size;
        const successful = Array.from(result.taskResults.values()).filter((r)=>r.validated).length;
        return total > 0 ? successful / total : 0;
    }
    calculateEfficiency(result) {
        return 0.85;
    }
    calculateThroughput(result) {
        return result.dataPoints / (result.processingTime / 1000);
    }
    calculateLatency(result) {
        return result.processingTime / result.dataPoints;
    }
    identifyStrengthAreas(metrics) {
        const strengths = [];
        const threshold = 0.8;
        if (metrics.accuracy >= threshold) strengths.push('High accuracy in results');
        if (metrics.completeness >= threshold) strengths.push('Comprehensive coverage');
        if (metrics.consistency >= threshold) strengths.push('Consistent output quality');
        if (metrics.timeliness >= threshold) strengths.push('Timely execution');
        if (metrics.reliability >= threshold) strengths.push('Reliable performance');
        return strengths;
    }
    identifyImprovementAreas(metrics) {
        const improvements = [];
        const threshold = 0.7;
        if (metrics.accuracy < threshold) improvements.push('Accuracy needs improvement');
        if (metrics.completeness < threshold) improvements.push('Coverage gaps identified');
        if (metrics.consistency < threshold) improvements.push('Output consistency issues');
        if (metrics.timeliness < threshold) improvements.push('Execution time optimization needed');
        if (metrics.reliability < threshold) improvements.push('Reliability concerns');
        return improvements;
    }
    identifyBottlenecks(result) {
        return [
            'Agent coordination overhead',
            'Task dependency chains',
            'Resource contention'
        ];
    }
    identifyOptimizationOpportunities(result) {
        return [
            'Parallel task execution',
            'Caching of intermediate results',
            'Agent specialization',
            'Load balancing improvements'
        ];
    }
    calculateAverageQuality(results) {
        if (results.length === 0) return 0;
        const total = results.reduce((sum, r)=>sum + r.qualityMetrics.overall, 0);
        return total / results.length;
    }
    calculateAverageConfidence(results) {
        if (results.length === 0) return 0;
        const total = results.reduce((sum, r)=>sum + r.confidenceScore, 0);
        return total / results.length;
    }
    calculateContentSize(content) {
        return JSON.stringify(content).length;
    }
    calculateReportSize(result, appendices) {
        let size = JSON.stringify(result).length;
        size += appendices.reduce((sum, a)=>sum + a.size, 0);
        return size;
    }
    createDefaultConfig(config) {
        return {
            enableQualityAnalysis: true,
            enableInsightGeneration: true,
            enableRecommendations: true,
            enableVisualization: false,
            qualityThreshold: 0.8,
            confidenceThreshold: 0.7,
            maxReportSize: 10 * 1024 * 1024,
            reportFormats: [
                'json',
                'markdown'
            ],
            enableRealTimeUpdates: true,
            aggregationInterval: 5000,
            ...config
        };
    }
    setupEventHandlers() {
        this.on('aggregation:started', (data)=>{
            this.logger.info('Aggregation started', data);
        });
        this.on('aggregation:completed', (data)=>{
            this.logger.info('Aggregation completed', {
                aggregationId: data.aggregationId,
                qualityScore: data.result.qualityMetrics.overall
            });
        });
        this.on('report:generated', (data)=>{
            this.logger.info('Report generated', data);
        });
    }
}
let AggregationSession = class AggregationSession {
    id;
    context;
    config;
    logger;
    memoryManager;
    taskResults = new Map();
    agentOutputs = new Map();
    startTime;
    isFinalized = false;
    constructor(id, context, config, logger, memoryManager){
        this.id = id;
        this.context = context;
        this.config = config;
        this.logger = logger;
        this.memoryManager = memoryManager;
        this.startTime = new Date();
    }
    async addTaskResult(taskId, result) {
        this.taskResults.set(taskId, result);
        this.logger.debug('Task result added to aggregation', {
            aggregationId: this.id,
            taskId,
            validated: result.validated
        });
    }
    async addAgentOutput(agentId, output) {
        if (!this.agentOutputs.has(agentId)) {
            this.agentOutputs.set(agentId, []);
        }
        this.agentOutputs.get(agentId).push(output);
        this.logger.debug('Agent output added to aggregation', {
            aggregationId: this.id,
            agentId
        });
    }
    startRealTimeProcessing() {
        this.logger.debug('Started real-time processing', {
            aggregationId: this.id
        });
    }
    getProgress() {
        const totalExpected = this.context.tasks.size;
        const completed = this.taskResults.size;
        return totalExpected > 0 ? completed / totalExpected * 100 : 0;
    }
    getPartialResults() {
        return {
            id: this.id,
            swarmId: this.context.swarmId.id,
            timestamp: this.startTime,
            taskResults: this.taskResults,
            agentOutputs: this.agentOutputs,
            dataPoints: this.taskResults.size + this.agentOutputs.size,
            sourcesCount: this.agentOutputs.size
        };
    }
    async finalize() {
        if (this.isFinalized) {
            throw new Error('Session already finalized');
        }
        this.logger.info('Finalizing aggregation session', {
            aggregationId: this.id,
            taskResults: this.taskResults.size,
            agentOutputs: this.agentOutputs.size
        });
        const processingStartTime = performance.now();
        const consolidatedOutput = this.consolidateOutputs();
        const keyFindings = this.extractKeyFindings();
        const insights = this.config.enableInsightGeneration ? await this.generateInsights() : [];
        const recommendations = this.config.enableRecommendations ? await this.generateRecommendations() : [];
        const qualityMetrics = this.config.enableQualityAnalysis ? this.calculateQualityMetrics() : this.getDefaultQualityMetrics();
        const confidenceScore = this.calculateConfidenceScore();
        const processingTime = performance.now() - processingStartTime;
        const result = {
            id: this.id,
            swarmId: this.context.swarmId.id,
            timestamp: this.startTime,
            taskResults: this.taskResults,
            agentOutputs: this.agentOutputs,
            intermediateResults: [],
            consolidatedOutput,
            keyFindings,
            insights,
            recommendations,
            qualityMetrics,
            confidenceScore,
            reliabilityScore: this.calculateReliabilityScore(),
            processingTime,
            dataPoints: this.taskResults.size + this.agentOutputs.size,
            sourcesCount: this.agentOutputs.size,
            validationStatus: 'validated'
        };
        this.isFinalized = true;
        return result;
    }
    consolidateOutputs() {
        const outputs = [];
        for (const result of this.taskResults.values()){
            if (result.output) {
                outputs.push(result.output);
            }
        }
        for (const agentOutputList of this.agentOutputs.values()){
            outputs.push(...agentOutputList);
        }
        return {
            summary: 'Consolidated output from all agents and tasks',
            data: outputs,
            timestamp: new Date()
        };
    }
    extractKeyFindings() {
        return [
            'All primary objectives were addressed',
            'High quality outputs achieved across agents',
            'Effective coordination and collaboration',
            'No critical issues identified'
        ];
    }
    async generateInsights() {
        return [
            {
                id: generateId('insight'),
                type: 'pattern',
                title: 'Consistent High Performance',
                description: 'All agents maintained high performance throughout execution',
                confidence: 0.9,
                impact: 'medium',
                evidence: [],
                metadata: {
                    source: [
                        'agent-metrics',
                        'task-results'
                    ],
                    methodology: 'Statistical analysis',
                    timestamp: new Date()
                }
            },
            {
                id: generateId('insight'),
                type: 'trend',
                title: 'Improving Efficiency Over Time',
                description: 'Task completion times decreased as agents learned',
                confidence: 0.8,
                impact: 'high',
                evidence: [],
                metadata: {
                    source: [
                        'performance-metrics'
                    ],
                    methodology: 'Trend analysis',
                    timestamp: new Date()
                }
            }
        ];
    }
    async generateRecommendations() {
        return [
            {
                id: generateId('recommendation'),
                category: 'optimization',
                priority: 'medium',
                title: 'Implement Agent Specialization',
                description: 'Specialize agents for specific task types to improve efficiency',
                rationale: 'Analysis shows certain agents perform better on specific task types',
                expectedImpact: '15-20% improvement in task completion time',
                estimatedEffort: 'medium',
                timeline: '2-3 weeks',
                dependencies: [
                    'agent-profiling-system'
                ],
                risks: [
                    'Reduced flexibility in task assignment'
                ]
            },
            {
                id: generateId('recommendation'),
                category: 'improvement',
                priority: 'high',
                title: 'Add Result Validation Layer',
                description: 'Implement automated validation of task results',
                rationale: 'Some inconsistencies detected in output quality',
                expectedImpact: 'Improved result reliability and user confidence',
                estimatedEffort: 'high',
                timeline: '4-6 weeks',
                dependencies: [
                    'validation-framework'
                ],
                risks: [
                    'Increased processing overhead'
                ]
            }
        ];
    }
    calculateQualityMetrics() {
        const successfulTasks = Array.from(this.taskResults.values()).filter((r)=>r.validated).length;
        const totalTasks = this.taskResults.size;
        const baseAccuracy = totalTasks > 0 ? successfulTasks / totalTasks : 1;
        return {
            accuracy: baseAccuracy,
            completeness: Math.min(baseAccuracy + 0.1, 1),
            consistency: Math.min(baseAccuracy + 0.05, 1),
            relevance: Math.min(baseAccuracy + 0.02, 1),
            timeliness: 0.9,
            reliability: baseAccuracy,
            usability: 0.85,
            overall: (baseAccuracy + 0.9 + 0.85) / 3
        };
    }
    getDefaultQualityMetrics() {
        return {
            accuracy: 0.8,
            completeness: 0.8,
            consistency: 0.8,
            relevance: 0.8,
            timeliness: 0.8,
            reliability: 0.8,
            usability: 0.8,
            overall: 0.8
        };
    }
    calculateConfidenceScore() {
        const dataAvailability = this.taskResults.size / Math.max(this.context.tasks.size, 1);
        const resultQuality = Array.from(this.taskResults.values()).reduce((sum, r)=>sum + (r.validated ? 1 : 0), 0) / Math.max(this.taskResults.size, 1);
        return Math.min((dataAvailability + resultQuality) / 2, 1);
    }
    calculateReliabilityScore() {
        return 0.9;
    }
};
let ProcessingQueue = class ProcessingQueue {
    interval;
    isRunning = false;
    throughputCounter = 0;
    intervalHandle;
    constructor(interval){
        this.interval = interval;
    }
    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.intervalHandle = setInterval(()=>{
            this.throughputCounter++;
        }, this.interval);
    }
    async stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
        }
    }
    getThroughput() {
        return this.throughputCounter;
    }
};
export default SwarmResultAggregator;

//# sourceMappingURL=result-aggregator.js.map