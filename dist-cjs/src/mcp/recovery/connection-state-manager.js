import { promises as fs } from 'node:fs';
import { join } from 'node:path';
export class ConnectionStateManager {
    logger;
    currentState;
    connectionHistory = [];
    metrics = {
        totalConnections: 0,
        totalDisconnections: 0,
        totalReconnections: 0,
        averageSessionDuration: 0,
        averageReconnectionTime: 0,
        connectionHistory: []
    };
    persistenceTimer;
    statePath;
    metricsPath;
    defaultConfig = {
        enablePersistence: true,
        stateDirectory: '.mcp-state',
        maxHistorySize: 1000,
        persistenceInterval: 60000
    };
    constructor(logger, config){
        this.logger = logger;
        this.config = {
            ...this.defaultConfig,
            ...config
        };
        this.statePath = join(this.config.stateDirectory, 'connection-state.json');
        this.metricsPath = join(this.config.stateDirectory, 'connection-metrics.json');
        this.initialize().catch((error)=>{
            this.logger.error('Failed to initialize state manager', error);
        });
    }
    config;
    async initialize() {
        if (!this.config.enablePersistence) {
            return;
        }
        try {
            await fs.mkdir(this.config.stateDirectory, {
                recursive: true
            });
            await this.loadState();
            await this.loadMetrics();
            this.startPersistenceTimer();
            this.logger.info('Connection state manager initialized', {
                stateDirectory: this.config.stateDirectory
            });
        } catch (error) {
            this.logger.error('Failed to initialize state manager', error);
        }
    }
    saveState(state) {
        this.currentState = {
            ...state,
            metadata: {
                ...state.metadata,
                lastSaved: new Date().toISOString()
            }
        };
        this.logger.debug('Connection state saved', {
            sessionId: state.sessionId,
            pendingRequests: state.pendingRequests.length
        });
        if (state.pendingRequests.length > 0) {
            this.persistState().catch((error)=>{
                this.logger.error('Failed to persist critical state', error);
            });
        }
    }
    restoreState() {
        if (!this.currentState) {
            this.logger.debug('No state to restore');
            return null;
        }
        this.logger.info('Restoring connection state', {
            sessionId: this.currentState.sessionId,
            pendingRequests: this.currentState.pendingRequests.length
        });
        return {
            ...this.currentState
        };
    }
    recordEvent(event) {
        const fullEvent = {
            ...event,
            timestamp: new Date()
        };
        this.connectionHistory.push(fullEvent);
        if (this.connectionHistory.length > this.config.maxHistorySize) {
            this.connectionHistory = this.connectionHistory.slice(-this.config.maxHistorySize);
        }
        this.updateMetrics(fullEvent);
        this.logger.debug('Connection event recorded', {
            type: event.type,
            sessionId: event.sessionId
        });
    }
    getMetrics() {
        return {
            ...this.metrics,
            connectionHistory: [
                ...this.connectionHistory
            ]
        };
    }
    clearSession(sessionId) {
        if (this.currentState?.sessionId === sessionId) {
            this.currentState = undefined;
            this.logger.info('Session state cleared', {
                sessionId
            });
            this.persistState().catch((error)=>{
                this.logger.error('Failed to persist cleared state', error);
            });
        }
    }
    addPendingRequest(request) {
        if (!this.currentState) {
            this.logger.warn('No active state to add pending request');
            return;
        }
        this.currentState.pendingRequests.push(request);
        this.logger.debug('Pending request added', {
            requestId: request.id,
            method: request.method,
            total: this.currentState.pendingRequests.length
        });
    }
    removePendingRequest(requestId) {
        if (!this.currentState) {
            return;
        }
        this.currentState.pendingRequests = this.currentState.pendingRequests.filter((req)=>req.id !== requestId);
    }
    getPendingRequests() {
        return this.currentState?.pendingRequests || [];
    }
    updateMetadata(metadata) {
        if (!this.currentState) {
            return;
        }
        this.currentState.metadata = {
            ...this.currentState.metadata,
            ...metadata
        };
    }
    getSessionDuration(sessionId) {
        const connectEvent = this.connectionHistory.find((e)=>e.sessionId === sessionId && e.type === 'connect');
        const disconnectEvent = this.connectionHistory.find((e)=>e.sessionId === sessionId && e.type === 'disconnect');
        if (!connectEvent) {
            return null;
        }
        const endTime = disconnectEvent ? disconnectEvent.timestamp : new Date();
        return endTime.getTime() - connectEvent.timestamp.getTime();
    }
    getReconnectionTime(sessionId) {
        const disconnectEvent = this.connectionHistory.find((e)=>e.sessionId === sessionId && e.type === 'disconnect');
        const reconnectEvent = this.connectionHistory.find((e)=>e.sessionId === sessionId && e.type === 'reconnect' && e.timestamp > (disconnectEvent?.timestamp || new Date(0)));
        if (!disconnectEvent || !reconnectEvent) {
            return null;
        }
        return reconnectEvent.timestamp.getTime() - disconnectEvent.timestamp.getTime();
    }
    updateMetrics(event) {
        switch(event.type){
            case 'connect':
                this.metrics.totalConnections++;
                break;
            case 'disconnect':
                this.metrics.totalDisconnections++;
                const duration = this.getSessionDuration(event.sessionId);
                if (duration !== null) {
                    this.metrics.lastConnectionDuration = duration;
                    const totalDuration = this.metrics.averageSessionDuration * (this.metrics.totalDisconnections - 1) + duration;
                    this.metrics.averageSessionDuration = totalDuration / this.metrics.totalDisconnections;
                }
                break;
            case 'reconnect':
                this.metrics.totalReconnections++;
                const reconnectTime = this.getReconnectionTime(event.sessionId);
                if (reconnectTime !== null) {
                    const totalTime = this.metrics.averageReconnectionTime * (this.metrics.totalReconnections - 1) + reconnectTime;
                    this.metrics.averageReconnectionTime = totalTime / this.metrics.totalReconnections;
                }
                break;
        }
    }
    async loadState() {
        try {
            const data = await fs.readFile(this.statePath, 'utf-8');
            const state = JSON.parse(data);
            state.lastConnected = new Date(state.lastConnected);
            if (state.lastDisconnected) {
                state.lastDisconnected = new Date(state.lastDisconnected);
            }
            this.currentState = state;
            this.logger.info('Connection state loaded', {
                sessionId: state.sessionId,
                pendingRequests: state.pendingRequests.length
            });
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Failed to load connection state', error);
            }
        }
    }
    async loadMetrics() {
        try {
            const data = await fs.readFile(this.metricsPath, 'utf-8');
            const loaded = JSON.parse(data);
            loaded.connectionHistory = loaded.connectionHistory.map((event)=>({
                    ...event,
                    timestamp: new Date(event.timestamp)
                }));
            this.metrics = loaded;
            this.connectionHistory = loaded.connectionHistory;
            this.logger.info('Connection metrics loaded', {
                totalConnections: this.metrics.totalConnections,
                historySize: this.connectionHistory.length
            });
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Failed to load connection metrics', error);
            }
        }
    }
    async persistState() {
        if (!this.config.enablePersistence) {
            return;
        }
        try {
            if (this.currentState) {
                await fs.writeFile(this.statePath, JSON.stringify(this.currentState, null, 2), 'utf-8');
            }
            await fs.writeFile(this.metricsPath, JSON.stringify({
                ...this.metrics,
                connectionHistory: this.connectionHistory
            }, null, 2), 'utf-8');
            this.logger.debug('State and metrics persisted');
        } catch (error) {
            this.logger.error('Failed to persist state', error);
        }
    }
    startPersistenceTimer() {
        if (this.persistenceTimer) {
            return;
        }
        this.persistenceTimer = setInterval(()=>{
            this.persistState().catch((error)=>{
                this.logger.error('Periodic persistence failed', error);
            });
        }, this.config.persistenceInterval);
    }
    async cleanup() {
        if (this.persistenceTimer) {
            clearInterval(this.persistenceTimer);
            this.persistenceTimer = undefined;
        }
        await this.persistState();
    }
}

//# sourceMappingURL=connection-state-manager.js.map