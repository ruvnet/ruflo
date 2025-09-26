import { EventEmitter } from 'node:events';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
export class FallbackCoordinator extends EventEmitter {
    logger;
    operationQueue = [];
    state;
    notificationTimer;
    processingQueue = false;
    defaultConfig = {
        enableFallback: true,
        maxQueueSize: 100,
        queueTimeout: 300000,
        cliPath: 'npx ruv-swarm',
        fallbackNotificationInterval: 30000
    };
    constructor(logger, config){
        super(), this.logger = logger;
        this.config = {
            ...this.defaultConfig,
            ...config
        };
        this.state = {
            isFallbackActive: false,
            queuedOperations: 0,
            failedOperations: 0,
            successfulOperations: 0
        };
    }
    config;
    async isMCPAvailable() {
        try {
            const { stdout } = await execAsync(`${this.config.cliPath} status --json`);
            const status = JSON.parse(stdout);
            return status.connected === true;
        } catch (error) {
            this.logger.debug('MCP availability check failed', error);
            return false;
        }
    }
    enableCLIFallback() {
        if (this.state.isFallbackActive) {
            this.logger.debug('Fallback already active');
            return;
        }
        this.logger.warn('Enabling CLI fallback mode');
        this.state.isFallbackActive = true;
        this.state.lastFallbackActivation = new Date();
        this.startNotificationTimer();
        this.emit('fallbackEnabled', this.state);
    }
    disableCLIFallback() {
        if (!this.state.isFallbackActive) {
            return;
        }
        this.logger.info('Disabling CLI fallback mode');
        this.state.isFallbackActive = false;
        this.stopNotificationTimer();
        this.emit('fallbackDisabled', this.state);
        if (this.operationQueue.length > 0) {
            this.processQueue().catch((error)=>{
                this.logger.error('Error processing queue after fallback disabled', error);
            });
        }
    }
    queueOperation(operation) {
        if (!this.config.enableFallback) {
            this.logger.debug('Fallback disabled, operation not queued');
            return;
        }
        if (this.operationQueue.length >= this.config.maxQueueSize) {
            this.logger.warn('Operation queue full, removing oldest operation');
            this.operationQueue.shift();
            this.state.failedOperations++;
        }
        const queuedOp = {
            ...operation,
            id: this.generateOperationId(),
            timestamp: new Date()
        };
        this.operationQueue.push(queuedOp);
        this.state.queuedOperations = this.operationQueue.length;
        this.logger.debug('Operation queued', {
            id: queuedOp.id,
            type: queuedOp.type,
            method: queuedOp.method,
            queueSize: this.operationQueue.length
        });
        this.emit('operationQueued', queuedOp);
        if (this.state.isFallbackActive && !this.processingQueue) {
            this.executeViaCliFallback(queuedOp).catch((error)=>{
                this.logger.error('CLI fallback execution failed', {
                    operation: queuedOp,
                    error
                });
            });
        }
    }
    async processQueue() {
        if (this.processingQueue || this.operationQueue.length === 0) {
            return;
        }
        this.processingQueue = true;
        this.logger.info('Processing operation queue', {
            queueSize: this.operationQueue.length
        });
        this.emit('queueProcessingStart', this.operationQueue.length);
        const results = {
            successful: 0,
            failed: 0
        };
        while(this.operationQueue.length > 0){
            const operation = this.operationQueue.shift();
            if (this.isOperationExpired(operation)) {
                this.logger.warn('Operation expired', {
                    id: operation.id
                });
                results.failed++;
                continue;
            }
            try {
                await this.replayOperation(operation);
                results.successful++;
                this.state.successfulOperations++;
            } catch (error) {
                this.logger.error('Failed to replay operation', {
                    operation,
                    error
                });
                results.failed++;
                this.state.failedOperations++;
                if (operation.retryable) {
                    this.operationQueue.push(operation);
                }
            }
        }
        this.state.queuedOperations = this.operationQueue.length;
        this.processingQueue = false;
        this.logger.info('Queue processing complete', results);
        this.emit('queueProcessingComplete', results);
    }
    getState() {
        return {
            ...this.state
        };
    }
    getQueuedOperations() {
        return [
            ...this.operationQueue
        ];
    }
    clearQueue() {
        const clearedCount = this.operationQueue.length;
        this.operationQueue = [];
        this.state.queuedOperations = 0;
        this.logger.info('Operation queue cleared', {
            clearedCount
        });
        this.emit('queueCleared', clearedCount);
    }
    async executeViaCliFallback(operation) {
        this.logger.debug('Executing operation via CLI fallback', {
            id: operation.id,
            method: operation.method
        });
        try {
            const cliCommand = this.mapOperationToCli(operation);
            if (!cliCommand) {
                throw new Error(`No CLI mapping for operation: ${operation.method}`);
            }
            const { stdout, stderr } = await execAsync(cliCommand);
            if (stderr) {
                this.logger.warn('CLI command stderr', {
                    stderr
                });
            }
            this.logger.debug('CLI fallback execution successful', {
                id: operation.id,
                stdout: stdout.substring(0, 200)
            });
            this.state.successfulOperations++;
            this.emit('fallbackExecutionSuccess', {
                operation,
                result: stdout
            });
        } catch (error) {
            this.logger.error('CLI fallback execution failed', {
                operation,
                error
            });
            this.state.failedOperations++;
            this.emit('fallbackExecutionFailed', {
                operation,
                error
            });
            if (operation.retryable) {
                this.queueOperation(operation);
            }
        }
    }
    async replayOperation(operation) {
        this.logger.info('Replaying operation', {
            id: operation.id,
            method: operation.method
        });
        this.emit('replayOperation', operation);
    }
    mapOperationToCli(operation) {
        const mappings = {
            'tools/list': ()=>`${this.config.cliPath} tools list`,
            'tools/call': (params)=>`${this.config.cliPath} tools call ${params.name} '${JSON.stringify(params.arguments)}'`,
            'resources/list': ()=>`${this.config.cliPath} resources list`,
            'resources/read': (params)=>`${this.config.cliPath} resources read ${params.uri}`,
            initialize: ()=>`${this.config.cliPath} session init`,
            shutdown: ()=>`${this.config.cliPath} session shutdown`,
            heartbeat: ()=>`${this.config.cliPath} health check`
        };
        const mapper = mappings[operation.method];
        return mapper ? mapper(operation.params) : null;
    }
    isOperationExpired(operation) {
        const age = Date.now() - operation.timestamp.getTime();
        return age > this.config.queueTimeout;
    }
    generateOperationId() {
        return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    startNotificationTimer() {
        if (this.notificationTimer) {
            return;
        }
        this.notificationTimer = setInterval(()=>{
            if (this.state.isFallbackActive && this.operationQueue.length > 0) {
                this.logger.info('Fallback mode active', {
                    queuedOperations: this.operationQueue.length,
                    duration: Date.now() - (this.state.lastFallbackActivation?.getTime() || 0)
                });
                this.emit('fallbackStatus', this.state);
            }
        }, this.config.fallbackNotificationInterval);
    }
    stopNotificationTimer() {
        if (this.notificationTimer) {
            clearInterval(this.notificationTimer);
            this.notificationTimer = undefined;
        }
    }
}

//# sourceMappingURL=fallback-coordinator.js.map