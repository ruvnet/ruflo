import { EventEmitter } from 'node:events';
import { ConnectionHealthMonitor } from './connection-health-monitor.js';
import { ReconnectionManager } from './reconnection-manager.js';
import { FallbackCoordinator } from './fallback-coordinator.js';
import { ConnectionStateManager } from './connection-state-manager.js';
export class RecoveryManager extends EventEmitter {
    client;
    mcpConfig;
    logger;
    healthMonitor;
    reconnectionManager;
    fallbackCoordinator;
    stateManager;
    isRecoveryActive = false;
    recoveryStartTime;
    metrics = {
        totalRecoveries: 0,
        successfulRecoveries: 0,
        failedRecoveries: 0,
        totalRecoveryTime: 0
    };
    constructor(client, mcpConfig, logger, config){
        super(), this.client = client, this.mcpConfig = mcpConfig, this.logger = logger;
        this.healthMonitor = new ConnectionHealthMonitor(client, logger, config?.healthMonitor);
        this.reconnectionManager = new ReconnectionManager(client, logger, config?.reconnection);
        this.fallbackCoordinator = new FallbackCoordinator(logger, config?.fallback);
        this.stateManager = new ConnectionStateManager(logger, config?.state);
        this.setupEventHandlers();
        this.logger.info('Recovery manager initialized');
    }
    async start() {
        this.logger.info('Starting recovery manager');
        await this.healthMonitor.start();
        const previousState = this.stateManager.restoreState();
        if (previousState && previousState.pendingRequests.length > 0) {
            this.logger.info('Restored previous connection state', {
                sessionId: previousState.sessionId,
                pendingRequests: previousState.pendingRequests.length
            });
            previousState.pendingRequests.forEach((request)=>{
                this.fallbackCoordinator.queueOperation({
                    type: 'tool',
                    method: request.method,
                    params: request.params,
                    priority: 'high',
                    retryable: true
                });
            });
        }
        this.emit('started');
    }
    async stop() {
        this.logger.info('Stopping recovery manager');
        await this.healthMonitor.stop();
        this.reconnectionManager.stopReconnection();
        this.fallbackCoordinator.disableCLIFallback();
        await this.stateManager.cleanup();
        this.emit('stopped');
    }
    getStatus() {
        const healthStatus = this.healthMonitor.getHealthStatus();
        const reconnectionState = this.reconnectionManager.getState();
        const fallbackState = this.fallbackCoordinator.getState();
        return {
            isRecoveryActive: this.isRecoveryActive,
            connectionHealth: healthStatus,
            reconnectionState: {
                attempts: reconnectionState.attempts,
                isReconnecting: reconnectionState.isReconnecting,
                nextDelay: reconnectionState.nextDelay
            },
            fallbackState: {
                isFallbackActive: fallbackState.isFallbackActive,
                queuedOperations: fallbackState.queuedOperations
            },
            metrics: {
                totalRecoveries: this.metrics.totalRecoveries,
                successfulRecoveries: this.metrics.successfulRecoveries,
                failedRecoveries: this.metrics.failedRecoveries,
                averageRecoveryTime: this.metrics.totalRecoveries > 0 ? this.metrics.totalRecoveryTime / this.metrics.totalRecoveries : 0
            }
        };
    }
    async forceRecovery() {
        this.logger.info('Forcing recovery attempt');
        if (this.isRecoveryActive) {
            this.logger.warn('Recovery already in progress');
            return false;
        }
        return this.startRecovery('manual');
    }
    async handleRequest(request) {
        if (!this.client.isConnected()) {
            this.stateManager.addPendingRequest(request);
            this.fallbackCoordinator.queueOperation({
                type: 'tool',
                method: request.method,
                params: request.params,
                priority: 'medium',
                retryable: true
            });
        }
    }
    setupEventHandlers() {
        this.healthMonitor.on('connectionLost', async ({ error })=>{
            this.logger.error('Connection lost, initiating recovery', error);
            await this.startRecovery('health-check');
        });
        this.healthMonitor.on('healthChange', (newStatus, oldStatus)=>{
            this.emit('healthChange', newStatus, oldStatus);
            this.stateManager.recordEvent({
                type: newStatus.healthy ? 'connect' : 'disconnect',
                sessionId: this.generateSessionId(),
                details: {
                    health: newStatus
                }
            });
        });
        this.reconnectionManager.on('success', async ({ attempts, duration })=>{
            this.logger.info('Reconnection successful', {
                attempts,
                duration
            });
            await this.completeRecovery(true);
        });
        this.reconnectionManager.on('maxRetriesExceeded', async ()=>{
            this.logger.error('Max reconnection attempts exceeded');
            await this.completeRecovery(false);
        });
        this.reconnectionManager.on('attemptFailed', ({ attempt, error })=>{
            this.emit('recoveryAttemptFailed', {
                attempt,
                error
            });
        });
        this.fallbackCoordinator.on('fallbackEnabled', (state)=>{
            this.logger.warn('Fallback mode activated', state);
            this.emit('fallbackActivated', state);
        });
        this.fallbackCoordinator.on('replayOperation', async (operation)=>{
            if (this.client.isConnected()) {
                try {
                    await this.client.request(operation.method, operation.params);
                    this.stateManager.removePendingRequest(operation.id);
                } catch (error) {
                    this.logger.error('Failed to replay operation', {
                        operation,
                        error
                    });
                }
            }
        });
    }
    async startRecovery(trigger) {
        if (this.isRecoveryActive) {
            return false;
        }
        this.isRecoveryActive = true;
        this.recoveryStartTime = new Date();
        this.metrics.totalRecoveries++;
        this.logger.info('Starting recovery process', {
            trigger
        });
        this.emit('recoveryStart', {
            trigger
        });
        this.stateManager.saveState({
            sessionId: this.generateSessionId(),
            lastConnected: new Date(),
            pendingRequests: [],
            configuration: this.mcpConfig,
            metadata: {
                trigger
            }
        });
        this.fallbackCoordinator.enableCLIFallback();
        this.reconnectionManager.startAutoReconnect();
        return true;
    }
    async completeRecovery(success) {
        if (!this.isRecoveryActive) {
            return;
        }
        const duration = this.recoveryStartTime ? Date.now() - this.recoveryStartTime.getTime() : 0;
        this.isRecoveryActive = false;
        this.recoveryStartTime = undefined;
        if (success) {
            this.metrics.successfulRecoveries++;
            this.metrics.totalRecoveryTime += duration;
            this.fallbackCoordinator.disableCLIFallback();
            await this.fallbackCoordinator.processQueue();
            this.healthMonitor.reset();
            this.stateManager.recordEvent({
                type: 'reconnect',
                sessionId: this.generateSessionId(),
                details: {
                    duration
                }
            });
            this.logger.info('Recovery completed successfully', {
                duration
            });
            this.emit('recoveryComplete', {
                success: true,
                duration
            });
        } else {
            this.metrics.failedRecoveries++;
            this.logger.error('Recovery failed');
            this.emit('recoveryComplete', {
                success: false,
                duration
            });
            this.emit('fallbackPermanent');
        }
    }
    generateSessionId() {
        return `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    async cleanup() {
        await this.stop();
    }
}

//# sourceMappingURL=recovery-manager.js.map