import { platform } from 'os';
import { TerminalError } from '../../utils/errors.js';
import { generateId, delay, timeout, createDeferred } from '../../utils/helpers.js';
let VSCodeTerminalWrapper = class VSCodeTerminalWrapper {
    vscodeApi;
    shellType;
    logger;
    id;
    pid;
    vscodeTerminal;
    outputBuffer = '';
    commandMarker;
    outputDeferred = createDeferred();
    isDisposed = false;
    constructor(vscodeApi, shellType, logger){
        this.vscodeApi = vscodeApi;
        this.shellType = shellType;
        this.logger = logger;
        this.id = generateId('vscode-term');
        this.commandMarker = `__CLAUDE_FLOW_${this.id}__`;
    }
    async initialize() {
        try {
            const shellPath = this.getShellPath();
            const terminalOptions = {
                name: `Claude-Flow Terminal ${this.id}`,
                shellArgs: this.getShellArgs(),
                env: {
                    CLAUDE_FLOW_TERMINAL: 'true',
                    CLAUDE_FLOW_TERMINAL_ID: this.id,
                    PS1: '$ '
                }
            };
            if (shellPath !== undefined) {
                terminalOptions.shellPath = shellPath;
            }
            this.vscodeTerminal = this.vscodeApi.window.createTerminal(terminalOptions);
            const processId = await this.vscodeTerminal.processId;
            if (processId !== undefined) {
                this.pid = processId;
            }
            this.vscodeTerminal.show(true);
            await this.waitForReady();
            this.logger.debug('VSCode terminal initialized', {
                id: this.id,
                pid: this.pid
            });
        } catch (error) {
            throw new TerminalError('Failed to create VSCode terminal', {
                error
            });
        }
    }
    async executeCommand(command) {
        if (!this.vscodeTerminal || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        try {
            this.outputBuffer = '';
            this.outputDeferred = createDeferred();
            const markedCommand = `${command} && echo "${this.commandMarker}"`;
            this.vscodeTerminal.sendText(markedCommand, true);
            const output = await timeout(this.outputDeferred.promise, 30000, 'Command execution timeout');
            return output;
        } catch (error) {
            throw new TerminalError('Failed to execute command', {
                command,
                error
            });
        }
    }
    async write(data) {
        if (!this.vscodeTerminal || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        this.vscodeTerminal.sendText(data, false);
    }
    async read() {
        if (!this.vscodeTerminal || !this.isAlive()) {
            throw new TerminalError('Terminal is not alive');
        }
        const output = this.outputBuffer;
        this.outputBuffer = '';
        return output;
    }
    isAlive() {
        return !this.isDisposed && this.vscodeTerminal !== undefined;
    }
    async kill() {
        if (this.vscodeTerminal && !this.isDisposed) {
            try {
                this.vscodeTerminal.sendText('exit', true);
                await delay(500);
                this.vscodeTerminal.dispose();
                this.isDisposed = true;
            } catch (error) {
                this.logger.warn('Error killing VSCode terminal', {
                    id: this.id,
                    error
                });
            }
        }
    }
    processOutput(data) {
        this.outputBuffer += data;
        const markerIndex = this.outputBuffer.indexOf(this.commandMarker);
        if (markerIndex !== -1) {
            const output = this.outputBuffer.substring(0, markerIndex).trim();
            this.outputBuffer = this.outputBuffer.substring(markerIndex + this.commandMarker.length).trim();
            this.outputDeferred.resolve(output);
        }
    }
    getShellPath() {
        switch(this.shellType){
            case 'bash':
                return '/bin/bash';
            case 'zsh':
                return '/bin/zsh';
            case 'powershell':
                return platform() === 'win32' ? 'powershell.exe' : 'pwsh';
            case 'cmd':
                return platform() === 'win32' ? 'cmd.exe' : undefined;
            default:
                return undefined;
        }
    }
    getShellArgs() {
        switch(this.shellType){
            case 'bash':
                return [
                    '--norc',
                    '--noprofile'
                ];
            case 'zsh':
                return [
                    '--no-rcs'
                ];
            case 'powershell':
                return [
                    '-NoProfile',
                    '-NonInteractive'
                ];
            case 'cmd':
                return [
                    '/Q'
                ];
            default:
                return [];
        }
    }
    async waitForReady() {
        this.vscodeTerminal.sendText('echo "READY"', true);
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
export class VSCodeAdapter {
    logger;
    terminals = new Map();
    vscodeApi;
    shellType;
    terminalCloseListener;
    constructor(logger){
        this.logger = logger;
        this.shellType = this.detectShell();
    }
    async initialize() {
        this.logger.info('Initializing VSCode terminal adapter');
        if (!this.isVSCodeExtensionContext()) {
            throw new TerminalError('Not running in VSCode extension context');
        }
        this.vscodeApi = globalThis.vscode;
        if (!this.vscodeApi) {
            throw new TerminalError('VSCode API not available');
        }
        this.terminalCloseListener = this.vscodeApi.window.onDidCloseTerminal((terminal)=>{
            for (const [id, wrapper] of this.terminals.entries()){
                if (wrapper.vscodeTerminal === terminal) {
                    this.logger.info('VSCode terminal closed', {
                        id
                    });
                    this.terminals.delete(id);
                    break;
                }
            }
        });
        this.logger.info('VSCode terminal adapter initialized');
    }
    async shutdown() {
        this.logger.info('Shutting down VSCode terminal adapter');
        if (this.terminalCloseListener) {
            this.terminalCloseListener.dispose();
        }
        const terminals = Array.from(this.terminals.values());
        await Promise.all(terminals.map((term)=>term.kill()));
        this.terminals.clear();
    }
    async createTerminal() {
        if (!this.vscodeApi) {
            throw new TerminalError('VSCode API not initialized');
        }
        const terminal = new VSCodeTerminalWrapper(this.vscodeApi, this.shellType, this.logger);
        await terminal.initialize();
        this.terminals.set(terminal.id, terminal);
        const outputProcessor = globalThis.registerTerminalOutputProcessor;
        if (outputProcessor) {
            outputProcessor(terminal.id, (data)=>terminal.processOutput(data));
        }
        return terminal;
    }
    async destroyTerminal(terminal) {
        await terminal.kill();
        this.terminals.delete(terminal.id);
    }
    isVSCodeExtensionContext() {
        return typeof globalThis.vscode !== 'undefined' && typeof globalThis.vscode.window !== 'undefined';
    }
    detectShell() {
        const osplatform = platform();
        if (osplatform === 'win32') {
            const comspec = process.env.COMSPEC;
            if (comspec?.toLowerCase().includes('powershell')) {
                return 'powershell';
            }
            return 'cmd';
        } else {
            const shell = process.env.SHELL;
            if (shell) {
                const shellName = shell.split('/').pop();
                if (shellName && [
                    'bash',
                    'zsh',
                    'fish',
                    'sh'
                ].includes(shellName)) {
                    return shellName;
                }
            }
            return 'bash';
        }
    }
}

//# sourceMappingURL=vscode.js.map