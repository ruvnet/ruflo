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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const ChatPanel_1 = require("../ui/ChatPanel");
const OperationMode_1 = require("../types/OperationMode");
function registerCommands(context, extensionContext) {
    // Open Chat command
    const openChatCommand = vscode.commands.registerCommand('claude-flow.openChat', () => {
        ChatPanel_1.ChatPanel.createOrShow(extensionContext);
    });
    context.subscriptions.push(openChatCommand);
    // Ask Claude command (with selected text)
    const askClaudeCommand = vscode.commands.registerCommand('claude-flow.askClaude', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showInformationMessage('Please select some code to ask about');
            return;
        }
        // Open chat panel
        const chatPanel = ChatPanel_1.ChatPanel.createOrShow(extensionContext);
        // Create a session if needed
        if (!extensionContext.chatManager.getActiveSession()) {
            extensionContext.chatManager.createSession();
        }
        // Send the selected text with context
        const language = editor.document.languageId;
        const fileName = editor.document.fileName;
        const prompt = `Please help me understand this ${language} code from ${fileName}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``;
        await extensionContext.chatManager.sendMessage(prompt, OperationMode_1.OperationMode.Chat);
    });
    context.subscriptions.push(askClaudeCommand);
    // Switch Mode command
    const switchModeCommand = vscode.commands.registerCommand('claude-flow.switchMode', async () => {
        const modes = [
            { label: 'Chat', value: OperationMode_1.OperationMode.Chat, description: 'Simple Q&A interactions' },
            { label: 'Pair Programming', value: OperationMode_1.OperationMode.PairProgramming, description: 'Context-aware coding assistance' },
            { label: 'Code Review', value: OperationMode_1.OperationMode.CodeReview, description: 'Analyze code for improvements' },
            { label: 'Plan & Reflect', value: OperationMode_1.OperationMode.PlanReflect, description: 'Autonomous multi-step task execution' }
        ];
        const selected = await vscode.window.showQuickPick(modes, {
            placeHolder: 'Select an operation mode',
            title: 'Claude Flow Mode'
        });
        if (selected) {
            try {
                await extensionContext.orchestratorManager.switchMode(selected.value);
                vscode.window.showInformationMessage(`Switched to ${selected.label} mode`);
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to switch mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    });
    context.subscriptions.push(switchModeCommand);
    // Stop Execution command
    const stopExecutionCommand = vscode.commands.registerCommand('claude-flow.stopExecution', async () => {
        try {
            await extensionContext.orchestratorManager.stopExecution();
            vscode.window.showInformationMessage('Execution stopped');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to stop execution: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });
    context.subscriptions.push(stopExecutionCommand);
    // Code Review command (review current file)
    const codeReviewCommand = vscode.commands.registerCommand('claude-flow.reviewCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }
        const document = editor.document;
        const code = document.getText();
        const language = document.languageId;
        const fileName = document.fileName;
        // Open chat panel
        ChatPanel_1.ChatPanel.createOrShow(extensionContext);
        // Create a session if needed
        if (!extensionContext.chatManager.getActiveSession()) {
            extensionContext.chatManager.createSession();
        }
        // Switch to code review mode
        await extensionContext.orchestratorManager.switchMode(OperationMode_1.OperationMode.CodeReview);
        // Send the code for review
        const prompt = `Please review this ${language} code from ${fileName} and suggest improvements:\n\n\`\`\`${language}\n${code}\n\`\`\``;
        await extensionContext.chatManager.sendMessage(prompt, OperationMode_1.OperationMode.CodeReview);
    });
    context.subscriptions.push(codeReviewCommand);
    // Set API Key command
    const setApiKeyCommand = vscode.commands.registerCommand('claude-flow.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic Claude API Key',
            password: true,
            placeHolder: 'sk-ant-...'
        });
        if (apiKey) {
            try {
                await extensionContext.configManager.setApiKey(apiKey);
                vscode.window.showInformationMessage('API key saved successfully');
                // Reinitialize orchestrator with new key
                await extensionContext.orchestratorManager.initialize({
                    apiKey,
                    model: extensionContext.configManager.getModel(),
                    maxTokens: extensionContext.configManager.getMaxTokens(),
                    memoryPath: extensionContext.memoryManager.getStoragePath()
                });
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to save API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    });
    context.subscriptions.push(setApiKeyCommand);
    // Clear Chat History command
    const clearChatCommand = vscode.commands.registerCommand('claude-flow.clearChat', async () => {
        const activeSession = extensionContext.chatManager.getActiveSession();
        if (!activeSession) {
            vscode.window.showInformationMessage('No active chat session');
            return;
        }
        const confirm = await vscode.window.showWarningMessage('Are you sure you want to clear the chat history?', 'Yes', 'No');
        if (confirm === 'Yes') {
            extensionContext.chatManager.clearSession(activeSession);
            vscode.window.showInformationMessage('Chat history cleared');
        }
    });
    context.subscriptions.push(clearChatCommand);
}
//# sourceMappingURL=registerCommands.js.map