export { NeuralDomainMapper } from './NeuralDomainMapper.js';
export { NeuralDomainMapperIntegration, createDomainMapperIntegration } from './integration.js';
export const NEURAL_MODULE_VERSION = '2.0.0';
export const DEFAULT_CONFIGS = {
    SMALL_SCALE: {
        training: {
            learningRate: 0.01,
            batchSize: 16,
            epochs: 50,
            optimizer: 'adam',
            lossFunction: 'mse',
            regularization: {
                l1: 0.0001,
                l2: 0.0001,
                dropout: 0.1
            },
            earlyStoping: {
                enabled: true,
                patience: 10,
                minDelta: 0.001
            },
            validationSplit: 0.2
        },
        integration: {
            enableAutoAnalysis: true,
            enableOptimizationSuggestions: true,
            enableContinuousLearning: true,
            confidenceThreshold: 0.6,
            analysisInterval: 60000,
            maxOptimizationProposals: 5
        }
    },
    MEDIUM_SCALE: {
        training: {
            learningRate: 0.005,
            batchSize: 32,
            epochs: 100,
            optimizer: 'adam',
            lossFunction: 'mse',
            regularization: {
                l1: 0.0001,
                l2: 0.0001,
                dropout: 0.15
            },
            earlyStoping: {
                enabled: true,
                patience: 15,
                minDelta: 0.0005
            },
            validationSplit: 0.2
        },
        integration: {
            enableAutoAnalysis: true,
            enableOptimizationSuggestions: true,
            enableContinuousLearning: true,
            confidenceThreshold: 0.7,
            analysisInterval: 30000,
            maxOptimizationProposals: 10
        }
    },
    LARGE_SCALE: {
        training: {
            learningRate: 0.001,
            batchSize: 64,
            epochs: 200,
            optimizer: 'adamw',
            lossFunction: 'mse',
            regularization: {
                l1: 0.0002,
                l2: 0.0002,
                dropout: 0.2
            },
            earlyStoping: {
                enabled: true,
                patience: 20,
                minDelta: 0.0001
            },
            validationSplit: 0.15
        },
        integration: {
            enableAutoAnalysis: true,
            enableOptimizationSuggestions: true,
            enableContinuousLearning: false,
            confidenceThreshold: 0.8,
            analysisInterval: 120000,
            maxOptimizationProposals: 20
        }
    },
    REAL_TIME: {
        training: {
            learningRate: 0.01,
            batchSize: 8,
            epochs: 20,
            optimizer: 'sgd',
            lossFunction: 'mse',
            regularization: {
                l1: 0,
                l2: 0,
                dropout: 0.05
            },
            earlyStoping: {
                enabled: true,
                patience: 5,
                minDelta: 0.01
            },
            validationSplit: 0.1
        },
        integration: {
            enableAutoAnalysis: true,
            enableOptimizationSuggestions: false,
            enableContinuousLearning: true,
            confidenceThreshold: 0.5,
            analysisInterval: 5000,
            maxOptimizationProposals: 3
        }
    }
};
export const NeuralUtils = {
    createSimpleDomainGraph: (domains, relationships)=>{
        const graph = {
            nodes: new Map(),
            edges: new Map(),
            metadata: {
                created: Date.now(),
                lastTraining: 0,
                version: '1.0.0',
                cohesionScore: 0,
                totalNodes: domains.length,
                totalEdges: relationships.length
            }
        };
        domains.forEach((domain)=>{
            const node = {
                id: domain.id,
                name: domain.name,
                type: domain.type,
                features: Array.from({
                    length: 64
                }, ()=>Math.random()),
                metadata: {
                    size: 1,
                    complexity: 0.5,
                    stability: 0.8,
                    dependencies: [],
                    lastUpdated: Date.now(),
                    version: '1.0.0'
                },
                activation: 0,
                embedding: Array.from({
                    length: 32
                }, ()=>(Math.random() - 0.5) * 0.1)
            };
            graph.nodes.set(domain.id, node);
        });
        relationships.forEach((rel)=>{
            const edgeId = `${rel.source}->${rel.target}`;
            const edge = {
                source: rel.source,
                target: rel.target,
                weight: 1.0,
                type: rel.type || 'dependency',
                features: Array.from({
                    length: 32
                }, ()=>Math.random()),
                metadata: {
                    frequency: 1,
                    latency: 100,
                    reliability: 0.99,
                    bandwidth: 1000,
                    direction: 'unidirectional'
                }
            };
            graph.edges.set(edgeId, edge);
        });
        return graph;
    },
    generateSyntheticTrainingData: (size)=>{
        const inputs = Array.from({
            length: size
        }, ()=>({
                features: Array.from({
                    length: 64
                }, ()=>Math.random())
            }));
        const outputs = Array.from({
            length: size
        }, ()=>Array.from({
                length: 4
            }, ()=>Math.random()));
        return {
            inputs,
            outputs,
            batchSize: Math.min(32, size),
            epochs: Math.max(1, Math.min(50, size / 10))
        };
    },
    calculateBasicMetrics: (graph)=>{
        const nodeCount = graph.nodes.size;
        const edgeCount = graph.edges.size;
        const density = nodeCount > 1 ? 2 * edgeCount / (nodeCount * (nodeCount - 1)) : 0;
        const inDegrees = new Map();
        const outDegrees = new Map();
        for (const nodeId of graph.nodes.keys()){
            inDegrees.set(nodeId, 0);
            outDegrees.set(nodeId, 0);
        }
        for (const edge of graph.edges.values()){
            outDegrees.set(edge.source, (outDegrees.get(edge.source) || 0) + 1);
            inDegrees.set(edge.target, (inDegrees.get(edge.target) || 0) + 1);
        }
        const avgInDegree = Array.from(inDegrees.values()).reduce((sum, deg)=>sum + deg, 0) / nodeCount;
        const avgOutDegree = Array.from(outDegrees.values()).reduce((sum, deg)=>sum + deg, 0) / nodeCount;
        return {
            nodeCount,
            edgeCount,
            density,
            avgInDegree,
            avgOutDegree,
            complexity: Math.log(nodeCount + 1) * density
        };
    },
    validateDomainGraph: (graph)=>{
        const errors = [];
        const warnings = [];
        if (graph.nodes.size === 0) {
            errors.push('Graph has no nodes');
        }
        for (const edge of graph.edges.values()){
            if (!graph.nodes.has(edge.source)) {
                errors.push(`Edge references non-existent source node: ${edge.source}`);
            }
            if (!graph.nodes.has(edge.target)) {
                errors.push(`Edge references non-existent target node: ${edge.target}`);
            }
        }
        const connectedNodes = new Set();
        for (const edge of graph.edges.values()){
            connectedNodes.add(edge.source);
            connectedNodes.add(edge.target);
        }
        for (const nodeId of graph.nodes.keys()){
            if (!connectedNodes.has(nodeId)) {
                warnings.push(`Isolated node detected: ${nodeId}`);
            }
        }
        const density = NeuralUtils.calculateBasicMetrics(graph).density;
        if (density < 0.1) {
            warnings.push('Graph is very sparse (density < 0.1)');
        } else if (density > 0.8) {
            warnings.push('Graph is very dense (density > 0.8)');
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
};
export const Examples = {
    basicAnalysis: async ()=>{
        const mapper = new NeuralDomainMapper(DEFAULT_CONFIGS.SMALL_SCALE.training);
        const graph = NeuralUtils.createSimpleDomainGraph([
            {
                id: 'user-service',
                name: 'User Service',
                type: 'api'
            },
            {
                id: 'auth-service',
                name: 'Authentication Service',
                type: 'api'
            },
            {
                id: 'user-db',
                name: 'User Database',
                type: 'data'
            },
            {
                id: 'user-ui',
                name: 'User Interface',
                type: 'ui'
            }
        ], [
            {
                source: 'user-service',
                target: 'auth-service',
                type: 'dependency'
            },
            {
                source: 'user-service',
                target: 'user-db',
                type: 'data-flow'
            },
            {
                source: 'user-ui',
                target: 'user-service',
                type: 'communication'
            }
        ]);
        const analysis = await mapper.analyzeDomains(graph);
        return {
            cohesionScore: analysis.cohesion.overallScore,
            dependencyCount: analysis.dependencies.graph.size,
            optimizationProposals: analysis.optimization.proposals.length,
            recommendations: analysis.recommendations
        };
    },
    trainingExample: async ()=>{
        const mapper = new NeuralDomainMapper(DEFAULT_CONFIGS.MEDIUM_SCALE.training);
        const trainingData = NeuralUtils.generateSyntheticTrainingData(100);
        const validationData = NeuralUtils.generateSyntheticTrainingData(20);
        const trainingResult = await mapper.train(trainingData, validationData);
        const prediction = await mapper.predict({
            features: Array.from({
                length: 64
            }, ()=>Math.random())
        });
        return {
            finalAccuracy: trainingResult.finalAccuracy,
            trainingEpochs: trainingResult.trainingHistory.length,
            predictionConfidence: prediction.confidence,
            alternativeCount: prediction.alternatives.length
        };
    },
    integrationExample: async ()=>{
        const integration = await createDomainMapperIntegration(DEFAULT_CONFIGS.MEDIUM_SCALE.integration);
        integration.on('domain-analysis-completed', (result)=>{
            console.log(`Analysis completed: ${result.cohesion.overallScore} cohesion score`);
        });
        integration.on('optimization-suggestions-generated', (result)=>{
            console.log(`${result.prioritizedActions.length} optimization suggestions generated`);
        });
        const stats = integration.getIntegrationStats();
        return {
            initialized: true,
            stats
        };
    }
};
export default {
    NeuralDomainMapper,
    NeuralDomainMapperIntegration,
    createDomainMapperIntegration,
    DEFAULT_CONFIGS,
    NeuralUtils,
    Examples,
    NEURAL_MODULE_VERSION
};

//# sourceMappingURL=index.js.map