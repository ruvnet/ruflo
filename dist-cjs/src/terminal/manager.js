import * as process from 'node:process';
import { TerminalError, TerminalSpawnError } from '../utils/errors.js';
import { VSCodeAdapter } from './adapters/vscode.js';
import { NativeAdapter } from './adapters/native.js';
import { TerminalPool } from './pool.js';
import { TerminalSession } from './session.js';
export class TerminalManager {
    config;
    eventBus;
    logger;
    adapter;
    pool;
    sessions = new Map();
    initialized = false;
    constructor(config, eventBus, logger){
        this.config = config;
        this.eventBus = eventBus;
        this.logger = logger;
        this.adapter = this.createAdapter();
        this.pool = new TerminalPool(this.config.poolSize, this.config.recycleAfter, this.adapter, this.logger);
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        this.logger.info('Initializing terminal manager...');
        try {
            await this.adapter.initialize();
            await this.pool.initialize();
            this.initialized = true;
            this.logger.info('Terminal manager initialized');
        } catch (error) {
            this.logger.error('Failed to initialize terminal manager', error);
            throw new TerminalError('Terminal manager initialization failed', {
                error
            });
        }
    }
    async shutdown() {
        if (!this.initialized) {
            return;
        }
        this.logger.info('Shutting down terminal manager...');
        try {
            const sessionIds = Array.from(this.sessions.keys());
            await Promise.all(sessionIds.map((id)=>this.terminateTerminal(id)));
            await this.pool.shutdown();
            await this.adapter.shutdown();
            this.initialized = false;
            this.logger.info('Terminal manager shutdown complete');
        } catch (error) {
            this.logger.error('Error during terminal manager shutdown', error);
            throw error;
        }
    }
    async spawnTerminal(profile) {
        if (!this.initialized) {
            throw new TerminalError('Terminal manager not initialized');
        }
        this.logger.debug('Spawning terminal', {
            agentId: profile.id
        });
        try {
            const terminal = await this.pool.acquire();
            const session = new TerminalSession(terminal, profile, this.config.commandTimeout, this.logger);
            await session.initialize();
            this.sessions.set(session.id, session);
            this.logger.info('Terminal spawned', {
                terminalId: session.id,
                agentId: profile.id
            });
            return session.id;
        } catch (error) {
            this.logger.error('Failed to spawn terminal', error);
            throw new TerminalSpawnError('Failed to spawn terminal', {
                error
            });
        }
    }
    async terminateTerminal(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            throw new TerminalError(`Terminal not found: ${terminalId}`);
        }
        this.logger.debug('Terminating terminal', {
            terminalId
        });
        try {
            await session.cleanup();
            await this.pool.release(session.terminal);
            this.sessions.delete(terminalId);
            this.logger.info('Terminal terminated', {
                terminalId
            });
        } catch (error) {
            this.logger.error('Failed to terminate terminal', error);
            throw error;
        }
    }
    async executeCommand(terminalId, command) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            throw new TerminalError(`Terminal not found: ${terminalId}`);
        }
        return await session.executeCommand(command);
    }
    async getHealthStatus() {
        try {
            const poolHealth = await this.pool.getHealthStatus();
            const activeSessions = this.sessions.size;
            const healthySessions = Array.from(this.sessions.values()).filter((session)=>session.isHealthy()).length;
            const metrics = {
                activeSessions,
                healthySessions,
                poolSize: poolHealth.size,
                availableTerminals: poolHealth.available,
                recycledTerminals: poolHealth.recycled
            };
            const healthy = poolHealth.healthy && healthySessions === activeSessions;
            if (healthy) {
                return {
                    healthy,
                    metrics
                };
            } else {
                return {
                    healthy,
                    metrics,
                    error: 'Some terminals are unhealthy'
                };
            }
        } catch (error) {
            return {
                healthy: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    async performMaintenance() {
        if (!this.initialized) {
            return;
        }
        this.logger.debug('Performing terminal manager maintenance');
        try {
            const deadSessions = Array.from(this.sessions.entries()).filter(([_, session])=>!session.isHealthy());
            for (const [terminalId, _] of deadSessions){
                this.logger.warn('Cleaning up dead terminal session', {
                    terminalId
                });
                await this.terminateTerminal(terminalId).catch((error)=>this.logger.error('Failed to clean up terminal', {
                        terminalId,
                        error
                    }));
            }
            await this.pool.performMaintenance();
            this.eventBus.emit('terminal:maintenance', {
                deadSessions: deadSessions.length,
                activeSessions: this.sessions.size,
                poolStatus: await this.pool.getHealthStatus()
            });
            this.logger.debug('Terminal manager maintenance completed');
        } catch (error) {
            this.logger.error('Error during terminal manager maintenance', error);
        }
    }
    getActiveSessions() {
        return Array.from(this.sessions.values()).map((session)=>({
                id: session.id,
                agentId: session.profile.id,
                terminalId: session.terminal.id,
                startTime: session.startTime,
                status: session.isHealthy() ? 'active' : 'error',
                lastActivity: session.lastActivity,
                memoryBankId: ''
            }));
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    async streamOutput(terminalId, callback) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            throw new TerminalError(`Terminal not found: ${terminalId}`);
        }
        return session.streamOutput(callback);
    }
    createAdapter() {
        switch(this.config.type){
            case 'vscode':
                return new VSCodeAdapter(this.logger);
            case 'native':
                return new NativeAdapter(this.logger);
            case 'auto':
                if (this.isVSCodeEnvironment()) {
                    this.logger.info('Detected VSCode environment, using VSCode adapter');
                    return new VSCodeAdapter(this.logger);
                } else {
                    this.logger.info('Using native terminal adapter');
                    return new NativeAdapter(this.logger);
                }
            default:
                throw new TerminalError(`Unknown terminal type: ${this.config.type}`);
        }
    }
    isVSCodeEnvironment() {
        return process.env.TERM_PROGRAM === 'vscode' || process.env.VSCODE_PID !== undefined || process.env.VSCODE_IPC_HOOK !== undefined;
    }
}

//# sourceMappingURL=manager.js.map