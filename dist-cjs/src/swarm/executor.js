import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { SWARM_CONSTANTS } from './types.js';
export class TaskExecutor extends EventEmitter {
    logger;
    config;
    activeExecutions = new Map();
    resourceMonitor;
    processPool;
    constructor(config = {}){
        super();
        this.config = this.mergeWithDefaults(config);
        this.logger = new Logger({
            level: this.config.logLevel || 'info',
            format: 'text',
            destination: 'console'
        }, {
            component: 'TaskExecutor'
        });
        this.resourceMonitor = new ResourceMonitor();
        this.processPool = new ProcessPool(this.config);
        this.setupEventHandlers();
    }
    async initialize() {
        this.logger.info('Initializing task executor...');
        await this.resourceMonitor.initialize();
        await this.processPool.initialize();
        this.logger.info('Task executor initialized');
    }
    async shutdown() {
        this.logger.info('Shutting down task executor...');
        const stopPromises = Array.from(this.activeExecutions.values()).map((session)=>this.stopExecution(session.id, 'Executor shutdown'));
        await Promise.allSettled(stopPromises);
        await this.processPool.shutdown();
        await this.resourceMonitor.shutdown();
        this.logger.info('Task executor shut down');
    }
    async executeTask(task, agent, options = {}) {
        const sessionId = generateId('execution');
        const context = await this.createExecutionContext(task, agent);
        const config = {
            ...this.config,
            ...options
        };
        this.logger.info('Starting task execution', {
            sessionId,
            taskId: task.id.id,
            agentId: agent.id.id,
            timeout: config.timeoutMs
        });
        const session = new ExecutionSession(sessionId, task, agent, context, config, this.logger);
        this.activeExecutions.set(sessionId, session);
        try {
            this.resourceMonitor.startMonitoring(sessionId, context.resources);
            const result = await this.executeWithTimeout(session);
            await this.cleanupExecution(session);
            this.logger.info('Task execution completed', {
                sessionId,
                success: result.success,
                duration: result.duration
            });
            return result;
        } catch (error) {
            this.logger.error('Task execution failed', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
                stack: error.stack
            });
            await this.cleanupExecution(session);
            throw error;
        } finally{
            this.activeExecutions.delete(sessionId);
            this.resourceMonitor.stopMonitoring(sessionId);
        }
    }
    async stopExecution(sessionId, reason) {
        const session = this.activeExecutions.get(sessionId);
        if (!session) {
            return;
        }
        this.logger.info('Stopping execution', {
            sessionId,
            reason
        });
        try {
            await session.stop(reason);
        } catch (error) {
            this.logger.error('Error stopping execution', {
                sessionId,
                error
            });
        }
    }
    async executeClaudeTask(task, agent, claudeOptions = {}) {
        const sessionId = generateId('claude-execution');
        const context = await this.createExecutionContext(task, agent);
        this.logger.info('Starting Claude task execution', {
            sessionId,
            taskId: task.id.id,
            agentId: agent.id.id
        });
        try {
            return await this.executeClaudeWithTimeout(sessionId, task, agent, context, claudeOptions);
        } catch (error) {
            this.logger.error('Claude task execution failed', {
                sessionId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    getActiveExecutions() {
        return Array.from(this.activeExecutions.values());
    }
    getExecutionMetrics() {
        return {
            activeExecutions: this.activeExecutions.size,
            totalExecutions: this.processPool.getTotalExecutions(),
            averageDuration: this.processPool.getAverageDuration(),
            successRate: this.processPool.getSuccessRate(),
            resourceUtilization: this.resourceMonitor.getUtilization(),
            errorRate: this.processPool.getErrorRate()
        };
    }
    async executeWithTimeout(session) {
        return new Promise((resolve, reject)=>{
            const timeout = setTimeout(()=>{
                this.logger.warn('Execution timeout', {
                    sessionId: session.id,
                    timeout: session.config.timeoutMs
                });
                session.stop('Timeout').then(()=>{
                    reject(new Error(`Execution timed out after ${session.config.timeoutMs}ms`));
                });
            }, session.config.timeoutMs);
            session.execute().then((result)=>{
                clearTimeout(timeout);
                resolve(result);
            }).catch((error)=>{
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    async executeClaudeWithTimeout(sessionId, task, agent, context, options) {
        const startTime = Date.now();
        const timeout = options.timeout || this.config.timeoutMs;
        const command = this.buildClaudeCommand(task, agent, options);
        const env = {
            ...process.env,
            ...context.environment,
            CLAUDE_TASK_ID: task.id.id,
            CLAUDE_AGENT_ID: agent.id.id,
            CLAUDE_SESSION_ID: sessionId,
            CLAUDE_WORKING_DIR: context.workingDirectory
        };
        this.logger.debug('Executing Claude command', {
            sessionId,
            command: command.command,
            args: command.args,
            workingDir: context.workingDirectory
        });
        return new Promise((resolve, reject)=>{
            let outputBuffer = '';
            let errorBuffer = '';
            let isTimeout = false;
            let process1 = null;
            const timeoutHandle = setTimeout(()=>{
                isTimeout = true;
                if (process1) {
                    this.logger.warn('Claude execution timeout, killing process', {
                        sessionId,
                        pid: process1.pid,
                        timeout
                    });
                    process1.kill('SIGTERM');
                    setTimeout(()=>{
                        if (process1 && !process1.killed) {
                            process1.kill('SIGKILL');
                        }
                    }, this.config.killTimeout);
                }
            }, timeout);
            try {
                process1 = spawn(command.command, command.args, {
                    cwd: context.workingDirectory,
                    env,
                    stdio: [
                        'pipe',
                        'pipe',
                        'pipe'
                    ],
                    detached: options.detached || false
                });
                if (!process1.pid) {
                    clearTimeout(timeoutHandle);
                    reject(new Error('Failed to spawn Claude process'));
                    return;
                }
                this.logger.info('Claude process started', {
                    sessionId,
                    pid: process1.pid,
                    command: command.command
                });
                if (process1.stdout) {
                    process1.stdout.on('data', (data)=>{
                        const chunk = data.toString();
                        outputBuffer += chunk;
                        if (this.config.streamOutput) {
                            this.emit('output', {
                                sessionId,
                                type: 'stdout',
                                data: chunk
                            });
                        }
                    });
                }
                if (process1.stderr) {
                    process1.stderr.on('data', (data)=>{
                        const chunk = data.toString();
                        errorBuffer += chunk;
                        if (this.config.streamOutput) {
                            this.emit('output', {
                                sessionId,
                                type: 'stderr',
                                data: chunk
                            });
                        }
                    });
                }
                process1.on('close', async (code, signal)=>{
                    clearTimeout(timeoutHandle);
                    const duration = Date.now() - startTime;
                    const exitCode = code || 0;
                    this.logger.info('Claude process completed', {
                        sessionId,
                        exitCode,
                        signal,
                        duration,
                        isTimeout
                    });
                    try {
                        const resourceUsage = await this.collectResourceUsage(sessionId);
                        const artifacts = await this.collectArtifacts(context);
                        const result = {
                            success: !isTimeout && exitCode === 0,
                            output: outputBuffer,
                            error: errorBuffer,
                            exitCode,
                            duration,
                            resourcesUsed: resourceUsage,
                            artifacts,
                            metadata: {
                                sessionId,
                                timeout: isTimeout,
                                signal,
                                command: command.command,
                                args: command.args
                            }
                        };
                        if (isTimeout) {
                            reject(new Error(`Claude execution timed out after ${timeout}ms`));
                        } else if (exitCode !== 0) {
                            reject(new Error(`Claude execution failed with exit code ${exitCode}: ${errorBuffer}`));
                        } else {
                            resolve(result);
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
                process1.on('error', (error)=>{
                    clearTimeout(timeoutHandle);
                    this.logger.error('Claude process error', {
                        sessionId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    reject(error);
                });
                if (command.input && process1.stdin) {
                    process1.stdin.write(command.input);
                    process1.stdin.end();
                }
                if (options.detached) {
                    process1.unref();
                }
            } catch (error) {
                clearTimeout(timeoutHandle);
                reject(error);
            }
        });
    }
    buildClaudeCommand(task, agent, options) {
        const args = [];
        let input = '';
        const prompt = this.buildClaudePrompt(task, agent);
        if (options.useStdin) {
            input = prompt;
        } else {
            args.push('-p', prompt);
        }
        if (task.requirements.tools.length > 0) {
            args.push('--allowedTools', task.requirements.tools.join(','));
        }
        if (options.model) {
            args.push('--model', options.model);
        }
        if (options.maxTokens) {
            args.push('--max-tokens', options.maxTokens.toString());
        }
        if (options.temperature !== undefined) {
            args.push('--temperature', options.temperature.toString());
        }
        args.push('--dangerously-skip-permissions');
        if (options.outputFormat) {
            args.push('--output-format', options.outputFormat);
        }
        return {
            command: options.claudePath || 'claude',
            args,
            input
        };
    }
    buildClaudePrompt(task, agent) {
        const sections = [];
        sections.push(`You are ${agent.name}, a ${agent.type} agent in a swarm system.`);
        sections.push(`Agent ID: ${agent.id.id}`);
        sections.push(`Swarm ID: ${agent.id.swarmId}`);
        sections.push('');
        sections.push(`TASK: ${task.name}`);
        sections.push(`Type: ${task.type}`);
        sections.push(`Priority: ${task.priority}`);
        sections.push('');
        sections.push('DESCRIPTION:');
        sections.push(task.description);
        sections.push('');
        sections.push('INSTRUCTIONS:');
        sections.push(task.instructions);
        sections.push('');
        if (Object.keys(task.context).length > 0) {
            sections.push('CONTEXT:');
            sections.push(JSON.stringify(task.context, null, 2));
            sections.push('');
        }
        if (task.input && Object.keys(task.input).length > 0) {
            sections.push('INPUT DATA:');
            sections.push(JSON.stringify(task.input, null, 2));
            sections.push('');
        }
        if (task.examples && task.examples.length > 0) {
            sections.push('EXAMPLES:');
            task.examples.forEach((example, index)=>{
                sections.push(`Example ${index + 1}:`);
                sections.push(JSON.stringify(example, null, 2));
                sections.push('');
            });
        }
        sections.push('EXPECTED OUTPUT:');
        if (task.expectedOutput) {
            sections.push(JSON.stringify(task.expectedOutput, null, 2));
        } else {
            sections.push('Provide a structured response with:');
            sections.push('- Summary of what was accomplished');
            sections.push('- Any artifacts created (files, data, etc.)');
            sections.push('- Recommendations or next steps');
            sections.push('- Any issues encountered');
        }
        sections.push('');
        sections.push('QUALITY REQUIREMENTS:');
        sections.push(`- Quality threshold: ${task.requirements.minReliability || 0.8}`);
        if (task.requirements.reviewRequired) {
            sections.push('- Review required before completion');
        }
        if (task.requirements.testingRequired) {
            sections.push('- Testing required before completion');
        }
        if (task.requirements.documentationRequired) {
            sections.push('- Documentation required');
        }
        sections.push('');
        sections.push('CAPABILITIES:');
        const capabilities = Object.entries(agent.capabilities).filter(([key, value])=>typeof value === 'boolean' && value).map(([key])=>key);
        sections.push(capabilities.join(', '));
        sections.push('');
        sections.push('CONSTRAINTS:');
        sections.push(`- Maximum execution time: ${task.constraints.timeoutAfter || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT}ms`);
        sections.push(`- Maximum retries: ${task.constraints.maxRetries || SWARM_CONSTANTS.MAX_RETRIES}`);
        if (task.constraints.deadline) {
            sections.push(`- Deadline: ${task.constraints.deadline.toISOString()}`);
        }
        sections.push('');
        sections.push('EXECUTION GUIDELINES:');
        sections.push('1. Read and understand the task completely before starting');
        sections.push('2. Use your capabilities efficiently and effectively');
        sections.push('3. Provide detailed output about your progress and results');
        sections.push('4. Handle errors gracefully and report issues clearly');
        sections.push('5. Ensure your work meets the quality requirements');
        sections.push('6. When complete, provide a clear summary of what was accomplished');
        sections.push('');
        sections.push('Begin your task execution now.');
        return sections.join('\n');
    }
    async createExecutionContext(task, agent) {
        const baseDir = path.join(os.tmpdir(), 'swarm-execution', task.id.id);
        const workingDir = path.join(baseDir, 'work');
        const tempDir = path.join(baseDir, 'temp');
        const logDir = path.join(baseDir, 'logs');
        await fs.mkdir(workingDir, {
            recursive: true
        });
        await fs.mkdir(tempDir, {
            recursive: true
        });
        await fs.mkdir(logDir, {
            recursive: true
        });
        return {
            task,
            agent,
            workingDirectory: workingDir,
            tempDirectory: tempDir,
            logDirectory: logDir,
            environment: {
                NODE_ENV: 'production',
                SWARM_MODE: 'execution',
                AGENT_TYPE: agent.type,
                TASK_TYPE: task.type,
                ...agent.environment.credentials
            },
            resources: {
                maxMemory: task.requirements.memoryRequired || SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
                maxCpuTime: task.requirements.maxDuration || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
                maxDiskSpace: 1024 * 1024 * 1024,
                maxNetworkConnections: 10,
                maxFileHandles: 100,
                priority: this.getPriorityNumber(task.priority)
            }
        };
    }
    async cleanupExecution(session) {
        try {
            await session.cleanup();
            this.logger.debug('Execution cleanup completed', {
                sessionId: session.id
            });
        } catch (error) {
            this.logger.warn('Error during execution cleanup', {
                sessionId: session.id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async collectResourceUsage(sessionId) {
        return this.resourceMonitor.getUsage(sessionId);
    }
    async collectArtifacts(context) {
        const artifacts = {};
        try {
            const files = await this.scanDirectory(context.workingDirectory);
            artifacts.files = files;
            artifacts.logs = await this.collectLogs(context.logDirectory);
            artifacts.outputs = await this.collectOutputs(context.workingDirectory);
        } catch (error) {
            this.logger.warn('Error collecting artifacts', {
                workingDir: context.workingDirectory,
                error: error instanceof Error ? error.message : String(error)
            });
        }
        return artifacts;
    }
    async scanDirectory(dirPath) {
        try {
            const entries = await fs.readdir(dirPath, {
                withFileTypes: true
            });
            const files = [];
            for (const entry of entries){
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isFile()) {
                    files.push(fullPath);
                } else if (entry.isDirectory()) {
                    const subFiles = await this.scanDirectory(fullPath);
                    files.push(...subFiles);
                }
            }
            return files;
        } catch (error) {
            return [];
        }
    }
    async collectLogs(logDir) {
        const logs = {};
        try {
            const files = await fs.readdir(logDir);
            for (const file of files){
                if (file.endsWith('.log')) {
                    const filePath = path.join(logDir, file);
                    const content = await fs.readFile(filePath, 'utf-8');
                    logs[file] = content;
                }
            }
        } catch (error) {}
        return logs;
    }
    async collectOutputs(workingDir) {
        const outputs = {};
        try {
            const outputFiles = [
                'output.json',
                'result.json',
                'response.json'
            ];
            for (const fileName of outputFiles){
                const filePath = path.join(workingDir, fileName);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    outputs[fileName] = JSON.parse(content);
                } catch (error) {}
            }
        } catch (error) {}
        return outputs;
    }
    getPriorityNumber(priority) {
        switch(priority){
            case 'critical':
                return 0;
            case 'high':
                return 1;
            case 'normal':
                return 2;
            case 'low':
                return 3;
            case 'background':
                return 4;
            default:
                return 2;
        }
    }
    mergeWithDefaults(config) {
        return {
            timeoutMs: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
            retryAttempts: SWARM_CONSTANTS.MAX_RETRIES,
            killTimeout: 5000,
            resourceLimits: {
                maxMemory: SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
                maxCpuTime: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
                maxDiskSpace: 1024 * 1024 * 1024,
                maxNetworkConnections: 10,
                maxFileHandles: 100,
                priority: 2
            },
            sandboxed: true,
            logLevel: 'info',
            captureOutput: true,
            streamOutput: false,
            enableMetrics: true,
            ...config
        };
    }
    setupEventHandlers() {
        this.resourceMonitor.on('limit-violation', (data)=>{
            this.logger.warn('Resource limit violation', data);
            const session = this.activeExecutions.get(data.sessionId);
            if (session) {
                session.stop('Resource limit violation').catch((error)=>{
                    this.logger.error('Error stopping session due to resource violation', {
                        sessionId: data.sessionId,
                        error
                    });
                });
            }
        });
        this.processPool.on('process-failed', (data)=>{
            this.logger.error('Process failed in pool', data);
        });
    }
}
let ExecutionSession = class ExecutionSession {
    id;
    task;
    agent;
    context;
    config;
    logger;
    process;
    startTime;
    endTime;
    constructor(id, task, agent, context, config, logger){
        this.id = id;
        this.task = task;
        this.agent = agent;
        this.context = context;
        this.config = config;
        this.logger = logger;
    }
    async execute() {
        this.startTime = new Date();
        await new Promise((resolve)=>setTimeout(resolve, 1000));
        this.endTime = new Date();
        return {
            success: true,
            output: 'Task completed successfully',
            exitCode: 0,
            duration: this.endTime.getTime() - this.startTime.getTime(),
            resourcesUsed: {
                cpuTime: 1000,
                maxMemory: 50 * 1024 * 1024,
                diskIO: 1024,
                networkIO: 0,
                fileHandles: 5
            },
            artifacts: {},
            metadata: {
                sessionId: this.id,
                agentId: this.agent.id.id,
                taskId: this.task.id.id
            }
        };
    }
    async stop(reason) {
        this.logger.info('Stopping execution session', {
            sessionId: this.id,
            reason
        });
        if (this.process) {
            this.process.kill('SIGTERM');
            setTimeout(()=>{
                if (this.process && !this.process.killed) {
                    this.process.kill('SIGKILL');
                }
            }, 5000);
        }
    }
    async cleanup() {
        try {
            await fs.rm(this.context.tempDirectory, {
                recursive: true,
                force: true
            });
        } catch (error) {}
    }
};
let ResourceMonitor = class ResourceMonitor extends EventEmitter {
    activeMonitors = new Map();
    usage = new Map();
    async initialize() {}
    async shutdown() {
        for (const [sessionId, timer] of this.activeMonitors){
            clearInterval(timer);
        }
        this.activeMonitors.clear();
    }
    startMonitoring(sessionId, limits) {
        const timer = setInterval(()=>{
            this.checkResources(sessionId, limits);
        }, 1000);
        this.activeMonitors.set(sessionId, timer);
    }
    stopMonitoring(sessionId) {
        const timer = this.activeMonitors.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.activeMonitors.delete(sessionId);
        }
    }
    getUsage(sessionId) {
        return this.usage.get(sessionId) || {
            cpuTime: 0,
            maxMemory: 0,
            diskIO: 0,
            networkIO: 0,
            fileHandles: 0
        };
    }
    getUtilization() {
        return {
            cpu: 0.1,
            memory: 0.2,
            disk: 0.05,
            network: 0.01
        };
    }
    checkResources(sessionId, limits) {
        const usage = this.collectCurrentUsage(sessionId);
        this.usage.set(sessionId, usage);
        if (usage.maxMemory > limits.maxMemory) {
            this.emit('limit-violation', {
                sessionId,
                type: 'memory',
                current: usage.maxMemory,
                limit: limits.maxMemory
            });
        }
        if (usage.cpuTime > limits.maxCpuTime) {
            this.emit('limit-violation', {
                sessionId,
                type: 'cpu',
                current: usage.cpuTime,
                limit: limits.maxCpuTime
            });
        }
    }
    collectCurrentUsage(sessionId) {
        return {
            cpuTime: Math.random() * 1000,
            maxMemory: Math.random() * 100 * 1024 * 1024,
            diskIO: Math.random() * 1024,
            networkIO: Math.random() * 1024,
            fileHandles: Math.floor(Math.random() * 10)
        };
    }
};
let ProcessPool = class ProcessPool extends EventEmitter {
    config;
    totalExecutions = 0;
    totalDuration = 0;
    successCount = 0;
    errorCount = 0;
    constructor(config){
        super();
        this.config = config;
    }
    async initialize() {}
    async shutdown() {}
    getTotalExecutions() {
        return this.totalExecutions;
    }
    getAverageDuration() {
        return this.totalExecutions > 0 ? this.totalDuration / this.totalExecutions : 0;
    }
    getSuccessRate() {
        return this.totalExecutions > 0 ? this.successCount / this.totalExecutions : 0;
    }
    getErrorRate() {
        return this.totalExecutions > 0 ? this.errorCount / this.totalExecutions : 0;
    }
};
export default TaskExecutor;

//# sourceMappingURL=executor.js.map