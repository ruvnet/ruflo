import { EventEmitter } from './event-emitter.js';
import chalk from 'chalk';
import { ProcessType, ProcessStatus } from './types.js';
import { Orchestrator } from '../../../core/orchestrator.js';
import { TerminalManager } from '../../../terminal/manager.js';
import { MemoryManager } from '../../../memory/manager.js';
import { CoordinationManager } from '../../../coordination/manager.js';
import { MCPServer } from '../../../mcp/server.js';
import { eventBus } from '../../../core/event-bus.js';
import { logger } from '../../../core/logger.js';
import { configManager } from '../../../core/config.js';
export class ProcessManager extends EventEmitter {
    processes = new Map();
    orchestrator;
    terminalManager;
    memoryManager;
    coordinationManager;
    mcpServer;
    config;
    constructor(){
        super();
        this.initializeProcesses();
    }
    initializeProcesses() {
        const processDefinitions = [
            {
                id: 'event-bus',
                name: 'Event Bus',
                type: ProcessType.EVENT_BUS,
                status: ProcessStatus.STOPPED
            },
            {
                id: 'orchestrator',
                name: 'Orchestrator Engine',
                type: ProcessType.ORCHESTRATOR,
                status: ProcessStatus.STOPPED
            },
            {
                id: 'memory-manager',
                name: 'Memory Manager',
                type: ProcessType.MEMORY_MANAGER,
                status: ProcessStatus.STOPPED
            },
            {
                id: 'terminal-pool',
                name: 'Terminal Pool',
                type: ProcessType.TERMINAL_POOL,
                status: ProcessStatus.STOPPED
            },
            {
                id: 'mcp-server',
                name: 'MCP Server',
                type: ProcessType.MCP_SERVER,
                status: ProcessStatus.STOPPED
            },
            {
                id: 'coordinator',
                name: 'Coordination Manager',
                type: ProcessType.COORDINATOR,
                status: ProcessStatus.STOPPED
            }
        ];
        for (const process of processDefinitions){
            this.processes.set(process.id, process);
        }
    }
    async initialize(configPath) {
        try {
            this.config = await configManager.load(configPath);
            this.emit('initialized', {
                config: this.config
            });
        } catch (error) {
            this.emit('error', {
                component: 'ProcessManager',
                error
            });
            throw error;
        }
    }
    async startProcess(processId) {
        const process = this.processes.get(processId);
        if (!process) {
            throw new Error(`Unknown process: ${processId}`);
        }
        if (process.status === ProcessStatus.RUNNING) {
            throw new Error(`Process ${processId} is already running`);
        }
        this.updateProcessStatus(processId, ProcessStatus.STARTING);
        try {
            switch(process.type){
                case ProcessType.EVENT_BUS:
                    process.pid = Deno.pid;
                    break;
                case ProcessType.MEMORY_MANAGER:
                    this.memoryManager = new MemoryManager(this.config.memory, eventBus, logger);
                    await this.memoryManager.initialize();
                    break;
                case ProcessType.TERMINAL_POOL:
                    this.terminalManager = new TerminalManager(this.config.terminal, eventBus, logger);
                    await this.terminalManager.initialize();
                    break;
                case ProcessType.COORDINATOR:
                    this.coordinationManager = new CoordinationManager(this.config.coordination, eventBus, logger);
                    await this.coordinationManager.initialize();
                    break;
                case ProcessType.MCP_SERVER:
                    this.mcpServer = new MCPServer(this.config.mcp, eventBus, logger);
                    await this.mcpServer.start();
                    break;
                case ProcessType.ORCHESTRATOR:
                    if (!this.terminalManager || !this.memoryManager || !this.coordinationManager || !this.mcpServer) {
                        throw new Error('Required components not initialized');
                    }
                    this.orchestrator = new Orchestrator(this.config, this.terminalManager, this.memoryManager, this.coordinationManager, this.mcpServer, eventBus, logger);
                    await this.orchestrator.initialize();
                    break;
            }
            process.startTime = Date.now();
            this.updateProcessStatus(processId, ProcessStatus.RUNNING);
            this.emit('processStarted', {
                processId,
                process
            });
        } catch (error) {
            this.updateProcessStatus(processId, ProcessStatus.ERROR);
            process.metrics = {
                ...process.metrics,
                lastError: error.message
            };
            this.emit('processError', {
                processId,
                error
            });
            throw error;
        }
    }
    async stopProcess(processId) {
        const process = this.processes.get(processId);
        if (!process || process.status !== ProcessStatus.RUNNING) {
            throw new Error(`Process ${processId} is not running`);
        }
        this.updateProcessStatus(processId, ProcessStatus.STOPPING);
        try {
            switch(process.type){
                case ProcessType.ORCHESTRATOR:
                    if (this.orchestrator) {
                        await this.orchestrator.shutdown();
                        this.orchestrator = undefined;
                    }
                    break;
                case ProcessType.MCP_SERVER:
                    if (this.mcpServer) {
                        await this.mcpServer.stop();
                        this.mcpServer = undefined;
                    }
                    break;
                case ProcessType.MEMORY_MANAGER:
                    if (this.memoryManager) {
                        await this.memoryManager.shutdown();
                        this.memoryManager = undefined;
                    }
                    break;
                case ProcessType.TERMINAL_POOL:
                    if (this.terminalManager) {
                        await this.terminalManager.shutdown();
                        this.terminalManager = undefined;
                    }
                    break;
                case ProcessType.COORDINATOR:
                    if (this.coordinationManager) {
                        await this.coordinationManager.shutdown();
                        this.coordinationManager = undefined;
                    }
                    break;
            }
            this.updateProcessStatus(processId, ProcessStatus.STOPPED);
            this.emit('processStopped', {
                processId
            });
        } catch (error) {
            this.updateProcessStatus(processId, ProcessStatus.ERROR);
            this.emit('processError', {
                processId,
                error
            });
            throw error;
        }
    }
    async restartProcess(processId) {
        await this.stopProcess(processId);
        await new Promise((resolve)=>setTimeout(resolve, 1000));
        await this.startProcess(processId);
    }
    async startAll() {
        const startOrder = [
            'event-bus',
            'memory-manager',
            'terminal-pool',
            'coordinator',
            'mcp-server',
            'orchestrator'
        ];
        for (const processId of startOrder){
            try {
                await this.startProcess(processId);
            } catch (error) {
                console.error(chalk.red(`Failed to start ${processId}:`), error.message);
            }
        }
    }
    async stopAll() {
        const stopOrder = [
            'orchestrator',
            'mcp-server',
            'coordinator',
            'terminal-pool',
            'memory-manager',
            'event-bus'
        ];
        for (const processId of stopOrder){
            const process = this.processes.get(processId);
            if (process && process.status === ProcessStatus.RUNNING) {
                try {
                    await this.stopProcess(processId);
                } catch (error) {
                    console.error(chalk.red(`Failed to stop ${processId}:`), error.message);
                }
            }
        }
    }
    getProcess(processId) {
        return this.processes.get(processId);
    }
    getAllProcesses() {
        return Array.from(this.processes.values());
    }
    getSystemStats() {
        const processes = this.getAllProcesses();
        const runningProcesses = processes.filter((p)=>p.status === ProcessStatus.RUNNING);
        const stoppedProcesses = processes.filter((p)=>p.status === ProcessStatus.STOPPED);
        const errorProcesses = processes.filter((p)=>p.status === ProcessStatus.ERROR);
        return {
            totalProcesses: processes.length,
            runningProcesses: runningProcesses.length,
            stoppedProcesses: stoppedProcesses.length,
            errorProcesses: errorProcesses.length,
            systemUptime: this.getSystemUptime(),
            totalMemory: this.getTotalMemoryUsage(),
            totalCpu: this.getTotalCpuUsage()
        };
    }
    updateProcessStatus(processId, status) {
        const process = this.processes.get(processId);
        if (process) {
            process.status = status;
            this.emit('statusChanged', {
                processId,
                status
            });
        }
    }
    getSystemUptime() {
        const orchestrator = this.processes.get('orchestrator');
        if (orchestrator && orchestrator.startTime) {
            return Date.now() - orchestrator.startTime;
        }
        return 0;
    }
    getTotalMemoryUsage() {
        return 0;
    }
    getTotalCpuUsage() {
        return 0;
    }
    async getProcessLogs(processId, lines = 50) {
        return [
            `[${new Date().toISOString()}] Process ${processId} started`,
            `[${new Date().toISOString()}] Process ${processId} is running normally`
        ];
    }
}

//# sourceMappingURL=process-manager.js.map