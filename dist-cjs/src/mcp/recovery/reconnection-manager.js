import { EventEmitter } from 'node:events';
export class ReconnectionManager extends EventEmitter {
    client;
    logger;
    state;
    reconnectTimer;
    reconnectPromise;
    defaultConfig = {
        maxRetries: 10,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitterFactor: 0.1,
        resetAfterSuccess: true
    };
    constructor(client, logger, config){
        super(), this.client = client, this.logger = logger;
        this.config = {
            ...this.defaultConfig,
            ...config
        };
        this.state = {
            attempts: 0,
            nextDelay: this.config.initialDelay,
            isReconnecting: false
        };
    }
    config;
    async attemptReconnection() {
        if (this.reconnectPromise) {
            this.logger.debug('Reconnection already in progress');
            return this.reconnectPromise;
        }
        if (this.state.attempts >= this.config.maxRetries) {
            this.logger.error('Max reconnection attempts exceeded');
            this.emit('maxRetriesExceeded', this.state);
            return false;
        }
        this.reconnectPromise = this.performReconnection();
        const result = await this.reconnectPromise;
        this.reconnectPromise = undefined;
        return result;
    }
    startAutoReconnect() {
        if (this.state.isReconnecting) {
            this.logger.debug('Auto-reconnect already active');
            return;
        }
        this.logger.info('Starting automatic reconnection');
        this.state.isReconnecting = true;
        this.emit('reconnectStart');
        this.scheduleReconnect();
    }
    stopReconnection() {
        if (!this.state.isReconnecting) {
            return;
        }
        this.logger.info('Stopping reconnection attempts');
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.state.isReconnecting = false;
        this.emit('reconnectStop');
    }
    reset() {
        this.logger.debug('Resetting reconnection manager');
        this.stopReconnection();
        this.state = {
            attempts: 0,
            nextDelay: this.config.initialDelay,
            isReconnecting: false
        };
    }
    getState() {
        return {
            ...this.state
        };
    }
    getNextDelay() {
        return this.state.nextDelay;
    }
    async performReconnection() {
        this.state.attempts++;
        this.state.lastAttempt = new Date();
        this.logger.info('Attempting reconnection', {
            attempt: this.state.attempts,
            maxRetries: this.config.maxRetries,
            delay: this.state.nextDelay
        });
        this.emit('attemptStart', {
            attempt: this.state.attempts,
            delay: this.state.nextDelay
        });
        try {
            if (this.client.isConnected()) {
                await this.client.disconnect();
            }
            await this.client.connect();
            this.logger.info('Reconnection successful', {
                attempts: this.state.attempts
            });
            this.emit('success', {
                attempts: this.state.attempts,
                duration: Date.now() - this.state.lastAttempt.getTime()
            });
            if (this.config.resetAfterSuccess) {
                this.reset();
            }
            return true;
        } catch (error) {
            this.state.lastError = error;
            this.logger.error('Reconnection failed', {
                attempt: this.state.attempts,
                error: error.message
            });
            this.emit('attemptFailed', {
                attempt: this.state.attempts,
                error: error
            });
            this.calculateNextDelay();
            if (this.state.attempts < this.config.maxRetries && this.state.isReconnecting) {
                this.scheduleReconnect();
            } else if (this.state.attempts >= this.config.maxRetries) {
                this.logger.error('Max reconnection attempts reached');
                this.emit('maxRetriesExceeded', this.state);
                this.state.isReconnecting = false;
            }
            return false;
        }
    }
    scheduleReconnect() {
        if (!this.state.isReconnecting) {
            return;
        }
        const delay = this.addJitter(this.state.nextDelay);
        this.logger.debug('Scheduling next reconnection attempt', {
            delay,
            baseDelay: this.state.nextDelay
        });
        this.reconnectTimer = setTimeout(()=>{
            this.attemptReconnection().catch((error)=>{
                this.logger.error('Scheduled reconnection error', error);
            });
        }, delay);
        this.emit('attemptScheduled', {
            attempt: this.state.attempts + 1,
            delay
        });
    }
    calculateNextDelay() {
        const nextDelay = Math.min(this.state.nextDelay * this.config.backoffMultiplier, this.config.maxDelay);
        this.state.nextDelay = nextDelay;
        this.logger.debug('Calculated next delay', {
            delay: nextDelay,
            multiplier: this.config.backoffMultiplier,
            maxDelay: this.config.maxDelay
        });
    }
    addJitter(delay) {
        const jitter = delay * this.config.jitterFactor;
        const randomJitter = (Math.random() - 0.5) * 2 * jitter;
        return Math.max(0, delay + randomJitter);
    }
    async forceReconnect() {
        this.logger.info('Forcing immediate reconnection');
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        const originalDelay = this.state.nextDelay;
        this.state.nextDelay = 0;
        const result = await this.attemptReconnection();
        if (!result) {
            this.state.nextDelay = originalDelay;
        }
        return result;
    }
    getTimeUntilNextAttempt() {
        if (!this.state.isReconnecting || !this.reconnectTimer) {
            return null;
        }
        return this.state.nextDelay;
    }
}

//# sourceMappingURL=reconnection-manager.js.map