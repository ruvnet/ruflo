import { EventEmitter } from 'events';
import { NeuralDomainMapper } from './NeuralDomainMapper.js';
import { agenticHookManager } from '../services/agentic-flow-hooks/hook-manager.js';
export class NeuralDomainMapperIntegration extends EventEmitter {
    domainMapper;
    config;
    analysisHistory = [];
    activeAnalysis = new Map();
    learningPatterns = [];
    isInitialized = false;
    constructor(domainMapper, config = {}){
        super();
        this.config = {
            enableAutoAnalysis: true,
            enableOptimizationSuggestions: true,
            enableContinuousLearning: true,
            confidenceThreshold: 0.7,
            analysisInterval: 30000,
            maxOptimizationProposals: 10,
            ...config
        };
        this.domainMapper = domainMapper || new NeuralDomainMapper();
        this.setupEventListeners();
    }
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        this.registerDomainAnalysisHooks();
        if (this.config.enableAutoAnalysis) {
            this.setupPeriodicAnalysis();
        }
        this.isInitialized = true;
        this.emit('integration-initialized');
    }
    async analyzeDomains(domains, context1) {
        const correlationId = context1.correlationId;
        if (this.activeAnalysis.has(correlationId)) {
            return await this.activeAnalysis.get(correlationId);
        }
        const analysisPromise = this.performDomainAnalysis(domains, context1);
        this.activeAnalysis.set(correlationId, analysisPromise);
        try {
            const result = await analysisPromise;
            this.analysisHistory.push(result);
            if (this.analysisHistory.length > 100) {
                this.analysisHistory.shift();
            }
            await this.generateHookSideEffects(result, context1);
            if (this.config.enableContinuousLearning) {
                await this.learnFromAnalysis(result, context1);
            }
            this.emit('domain-analysis-completed', result);
            return result;
        } finally{
            this.activeAnalysis.delete(correlationId);
        }
    }
    async trainOnPatterns(patterns, context1) {
        const trainingData = this.convertPatternsToTrainingData(patterns);
        if (trainingData.inputs.length === 0) {
            return {
                trainingAccuracy: 0,
                patternsProcessed: 0,
                newInsights: [
                    'No suitable training data found in patterns'
                ]
            };
        }
        const trainingResult = await this.domainMapper.train(trainingData);
        const newInsights = this.extractTrainingInsights(trainingResult, patterns);
        this.learningPatterns.push(...patterns.slice(-50));
        const result = {
            trainingAccuracy: trainingResult.finalAccuracy,
            patternsProcessed: patterns.length,
            newInsights
        };
        this.emit('training-completed', result);
        return result;
    }
    async getOptimizationSuggestions(context1) {
        const optimization = await this.domainMapper.provideBoundaryOptimization();
        const applicability = this.calculateOptimizationApplicability(optimization, context1);
        const prioritizedActions = this.generatePrioritizedActions(optimization);
        const result = {
            suggestions: optimization,
            applicability,
            prioritizedActions
        };
        this.emit('optimization-suggestions-generated', result);
        return result;
    }
    async predictDomainRelationships(proposedChanges, context1) {
        const predictionInput = this.createPredictionInput(proposedChanges);
        const predictions = await Promise.all(predictionInput.map((input)=>this.domainMapper.predict(input)));
        const riskAssessment = this.assessChangeRisks(proposedChanges, predictions);
        const recommendations = this.generateChangeRecommendations(proposedChanges, predictions, riskAssessment);
        const result = {
            predictions,
            riskAssessment,
            recommendations
        };
        this.emit('domain-predictions-generated', result);
        return result;
    }
    getIntegrationStats() {
        const totalAnalyses = this.analysisHistory.length;
        const avgTime = totalAnalyses > 0 ? this.analysisHistory.reduce((sum, a)=>sum + a.metrics.analysisTime, 0) / totalAnalyses : 0;
        const optimizationsSuggested = this.analysisHistory.reduce((sum, a)=>sum + a.optimization.proposals.length, 0);
        const accuracyTrend = this.analysisHistory.slice(-10).map((a)=>a.cohesion.overallScore);
        return {
            analysesPerformed: totalAnalyses,
            averageAnalysisTime: avgTime,
            patternsLearned: this.learningPatterns.length,
            optimizationsSuggested,
            accuracyTrend,
            lastAnalysis: totalAnalyses > 0 ? this.analysisHistory[totalAnalyses - 1].timestamp : 0
        };
    }
    setupEventListeners() {
        this.domainMapper.on('graph-updated', (graph)=>{
            this.emit('graph-updated', graph);
        });
        this.domainMapper.on('cohesion-calculated', (analysis)=>{
            this.emit('cohesion-calculated', analysis);
        });
        this.domainMapper.on('dependencies-analyzed', (analysis)=>{
            this.emit('dependencies-analyzed', analysis);
        });
        this.domainMapper.on('optimization-generated', (optimization)=>{
            this.emit('optimization-generated', optimization);
        });
        this.domainMapper.on('training-completed', (result)=>{
            this.emit('mapper-training-completed', result);
        });
    }
    registerDomainAnalysisHooks() {
        agenticHookManager.register({
            id: 'domain-mapper-pattern-analysis',
            type: 'neural-pattern-detected',
            priority: 80,
            handler: async (payload, context1)=>{
                if (!this.config.enableAutoAnalysis || !payload.patterns?.length) {
                    return {
                        continue: true
                    };
                }
                const domainPatterns = payload.patterns.filter((p)=>this.isDomainRelatedPattern(p));
                if (domainPatterns.length === 0) {
                    return {
                        continue: true
                    };
                }
                const sideEffects = [];
                try {
                    const domainGraph = await this.extractDomainGraphFromPatterns(domainPatterns);
                    if (domainGraph) {
                        const analysisResult = await this.analyzeDomains(domainGraph, context1);
                        if (analysisResult.optimization.optimizationScore >= this.config.confidenceThreshold) {
                            sideEffects.push({
                                type: 'notification',
                                action: 'emit',
                                data: {
                                    event: 'domain:optimization-suggested',
                                    data: analysisResult.optimization
                                }
                            });
                        }
                        sideEffects.push({
                            type: 'memory',
                            action: 'store',
                            data: {
                                key: `domain:analysis:${context1.correlationId}`,
                                value: analysisResult,
                                ttl: 3600
                            }
                        });
                    }
                } catch (error) {
                    sideEffects.push({
                        type: 'log',
                        action: 'write',
                        data: {
                            level: 'error',
                            message: 'Domain analysis failed',
                            error: error.message
                        }
                    });
                }
                return {
                    continue: true,
                    sideEffects
                };
            }
        });
        agenticHookManager.register({
            id: 'domain-mapper-training-integration',
            type: 'post-neural-train',
            priority: 90,
            handler: async (payload, context1)=>{
                if (!this.config.enableContinuousLearning) {
                    return {
                        continue: true
                    };
                }
                if (payload.trainingData) {
                    const domainTrainingData = this.extractDomainTrainingData(payload.trainingData);
                    if (domainTrainingData.inputs.length > 0) {
                        try {
                            await this.domainMapper.train(domainTrainingData);
                            return {
                                continue: true,
                                sideEffects: [
                                    {
                                        type: 'log',
                                        action: 'write',
                                        data: {
                                            level: 'info',
                                            message: 'Domain mapper updated with new training data',
                                            dataSize: domainTrainingData.inputs.length
                                        }
                                    }
                                ]
                            };
                        } catch (error) {
                            return {
                                continue: true,
                                sideEffects: [
                                    {
                                        type: 'log',
                                        action: 'write',
                                        data: {
                                            level: 'warning',
                                            message: 'Failed to update domain mapper',
                                            error: error.message
                                        }
                                    }
                                ]
                            };
                        }
                    }
                }
                return {
                    continue: true
                };
            }
        });
    }
    setupPeriodicAnalysis() {
        setInterval(async ()=>{
            try {
                const recentPatterns = context.neural.patterns.getByType('behavior').filter((p)=>Date.now() - (p.context.timestamp || 0) < this.config.analysisInterval * 2);
                if (recentPatterns.length > 0) {
                    const mockContext = {
                        sessionId: 'periodic-analysis',
                        timestamp: Date.now(),
                        correlationId: `periodic-${Date.now()}`,
                        metadata: {
                            source: 'periodic-analysis'
                        },
                        memory: {
                            namespace: 'domain-analysis',
                            provider: 'default',
                            cache: new Map()
                        },
                        neural: {
                            modelId: 'domain-mapper',
                            patterns: context.neural.patterns,
                            training: context.neural.training
                        },
                        performance: {
                            metrics: new Map(),
                            bottlenecks: [],
                            optimizations: []
                        }
                    };
                    await this.trainOnPatterns(recentPatterns, mockContext);
                }
            } catch (error) {
                this.emit('error', {
                    type: 'periodic-analysis',
                    error
                });
            }
        }, this.config.analysisInterval);
    }
    async performDomainAnalysis(domains, context1) {
        const startTime = Date.now();
        const analysis = await this.domainMapper.analyzeDomains(domains);
        const patterns = this.extractPatternsFromAnalysis(analysis, context1);
        const analysisTime = Date.now() - startTime;
        return {
            timestamp: Date.now(),
            correlationId: context1.correlationId,
            graph: domains,
            cohesion: analysis.cohesion,
            dependencies: analysis.dependencies,
            optimization: analysis.optimization,
            patterns,
            metrics: {
                analysisTime,
                nodesAnalyzed: domains.nodes.size,
                edgesAnalyzed: domains.edges.size,
                patternsDetected: patterns.length
            }
        };
    }
    async generateHookSideEffects(result, context1) {
        const sideEffects = [];
        if (result.optimization.optimizationScore >= this.config.confidenceThreshold) {
            sideEffects.push({
                type: 'notification',
                action: 'emit',
                data: {
                    event: 'domain:optimization-available',
                    data: {
                        score: result.optimization.optimizationScore,
                        priority: result.optimization.priority,
                        proposalCount: result.optimization.proposals.length
                    }
                }
            });
        }
        for (const pattern of result.patterns){
            sideEffects.push({
                type: 'neural',
                action: 'store-pattern',
                data: {
                    pattern
                }
            });
        }
        sideEffects.push({
            type: 'metric',
            action: 'update',
            data: {
                name: 'domain.analysis.time',
                value: result.metrics.analysisTime
            }
        });
        sideEffects.push({
            type: 'metric',
            action: 'update',
            data: {
                name: 'domain.cohesion.score',
                value: result.cohesion.overallScore
            }
        });
        for (const effect of sideEffects){
            try {
                await this.executeSideEffect(effect, context1);
            } catch (error) {
                this.emit('error', {
                    type: 'side-effect',
                    effect,
                    error
                });
            }
        }
    }
    async learnFromAnalysis(result, context1) {
        const learningData = this.convertAnalysisToTrainingData(result);
        if (learningData.inputs.length > 0) {
            try {
                await this.domainMapper.train(learningData);
                this.emit('continuous-learning-completed', {
                    dataSize: learningData.inputs.length,
                    correlationId: context1.correlationId
                });
            } catch (error) {
                this.emit('error', {
                    type: 'continuous-learning',
                    error
                });
            }
        }
    }
    convertPatternsToTrainingData(patterns) {
        const inputs = [];
        const outputs = [];
        const labels = [];
        for (const pattern of patterns){
            if (this.isDomainRelatedPattern(pattern)) {
                const features = this.extractFeaturesFromPattern(pattern);
                if (features.length > 0) {
                    inputs.push({
                        features
                    });
                    const target = this.createTargetFromPattern(pattern);
                    outputs.push(target);
                    labels.push(pattern.type);
                }
            }
        }
        return {
            inputs,
            outputs,
            labels,
            batchSize: Math.min(32, inputs.length),
            epochs: Math.max(1, Math.min(10, inputs.length / 10))
        };
    }
    isDomainRelatedPattern(pattern) {
        return !!(pattern.context.domain || pattern.context.domainId || pattern.context.relationship || pattern.context.boundary || pattern.type === 'behavior' && pattern.context.component);
    }
    extractFeaturesFromPattern(pattern) {
        const features = [];
        const types = [
            'success',
            'failure',
            'optimization',
            'behavior'
        ];
        features.push(...types.map((t)=>t === pattern.type ? 1 : 0));
        features.push(pattern.confidence, Math.log(pattern.occurrences + 1) / 10);
        features.push(pattern.context.complexity || 0.5, pattern.context.size || 1, pattern.context.frequency || 1);
        while(features.length < 32){
            features.push(0);
        }
        return features.slice(0, 32);
    }
    createTargetFromPattern(pattern) {
        const target = [
            pattern.confidence,
            pattern.type === 'success' ? 1 : 0,
            pattern.type === 'failure' ? 1 : 0,
            Math.min(pattern.occurrences / 100, 1)
        ];
        return target;
    }
    extractTrainingInsights(trainingResult, patterns) {
        const insights = [];
        if (trainingResult.finalAccuracy > 0.8) {
            insights.push('High accuracy achieved - domain patterns are well understood');
        } else if (trainingResult.finalAccuracy > 0.6) {
            insights.push('Moderate accuracy - some domain patterns may need more data');
        } else {
            insights.push('Low accuracy - domain patterns are complex or insufficient data');
        }
        const patternTypes = new Map();
        patterns.forEach((p)=>{
            patternTypes.set(p.type, (patternTypes.get(p.type) || 0) + 1);
        });
        const dominantType = Array.from(patternTypes.entries()).sort((a, b)=>b[1] - a[1])[0];
        if (dominantType) {
            insights.push(`Primary learning focus: ${dominantType[0]} patterns (${dominantType[1]} samples)`);
        }
        return insights;
    }
    async extractDomainGraphFromPatterns(patterns) {
        return null;
    }
    extractDomainTrainingData(trainingData) {
        return {
            inputs: [],
            outputs: [],
            batchSize: 1,
            epochs: 1
        };
    }
    extractPatternsFromAnalysis(analysis, context1) {
        return [];
    }
    async executeSideEffect(effect, context1) {}
    convertAnalysisToTrainingData(result) {
        return {
            inputs: [],
            outputs: [],
            batchSize: 1,
            epochs: 1
        };
    }
    calculateOptimizationApplicability(optimization, context1) {
        return optimization.optimizationScore;
    }
    generatePrioritizedActions(optimization) {
        return optimization.proposals.map((p)=>({
                action: `${p.type} domains: ${p.domains.join(', ')}`,
                priority: p.confidence > 0.8 ? 'high' : p.confidence > 0.6 ? 'medium' : 'low',
                impact: p.metrics.cohesionImprovement + p.metrics.couplingReduction,
                effort: p.metrics.performanceImpact
            }));
    }
    createPredictionInput(proposedChanges) {
        return [];
    }
    assessChangeRisks(proposedChanges, predictions) {
        return {
            overallRisk: 0.5,
            riskFactors: []
        };
    }
    generateChangeRecommendations(proposedChanges, predictions, riskAssessment) {
        return [
            'Consider gradual implementation',
            'Monitor domain cohesion metrics'
        ];
    }
}
export async function createDomainMapperIntegration(config = {}) {
    const integration = new NeuralDomainMapperIntegration(undefined, config);
    await integration.initialize();
    return integration;
}

//# sourceMappingURL=integration.js.map