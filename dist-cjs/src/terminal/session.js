import { TerminalCommandError } from '../utils/errors.js';
import { generateId, timeout } from '../utils/helpers.js';
export class TerminalSession {
    terminal;
    profile;
    commandTimeout;
    logger;
    id;
    startTime;
    initialized = false;
    commandHistory = [];
    lastCommandTime;
    outputListeners = new Set();
    constructor(terminal, profile, commandTimeout, logger){
        this.terminal = terminal;
        this.profile = profile;
        this.commandTimeout = commandTimeout;
        this.logger = logger;
        this.id = generateId('session');
        this.startTime = new Date();
    }
    get lastActivity() {
        return this.lastCommandTime || this.startTime;
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        this.logger.debug('Initializing terminal session', {
            sessionId: this.id,
            agentId: this.profile.id
        });
        try {
            await this.setupEnvironment();
            await this.runInitializationCommands();
            this.initialized = true;
            this.logger.info('Terminal session initialized', {
                sessionId: this.id,
                agentId: this.profile.id
            });
        } catch (error) {
            this.logger.error('Failed to initialize terminal session', error);
            throw error;
        }
    }
    async executeCommand(command) {
        if (!this.initialized) {
            throw new TerminalCommandError('Session not initialized');
        }
        if (!this.terminal.isAlive()) {
            throw new TerminalCommandError('Terminal is not alive');
        }
        this.logger.debug('Executing command', {
            sessionId: this.id,
            command: command.substring(0, 100)
        });
        try {
            this.notifyOutputListeners(`$ ${command}\n`);
            const result = await timeout(this.terminal.executeCommand(command), this.commandTimeout, `Command timeout after ${this.commandTimeout}ms`);
            this.notifyOutputListeners(result);
            this.commandHistory.push(command);
            this.lastCommandTime = new Date();
            this.logger.debug('Command executed successfully', {
                sessionId: this.id,
                outputLength: result.length
            });
            return result;
        } catch (error) {
            this.logger.error('Command execution failed', {
                sessionId: this.id,
                command,
                error
            });
            throw new TerminalCommandError('Command execution failed', {
                command,
                error
            });
        }
    }
    async cleanup() {
        this.logger.debug('Cleaning up terminal session', {
            sessionId: this.id
        });
        try {
            await this.runCleanupCommands();
        } catch (error) {
            this.logger.warn('Error during session cleanup', {
                sessionId: this.id,
                error
            });
        }
    }
    isHealthy() {
        if (!this.terminal.isAlive()) {
            return false;
        }
        if (this.lastCommandTime) {
            const timeSinceLastCommand = Date.now() - this.lastCommandTime.getTime();
            if (timeSinceLastCommand > 300000) {
                this.performHealthCheck().catch((error)=>{
                    this.logger.warn('Health check failed', {
                        sessionId: this.id,
                        error
                    });
                });
            }
        }
        return true;
    }
    getCommandHistory() {
        return [
            ...this.commandHistory
        ];
    }
    async setupEnvironment() {
        const envVars = {
            CLAUDE_FLOW_SESSION: this.id,
            CLAUDE_FLOW_AGENT: this.profile.id,
            CLAUDE_FLOW_AGENT_TYPE: this.profile.type
        };
        for (const [key, value] of Object.entries(envVars)){
            await this.terminal.executeCommand(`export ${key}="${value}"`);
        }
        if (this.profile.metadata?.workingDirectory) {
            await this.terminal.executeCommand(`cd "${this.profile.metadata.workingDirectory}"`);
        }
    }
    async runInitializationCommands() {
        if (this.profile.metadata?.initCommands) {
            const commands = this.profile.metadata.initCommands;
            for (const command of commands){
                await this.terminal.executeCommand(command);
            }
        }
        await this.terminal.executeCommand('export PS1="[claude-flow]$ "');
    }
    async runCleanupCommands() {
        if (this.profile.metadata?.cleanupCommands) {
            const commands = this.profile.metadata.cleanupCommands;
            for (const command of commands){
                try {
                    await this.terminal.executeCommand(command);
                } catch  {}
            }
        }
    }
    async performHealthCheck() {
        try {
            const result = await timeout(this.terminal.executeCommand('echo "HEALTH_CHECK_OK"'), 5000, 'Health check timeout');
            if (!result.includes('HEALTH_CHECK_OK')) {
                throw new Error('Invalid health check response');
            }
            this.lastCommandTime = new Date();
        } catch (error) {
            throw new Error(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    streamOutput(callback) {
        this.outputListeners.add(callback);
        if (this.terminal.addOutputListener) {
            this.terminal.addOutputListener(callback);
        }
        return ()=>{
            this.outputListeners.delete(callback);
            if (this.terminal.removeOutputListener) {
                this.terminal.removeOutputListener(callback);
            }
        };
    }
    notifyOutputListeners(output) {
        this.outputListeners.forEach((listener)=>{
            try {
                listener(output);
            } catch (error) {
                this.logger.error('Error in output listener', {
                    sessionId: this.id,
                    error
                });
            }
        });
    }
}

//# sourceMappingURL=session.js.map