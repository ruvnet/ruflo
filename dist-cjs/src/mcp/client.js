import { EventEmitter } from 'node:events';
import { logger } from '../core/logger.js';
import { RecoveryManager } from './recovery/index.js';
export class MCPClient extends EventEmitter {
    transport;
    timeout;
    connected = false;
    recoveryManager;
    pendingRequests = new Map();
    constructor(config){
        super();
        this.transport = config.transport;
        this.timeout = config.timeout || 30000;
        if (config.enableRecovery) {
            this.recoveryManager = new RecoveryManager(this, config.mcpConfig || {}, logger, config.recoveryConfig);
            this.setupRecoveryHandlers();
        }
    }
    async connect() {
        try {
            await this.transport.connect();
            this.connected = true;
            logger.info('MCP Client connected');
            if (this.recoveryManager) {
                await this.recoveryManager.start();
            }
            this.emit('connected');
        } catch (error) {
            logger.error('Failed to connect MCP client', error);
            this.connected = false;
            if (this.recoveryManager) {
                await this.recoveryManager.forceRecovery();
            }
            throw error;
        }
    }
    async disconnect() {
        if (this.connected) {
            if (this.recoveryManager) {
                await this.recoveryManager.stop();
            }
            await this.transport.disconnect();
            this.connected = false;
            logger.info('MCP Client disconnected');
            this.emit('disconnected');
        }
    }
    async request(method, params) {
        const request = {
            jsonrpc: '2.0',
            method,
            params,
            id: Math.random().toString(36).slice(2)
        };
        if (this.recoveryManager && !this.connected) {
            await this.recoveryManager.handleRequest(request);
        }
        if (!this.connected) {
            throw new Error('Client not connected');
        }
        const requestPromise = new Promise((resolve, reject)=>{
            const timer = setTimeout(()=>{
                this.pendingRequests.delete(request.id);
                reject(new Error(`Request timeout: ${method}`));
            }, this.timeout);
            this.pendingRequests.set(request.id, {
                resolve,
                reject,
                timer
            });
        });
        try {
            const response = await this.transport.sendRequest(request);
            const pending = this.pendingRequests.get(request.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(request.id);
            }
            if ('error' in response) {
                throw new Error(response.error);
            }
            return response.result;
        } catch (error) {
            const pending = this.pendingRequests.get(request.id);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(request.id);
            }
            throw error;
        }
    }
    async notify(method, params) {
        if (method === 'heartbeat') {
            const notification = {
                jsonrpc: '2.0',
                method,
                params
            };
            if (this.transport.sendNotification) {
                await this.transport.sendNotification(notification);
            }
            return;
        }
        if (!this.connected) {
            throw new Error('Client not connected');
        }
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };
        if (this.transport.sendNotification) {
            await this.transport.sendNotification(notification);
        } else {
            throw new Error('Transport does not support notifications');
        }
    }
    isConnected() {
        return this.connected;
    }
    getRecoveryStatus() {
        return this.recoveryManager?.getStatus();
    }
    async forceRecovery() {
        if (!this.recoveryManager) {
            throw new Error('Recovery not enabled');
        }
        return this.recoveryManager.forceRecovery();
    }
    setupRecoveryHandlers() {
        if (!this.recoveryManager) {
            return;
        }
        this.recoveryManager.on('recoveryStart', ({ trigger })=>{
            logger.info('Recovery started', {
                trigger
            });
            this.emit('recoveryStart', {
                trigger
            });
        });
        this.recoveryManager.on('recoveryComplete', ({ success, duration })=>{
            if (success) {
                logger.info('Recovery completed successfully', {
                    duration
                });
                this.connected = true;
                this.emit('recoverySuccess', {
                    duration
                });
            } else {
                logger.error('Recovery failed');
                this.emit('recoveryFailed', {
                    duration
                });
            }
        });
        this.recoveryManager.on('fallbackActivated', (state)=>{
            logger.warn('Fallback mode activated', state);
            this.emit('fallbackActivated', state);
        });
        this.recoveryManager.on('healthChange', (newStatus, oldStatus)=>{
            this.emit('healthChange', newStatus, oldStatus);
        });
    }
    async cleanup() {
        for (const [id, pending] of this.pendingRequests){
            clearTimeout(pending.timer);
            pending.reject(new Error('Client cleanup'));
        }
        this.pendingRequests.clear();
        if (this.recoveryManager) {
            await this.recoveryManager.cleanup();
        }
        await this.disconnect();
    }
}

//# sourceMappingURL=client.js.map