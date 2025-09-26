import { EventEmitter } from 'node:events';
import { MCPError } from '../utils/errors.js';
export var LifecycleState = /*#__PURE__*/ function(LifecycleState) {
    LifecycleState["STOPPED"] = "stopped";
    LifecycleState["STARTING"] = "starting";
    LifecycleState["RUNNING"] = "running";
    LifecycleState["STOPPING"] = "stopping";
    LifecycleState["RESTARTING"] = "restarting";
    LifecycleState["ERROR"] = "error";
    return LifecycleState;
}({});
export class MCPLifecycleManager extends EventEmitter {
    mcpConfig;
    logger;
    serverFactory;
    state = "stopped";
    server;
    healthCheckTimer;
    startTime;
    lastRestart;
    restartAttempts = 0;
    shutdownPromise;
    history = [];
    config = {
        healthCheckInterval: 30000,
        gracefulShutdownTimeout: 10000,
        maxRestartAttempts: 3,
        restartDelay: 5000,
        enableAutoRestart: true,
        enableHealthChecks: true
    };
    constructor(mcpConfig, logger, serverFactory, config){
        super(), this.mcpConfig = mcpConfig, this.logger = logger, this.serverFactory = serverFactory;
        if (config) {
            Object.assign(this.config, config);
        }
        this.setupEventHandlers();
    }
    async start() {
        if (this.state !== "stopped") {
            throw new MCPError(`Cannot start server in state: ${this.state}`);
        }
        this.setState("starting");
        this.logger.info('Starting MCP server lifecycle manager');
        try {
            this.server = this.serverFactory();
            await this.server.start();
            this.startTime = new Date();
            this.restartAttempts = 0;
            if (this.config.enableHealthChecks) {
                this.startHealthChecks();
            }
            this.setState("running");
            this.logger.info('MCP server started successfully');
        } catch (error) {
            this.setState("error", error);
            this.logger.error('Failed to start MCP server', error);
            throw error;
        }
    }
    async stop() {
        if (this.state === "stopped") {
            return;
        }
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }
        this.setState("stopping");
        this.logger.info('Stopping MCP server');
        this.shutdownPromise = this.performShutdown();
        await this.shutdownPromise;
        this.shutdownPromise = undefined;
    }
    async restart() {
        if (this.state === "stopped") {
            return this.start();
        }
        this.setState("restarting");
        this.logger.info('Restarting MCP server');
        try {
            await this.stop();
            if (this.config.restartDelay > 0) {
                await new Promise((resolve)=>setTimeout(resolve, this.config.restartDelay));
            }
            await this.start();
            this.lastRestart = new Date();
            this.restartAttempts++;
            this.logger.info('MCP server restarted successfully');
        } catch (error) {
            this.setState("error", error);
            this.logger.error('Failed to restart MCP server', error);
            throw error;
        }
    }
    async healthCheck() {
        const startTime = Date.now();
        const result = {
            healthy: false,
            state: this.state,
            uptime: this.getUptime(),
            lastRestart: this.lastRestart,
            components: {
                server: false,
                transport: false,
                sessions: false,
                tools: false,
                auth: false,
                loadBalancer: false
            }
        };
        try {
            if (!this.server || this.state !== "running") {
                result.error = 'Server not running';
                return result;
            }
            const serverHealth = await this.server.getHealthStatus();
            result.components.server = serverHealth.healthy;
            result.metrics = serverHealth.metrics;
            if (serverHealth.error) {
                result.error = serverHealth.error;
            }
            result.components.transport = serverHealth.metrics?.transportConnections !== undefined;
            result.components.sessions = serverHealth.metrics?.activeSessions !== undefined;
            result.components.tools = (serverHealth.metrics?.registeredTools || 0) > 0;
            result.components.auth = serverHealth.metrics?.authenticatedSessions !== undefined;
            result.components.loadBalancer = serverHealth.metrics?.rateLimitedRequests !== undefined;
            result.healthy = result.components.server && result.components.transport && result.components.sessions && result.components.tools;
            const checkDuration = Date.now() - startTime;
            if (result.metrics) {
                result.metrics.healthCheckDuration = checkDuration;
            }
            this.logger.debug('Health check completed', {
                healthy: result.healthy,
                duration: checkDuration,
                components: result.components
            });
            return result;
        } catch (error) {
            result.error = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Health check failed', error);
            return result;
        }
    }
    getState() {
        return this.state;
    }
    getMetrics() {
        return this.server?.getMetrics();
    }
    getSessions() {
        return this.server?.getSessions() || [];
    }
    getUptime() {
        return this.startTime ? Date.now() - this.startTime.getTime() : 0;
    }
    getHistory() {
        return [
            ...this.history
        ];
    }
    async forceStop() {
        this.logger.warn('Force stopping MCP server');
        this.stopHealthChecks();
        if (this.server) {
            try {
                await this.server.stop();
            } catch (error) {
                this.logger.error('Error during force stop', error);
            }
            this.server = undefined;
        }
        this.setState("stopped");
        this.startTime = undefined;
    }
    setAutoRestart(enabled) {
        this.config.enableAutoRestart = enabled;
        this.logger.info('Auto-restart', {
            enabled
        });
    }
    setHealthChecks(enabled) {
        this.config.enableHealthChecks = enabled;
        if (enabled && this.state === "running") {
            this.startHealthChecks();
        } else {
            this.stopHealthChecks();
        }
        this.logger.info('Health checks', {
            enabled
        });
    }
    setState(newState, error) {
        const previousState = this.state;
        this.state = newState;
        const event = {
            timestamp: new Date(),
            state: newState,
            previousState,
            error
        };
        this.history.push(event);
        if (this.history.length > 100) {
            this.history.shift();
        }
        this.emit('stateChange', event);
        this.logger.info('State change', {
            from: previousState,
            to: newState,
            error: error?.message
        });
    }
    setupEventHandlers() {
        process.on('uncaughtException', (error)=>{
            this.logger.error('Uncaught exception', error);
            this.handleServerError(error);
        });
        process.on('unhandledRejection', (reason)=>{
            this.logger.error('Unhandled rejection', reason);
            this.handleServerError(reason instanceof Error ? reason : new Error(String(reason)));
        });
        process.on('SIGINT', ()=>{
            this.logger.info('Received SIGINT, shutting down gracefully');
            this.stop().catch((error)=>{
                this.logger.error('Error during graceful shutdown', error);
                process.exit(1);
            });
        });
        process.on('SIGTERM', ()=>{
            this.logger.info('Received SIGTERM, shutting down gracefully');
            this.stop().catch((error)=>{
                this.logger.error('Error during graceful shutdown', error);
                process.exit(1);
            });
        });
    }
    async handleServerError(error) {
        this.logger.error('Server error detected', error);
        this.setState("error", error);
        if (this.config.enableAutoRestart && this.restartAttempts < this.config.maxRestartAttempts) {
            this.logger.info('Attempting auto-restart', {
                attempt: this.restartAttempts + 1,
                maxAttempts: this.config.maxRestartAttempts
            });
            try {
                await this.restart();
            } catch (restartError) {
                this.logger.error('Auto-restart failed', restartError);
            }
        } else {
            this.logger.error('Max restart attempts reached or auto-restart disabled');
            await this.forceStop();
        }
    }
    startHealthChecks() {
        if (this.healthCheckTimer) {
            return;
        }
        this.healthCheckTimer = setInterval(async ()=>{
            try {
                const health = await this.healthCheck();
                if (!health.healthy && this.state === "running") {
                    this.logger.warn('Health check failed', health);
                    this.handleServerError(new Error(health.error || 'Health check failed'));
                }
            } catch (error) {
                this.logger.error('Health check error', error);
            }
        }, this.config.healthCheckInterval);
        this.logger.debug('Health checks started', {
            interval: this.config.healthCheckInterval
        });
    }
    stopHealthChecks() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
            this.logger.debug('Health checks stopped');
        }
    }
    async performShutdown() {
        try {
            this.stopHealthChecks();
            const shutdownPromise = this.server?.stop() || Promise.resolve();
            const timeoutPromise = new Promise((_, reject)=>{
                setTimeout(()=>reject(new Error('Shutdown timeout')), this.config.gracefulShutdownTimeout);
            });
            await Promise.race([
                shutdownPromise,
                timeoutPromise
            ]);
            this.server = undefined;
            this.setState("stopped");
            this.startTime = undefined;
            this.logger.info('MCP server stopped successfully');
        } catch (error) {
            this.logger.error('Error during shutdown', error);
            await this.forceStop();
            throw error;
        }
    }
}

//# sourceMappingURL=lifecycle-manager.js.map