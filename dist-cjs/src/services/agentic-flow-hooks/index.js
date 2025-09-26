import { agenticHookManager } from './hook-manager.js';
import { registerLLMHooks } from './llm-hooks.js';
import { registerMemoryHooks } from './memory-hooks.js';
import { registerNeuralHooks } from './neural-hooks.js';
import { registerPerformanceHooks } from './performance-hooks.js';
import { registerWorkflowHooks } from './workflow-hooks.js';
import { Logger } from '../../core/logger.js';
export * from './types.js';
export { agenticHookManager } from './hook-manager.js';
export * from './llm-hooks.js';
export * from './memory-hooks.js';
export * from './neural-hooks.js';
export * from './performance-hooks.js';
export * from './workflow-hooks.js';
const logger = new Logger({
    level: 'info',
    format: 'text',
    destination: 'console'
}, {
    prefix: 'AgenticFlowHooks'
});
export async function initializeAgenticFlowHooks() {
    logger.info('Initializing agentic-flow hook system...');
    try {
        registerLLMHooks();
        logger.debug('LLM hooks registered');
        registerMemoryHooks();
        logger.debug('Memory hooks registered');
        registerNeuralHooks();
        logger.debug('Neural hooks registered');
        registerPerformanceHooks();
        logger.debug('Performance hooks registered');
        registerWorkflowHooks();
        logger.debug('Workflow hooks registered');
        await setupDefaultPipelines();
        startMetricsCollection();
        logger.info('Agentic-flow hook system initialized successfully');
    } catch (error) {
        logger.error('Failed to initialize agentic-flow hooks:', error);
        throw error;
    }
}
async function setupDefaultPipelines() {
    agenticHookManager.createPipeline({
        id: 'llm-call-pipeline',
        name: 'LLM Call Pipeline',
        stages: [
            {
                name: 'pre-call',
                hooks: agenticHookManager.getHooks('pre-llm-call'),
                parallel: false
            },
            {
                name: 'call-execution',
                hooks: [],
                parallel: false
            },
            {
                name: 'post-call',
                hooks: agenticHookManager.getHooks('post-llm-call'),
                parallel: true
            }
        ],
        errorStrategy: 'continue'
    });
    agenticHookManager.createPipeline({
        id: 'memory-operation-pipeline',
        name: 'Memory Operation Pipeline',
        stages: [
            {
                name: 'validation',
                hooks: agenticHookManager.getHooks('pre-memory-store'),
                parallel: false
            },
            {
                name: 'storage',
                hooks: agenticHookManager.getHooks('post-memory-store'),
                parallel: true
            },
            {
                name: 'sync',
                hooks: agenticHookManager.getHooks('memory-sync'),
                parallel: true,
                condition: (ctx)=>ctx.metadata.crossProvider === true
            }
        ],
        errorStrategy: 'rollback'
    });
    agenticHookManager.createPipeline({
        id: 'workflow-execution-pipeline',
        name: 'Workflow Execution Pipeline',
        stages: [
            {
                name: 'initialization',
                hooks: agenticHookManager.getHooks('workflow-start'),
                parallel: false
            },
            {
                name: 'execution',
                hooks: [
                    ...agenticHookManager.getHooks('workflow-step'),
                    ...agenticHookManager.getHooks('workflow-decision')
                ],
                parallel: false
            },
            {
                name: 'completion',
                hooks: agenticHookManager.getHooks('workflow-complete'),
                parallel: true
            }
        ],
        errorStrategy: 'fail-fast'
    });
}
function startMetricsCollection() {
    setInterval(()=>{
        const metrics = agenticHookManager.getMetrics();
        logger.debug('Hook system metrics:', {
            totalHooks: metrics['hooks.count'],
            totalExecutions: metrics['hooks.executions'],
            errorRate: metrics['hooks.errors'] / metrics['hooks.executions'] || 0,
            cacheHitRate: metrics['hooks.cacheHits'] / metrics['hooks.executions'] || 0
        });
        agenticHookManager.emit('metrics:collected', metrics);
    }, 30000);
}
export async function shutdownAgenticFlowHooks() {
    logger.info('Shutting down agentic-flow hook system...');
    try {
        const maxWaitTime = 10000;
        const startTime = Date.now();
        while(agenticHookManager.getMetrics()['executions.active'] > 0){
            if (Date.now() - startTime > maxWaitTime) {
                logger.warn('Timeout waiting for active executions to complete');
                break;
            }
            await new Promise((resolve)=>setTimeout(resolve, 100));
        }
        agenticHookManager.removeAllListeners();
        logger.info('Agentic-flow hook system shut down successfully');
    } catch (error) {
        logger.error('Error during hook system shutdown:', error);
        throw error;
    }
}
export function getHookSystemStatus() {
    const metrics = agenticHookManager.getMetrics();
    return {
        initialized: metrics['hooks.count'] > 0,
        metrics,
        pipelines: [
            'llm-call-pipeline',
            'memory-operation-pipeline',
            'workflow-execution-pipeline'
        ],
        activeExecutions: metrics['executions.active'] || 0
    };
}
export function createHookContext() {
    let ContextBuilder = class ContextBuilder {
        context = {
            timestamp: Date.now(),
            correlationId: this.generateCorrelationId(),
            metadata: {}
        };
        withSession(sessionId) {
            this.context.sessionId = sessionId;
            return this;
        }
        withMemory(namespace, provider) {
            this.context.memory = {
                namespace,
                provider,
                cache: new Map()
            };
            return this;
        }
        withNeural(modelId) {
            this.context.neural = {
                modelId,
                patterns: this.createPatternStore(),
                training: {
                    epoch: 0,
                    loss: 0,
                    accuracy: 0,
                    learningRate: 0.001,
                    optimizer: 'adam',
                    checkpoints: []
                }
            };
            return this;
        }
        withPerformance(metrics) {
            const metricsMap = new Map();
            metrics.forEach((m)=>metricsMap.set(m.name, m));
            this.context.performance = {
                metrics: metricsMap,
                bottlenecks: [],
                optimizations: []
            };
            return this;
        }
        withMetadata(metadata) {
            this.context.metadata = {
                ...this.context.metadata,
                ...metadata
            };
            return this;
        }
        build() {
            if (!this.context.sessionId) {
                this.context.sessionId = this.generateSessionId();
            }
            if (!this.context.memory) {
                this.context.memory = {
                    namespace: 'default',
                    provider: 'memory',
                    cache: new Map()
                };
            }
            if (!this.context.neural) {
                this.context.neural = {
                    modelId: 'default',
                    patterns: this.createPatternStore(),
                    training: {
                        epoch: 0,
                        loss: 0,
                        accuracy: 0,
                        learningRate: 0.001,
                        optimizer: 'adam',
                        checkpoints: []
                    }
                };
            }
            if (!this.context.performance) {
                this.context.performance = {
                    metrics: new Map(),
                    bottlenecks: [],
                    optimizations: []
                };
            }
            return this.context;
        }
        generateCorrelationId() {
            return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        generateSessionId() {
            return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        createPatternStore() {
            const patterns = new Map();
            return {
                add (pattern) {
                    patterns.set(pattern.id, pattern);
                },
                get (id) {
                    return patterns.get(id);
                },
                findSimilar (pattern, threshold) {
                    const results = [];
                    for (const p of patterns.values()){
                        if (p.type === pattern.type && p.confidence >= threshold) {
                            results.push(p);
                        }
                    }
                    return results;
                },
                getByType (type) {
                    return Array.from(patterns.values()).filter((p)=>p.type === type);
                },
                prune (maxAge) {
                    const cutoff = Date.now() - maxAge;
                    for (const [id, pattern] of patterns){
                        if (pattern.context.timestamp < cutoff) {
                            patterns.delete(id);
                        }
                    }
                },
                export () {
                    return Array.from(patterns.values());
                },
                import (newPatterns) {
                    for (const pattern of newPatterns){
                        patterns.set(pattern.id, pattern);
                    }
                }
            };
        }
    };
    return new ContextBuilder();
}

//# sourceMappingURL=index.js.map