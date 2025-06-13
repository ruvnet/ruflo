import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';

export interface ClaudeFlowMessage {
    type: 'message' | 'error' | 'agent_update' | 'task_update' | 'tool_execution';
    data: any;
}

export class ClaudeFlowCLIAdapter extends EventEmitter {
    private process: ChildProcess | null = null;
    private isRunning = false;
    private messageBuffer = '';

    constructor(private workingDirectory: string = process.cwd()) {
        super();
    }

    async initialize(): Promise<void> {
        // Check if claude-flow is installed
        const checkProcess = spawn('claude-flow', ['--version'], {
            cwd: this.workingDirectory,
            shell: true
        });

        return new Promise((resolve, reject) => {
            checkProcess.on('error', () => {
                reject(new Error('claude-flow CLI not found. Please install it first.'));
            });

            checkProcess.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error('claude-flow CLI check failed'));
                }
            });
        });
    }

    async startSession(mode: string = 'chat'): Promise<void> {
        if (this.isRunning) {
            throw new Error('Session already running');
        }

        // Map our modes to claude-flow modes
        const claudeFlowMode = this.mapMode(mode);
        
        // Start claude-flow in interactive mode
        this.process = spawn('claude-flow', ['sparc', 'run', claudeFlowMode, '--interactive'], {
            cwd: this.workingDirectory,
            shell: true,
            env: {
                ...process.env,
                CLAUDE_FLOW_JSON_OUTPUT: 'true' // Request JSON output for easier parsing
            }
        });

        this.isRunning = true;
        this.setupProcessListeners();
        this.emit('session_started', { mode: claudeFlowMode });
    }

    async sendMessage(message: string): Promise<void> {
        if (!this.process || !this.isRunning) {
            throw new Error('No active session');
        }

        // Send message to claude-flow stdin
        this.process.stdin?.write(message + '\n');
    }

    async executeCommand(command: string, args: string[] = []): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn('claude-flow', [command, ...args], {
                cwd: this.workingDirectory,
                shell: true
            });

            let output = '';
            let error = '';

            proc.stdout?.on('data', (data) => {
                output += data.toString();
            });

            proc.stderr?.on('data', (data) => {
                error += data.toString();
            });

            proc.on('exit', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(error || `Command failed with code ${code}`));
                }
            });
        });
    }

    async stopSession(): Promise<void> {
        if (!this.process || !this.isRunning) {
            return;
        }

        return new Promise((resolve) => {
            this.process!.on('exit', () => {
                this.isRunning = false;
                this.process = null;
                resolve();
            });

            // Send exit command
            this.process!.stdin?.write('exit\n');
            
            // Force kill after timeout
            setTimeout(() => {
                if (this.process) {
                    this.process.kill('SIGTERM');
                }
            }, 5000);
        });
    }

    private setupProcessListeners(): void {
        if (!this.process) return;

        // Handle stdout
        this.process.stdout?.on('data', (data) => {
            this.messageBuffer += data.toString();
            this.processMessages();
        });

        // Handle stderr
        this.process.stderr?.on('data', (data) => {
            this.emit('error', new Error(data.toString()));
        });

        // Handle process exit
        this.process.on('exit', (code) => {
            this.isRunning = false;
            this.emit('session_ended', { code });
            this.process = null;
        });

        // Handle process errors
        this.process.on('error', (error) => {
            this.emit('error', error);
        });
    }

    private processMessages(): void {
        const lines = this.messageBuffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        this.messageBuffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.trim()) continue;

            try {
                // Try to parse as JSON (if CLAUDE_FLOW_JSON_OUTPUT is enabled)
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch {
                // Fallback to text parsing
                this.parseTextMessage(line);
            }
        }
    }

    private handleMessage(message: any): void {
        switch (message.type) {
            case 'assistant_message':
                this.emit('message', {
                    role: 'assistant',
                    content: message.content,
                    metadata: message.metadata
                });
                break;
            
            case 'agent_update':
                this.emit('agent_update', message.agents);
                break;
            
            case 'task_update':
                this.emit('task_update', message.tasks);
                break;
            
            case 'tool_execution':
                this.emit('tool_execution', {
                    tool: message.tool,
                    args: message.args,
                    result: message.result
                });
                break;
            
            case 'error':
                this.emit('error', new Error(message.error));
                break;
            
            default:
                // Forward unknown messages
                this.emit('raw_message', message);
        }
    }

    private parseTextMessage(line: string): void {
        // Simple text parsing fallback
        // Look for patterns like [AGENT], [TASK], etc.
        
        if (line.startsWith('[AGENT]')) {
            const content = line.substring(7).trim();
            const match = content.match(/^(\w+):\s*(.+)/);
            if (match) {
                this.emit('message', {
                    role: 'assistant',
                    content: match[2],
                    metadata: { agent: match[1] }
                });
            }
        } else if (line.startsWith('[TASK]')) {
            // Parse task updates
            const content = line.substring(6).trim();
            this.emit('task_update', { raw: content });
        } else if (line.startsWith('[ERROR]')) {
            const error = line.substring(7).trim();
            this.emit('error', new Error(error));
        } else if (line.trim()) {
            // Regular message
            this.emit('message', {
                role: 'assistant',
                content: line
            });
        }
    }

    private mapMode(mode: string): string {
        const modeMap: Record<string, string> = {
            'chat': 'ask',
            'pair-programming': 'code',
            'code-review': 'security-review',
            'plan-reflect': 'architect'
        };
        
        return modeMap[mode] || 'ask';
    }

    // Utility methods for common claude-flow commands
    
    async listModes(): Promise<string[]> {
        const output = await this.executeCommand('sparc', ['modes']);
        return output.split('\n').filter(line => line.trim());
    }

    async getModeInfo(mode: string): Promise<string> {
        return await this.executeCommand('sparc', ['info', mode]);
    }

    async runTDD(feature: string): Promise<void> {
        this.process = spawn('claude-flow', ['sparc', 'tdd', `"${feature}"`], {
            cwd: this.workingDirectory,
            shell: true,
            stdio: 'pipe'
        });

        this.isRunning = true;
        this.setupProcessListeners();
    }

    // Memory operations
    async memoryStore(key: string, value: string): Promise<void> {
        await this.executeCommand('memory', ['store', key, value]);
    }

    async memoryQuery(query: string): Promise<string> {
        return await this.executeCommand('memory', ['query', query]);
    }

    async memoryList(): Promise<string[]> {
        const output = await this.executeCommand('memory', ['list']);
        return output.split('\n').filter(line => line.trim());
    }

    // Swarm operations for multi-agent coordination
    async startSwarm(agents: string[], task: string): Promise<void> {
        const agentList = agents.join(',');
        this.process = spawn('claude-flow', ['swarm', 'run', `--agents="${agentList}"`, `"${task}"`], {
            cwd: this.workingDirectory,
            shell: true,
            stdio: 'pipe'
        });

        this.isRunning = true;
        this.setupProcessListeners();
    }
}