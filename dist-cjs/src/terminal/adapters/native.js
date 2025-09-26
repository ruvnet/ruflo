import * as process from 'node:process';
import { spawn } from 'child_process';
import { platform } from 'os';
import { TerminalError, TerminalCommandError } from '../../utils/errors.js';
import { generateId, delay, timeout, createDeferred } from '../../utils/helpers.js';
let NativeTerminal = class NativeTerminal {
    logger;
    id;
    pid;
    process;
    encoder = new TextEncoder();
    decoder = new TextDecoder();
    shell;
    outputBuffer = '';
    errorBuffer = '';
    commandMarker;
    commandDeferred;
    outputListeners = new Set();
    alive = true;
    stdoutData = '';
    stderrData = '';
    constructor(shell, logger){
        this.logger = logger;
        this.id = generateId('native-term');
        this.shell = shell;
        this.commandMarker = `__CLAUDE_FLOW_${this.id}__`;
    }
    async initialize() {
        try {
            const shellConfig = this.getShellConfig();
            this.process = spawn(shellConfig.path, shellConfig.args, {
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ],
                env: {
                    ...process.env,
                    ...shellConfig.env,
                    CLAUDE_FLOW_TERMINAL: 'true',
                    CLAUDE_FLOW_TERMINAL_ID: this.id
                }
            });
            this.pid = this.process.pid;
            this.setupOutputHandlers();
            this.monitorProcess();
            await this.waitForReady();
            this.logger.debug('Native terminal initialized', {
                id: this.id,
                pid: this.pid,
                shell: this.shell
            });
        } catch (error) {
            this.alive = false;
            throw new TerminalError('Failed to create native terminal', {
                error
            });
        }
    }
    async executeCommand(command) {
        if (!this.process || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        try {
            this.commandDeferred = createDeferred();
            this.outputBuffer = '';
            const markedCommand = this.wrapCommand(command);
            await this.write(markedCommand + '\n');
            const output = await timeout(this.commandDeferred.promise, 30000, 'Command execution timeout');
            return output;
        } catch (error) {
            throw new TerminalCommandError('Failed to execute command', {
                command,
                error
            });
        }
    }
    async write(data) {
        if (!this.process || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        return new Promise((resolve, reject)=>{
            if (!this.process?.stdin) {
                reject(new TerminalError('Process stdin not available'));
                return;
            }
            this.process.stdin.write(data, (error)=>{
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
    async read() {
        if (!this.process || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        const output = this.outputBuffer;
        this.outputBuffer = '';
        return output;
    }
    isAlive() {
        return this.alive && this.process !== undefined;
    }
    async kill() {
        if (!this.process) return;
        try {
            this.alive = false;
            if (this.process.stdin && !this.process.stdin.destroyed) {
                this.process.stdin.end();
            }
            try {
                await this.write('exit\n');
                await delay(500);
            } catch  {}
            try {
                this.process.kill('SIGTERM');
                await delay(500);
                if (!this.process.killed) {
                    this.process.kill('SIGKILL');
                }
            } catch  {}
        } catch (error) {
            this.logger.warn('Error killing native terminal', {
                id: this.id,
                error
            });
        } finally{
            this.process = undefined;
        }
    }
    addOutputListener(listener) {
        this.outputListeners.add(listener);
    }
    removeOutputListener(listener) {
        this.outputListeners.delete(listener);
    }
    getShellConfig() {
        const osplatform = platform();
        switch(this.shell){
            case 'bash':
                return {
                    path: osplatform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
                    args: [
                        '--norc',
                        '--noprofile'
                    ],
                    env: {
                        PS1: '$ '
                    }
                };
            case 'zsh':
                return {
                    path: '/bin/zsh',
                    args: [
                        '--no-rcs'
                    ],
                    env: {
                        PS1: '$ '
                    }
                };
            case 'powershell':
                return {
                    path: osplatform === 'win32' ? 'powershell.exe' : 'pwsh',
                    args: [
                        '-NoProfile',
                        '-NonInteractive',
                        '-NoLogo'
                    ]
                };
            case 'cmd':
                return {
                    path: 'cmd.exe',
                    args: [
                        '/Q',
                        '/K',
                        'prompt $G'
                    ]
                };
            case 'sh':
            default:
                return {
                    path: '/bin/sh',
                    args: [],
                    env: {
                        PS1: '$ '
                    }
                };
        }
    }
    wrapCommand(command) {
        const osplatform = platform();
        if (this.shell === 'powershell') {
            return `${command}; Write-Host "${this.commandMarker}"`;
        } else if (this.shell === 'cmd' && osplatform === 'win32') {
            return `${command} & echo ${this.commandMarker}`;
        } else {
            return `${command} && echo "${this.commandMarker}" || (echo "${this.commandMarker}"; false)`;
        }
    }
    setupOutputHandlers() {
        if (!this.process) return;
        this.process.stdout?.on('data', (data)=>{
            const text = data.toString();
            this.processOutput(text);
        });
        this.process.stderr?.on('data', (data)=>{
            const text = data.toString();
            this.errorBuffer += text;
            this.notifyListeners(text);
        });
        this.process.on('error', (error)=>{
            if (this.alive) {
                this.logger.error('Process error', {
                    id: this.id,
                    error
                });
            }
        });
    }
    processOutput(text) {
        this.outputBuffer += text;
        this.notifyListeners(text);
        const markerIndex = this.outputBuffer.indexOf(this.commandMarker);
        if (markerIndex !== -1 && this.commandDeferred) {
            const output = this.outputBuffer.substring(0, markerIndex).trim();
            const fullOutput = this.errorBuffer ? `${output}\n${this.errorBuffer}` : output;
            this.errorBuffer = '';
            this.outputBuffer = this.outputBuffer.substring(markerIndex + this.commandMarker.length).trim();
            this.commandDeferred.resolve(fullOutput);
            this.commandDeferred = undefined;
        }
    }
    notifyListeners(data) {
        this.outputListeners.forEach((listener)=>{
            try {
                listener(data);
            } catch (error) {
                this.logger.error('Error in output listener', {
                    id: this.id,
                    error
                });
            }
        });
    }
    async monitorProcess() {
        if (!this.process) return;
        this.process.on('exit', (code, signal)=>{
            this.logger.info('Terminal process exited', {
                id: this.id,
                code,
                signal
            });
            this.alive = false;
            if (this.commandDeferred) {
                this.commandDeferred.reject(new Error('Terminal process exited'));
            }
        });
        this.process.on('error', (error)=>{
            this.logger.error('Error monitoring process', {
                id: this.id,
                error
            });
            this.alive = false;
            if (this.commandDeferred) {
                this.commandDeferred.reject(error);
            }
        });
    }
    async waitForReady() {
        const testCommand = this.shell === 'powershell' ? 'Write-Host "READY"' : 'echo "READY"';
        await this.write(testCommand + '\n');
        const startTime = Date.now();
        while(Date.now() - startTime < 5000){
            if (this.outputBuffer.includes('READY')) {
                this.outputBuffer = '';
                return;
            }
            await delay(100);
        }
        throw new TerminalError('Terminal failed to become ready');
    }
};
export class NativeAdapter {
    logger;
    terminals = new Map();
    shell;
    constructor(logger){
        this.logger = logger;
        this.shell = this.detectShell();
    }
    async initialize() {
        this.logger.info('Initializing native terminal adapter', {
            shell: this.shell
        });
        try {
            const testConfig = this.getTestCommand();
            const { spawnSync } = require('child_process');
            const result = spawnSync(testConfig.cmd, testConfig.args, {
                stdio: 'ignore'
            });
            if (result.status !== 0) {
                throw new Error('Shell test failed');
            }
        } catch (error) {
            this.logger.warn(`Shell ${this.shell} not available, falling back to sh`, {
                error
            });
            this.shell = 'sh';
        }
    }
    async shutdown() {
        this.logger.info('Shutting down native terminal adapter');
        const terminals = Array.from(this.terminals.values());
        await Promise.all(terminals.map((term)=>term.kill()));
        this.terminals.clear();
    }
    async createTerminal() {
        const terminal = new NativeTerminal(this.shell, this.logger);
        await terminal.initialize();
        this.terminals.set(terminal.id, terminal);
        return terminal;
    }
    async destroyTerminal(terminal) {
        await terminal.kill();
        this.terminals.delete(terminal.id);
    }
    detectShell() {
        const osplatform = platform();
        if (osplatform === 'win32') {
            const comspec = process.env.COMSPEC;
            if (comspec?.toLowerCase().includes('powershell')) {
                return 'powershell';
            }
            try {
                const { spawnSync } = require('child_process');
                const result = spawnSync('powershell', [
                    '-Version'
                ], {
                    stdio: 'ignore'
                });
                if (result.status === 0) {
                    return 'powershell';
                }
            } catch  {}
            return 'cmd';
        } else {
            const shell = process.env.SHELL;
            if (shell) {
                const shellName = shell.split('/').pop();
                if (shellName && this.isShellSupported(shellName)) {
                    return shellName;
                }
            }
            const shells = [
                'bash',
                'zsh',
                'sh'
            ];
            for (const shell of shells){
                try {
                    const { spawnSync } = require('child_process');
                    const result = spawnSync('which', [
                        shell
                    ], {
                        stdio: 'ignore'
                    });
                    if (result.status === 0) {
                        return shell;
                    }
                } catch  {}
            }
            return 'sh';
        }
    }
    isShellSupported(shell) {
        return [
            'bash',
            'zsh',
            'sh',
            'fish',
            'dash',
            'powershell',
            'cmd'
        ].includes(shell);
    }
    getTestCommand() {
        switch(this.shell){
            case 'powershell':
                return {
                    cmd: 'powershell',
                    args: [
                        '-Version'
                    ]
                };
            case 'cmd':
                return {
                    cmd: 'cmd',
                    args: [
                        '/C',
                        'echo test'
                    ]
                };
            default:
                return {
                    cmd: this.shell,
                    args: [
                        '--version'
                    ]
                };
        }
    }
}

//# sourceMappingURL=native.js.map