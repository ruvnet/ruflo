import { EventEmitter } from 'node:events';
import { Logger } from '../../core/logger.js';
import { ClaudeConnectionPool } from './connection-pool.js';
import { AsyncFileManager } from './async-file-manager.js';
import { TTLMap } from './ttl-map.js';
import { CircularBuffer } from './circular-buffer.js';
import PQueue from 'p-queue';
export class OptimizedExecutor extends EventEmitter {
    config;
    logger;
    connectionPool;
    fileManager;
    executionQueue;
    resultCache;
    executionHistory;
    metrics = {
        totalExecuted: 0,
        totalSucceeded: 0,
        totalFailed: 0,
        totalExecutionTime: 0,
        cacheHits: 0,
        cacheMisses: 0
    };
    activeExecutions = new Set();
    constructor(config = {}){
        super(), this.config = config;
        const loggerConfig = process.env.CLAUDE_FLOW_ENV === 'test' ? {
            level: 'error',
            format: 'json',
            destination: 'console'
        } : {
            level: 'info',
            format: 'json',
            destination: 'console'
        };
        this.logger = new Logger(loggerConfig, {
            component: 'OptimizedExecutor'
        });
        this.connectionPool = new ClaudeConnectionPool({
            min: config.connectionPool?.min || 2,
            max: config.connectionPool?.max || 10
        });
        this.fileManager = new AsyncFileManager({
            write: config.fileOperations?.concurrency || 10,
            read: config.fileOperations?.concurrency || 20
        });
        this.executionQueue = new PQueue({
            concurrency: config.concurrency || 10
        });
        this.resultCache = new TTLMap({
            defaultTTL: config.caching?.ttl || 3600000,
            maxSize: config.caching?.maxSize || 1000,
            onExpire: (key, value)=>{
                this.logger.debug('Cache entry expired', {
                    taskId: key
                });
            }
        });
        this.executionHistory = new CircularBuffer(1000);
        if (config.monitoring?.metricsInterval) {
            setInterval(()=>{
                this.emitMetrics();
            }, config.monitoring.metricsInterval);
        }
    }
    async executeTask(task, agentId) {
        const startTime = Date.now();
        const taskKey = this.getTaskCacheKey(task);
        if (this.config.caching?.enabled) {
            const cached = this.resultCache.get(taskKey);
            if (cached) {
                this.metrics.cacheHits++;
                this.logger.debug('Cache hit for task', {
                    taskId: task.id
                });
                return cached;
            }
            this.metrics.cacheMisses++;
        }
        this.activeExecutions.add(task.id);
        const result = await this.executionQueue.add(async ()=>{
            try {
                const executionResult = await this.connectionPool.execute(async (api)=>{
                    const response = await api.complete({
                        messages: this.buildMessages(task),
                        model: task.metadata?.model || 'claude-3-5-sonnet-20241022',
                        max_tokens: task.constraints.maxTokens || 4096,
                        temperature: task.metadata?.temperature || 0.7
                    });
                    return {
                        success: true,
                        output: response.content[0]?.text || '',
                        usage: {
                            inputTokens: response.usage?.input_tokens || 0,
                            outputTokens: response.usage?.output_tokens || 0
                        }
                    };
                });
                if (this.config.fileOperations?.outputDir) {
                    const outputPath = `${this.config.fileOperations.outputDir}/${task.id}.json`;
                    await this.fileManager.writeJSON(outputPath, {
                        taskId: task.id,
                        agentId: agentId.id,
                        result: executionResult,
                        timestamp: new Date()
                    });
                }
                const taskResult = {
                    taskId: task.id,
                    agentId: agentId.id,
                    success: executionResult.success,
                    output: executionResult.output,
                    error: undefined,
                    executionTime: Date.now() - startTime,
                    tokensUsed: executionResult.usage,
                    timestamp: new Date()
                };
                if (this.config.caching?.enabled && executionResult.success) {
                    this.resultCache.set(taskKey, taskResult);
                }
                this.metrics.totalExecuted++;
                this.metrics.totalSucceeded++;
                this.metrics.totalExecutionTime += taskResult.executionTime;
                this.executionHistory.push({
                    taskId: task.id,
                    duration: taskResult.executionTime,
                    status: 'success',
                    timestamp: new Date()
                });
                if (this.config.monitoring?.slowTaskThreshold && taskResult.executionTime > this.config.monitoring.slowTaskThreshold) {
                    this.logger.warn('Slow task detected', {
                        taskId: task.id,
                        duration: taskResult.executionTime,
                        threshold: this.config.monitoring.slowTaskThreshold
                    });
                }
                this.emit('task:completed', taskResult);
                return taskResult;
            } catch (error) {
                this.metrics.totalExecuted++;
                this.metrics.totalFailed++;
                const errorResult = {
                    taskId: task.id,
                    agentId: agentId.id,
                    success: false,
                    output: '',
                    error: {
                        type: error instanceof Error ? error.constructor.name : 'UnknownError',
                        message: error instanceof Error ? error.message : 'Unknown error',
                        code: error.code,
                        stack: error instanceof Error ? error.stack : undefined,
                        context: {
                            taskId: task.id,
                            agentId: agentId.id
                        },
                        recoverable: this.isRecoverableError(error),
                        retryable: this.isRetryableError(error)
                    },
                    executionTime: Date.now() - startTime,
                    timestamp: new Date()
                };
                this.executionHistory.push({
                    taskId: task.id,
                    duration: errorResult.executionTime,
                    status: 'failed',
                    timestamp: new Date()
                });
                this.emit('task:failed', errorResult);
                throw error;
            } finally{
                this.activeExecutions.delete(task.id);
            }
        });
        return result;
    }
    async executeBatch(tasks, agentId) {
        return Promise.all(tasks.map((task)=>this.executeTask(task, agentId)));
    }
    buildMessages(task) {
        const messages = [];
        if (task.metadata?.systemPrompt) {
            messages.push({
                role: 'system',
                content: task.metadata.systemPrompt
            });
        }
        messages.push({
            role: 'user',
            content: task.objective
        });
        if (task.context) {
            if (task.context.previousResults?.length) {
                messages.push({
                    role: 'assistant',
                    content: 'Previous results:\n' + task.context.previousResults.map((r)=>r.output).join('\n\n')
                });
            }
            if (task.context.relatedTasks?.length) {
                messages.push({
                    role: 'user',
                    content: 'Related context:\n' + task.context.relatedTasks.map((t)=>t.objective).join('\n')
                });
            }
        }
        return messages;
    }
    getTaskCacheKey(task) {
        return `${task.type}-${task.objective}-${JSON.stringify(task.metadata || {})}`;
    }
    isRecoverableError(error) {
        if (!error) return false;
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            return true;
        }
        if (error.status === 429) {
            return true;
        }
        return false;
    }
    isRetryableError(error) {
        if (!error) return false;
        if (this.isRecoverableError(error)) {
            return true;
        }
        if (error.status >= 500 && error.status < 600) {
            return true;
        }
        return false;
    }
    getMetrics() {
        const history = this.executionHistory.getAll();
        const avgExecutionTime = this.metrics.totalExecuted > 0 ? this.metrics.totalExecutionTime / this.metrics.totalExecuted : 0;
        const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;
        const cacheHitRate = cacheTotal > 0 ? this.metrics.cacheHits / cacheTotal : 0;
        return {
            totalExecuted: this.metrics.totalExecuted,
            totalSucceeded: this.metrics.totalSucceeded,
            totalFailed: this.metrics.totalFailed,
            avgExecutionTime,
            cacheHitRate,
            queueLength: this.executionQueue.size,
            activeExecutions: this.activeExecutions.size
        };
    }
    emitMetrics() {
        const metrics = this.getMetrics();
        this.emit('metrics', metrics);
        this.logger.info('Executor metrics', metrics);
    }
    async waitForPendingExecutions() {
        await this.executionQueue.onIdle();
        await this.fileManager.waitForPendingOperations();
    }
    async shutdown() {
        this.logger.info('Shutting down optimized executor');
        this.executionQueue.clear();
        await this.waitForPendingExecutions();
        await this.connectionPool.drain();
        this.resultCache.destroy();
        this.logger.info('Optimized executor shut down');
    }
    getExecutionHistory() {
        return this.executionHistory.snapshot();
    }
    getConnectionPoolStats() {
        return this.connectionPool.getStats();
    }
    getFileManagerMetrics() {
        return this.fileManager.getMetrics();
    }
    getCacheStats() {
        return this.resultCache.getStats();
    }
}

//# sourceMappingURL=optimized-executor.js.map