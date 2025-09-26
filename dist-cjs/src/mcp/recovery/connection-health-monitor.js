import { EventEmitter } from 'node:events';
export class ConnectionHealthMonitor extends EventEmitter {
    client;
    logger;
    heartbeatTimer;
    timeoutTimer;
    lastHeartbeat = new Date();
    missedHeartbeats = 0;
    currentLatency = 0;
    isMonitoring = false;
    healthStatus;
    defaultConfig = {
        heartbeatInterval: 5000,
        heartbeatTimeout: 10000,
        maxMissedHeartbeats: 3,
        enableAutoRecovery: true
    };
    constructor(client, logger, config){
        super(), this.client = client, this.logger = logger;
        this.config = {
            ...this.defaultConfig,
            ...config
        };
        this.healthStatus = {
            healthy: false,
            lastHeartbeat: new Date(),
            missedHeartbeats: 0,
            latency: 0,
            connectionState: 'disconnected'
        };
    }
    config;
    async start() {
        if (this.isMonitoring) {
            this.logger.warn('Health monitor already running');
            return;
        }
        this.logger.info('Starting connection health monitor', {
            config: this.config
        });
        this.isMonitoring = true;
        this.missedHeartbeats = 0;
        this.lastHeartbeat = new Date();
        this.scheduleHeartbeat();
        this.updateHealthStatus('connected');
        this.emit('started');
    }
    async stop() {
        if (!this.isMonitoring) {
            return;
        }
        this.logger.info('Stopping connection health monitor');
        this.isMonitoring = false;
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = undefined;
        }
        this.updateHealthStatus('disconnected');
        this.emit('stopped');
    }
    getHealthStatus() {
        return {
            ...this.healthStatus
        };
    }
    async checkHealth() {
        try {
            const startTime = Date.now();
            await this.sendHeartbeat();
            this.currentLatency = Date.now() - startTime;
            this.lastHeartbeat = new Date();
            this.missedHeartbeats = 0;
            this.updateHealthStatus('connected', true);
            return this.getHealthStatus();
        } catch (error) {
            this.logger.error('Health check failed', error);
            this.handleHeartbeatFailure(error);
            return this.getHealthStatus();
        }
    }
    async forceCheck() {
        this.logger.debug('Forcing health check');
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
        }
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
        }
        await this.performHeartbeat();
    }
    scheduleHeartbeat() {
        if (!this.isMonitoring) {
            return;
        }
        this.heartbeatTimer = setTimeout(()=>{
            this.performHeartbeat().catch((error)=>{
                this.logger.error('Heartbeat error', error);
            });
        }, this.config.heartbeatInterval);
    }
    async performHeartbeat() {
        if (!this.isMonitoring) {
            return;
        }
        this.logger.debug('Performing heartbeat');
        try {
            this.setHeartbeatTimeout();
            const startTime = Date.now();
            await this.sendHeartbeat();
            this.clearHeartbeatTimeout();
            this.currentLatency = Date.now() - startTime;
            this.lastHeartbeat = new Date();
            this.missedHeartbeats = 0;
            this.logger.debug('Heartbeat successful', {
                latency: this.currentLatency
            });
            this.updateHealthStatus('connected', true);
            this.scheduleHeartbeat();
        } catch (error) {
            this.handleHeartbeatFailure(error);
        }
    }
    async sendHeartbeat() {
        await this.client.notify('heartbeat', {
            timestamp: Date.now(),
            sessionId: this.generateSessionId()
        });
    }
    setHeartbeatTimeout() {
        this.timeoutTimer = setTimeout(()=>{
            this.handleHeartbeatTimeout();
        }, this.config.heartbeatTimeout);
    }
    clearHeartbeatTimeout() {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = undefined;
        }
    }
    handleHeartbeatTimeout() {
        this.logger.warn('Heartbeat timeout');
        this.handleHeartbeatFailure(new Error('Heartbeat timeout'));
    }
    handleHeartbeatFailure(error) {
        this.clearHeartbeatTimeout();
        this.missedHeartbeats++;
        this.logger.warn('Heartbeat failed', {
            missedHeartbeats: this.missedHeartbeats,
            maxMissed: this.config.maxMissedHeartbeats,
            error: error instanceof Error ? error.message : String(error)
        });
        if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
            this.logger.error('Max missed heartbeats exceeded, connection unhealthy');
            this.updateHealthStatus('disconnected', false, error instanceof Error ? error.message : String(error));
            if (this.config.enableAutoRecovery) {
                this.emit('connectionLost', {
                    error
                });
            }
        } else {
            const backoffDelay = this.config.heartbeatInterval * (this.missedHeartbeats + 1);
            this.logger.debug('Scheduling heartbeat with backoff', {
                delay: backoffDelay
            });
            this.heartbeatTimer = setTimeout(()=>{
                this.performHeartbeat().catch((err)=>{
                    this.logger.error('Backoff heartbeat error', err);
                });
            }, backoffDelay);
        }
    }
    updateHealthStatus(connectionState, healthy, error) {
        const previousStatus = {
            ...this.healthStatus
        };
        this.healthStatus = {
            healthy: healthy ?? connectionState === 'connected',
            lastHeartbeat: this.lastHeartbeat,
            missedHeartbeats: this.missedHeartbeats,
            latency: this.currentLatency,
            connectionState,
            error
        };
        if (previousStatus.healthy !== this.healthStatus.healthy || previousStatus.connectionState !== this.healthStatus.connectionState) {
            this.logger.info('Health status changed', {
                from: previousStatus.connectionState,
                to: this.healthStatus.connectionState,
                healthy: this.healthStatus.healthy
            });
            this.emit('healthChange', this.healthStatus, previousStatus);
        }
    }
    generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    reset() {
        this.missedHeartbeats = 0;
        this.currentLatency = 0;
        this.lastHeartbeat = new Date();
        if (this.isMonitoring) {
            this.logger.debug('Resetting health monitor');
            this.clearHeartbeatTimeout();
            this.scheduleHeartbeat();
        }
    }
}

//# sourceMappingURL=connection-health-monitor.js.map