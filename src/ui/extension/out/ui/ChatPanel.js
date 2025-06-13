"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
class ChatPanel {
    constructor(panel, extensionContext) {
        this.extensionContext = extensionContext;
        this.disposables = [];
        this.panel = panel;
        this.setupWebview();
        this.setupEventListeners();
    }
    static createOrShow(extensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return ChatPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel('claudeFlowChat', 'Claude Flow Chat', column || vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionContext.vscodeContext.extensionUri, 'media'),
                vscode.Uri.joinPath(extensionContext.vscodeContext.extensionUri, 'out', 'webview')
            ]
        });
        ChatPanel.currentPanel = new ChatPanel(panel, extensionContext);
        return ChatPanel.currentPanel;
    }
    setupWebview() {
        this.panel.webview.html = this.getWebviewContent();
        this.panel.iconPath = vscode.Uri.joinPath(this.extensionContext.vscodeContext.extensionUri, 'media', 'icon.png');
    }
    setupEventListeners() {
        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleWebviewMessage(message);
        }, null, this.disposables);
        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        // Setup chat manager listeners
        this.extensionContext.chatManager.on('user-message', (message) => {
            this.sendToWebview({
                type: 'user-message',
                payload: message
            });
        });
        this.extensionContext.chatManager.on('assistant-message-start', (message) => {
            this.sendToWebview({
                type: 'assistant-message-start',
                payload: message
            });
        });
        this.extensionContext.chatManager.on('stream-chunk', (chunk) => {
            this.sendToWebview({
                type: 'stream-chunk',
                payload: chunk
            });
        });
        this.extensionContext.chatManager.on('assistant-message-complete', (message) => {
            this.sendToWebview({
                type: 'assistant-message-complete',
                payload: message
            });
        });
        // Setup orchestrator listeners
        this.extensionContext.orchestratorManager.on('agent-update', (agents) => {
            this.sendToWebview({
                type: 'agent-update',
                payload: agents
            });
        });
        this.extensionContext.orchestratorManager.on('task-update', (tasks) => {
            this.sendToWebview({
                type: 'task-update',
                payload: tasks
            });
        });
        this.extensionContext.orchestratorManager.on('error', (error) => {
            this.sendToWebview({
                type: 'error',
                payload: error.message
            });
        });
    }
    async handleWebviewMessage(message) {
        switch (message.type) {
            case 'user-message':
                await this.handleUserMessage(message.payload);
                break;
            case 'mode-change':
                await this.handleModeChange(message.payload);
                break;
            case 'apply-code':
                await this.handleApplyCode(message.payload);
                break;
            case 'stop-execution':
                await this.handleStopExecution();
                break;
            case 'ready':
                await this.handleWebviewReady();
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    }
    async handleUserMessage(payload) {
        try {
            await this.extensionContext.chatManager.sendMessage(payload.content, payload.mode);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleModeChange(payload) {
        try {
            await this.extensionContext.orchestratorManager.switchMode(payload.mode);
            this.sendToWebview({
                type: 'mode-changed',
                payload: payload.mode
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to switch mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleApplyCode(payload) {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor to apply code');
                return;
            }
            const edit = new vscode.WorkspaceEdit();
            if (payload.file) {
                // Apply to specific file
                const uri = vscode.Uri.file(payload.file);
                edit.replace(uri, new vscode.Range(0, 0, editor.document.lineCount, 0), payload.code);
            }
            else {
                // Apply to active editor
                const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(editor.document.getText().length));
                edit.replace(editor.document.uri, fullRange, payload.code);
            }
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('Code applied successfully');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to apply code: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleStopExecution() {
        try {
            await this.extensionContext.orchestratorManager.stopExecution();
            this.sendToWebview({
                type: 'execution-stopped',
                payload: null
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to stop execution: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleWebviewReady() {
        // Initialize webview with current state
        const sessionId = this.extensionContext.chatManager.getActiveSession();
        if (sessionId) {
            const history = this.extensionContext.chatManager.getHistory(sessionId);
            this.sendToWebview({
                type: 'initialize',
                payload: {
                    messages: history,
                    mode: this.extensionContext.orchestratorManager.getCurrentMode(),
                    agents: this.extensionContext.orchestratorManager.getActiveAgents()
                }
            });
        }
    }
    sendToWebview(message) {
        this.panel.webview.postMessage(message);
    }
    getWebviewContent() {
        const webviewPath = vscode.Uri.joinPath(this.extensionContext.vscodeContext.extensionUri, 'out', 'webview');
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'main.js'));
        const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(webviewPath, 'style.css'));
        const nonce = this.getNonce();
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
            <link href="${styleUri}" rel="stylesheet">
            <title>Claude Flow Chat</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
    }
    getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
    dispose() {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
exports.ChatPanel = ChatPanel;
//# sourceMappingURL=ChatPanel.js.map