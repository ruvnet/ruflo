import { EventEmitter } from 'events';
import { Logger } from '../../core/logger.js';
const logger = new Logger({
    level: 'info',
    format: 'text',
    destination: 'console'
}, {
    prefix: 'AgenticHookManager'
});
export class AgenticHookManager extends EventEmitter {
    hooks = new Map();
    pipelines = new Map();
    metrics = new Map();
    activeExecutions = new Set();
    constructor(){
        super();
        this.initializeMetrics();
    }
    register(registration) {
        const { type, id } = registration;
        this.validateRegistration(registration);
        if (!this.hooks.has(type)) {
            this.hooks.set(type, []);
        }
        const hookList = this.hooks.get(type);
        if (hookList.some((h)=>h.id === id)) {
            throw new Error(`Hook with ID '${id}' already registered for type '${type}'`);
        }
        const insertIndex = hookList.findIndex((h)=>h.priority < registration.priority);
        if (insertIndex === -1) {
            hookList.push(registration);
        } else {
            hookList.splice(insertIndex, 0, registration);
        }
        logger.info(`Registered hook '${id}' for type '${type}' with priority ${registration.priority}`);
        this.emit('hook:registered', {
            type,
            registration
        });
        this.updateMetric('hooks.registered', 1);
    }
    unregister(id) {
        let found = false;
        for (const [type, hookList] of this.hooks.entries()){
            const index = hookList.findIndex((h)=>h.id === id);
            if (index !== -1) {
                hookList.splice(index, 1);
                found = true;
                logger.info(`Unregistered hook '${id}' from type '${type}'`);
                this.emit('hook:unregistered', {
                    type,
                    id
                });
                if (hookList.length === 0) {
                    this.hooks.delete(type);
                }
                break;
            }
        }
        if (!found) {
            throw new Error(`Hook with ID '${id}' not found`);
        }
        this.updateMetric('hooks.unregistered', 1);
    }
    getHooks(type, filter) {
        const hookList = this.hooks.get(type) || [];
        if (!filter) {
            return [
                ...hookList
            ];
        }
        return hookList.filter((hook)=>this.matchesFilter(hook, filter));
    }
    async executeHooks(type, payload, context) {
        const executionId = this.generateExecutionId();
        this.activeExecutions.add(executionId);
        const startTime = Date.now();
        const results = [];
        try {
            const hooks = this.getHooks(type, this.createFilterFromPayload(payload));
            logger.debug(`Executing ${hooks.length} hooks for type '${type}'`);
            this.emit('hooks:executing', {
                type,
                count: hooks.length,
                executionId
            });
            let modifiedPayload = payload;
            for (const hook of hooks){
                try {
                    const result = await this.executeHook(hook, modifiedPayload, context);
                    results.push(result);
                    if (result.sideEffects) {
                        await this.processSideEffects(result.sideEffects, context);
                    }
                    if (result.modified && result.payload) {
                        modifiedPayload = result.payload;
                    }
                    if (!result.continue) {
                        logger.debug(`Hook '${hook.id}' halted execution chain`);
                        break;
                    }
                } catch (error) {
                    await this.handleHookError(hook, error, context);
                    if (hook.options?.errorHandler) {
                        hook.options.errorHandler(error);
                    } else {
                        throw error;
                    }
                }
            }
            const duration = Date.now() - startTime;
            this.updateMetric('hooks.executions', 1);
            this.updateMetric('hooks.totalDuration', duration);
            this.updateMetric(`hooks.${type}.executions`, 1);
            this.updateMetric(`hooks.${type}.duration`, duration);
            this.emit('hooks:executed', {
                type,
                results,
                duration,
                executionId
            });
            return results;
        } finally{
            this.activeExecutions.delete(executionId);
        }
    }
    createPipeline(config) {
        const pipeline = {
            id: config.id || this.generatePipelineId(),
            name: config.name || 'Unnamed Pipeline',
            stages: config.stages || [],
            errorStrategy: config.errorStrategy || 'fail-fast',
            metrics: {
                executions: 0,
                avgDuration: 0,
                errorRate: 0,
                throughput: 0
            }
        };
        this.pipelines.set(pipeline.id, pipeline);
        logger.info(`Created pipeline '${pipeline.name}' with ID '${pipeline.id}'`);
        return pipeline;
    }
    async executePipeline(pipelineId, initialPayload, context) {
        const pipeline = this.pipelines.get(pipelineId);
        if (!pipeline) {
            throw new Error(`Pipeline '${pipelineId}' not found`);
        }
        const startTime = Date.now();
        const results = [];
        let currentPayload = initialPayload;
        try {
            for (const stage of pipeline.stages){
                if (stage.condition && !stage.condition(context)) {
                    logger.debug(`Skipping stage '${stage.name}' due to condition`);
                    continue;
                }
                const stageResults = await this.executeStage(stage, currentPayload, context);
                if (stage.transform) {
                    for(let i = 0; i < stageResults.length; i++){
                        stageResults[i] = stage.transform(stageResults[i]);
                    }
                }
                results.push(...stageResults);
                const lastModified = stageResults.reverse().find((r)=>r.modified && r.payload);
                if (lastModified) {
                    currentPayload = lastModified.payload;
                }
            }
            this.updatePipelineMetrics(pipeline, Date.now() - startTime, false);
            return results;
        } catch (error) {
            this.updatePipelineMetrics(pipeline, Date.now() - startTime, true);
            if (pipeline.errorStrategy === 'rollback') {
                await this.rollbackPipeline(pipeline, results, context);
            }
            throw error;
        }
    }
    getMetrics() {
        const metrics = {};
        for (const [key, value] of this.metrics.entries()){
            metrics[key] = value;
        }
        metrics['hooks.count'] = this.getTotalHookCount();
        metrics['hooks.types'] = Array.from(this.hooks.keys());
        metrics['pipelines.count'] = this.pipelines.size;
        metrics['executions.active'] = this.activeExecutions.size;
        return metrics;
    }
    validateRegistration(registration) {
        if (!registration.id) {
            throw new Error('Hook registration must have an ID');
        }
        if (!registration.type) {
            throw new Error('Hook registration must have a type');
        }
        if (typeof registration.handler !== 'function') {
            throw new Error('Hook registration must have a handler function');
        }
        if (registration.priority < 0) {
            throw new Error('Hook priority must be non-negative');
        }
    }
    matchesFilter(hook, filter) {
        if (!hook.filter) {
            return true;
        }
        if (filter.providers && hook.filter.providers) {
            const hasProvider = filter.providers.some((p)=>hook.filter.providers.includes(p));
            if (!hasProvider) return false;
        }
        if (filter.models && hook.filter.models) {
            const hasModel = filter.models.some((m)=>hook.filter.models.includes(m));
            if (!hasModel) return false;
        }
        if (filter.patterns && hook.filter.patterns) {
            return true;
        }
        if (filter.conditions && hook.filter.conditions) {
            return true;
        }
        return true;
    }
    createFilterFromPayload(payload) {
        const filter = {};
        if ('provider' in payload) {
            filter.providers = [
                payload.provider
            ];
        }
        if ('model' in payload) {
            filter.models = [
                payload.model
            ];
        }
        if ('operation' in payload) {
            filter.operations = [
                payload.operation
            ];
        }
        if ('namespace' in payload) {
            filter.namespaces = [
                payload.namespace
            ];
        }
        return Object.keys(filter).length > 0 ? filter : undefined;
    }
    async executeHook(hook, payload, context) {
        const startTime = Date.now();
        try {
            if (hook.options?.cache?.enabled) {
                const cacheKey = hook.options.cache.key(payload);
                const cached = this.getCachedResult(hook.id, cacheKey);
                if (cached) {
                    this.updateMetric('hooks.cacheHits', 1);
                    return cached;
                }
            }
            let resultPromise = hook.handler(payload, context);
            if (hook.options?.timeout) {
                resultPromise = this.withTimeout(resultPromise, hook.options.timeout, `Hook '${hook.id}' timed out`);
            }
            const result = await resultPromise;
            if (hook.options?.cache?.enabled && result) {
                const cacheKey = hook.options.cache.key(payload);
                this.cacheResult(hook.id, cacheKey, result, hook.options.cache.ttl);
            }
            const duration = Date.now() - startTime;
            this.updateMetric(`hooks.${hook.id}.executions`, 1);
            this.updateMetric(`hooks.${hook.id}.duration`, duration);
            return result;
        } catch (error) {
            if (hook.options?.retries && hook.options.retries > 0) {
                logger.warn(`Hook '${hook.id}' failed, retrying...`);
                return this.retryHook(hook, payload, context, hook.options.retries);
            }
            if (hook.options?.fallback) {
                logger.warn(`Hook '${hook.id}' failed, using fallback`);
                return hook.options.fallback(payload, context);
            }
            throw error;
        }
    }
    async retryHook(hook, payload, context, retriesLeft) {
        for(let i = 0; i < retriesLeft; i++){
            try {
                await this.delay(Math.pow(2, i) * 1000);
                return await hook.handler(payload, context);
            } catch (error) {
                if (i === retriesLeft - 1) {
                    throw error;
                }
            }
        }
        throw new Error('Retry logic error');
    }
    async processSideEffects(sideEffects, context) {
        for (const effect of sideEffects){
            try {
                await this.processSideEffect(effect, context);
            } catch (error) {
                logger.error(`Failed to process side effect: ${effect.type}`, error);
            }
        }
    }
    async processSideEffect(effect, context) {
        switch(effect.type){
            case 'memory':
                await this.processMemorySideEffect(effect, context);
                break;
            case 'neural':
                await this.processNeuralSideEffect(effect, context);
                break;
            case 'metric':
                this.processMetricSideEffect(effect);
                break;
            case 'notification':
                this.processNotificationSideEffect(effect);
                break;
            case 'log':
                this.processLogSideEffect(effect);
                break;
        }
    }
    async processMemorySideEffect(effect, context) {
        logger.debug(`Processing memory side effect: ${effect.action}`, effect.data);
    }
    async processNeuralSideEffect(effect, context) {
        logger.debug(`Processing neural side effect: ${effect.action}`, effect.data);
    }
    processMetricSideEffect(effect) {
        if (effect.action === 'update') {
            this.updateMetric(effect.data.name, effect.data.value);
        } else if (effect.action === 'increment') {
            this.updateMetric(effect.data.name, 1);
        }
    }
    processNotificationSideEffect(effect) {
        this.emit('notification', effect.data);
    }
    processLogSideEffect(effect) {
        const { level = 'info', message, data } = effect.data;
        logger[level](message, data);
    }
    async handleHookError(hook, error, context) {
        logger.error(`Hook '${hook.id}' error:`, error);
        this.updateMetric('hooks.errors', 1);
        this.updateMetric(`hooks.${hook.id}.errors`, 1);
        this.emit('hook:error', {
            hookId: hook.id,
            type: hook.type,
            error,
            context
        });
    }
    async executeStage(stage, payload, context) {
        if (stage.parallel) {
            const promises = stage.hooks.map((hook)=>this.executeHook(hook, payload, context));
            return Promise.all(promises);
        } else {
            const results = [];
            let currentPayload = payload;
            for (const hook of stage.hooks){
                const result = await this.executeHook(hook, currentPayload, context);
                results.push(result);
                if (result.modified && result.payload) {
                    currentPayload = result.payload;
                }
                if (!result.continue) {
                    break;
                }
            }
            return results;
        }
    }
    updatePipelineMetrics(pipeline, duration, hasError) {
        const metrics = pipeline.metrics;
        metrics.executions++;
        metrics.avgDuration = (metrics.avgDuration * (metrics.executions - 1) + duration) / metrics.executions;
        if (hasError) {
            metrics.errorRate = (metrics.errorRate * (metrics.executions - 1) + 1) / metrics.executions;
        } else {
            metrics.errorRate = metrics.errorRate * (metrics.executions - 1) / metrics.executions;
        }
        const timeWindow = 60000;
        metrics.throughput = metrics.executions / duration * timeWindow;
    }
    async rollbackPipeline(pipeline, results, context) {
        logger.warn(`Rolling back pipeline '${pipeline.name}'`);
    }
    getTotalHookCount() {
        let count = 0;
        for (const hookList of this.hooks.values()){
            count += hookList.length;
        }
        return count;
    }
    initializeMetrics() {
        this.metrics.set('hooks.registered', 0);
        this.metrics.set('hooks.unregistered', 0);
        this.metrics.set('hooks.executions', 0);
        this.metrics.set('hooks.errors', 0);
        this.metrics.set('hooks.cacheHits', 0);
        this.metrics.set('hooks.totalDuration', 0);
    }
    updateMetric(key, value) {
        const current = this.metrics.get(key) || 0;
        this.metrics.set(key, current + value);
    }
    generateExecutionId() {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    generatePipelineId() {
        return `pipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    getCachedResult(hookId, cacheKey) {
        return null;
    }
    cacheResult(hookId, cacheKey, result, ttl) {}
    async withTimeout(promise, timeout, message) {
        return Promise.race([
            promise,
            new Promise((_, reject)=>setTimeout(()=>reject(new Error(message)), timeout))
        ]);
    }
    delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
}
export const agenticHookManager = new AgenticHookManager();

//# sourceMappingURL=hook-manager.js.map