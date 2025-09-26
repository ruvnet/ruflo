export class RealtimeUpdateSystem {
    constructor(ui){
        this.ui = ui;
        this.subscribers = new Map();
        this.updateQueues = new Map();
        this.updateTimers = new Map();
        this.batchDelay = 100;
        this.eventHistory = [];
        this.maxHistorySize = 100;
        this.updateMetrics = {
            totalUpdates: 0,
            updateLatency: [],
            batchedUpdates: 0,
            droppedUpdates: 0
        };
        this.initializeSystem();
    }
    initializeSystem() {
        this.setupSystemEvents();
        this.initializeUpdateQueues();
        this.startPerformanceMonitoring();
        this.ui.addLog('success', 'Real-time update system initialized');
    }
    setupSystemEvents() {
        this.subscribe('tool_start', (data)=>{
            this.broadcastUpdate('tools', {
                type: 'execution_start',
                toolName: data.toolName,
                executionId: data.executionId,
                timestamp: Date.now()
            });
        });
        this.subscribe('tool_complete', (data)=>{
            this.broadcastUpdate('tools', {
                type: 'execution_complete',
                toolName: data.toolName,
                executionId: data.executionId,
                result: data.result,
                timestamp: Date.now()
            });
            this.updateRelatedViews(data.toolName, data.result);
        });
        this.subscribe('tool_error', (data)=>{
            this.broadcastUpdate('tools', {
                type: 'execution_error',
                toolName: data.toolName,
                executionId: data.executionId,
                error: data.error,
                timestamp: Date.now()
            });
        });
        this.subscribe('swarm_status_change', (data)=>{
            this.broadcastUpdate('orchestration', {
                type: 'swarm_update',
                swarmId: data.swarmId,
                status: data.status,
                timestamp: Date.now()
            });
        });
        this.subscribe('memory_change', (data)=>{
            this.broadcastUpdate('memory', {
                type: 'memory_update',
                namespace: data.namespace,
                operation: data.operation,
                timestamp: Date.now()
            });
        });
    }
    initializeUpdateQueues() {
        const views = [
            'neural',
            'analysis',
            'workflow',
            'github',
            'daa',
            'system',
            'tools',
            'orchestration',
            'memory'
        ];
        views.forEach((view)=>{
            this.updateQueues.set(view, []);
        });
    }
    subscribe(eventType, callback) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, new Set());
        }
        this.subscribers.get(eventType).add(callback);
        return ()=>{
            const subs = this.subscribers.get(eventType);
            if (subs) {
                subs.delete(callback);
            }
        };
    }
    emit(eventType, data) {
        const timestamp = Date.now();
        this.eventHistory.push({
            type: eventType,
            data,
            timestamp
        });
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
        const subscribers = this.subscribers.get(eventType);
        if (subscribers) {
            subscribers.forEach((callback)=>{
                try {
                    callback(data, timestamp);
                } catch (error) {
                    console.error(`Error in event subscriber for ${eventType}:`, error);
                }
            });
        }
    }
    broadcastUpdate(viewName, updateData) {
        const queue = this.updateQueues.get(viewName);
        if (!queue) return;
        queue.push({
            ...updateData,
            id: `update_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
        });
        this.scheduleBatchedUpdate(viewName);
        this.updateMetrics.totalUpdates++;
    }
    scheduleBatchedUpdate(viewName) {
        const existingTimer = this.updateTimers.get(viewName);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        const timer = setTimeout(()=>{
            this.processBatchedUpdates(viewName);
        }, this.batchDelay);
        this.updateTimers.set(viewName, timer);
    }
    processBatchedUpdates(viewName) {
        const queue = this.updateQueues.get(viewName);
        if (!queue || queue.length === 0) return;
        const startTime = Date.now();
        const groupedUpdates = this.groupUpdatesByType(queue);
        this.applyUpdatesToView(viewName, groupedUpdates);
        queue.length = 0;
        const latency = Date.now() - startTime;
        this.updateMetrics.updateLatency.push(latency);
        this.updateMetrics.batchedUpdates++;
        if (this.updateMetrics.updateLatency.length > 100) {
            this.updateMetrics.updateLatency.shift();
        }
        this.updateTimers.delete(viewName);
    }
    groupUpdatesByType(updates) {
        const grouped = new Map();
        updates.forEach((update)=>{
            if (!grouped.has(update.type)) {
                grouped.set(update.type, []);
            }
            grouped.get(update.type).push(update);
        });
        return grouped;
    }
    applyUpdatesToView(viewName, groupedUpdates) {
        try {
            switch(viewName){
                case 'neural':
                    this.applyNeuralUpdates(groupedUpdates);
                    break;
                case 'analysis':
                    this.applyAnalysisUpdates(groupedUpdates);
                    break;
                case 'workflow':
                    this.applyWorkflowUpdates(groupedUpdates);
                    break;
                case 'tools':
                    this.applyToolsUpdates(groupedUpdates);
                    break;
                case 'orchestration':
                    this.applyOrchestrationUpdates(groupedUpdates);
                    break;
                case 'memory':
                    this.applyMemoryUpdates(groupedUpdates);
                    break;
                default:
                    this.applyGenericUpdates(viewName, groupedUpdates);
            }
            if (this.ui.currentView === viewName) {
                this.requestUIRefresh();
            }
        } catch (error) {
            console.error(`Error applying updates to ${viewName}:`, error);
            this.updateMetrics.droppedUpdates++;
        }
    }
    applyNeuralUpdates(groupedUpdates) {
        const neuralData = this.ui.enhancedViews?.viewData?.get('neural');
        if (!neuralData) return;
        const trainingUpdates = groupedUpdates.get('training_progress');
        if (trainingUpdates) {
            trainingUpdates.forEach((update)=>{
                const existingJob = neuralData.trainingJobs.find((job)=>job.id === update.jobId);
                if (existingJob) {
                    Object.assign(existingJob, update.data);
                } else {
                    neuralData.trainingJobs.push({
                        id: update.jobId,
                        ...update.data,
                        startTime: update.timestamp
                    });
                }
            });
        }
        const modelUpdates = groupedUpdates.get('model_update');
        if (modelUpdates) {
            modelUpdates.forEach((update)=>{
                const existingModel = neuralData.models.find((model)=>model.id === update.modelId);
                if (existingModel) {
                    Object.assign(existingModel, update.data);
                } else {
                    neuralData.models.push({
                        id: update.modelId,
                        ...update.data,
                        createdAt: update.timestamp
                    });
                }
            });
        }
    }
    applyAnalysisUpdates(groupedUpdates) {
        const analysisData = this.ui.enhancedViews?.viewData?.get('analysis');
        if (!analysisData) return;
        const reportUpdates = groupedUpdates.get('performance_report');
        if (reportUpdates) {
            reportUpdates.forEach((update)=>{
                analysisData.reports.unshift({
                    id: update.reportId || `report_${update.timestamp}`,
                    ...update.data,
                    timestamp: update.timestamp
                });
                if (analysisData.reports.length > 50) {
                    analysisData.reports = analysisData.reports.slice(0, 50);
                }
            });
        }
        const metricsUpdates = groupedUpdates.get('metrics_update');
        if (metricsUpdates) {
            metricsUpdates.forEach((update)=>{
                analysisData.metrics.push({
                    ...update.data,
                    timestamp: update.timestamp
                });
                if (analysisData.metrics.length > 100) {
                    analysisData.metrics.shift();
                }
            });
        }
    }
    applyToolsUpdates(groupedUpdates) {
        const executionUpdates = groupedUpdates.get('execution_start');
        if (executionUpdates) {
            executionUpdates.forEach((update)=>{
                this.ui.addLog('info', `🔧 Started: ${update.toolName}`);
            });
        }
        const completionUpdates = groupedUpdates.get('execution_complete');
        if (completionUpdates) {
            completionUpdates.forEach((update)=>{
                this.ui.addLog('success', `✅ Completed: ${update.toolName}`);
                if (update.result && update.result.summary) {
                    this.ui.addLog('info', `📋 ${update.result.summary}`);
                }
            });
        }
        const errorUpdates = groupedUpdates.get('execution_error');
        if (errorUpdates) {
            errorUpdates.forEach((update)=>{
                this.ui.addLog('error', `❌ Failed: ${update.toolName} - ${update.error}`);
            });
        }
    }
    applyOrchestrationUpdates(groupedUpdates) {
        const swarmUpdates = groupedUpdates.get('swarm_update');
        if (swarmUpdates) {
            swarmUpdates.forEach((update)=>{
                if (this.ui.swarmIntegration) {
                    this.ui.swarmIntegration.updateSwarmStatus();
                }
                this.ui.addLog('info', `🐝 Swarm ${update.swarmId}: ${update.status}`);
            });
        }
    }
    applyMemoryUpdates(groupedUpdates) {
        const memoryUpdates = groupedUpdates.get('memory_update');
        if (memoryUpdates) {
            memoryUpdates.forEach((update)=>{
                if (this.ui.memoryStats) {
                    const namespace = this.ui.memoryStats.namespaces.find((ns)=>ns.name === update.namespace);
                    if (namespace) {
                        if (update.operation === 'store') {
                            namespace.entries++;
                        } else if (update.operation === 'delete') {
                            namespace.entries = Math.max(0, namespace.entries - 1);
                        }
                    }
                }
                this.ui.addLog('info', `💾 Memory ${update.operation} in ${update.namespace}`);
            });
        }
    }
    applyGenericUpdates(viewName, groupedUpdates) {
        groupedUpdates.forEach((updates, type)=>{
            updates.forEach((update)=>{
                this.ui.addLog('info', `📡 ${viewName}: ${type} update`);
            });
        });
    }
    updateRelatedViews(toolName, result) {
        const toolViewMap = {
            neural_train: [
                'neural'
            ],
            neural_predict: [
                'neural'
            ],
            neural_status: [
                'neural'
            ],
            model_save: [
                'neural'
            ],
            model_load: [
                'neural'
            ],
            performance_report: [
                'analysis'
            ],
            bottleneck_analyze: [
                'analysis'
            ],
            token_usage: [
                'analysis'
            ],
            benchmark_run: [
                'analysis'
            ],
            swarm_init: [
                'orchestration'
            ],
            agent_spawn: [
                'orchestration'
            ],
            task_orchestrate: [
                'orchestration'
            ],
            memory_usage: [
                'memory'
            ],
            memory_search: [
                'memory'
            ],
            memory_backup: [
                'memory'
            ]
        };
        const affectedViews = toolViewMap[toolName] || [];
        affectedViews.forEach((viewName)=>{
            this.broadcastUpdate(viewName, {
                type: 'tool_result',
                toolName,
                result,
                timestamp: Date.now()
            });
        });
    }
    requestUIRefresh() {
        if (this.refreshThrottle) return;
        this.refreshThrottle = setTimeout(()=>{
            if (this.ui && typeof this.ui.render === 'function') {
                this.ui.render();
            }
            this.refreshThrottle = null;
        }, 50);
    }
    startPerformanceMonitoring() {
        setInterval(()=>{
            this.reportPerformanceMetrics();
        }, 60000);
    }
    reportPerformanceMetrics() {
        const avgLatency = this.updateMetrics.updateLatency.length > 0 ? this.updateMetrics.updateLatency.reduce((a, b)=>a + b, 0) / this.updateMetrics.updateLatency.length : 0;
        const queueSizes = Array.from(this.updateQueues.values()).map((q)=>q.length);
        const totalQueueSize = queueSizes.reduce((a, b)=>a + b, 0);
        this.emit('performance_metrics', {
            totalUpdates: this.updateMetrics.totalUpdates,
            averageLatency: avgLatency,
            batchedUpdates: this.updateMetrics.batchedUpdates,
            droppedUpdates: this.updateMetrics.droppedUpdates,
            totalQueueSize,
            eventHistorySize: this.eventHistory.length
        });
    }
    getStatus() {
        const queueSizes = {};
        this.updateQueues.forEach((queue, viewName)=>{
            queueSizes[viewName] = queue.length;
        });
        return {
            subscribers: this.subscribers.size,
            queueSizes,
            metrics: this.updateMetrics,
            eventHistorySize: this.eventHistory.length,
            activeTimers: this.updateTimers.size
        };
    }
    createProgressiveLoader(viewName, dataLoader, options = {}) {
        const { chunkSize = 10, delay = 100, onProgress = null, onComplete = null } = options;
        return async ()=>{
            try {
                const data = await dataLoader();
                if (!Array.isArray(data)) {
                    this.broadcastUpdate(viewName, {
                        type: 'data_loaded',
                        data,
                        timestamp: Date.now()
                    });
                    if (onComplete) onComplete(data);
                    return;
                }
                for(let i = 0; i < data.length; i += chunkSize){
                    const chunk = data.slice(i, i + chunkSize);
                    this.broadcastUpdate(viewName, {
                        type: 'data_chunk',
                        chunk,
                        progress: {
                            loaded: Math.min(i + chunkSize, data.length),
                            total: data.length,
                            percentage: Math.min((i + chunkSize) / data.length * 100, 100)
                        },
                        timestamp: Date.now()
                    });
                    if (onProgress) {
                        onProgress({
                            loaded: Math.min(i + chunkSize, data.length),
                            total: data.length,
                            percentage: Math.min((i + chunkSize) / data.length * 100, 100)
                        });
                    }
                    if (i + chunkSize < data.length) {
                        await new Promise((resolve)=>setTimeout(resolve, delay));
                    }
                }
                if (onComplete) onComplete(data);
            } catch (error) {
                this.broadcastUpdate(viewName, {
                    type: 'data_error',
                    error: error.message,
                    timestamp: Date.now()
                });
            }
        };
    }
    cleanup() {
        this.updateTimers.forEach((timer)=>clearTimeout(timer));
        this.updateTimers.clear();
        if (this.refreshThrottle) {
            clearTimeout(this.refreshThrottle);
        }
        this.subscribers.clear();
        this.updateQueues.clear();
        this.ui.addLog('info', 'Real-time update system cleaned up');
    }
}
export default RealtimeUpdateSystem;

//# sourceMappingURL=realtime-update-system.js.map