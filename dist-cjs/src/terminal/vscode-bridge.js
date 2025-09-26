import * as vscode from 'vscode';
const terminalOutputProcessors = new Map();
const activeTerminals = new Map();
const terminalWriteEmulators = new Map();
export function initializeTerminalBridge(context) {
    globalThis.vscode = vscode;
    globalThis.registerTerminalOutputProcessor = (terminalId, processor)=>{
        terminalOutputProcessors.set(terminalId, processor);
    };
    const originalCreateTerminal = vscode.window.createTerminal;
    vscode.window.createTerminal = function(options) {
        const terminal = originalCreateTerminal.call(vscode.window, options);
        const writeEmulator = new vscode.EventEmitter();
        terminalWriteEmulators.set(terminal, writeEmulator);
        const match = options.name?.match(/Claude-Flow Terminal ([\w-]+)/);
        if (match) {
            const terminalId = match[1];
            activeTerminals.set(terminalId, terminal);
            captureTerminalOutput(terminal, terminalId);
        }
        return terminal;
    };
    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal)=>{
        for (const [id, term] of activeTerminals.entries()){
            if (term === terminal) {
                activeTerminals.delete(id);
                terminalOutputProcessors.delete(id);
                break;
            }
        }
        const emulator = terminalWriteEmulators.get(terminal);
        if (emulator) {
            emulator.dispose();
            terminalWriteEmulators.delete(terminal);
        }
    }));
}
function captureTerminalOutput(terminal, terminalId) {
    const originalSendText = terminal.sendText;
    terminal.sendText = function(text, addNewLine) {
        originalSendText.call(terminal, text, addNewLine);
        const processor = terminalOutputProcessors.get(terminalId);
        if (processor && text) {
            processor(text + (addNewLine !== false ? '\n' : ''));
        }
    };
    if ('onDidWriteData' in terminal) {
        const writeDataEvent = terminal.onDidWriteData;
        if (writeDataEvent) {
            writeDataEvent((data)=>{
                const processor = terminalOutputProcessors.get(terminalId);
                if (processor) {
                    processor(data);
                }
            });
        }
    }
    setupTerminalRenderer(terminal, terminalId);
}
function setupTerminalRenderer(terminal, terminalId) {
    if (vscode.window.registerTerminalProfileProvider) {
        let lastOutput = '';
        const checkOutput = setInterval(()=>{
            if (!activeTerminals.has(terminalId)) {
                clearInterval(checkOutput);
            }
        }, 100);
    }
}
export async function createCapturedTerminal(name, shellPath, shellArgs) {
    const writeEmulator = new vscode.EventEmitter();
    const terminal = vscode.window.createTerminal({
        name,
        shellPath,
        shellArgs
    });
    terminalWriteEmulators.set(terminal, writeEmulator);
    return {
        terminal,
        onData: writeEmulator.event
    };
}
export async function executeTerminalCommand(terminal, command, timeout = 30000) {
    return new Promise((resolve, reject)=>{
        const writeEmulator = terminalWriteEmulators.get(terminal);
        if (!writeEmulator) {
            reject(new Error('No write emulator for terminal'));
            return;
        }
        let output = '';
        const marker = `__COMMAND_COMPLETE_${Date.now()}__`;
        const disposable = writeEmulator.event((data)=>{
            output += data;
            if (output.includes(marker)) {
                disposable.dispose();
                const result = output.substring(0, output.indexOf(marker));
                resolve(result);
            }
        });
        const timer = setTimeout(()=>{
            disposable.dispose();
            reject(new Error('Command timeout'));
        }, timeout);
        terminal.sendText(`${command} && echo "${marker}"`);
        writeEmulator.event(()=>{
            if (output.includes(marker)) {
                clearTimeout(timer);
            }
        });
    });
}
export function getTerminalById(terminalId) {
    return activeTerminals.get(terminalId);
}
export function disposeTerminalBridge() {
    for (const terminal of activeTerminals.values()){
        terminal.dispose();
    }
    activeTerminals.clear();
    terminalOutputProcessors.clear();
    for (const emulator of terminalWriteEmulators.values()){
        emulator.dispose();
    }
    terminalWriteEmulators.clear();
}

//# sourceMappingURL=vscode-bridge.js.map